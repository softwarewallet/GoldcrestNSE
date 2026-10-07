import { ForexDataProvider } from '../markets/forex/provider';
import { ForexCandle, ForexMarketStatus, ForexQuote, ForexTimeframe } from '../markets/forex/types';
import { FOREX_PAIRS, getForexPairConfig } from '../markets/forex/instruments';
import { ForexSignalEngine } from '../markets/forex/signalEngine';
import { getForexSessionState } from '../markets/common/session';
import { getAutoLiveMarketGate, AutoLiveMarketGate } from './marketOpenGate';
import { getMarketTrendContext } from './marketHistoryService';
import { fetchLiveForexNews, LiveNewsSnapshot } from './liveNewsService';
import { brokerRegistry } from '../brokers/registry';
import { autoExecutionEngine, LIVE_AUTO_EXECUTION_ALLOWED, armAutonomousExecutionGate, refreshAutonomousExecutionPermission, disarmLocalAutonomousExecution } from '../brokers/safety/AutoExecutionEngine';
import { autoTradeReadinessService } from '../brokers/safety/AutoTradeReadiness';
import { getSystemConfig } from './configService';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { BrokerAdapter, ConnectionTestResult, NormalizedQuote, OrderRequest } from '../brokers/types';
import { liveRuntimeLog, tradeAuditLog } from './liveRuntimeLog';
import { calculateForexPipTargets, normalizePriceToThreeDigits, sizeForexOrderToMaxTradeValue } from '../brokers/safety/TradeSizing';
import { recordLiveTradeResearchSignal, updateLiveTradeResearchQuote, updateLiveTradeResearchExecution } from './liveTradeResearchService';
import { AUTO_LIVE_POSITION_CAPACITY_POLL_MS, AUTO_LIVE_RUNTIME_RECOVERY_POLL_MS, getAutoLiveParallelTradePolicy, hasPairPositionCapacity } from './autoLiveTradePolicy';

const LIVE_QUOTE_MAX_AGE_MS = 30_000;

const AUTO_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.GOLDCREST_AUTO_TRADING_INTERVAL_MS || 60_000)
);

const DEFAULT_AUTO_FOREX_PAIRS = FOREX_PAIRS.map(pair => pair.symbol);

export async function validateAutoLiveCTraderConnection(
  adapter: Pick<BrokerAdapter, 'testConnection'>
): Promise<{ ok: boolean; message: string; result: ConnectionTestResult }> {
  try {
    const result = await adapter.testConnection();
    const selectedMode = result.apiMode || 'LIVE';
    const endpoint = result.apiEndpoint || 'unknown endpoint';
    if (!result.connected) return { ok:false, message:`cTrader ${selectedMode} API connection preflight failed: ${result.error || 'connection test failed'} (${endpoint}).`, result };
    return { ok:true, message:`cTrader ${selectedMode} API connection preflight passed (${endpoint}).`, result };
  } catch (error: any) {
    const result = { broker:'CTRADER' as const, environment:'LIVE' as const, connected:false, error:error?.message || String(error), timestamp:Date.now() } satisfies ConnectionTestResult;
    return { ok:false, message:`cTrader API connection preflight failed: ${result.error}.`, result };
  }
}

function getConfiguredAutoForexPairs(): string[] {
  const configured = getSystemConfig().autoLiveForexPairs;
  if (!Array.isArray(configured) || configured.length === 0) return [...DEFAULT_AUTO_FOREX_PAIRS];
  return [...new Set(configured
    .map(symbol => String(symbol).toUpperCase().trim())
    .filter(symbol => /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol)))];
}

// Pre-open preparation is background work. Keep the operator-facing arm fast,
// avoid repeating the same broker history fetch every minute, and bound
// concurrent pair preparation so cTrader is not flooded with sessions.
const PREOPEN_PREPARATION_MIN_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.GOLDCREST_PREOPEN_MIN_INTERVAL_MS || 120_000)
);
const PREOPEN_PAIR_CONCURRENCY = Math.max(
  1,
  Math.min(3, Number(process.env.GOLDCREST_PREOPEN_PAIR_CONCURRENCY || 3))
);

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}

class LiveForexSignalProvider implements ForexDataProvider {
  readonly providerName = 'CTRADER_LIVE_PROVIDER';
  readonly status = 'LIVE' as const;
  readonly isDemo = false;

  private candles = new Map<string, ForexCandle[]>();
  private quotes = new Map<string, ForexQuote>();

  async refreshPair(pair: string): Promise<void> {
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
    if (!adapter.getHistoricalCandles) {
      throw new Error('Authoritative cTrader historical market-data capability is unavailable.');
    }

    const timeframes: ForexTimeframe[] = ['5M', '15M', '1H', '4H', 'Daily'];
    const rows = await Promise.all(
      timeframes.map(async timeframe => ({
        timeframe,
        data: await adapter.getHistoricalCandles(pair, timeframe, 80)
      }))
    );

    for (const row of rows) {
      if (!Array.isArray(row.data) || row.data.length < 35) {
        throw new Error(`Insufficient live ${row.timeframe} candle history for ${pair}.`);
      }
      this.candles.set(`${pair}:${row.timeframe}`, row.data as ForexCandle[]);
    }

    // Pre-open trend preparation only needs historical candles. A live quote
    // is fetched again at the execution boundary, so opening another broker
    // WebSocket here only adds latency and can block preparation unnecessarily.
  }

  getQuote(pair: string): ForexQuote {
    const quote = this.quotes.get(pair);
    if (!quote) throw new Error(`Live quote cache is empty for ${pair}.`);
    return quote;
  }

  getCandles(pair: string, timeframe: ForexTimeframe = '15M', limit = 80): ForexCandle[] {
    const rows = this.candles.get(`${pair}:${timeframe}`) || [];
    return rows.slice(Math.max(0, rows.length - limit));
  }

  getLatestCandle(pair: string, timeframe: ForexTimeframe = '15M'): ForexCandle {
    const rows = this.getCandles(pair, timeframe, 2);
    if (!rows.length) throw new Error(`Live candle cache is empty for ${pair} ${timeframe}.`);
    return rows[rows.length - 1];
  }

  getAvailablePairs() {
    return FOREX_PAIRS;
  }

  getMarketStatus(): ForexMarketStatus {
    const session = getForexSessionState();
    const isOpen = !session.activeSessions.includes('CLOSED (WEEKEND)');
    return {
      isOpen,
      status: isOpen ? 'OPEN' : 'WEEKEND',
      activeSessions: session.activeSessions,
      currentSession: session.activeSessions.join(' / ') || 'Interbank Electronic Off-Peak',
      isLondonNyOverlap: session.isLondonNyOverlap,
      serverUtcTime: new Date().toISOString()
    };
  }
}

export type AutoTradingState = 'STOPPED' | 'PREPARING' | 'RUNNING' | 'PAUSED_LIMIT' | 'PAUSED_RUNTIME' | 'BLOCKED';
export type AutoTradingExecutionStage = 'IDLE' | 'SCANNING_MARKET' | 'ANALYZING_SIGNAL' | 'PREPARING_ORDER' | 'SAFETY_GATE' | 'SUBMITTING_ORDER' | 'TRADE_EXECUTED' | 'REJECTED';

export interface AutoTradingExecutionStatus {
  stage: AutoTradingExecutionStage;
  pair: string | null;
  side: 'BUY' | 'SELL' | null;
  signalId: string | null;
  message: string;
  updatedAt: number;
}

export interface AutoTradingStatus {
  state: AutoTradingState;
  enabledByEnvironment: boolean;
  autonomousPermission: boolean;
  intervalMs: number;
  minSignalScore: number;
  maxTradesPerPair: number;
  maxOpenPositions: number;
  pairs: string[];
  indianUnderlyings: string[];
  lastCycleAt: number | null;
  lastCycleResult: string | null;
  lastActions: Array<{
    pair: string;
    result: string;
    signalId?: string;
    reason?: string;
    orderId?: string;
  }>;
  marketGate: AutoLiveMarketGate;
  currentExecution: AutoTradingExecutionStatus;
  lastExecution: AutoTradingExecutionStatus | null;
  executionPausedByPositionLimit: boolean;
  runtimeFaultReason?: string | null;
  preOpenPreparation: {
    lastPreparedAt: number | null;
    trendPairsEvaluated: number;
    news: LiveNewsSnapshot | null;
    status: 'IDLE' | 'RUNNING' | 'READY' | 'UNAVAILABLE';
  };
  requiresClosedMarketConfirmation?: boolean;
}

class AutoTradingService {
  private provider = new LiveForexSignalProvider();
  private signalEngine = new ForexSignalEngine(undefined, this.provider);
  private timer: NodeJS.Timeout | null = null;
  private state: AutoTradingState = 'STOPPED';
  private lastCycleAt: number | null = null;
  private lastCycleResult: string | null = null;
  private lastActions: AutoTradingStatus['lastActions'] = [];
  private lastPreOpenPreparedAt: number | null = null;
  private preOpenTrendPairsEvaluated = 0;
  private preOpenNews: LiveNewsSnapshot | null = null;
  // Snapshot of the authoritative news input used by the current Auto Live
  // cycle. It is copied into the research ledger with each evaluated signal.
  private currentCycleNews: LiveNewsSnapshot | null = null;
  private preOpenStatus: 'IDLE' | 'RUNNING' | 'READY' | 'UNAVAILABLE' = 'IDLE';
  private cycleInFlight = false;
  // When the authoritative system-wide live-position limit is full, Auto Live
  // pauses expensive market/news analysis and polls only the broker position
  // count until a slot becomes available.
  private executionPausedByPositionLimit = false;
  private positionCapacityTimer: NodeJS.Timeout | null = null;
  private runtimeRecoveryTimer: NodeJS.Timeout | null = null;
  private runtimeFaultReason: string | null = null;
  private readonly POSITION_CAPACITY_POLL_MS = AUTO_LIVE_POSITION_CAPACITY_POLL_MS;
  private readonly RUNTIME_RECOVERY_POLL_MS = AUTO_LIVE_RUNTIME_RECOVERY_POLL_MS;
  // Market analysis can run concurrently across the configured universe, but
  // broker-side execution is serialized so two pairs cannot race the same
  // account-position/exposure snapshot and bypass the global safety limits.
  private executionQueue: Promise<void> = Promise.resolve();
  private currentExecution: AutoTradingExecutionStatus = {
    stage: 'IDLE',
    pair: null,
    side: null,
    signalId: null,
    message: 'Waiting for the next Auto Live cycle.',
    updatedAt: Date.now()
  };
  private lastExecution: AutoTradingExecutionStatus | null = null;
  // Once the operator has successfully started Auto Live in this process,
  // STOP may disarm the runtime flags and a later explicit START is allowed
  // to re-arm them. A fresh process still requires the configured execution
  // flags, preserving the production safety boundary.
  private hasCompletedExplicitStart = false;

  private isRequested(): boolean {
    // Development mode is not itself an execution request. Autonomous live
    // execution must be explicitly armed through the two runtime flags.
    return process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true'
      && process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true';
  }


  private async withExecutionLock<T>(worker: () => Promise<T>): Promise<T> {
    const previous = this.executionQueue;
    let release!: () => void;
    this.executionQueue = new Promise<void>(resolve => {
      release = resolve;
    });

    await previous;
    try {
      return await worker();
    } finally {
      release();
    }
  }

  private setExecutionStatus(update: Partial<AutoTradingExecutionStatus> & Pick<AutoTradingExecutionStatus, 'stage' | 'message'>): void {
    this.currentExecution = { ...this.currentExecution, ...update, updatedAt: Date.now() };
    liveRuntimeLog('INFO', 'AUTO_TRADING_EXECUTION_STAGE', this.currentExecution);
    tradeAuditLog('EXECUTION_STAGE', this.currentExecution);
  }

  private finishExecution(stage: 'TRADE_EXECUTED' | 'REJECTED', message: string, extra: Partial<AutoTradingExecutionStatus> = {}): void {
    this.setExecutionStatus({ stage, message, ...extra });
    this.lastExecution = { ...this.currentExecution };
  }

  private getConfiguredMaxOpenPositions(): number {
    return Math.max(1, Math.floor(Number(getSystemConfig().maxOpenPositions)));
  }

  private async getAuthoritativePositionCapacity(): Promise<{ current: number; max: number; available: number }> {
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
    const positions = await adapter.getPositions();
    const current = Array.isArray(positions) ? positions.length : 0;
    const max = this.getConfiguredMaxOpenPositions();
    return { current, max, available: Math.max(0, max - current) };
  }

  private pauseForPositionLimit(current: number, max: number, reason: string): void {
    this.executionPausedByPositionLimit = true;
    this.lastCycleResult = `Auto Live paused: ${reason} (${current}/${max}). Waiting for a free position slot.`;
    liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_CAPACITY_PAUSED', { currentOpenPositions: current, maxOpenPositions: max, reason, pollIntervalMs: this.POSITION_CAPACITY_POLL_MS });
    if (!this.positionCapacityTimer) {
      this.positionCapacityTimer = setInterval(() => { void this.checkPositionCapacityAndResume(); }, this.POSITION_CAPACITY_POLL_MS);
      this.positionCapacityTimer.unref?.();
    }
  }

  private async checkPositionCapacityAndResume(): Promise<void> {
    if (!this.executionPausedByPositionLimit || this.state !== 'RUNNING' || this.cycleInFlight) return;
    try {
      const capacity = await this.getAuthoritativePositionCapacity();
      if (capacity.available <= 0) return;
      this.executionPausedByPositionLimit = false;
      if (this.positionCapacityTimer) {
        clearInterval(this.positionCapacityTimer);
        this.positionCapacityTimer = null;
      }
      this.lastCycleResult = `Auto Live resumed: ${capacity.available} live position slot(s) are available.`;
      liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_CAPACITY_RESUMED', { currentOpenPositions: capacity.current, maxOpenPositions: capacity.max, availableSlots: capacity.available });
      void this.runCycle();
    } catch (error: any) {
      liveRuntimeLog('WARN', 'AUTO_TRADING_POSITION_CAPACITY_CHECK_ERROR', { error: error?.message || String(error) });
    }
  }

  private clearPositionCapacityPause(): void {
    this.executionPausedByPositionLimit = false;
    if (this.positionCapacityTimer) {
      clearInterval(this.positionCapacityTimer);
      this.positionCapacityTimer = null;
    }
  }

  private pauseForRuntimeFault(reason: string): void {
    if (this.state === 'STOPPED' || this.state === 'BLOCKED') return;
    this.runtimeFaultReason = reason;
    this.state = 'PAUSED_RUNTIME';
    this.lastCycleResult = `Auto Live paused: live broker/runtime health is unavailable. ${reason}`;
    this.clearPositionCapacityPause();
    liveRuntimeLog('WARN', 'AUTO_TRADING_RUNTIME_FAULT_PAUSED', {
      reason,
      recoveryPollIntervalMs: this.RUNTIME_RECOVERY_POLL_MS
    });
    tradeAuditLog('AUTO_TRADING_RUNTIME_FAULT_PAUSED', {
      reason,
      recoveryPollIntervalMs: this.RUNTIME_RECOVERY_POLL_MS
    });
    if (!this.runtimeRecoveryTimer) {
      this.runtimeRecoveryTimer = setInterval(() => {
        void this.checkRuntimeRecoveryAndResume();
      }, this.RUNTIME_RECOVERY_POLL_MS);
      this.runtimeRecoveryTimer.unref?.();
    }
  }

  private async checkRuntimeRecoveryAndResume(runCycleAfterRecovery = true): Promise<void> {
    if (this.state !== 'PAUSED_RUNTIME' || this.cycleInFlight) return;
    try {
      const capacity = await this.getAuthoritativePositionCapacity();
      if (capacity.available <= 0) {
        this.runtimeFaultReason = null;
        this.state = 'PAUSED_LIMIT';
        if (this.runtimeRecoveryTimer) {
          clearInterval(this.runtimeRecoveryTimer);
          this.runtimeRecoveryTimer = null;
        }
        this.pauseForPositionLimit(
          capacity.current,
          capacity.max,
          'Broker connectivity has recovered, but the maximum system-wide live-position limit is still reached.'
        );
        return;
      }

      const previousReason = this.runtimeFaultReason;
      this.runtimeFaultReason = null;
      this.state = 'RUNNING';
      if (this.runtimeRecoveryTimer) {
        clearInterval(this.runtimeRecoveryTimer);
        this.runtimeRecoveryTimer = null;
      }
      this.lastCycleResult = 'Auto Live resumed: live broker/runtime health has recovered and execution capacity is available.';
      liveRuntimeLog('INFO', 'AUTO_TRADING_RUNTIME_FAULT_RECOVERED', {
        previousReason,
        currentOpenPositions: capacity.current,
        maxOpenPositions: capacity.max,
        availableSlots: capacity.available
      });
      tradeAuditLog('AUTO_TRADING_RUNTIME_FAULT_RECOVERED', {
        previousReason,
        currentOpenPositions: capacity.current,
        maxOpenPositions: capacity.max,
        availableSlots: capacity.available
      });
      if (runCycleAfterRecovery) void this.runCycle();
    } catch (error: any) {
      liveRuntimeLog('WARN', 'AUTO_TRADING_RUNTIME_RECOVERY_CHECK_FAILED', {
        error: error?.message || String(error)
      });
    }
  }

  getStatus(): AutoTradingStatus {
    const autonomousPermission = refreshAutonomousExecutionPermission();
    return {
      state: this.state,
      enabledByEnvironment: this.isRequested(),
      autonomousPermission,
      intervalMs: AUTO_INTERVAL_MS,
      minSignalScore: Number(getSystemConfig().autoLiveMinSignalScore),
      maxTradesPerPair: Number(getSystemConfig().autoLiveMaxTradesPerPair),
      maxOpenPositions: Number(getSystemConfig().maxOpenPositions),
      pairs: getConfiguredAutoForexPairs(),
      indianUnderlyings: [...getSystemConfig().autoLiveIndianUnderlyings],
      lastCycleAt: this.lastCycleAt,
      lastCycleResult: this.lastCycleResult,
      lastActions: [...this.lastActions],
      marketGate: getAutoLiveMarketGate(),
      currentExecution: { ...this.currentExecution },
      lastExecution: this.lastExecution ? { ...this.lastExecution } : null,
      executionPausedByPositionLimit: this.executionPausedByPositionLimit,
      runtimeFaultReason: this.runtimeFaultReason,
      preOpenPreparation: {
        lastPreparedAt: this.lastPreOpenPreparedAt,
        trendPairsEvaluated: this.preOpenTrendPairsEvaluated,
        news: this.preOpenNews,
        status: this.preOpenStatus
      }
    };
  }

  start(options: { confirmWhenClosed?: boolean } = {}): AutoTradingStatus {
    const marketGate = getAutoLiveMarketGate();

    liveRuntimeLog('SYSTEM', 'AUTO_TRADING_START_ATTEMPT', {
      previousState: this.state,
      requestedFlags: {
        autoTrading: process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true',
        autonomousLiveExecution: process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true'
      },
      marketGate,
      confirmWhenClosed: Boolean(options.confirmWhenClosed)
    });

    if (marketGate.bothMarketsClosed && !options.confirmWhenClosed) {
      const message = 'Markets are closed, do you still want to start Auto Live';
      this.lastCycleResult = message;
      liveRuntimeLog('INFO', 'AUTO_TRADING_CLOSED_MARKET_CONFIRMATION_REQUIRED', {
        message,
        marketGate
      });
      return {
        ...this.getStatus(),
        requiresClosedMarketConfirmation: true
      };
    }

    // Production Auto Live must be unlocked through the dedicated execution
    // gate first. The unlock endpoint performs the complete production
    // activation preflight. Local development retains the existing explicit
    // START -> arm behavior for broker-integrated testing.
    if (process.env.NODE_ENV === 'production') {
      if (!LIVE_AUTO_EXECUTION_ALLOWED) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Execution gate is locked. Complete the Auto Live activation preflight and unlock the execution gate before starting Auto Live.';
        liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
          stage: 'EXECUTION_GATE',
          reason: this.lastCycleResult
        });
        return this.getStatus();
      }
    } else {
      if (!this.isRequested() && !this.hasCompletedExplicitStart) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Autonomous execution is not enabled. Both GOLDCREST_AUTO_TRADING_ENABLED and GOLDCREST_AUTONOMOUS_LIVE_EXECUTION must be true.';
        liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
          stage: 'REQUEST_FLAGS',
          reason: this.lastCycleResult
        });
        return this.getStatus();
      }

      const gateArm = armAutonomousExecutionGate();
      if (!gateArm.success) {
        this.state = 'BLOCKED';
        this.lastCycleResult = gateArm.message;
        liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
          stage: 'REQUEST_FLAGS',
          code: gateArm.code,
          reason: gateArm.message
        });
        return this.getStatus();
      }

      if (!this.isRequested()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Autonomous execution is not enabled. Both GOLDCREST_AUTO_TRADING_ENABLED and GOLDCREST_AUTONOMOUS_LIVE_EXECUTION must be true.';
        liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
          stage: 'REQUEST_FLAGS',
          reason: this.lastCycleResult
        });
        return this.getStatus();
      }
    }

    const activation = autoExecutionEngine.enableAutomaticExecution();
    if (!activation.success) {
      this.state = 'BLOCKED';
      this.lastCycleResult = activation.message;
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'ARM',
        code: activation.code,
        reason: activation.message
      });
      return this.getStatus();
    }

    if (!getSystemConfig().liveTradingEnabled) {
      this.state = 'BLOCKED';
      this.lastCycleResult = 'LIVE_TRADING_ENABLED is not true.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'LIVE_TRADING_CONFIG',
        reason: this.lastCycleResult
      });
      return this.getStatus();
    }

    const permission = refreshAutonomousExecutionPermission();
    if (!permission) {
      this.state = 'BLOCKED';
      this.lastCycleResult = 'Autonomous execution is not currently permitted. The strategy must be calibrated and the safety controls must pass.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'AUTONOMOUS_PERMISSION',
        reason: this.lastCycleResult
      });
      return this.getStatus();
    }

    if (this.timer) return this.getStatus();

    if (marketGate.anyMarketOpen) {
      this.hasCompletedExplicitStart = true;
      this.state = 'RUNNING';
      this.lastCycleResult = 'Auto-trading loop started.';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_STARTED', {
        intervalMs: AUTO_INTERVAL_MS,
        pairs: getConfiguredAutoForexPairs(),
        marketGate
      });
      void this.runCycle();
    } else {
      this.hasCompletedExplicitStart = true;

    this.state = 'PREPARING';
      this.lastCycleResult = 'Markets are closed. Auto Live is armed; pre-open preparation is running and the system will begin evaluating trades as soon as a supported market opens.';
      this.preOpenStatus = 'RUNNING';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_PRE_OPEN_ARMED', {
        intervalMs: AUTO_INTERVAL_MS,
        pairs: getConfiguredAutoForexPairs(),
        marketGate
      });
      void this.runScheduledCycle();
    }

    this.timer = setInterval(() => {
      void this.runScheduledCycle();
    }, AUTO_INTERVAL_MS);
    this.timer.unref?.();

    return this.getStatus();
  }

  abandonClosedMarketStart(): AutoTradingStatus {
    this.lastCycleResult = 'Auto Live start abandoned while markets were closed.';
    liveRuntimeLog('INFO', 'AUTO_TRADING_CLOSED_MARKET_START_ABANDONED', {
      marketGate: getAutoLiveMarketGate()
    });
    return this.getStatus();
  }

  stop(reason = 'Operator stopped auto trading.'): AutoTradingStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearPositionCapacityPause();
    this.runtimeFaultReason = null;
    if (this.runtimeRecoveryTimer) {
      clearInterval(this.runtimeRecoveryTimer);
      this.runtimeRecoveryTimer = null;
    }
    this.state = 'STOPPED';
    this.lastCycleResult = reason;
    liveRuntimeLog('SYSTEM', 'AUTO_TRADING_STOPPED', { reason });
    disarmLocalAutonomousExecution();
    return this.getStatus();
  }

  /**
   * Check the authoritative live cTrader position count before starting or
   * continuing an Auto Live execution cycle.
   *
   * When the configured system-wide position limit is full, Auto Live enters
   * PAUSED_LIMIT rather than repeatedly scanning signals and reaching
   * Condition 13B one order at a time. The timer remains armed, so the service
   * re-checks the broker when the next cycle arrives and automatically resumes
   * as soon as a live-position slot is available.
   */
  private async checkSystemPositionCapacity(): Promise<boolean> {
    const maxOpenPositions = Math.max(
      1,
      Math.min(100, Math.floor(Number(getSystemConfig().maxOpenPositions)))
    );

    try {
      const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
      const positions = await adapter.getPositions();
      const activePositionsCount = Array.isArray(positions) ? positions.length : 0;

      if (activePositionsCount >= maxOpenPositions) {
        const wasAlreadyPaused = this.state === 'PAUSED_LIMIT';
        this.state = 'PAUSED_LIMIT';
        this.lastCycleResult =
          `Auto Live paused: maximum system-wide live positions reached (${activePositionsCount}/${maxOpenPositions}). Waiting for a position slot to become available.`;

        if (!wasAlreadyPaused) {
          liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_LIMIT_PAUSED', {
            activePositionsCount,
            maxOpenPositions
          });
          tradeAuditLog('AUTO_TRADING_POSITION_LIMIT_PAUSED', {
            activePositionsCount,
            maxOpenPositions
          });
        }

        return false;
      }

      if (this.state === 'PAUSED_LIMIT') {
        this.state = 'RUNNING';
        this.lastCycleResult =
          `Auto Live resumed: a live-position slot is available (${activePositionsCount}/${maxOpenPositions}).`;
        liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_LIMIT_RESUMED', {
          activePositionsCount,
          maxOpenPositions
        });
        tradeAuditLog('AUTO_TRADING_POSITION_LIMIT_RESUMED', {
          activePositionsCount,
          maxOpenPositions
        });
      }

      return true;
    } catch (error: any) {
      // A broker-position snapshot is also the authoritative runtime health
      // signal for Auto Live. When it fails, do not label the outage as a
      // position-limit condition; pause in a dedicated runtime-fault state and
      // recover only after a fresh authoritative snapshot succeeds.
      this.pauseForRuntimeFault(error?.message || String(error));
      return false;
    }
  }

  private async runScheduledCycle(): Promise<void> {
    if (!['PREPARING', 'RUNNING', 'PAUSED_LIMIT', 'PAUSED_RUNTIME'].includes(this.state) || this.cycleInFlight) return;

    const marketGate = getAutoLiveMarketGate();

    if (this.state === 'PAUSED_RUNTIME') {
      await this.checkRuntimeRecoveryAndResume();
      return;
    }

    if (this.state === 'PAUSED_LIMIT') {
      const capacityAvailable = await this.checkSystemPositionCapacity();
      if (!capacityAvailable) return;
    }

    if (marketGate.bothMarketsClosed) {
      if (this.state === 'RUNNING') {
        this.state = 'PREPARING';
        this.lastCycleResult = 'Markets closed. Auto Live remains armed and has returned to pre-open preparation.';
        liveRuntimeLog('INFO', 'AUTO_TRADING_MARKET_CLOSED_PREPARATION_RESUMED', { marketGate });
      }
      await this.runPreOpenPreparation(marketGate);
      return;
    }

    if (this.state === 'PREPARING') {
      this.state = 'RUNNING';
      this.lastCycleResult = 'A supported market is now open. Auto Live is moving from preparation to live signal evaluation.';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_MARKET_OPENED', { marketGate });
    }

    await this.runCycle();
  }

  private async runPreOpenPreparation(marketGate: AutoLiveMarketGate): Promise<void> {
    if (this.state !== 'PREPARING' || this.cycleInFlight) return;

    const sinceLastPreparation = this.lastPreOpenPreparedAt
      ? Date.now() - this.lastPreOpenPreparedAt
      : Number.POSITIVE_INFINITY;
    const hasFreshNews = this.preOpenNews?.status === 'LIVE';
    const hasFreshPreparation =
      sinceLastPreparation < PREOPEN_PREPARATION_MIN_INTERVAL_MS
      && this.preOpenStatus === 'READY'
      && hasFreshNews;

    if (hasFreshPreparation) {
      this.lastCycleResult = `Pre-open preparation is already fresh (${Math.round(sinceLastPreparation / 1000)}s old). Auto Live remains armed.`;
      liveRuntimeLog('INFO', 'PREOPEN_PREPARATION_SKIPPED_FRESH', {
        ageMs: sinceLastPreparation,
        minIntervalMs: PREOPEN_PREPARATION_MIN_INTERVAL_MS,
        newsStatus: this.preOpenNews?.status,
        newsFetchedAt: this.preOpenNews?.fetchedAt
      });
      return;
    }

    this.cycleInFlight = true;
    this.preOpenStatus = 'RUNNING';

    try {
      const cTraderAdapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
      const cTraderPreflight = await validateAutoLiveCTraderConnection(cTraderAdapter);
      liveRuntimeLog(cTraderPreflight.ok ? 'INFO' : 'WARN', 'AUTO_TRADING_CTRADER_PREFLIGHT', {
        ok: cTraderPreflight.ok, apiMode:cTraderPreflight.result.apiMode, apiEndpoint:cTraderPreflight.result.apiEndpoint,
        account:cTraderPreflight.result.account, accountType:cTraderPreflight.result.accountType, error:cTraderPreflight.result.error
      });
      if (!cTraderPreflight.ok) {
        this.state='BLOCKED'; this.lastCycleResult=cTraderPreflight.message;
        this.setExecutionStatus({stage:'REJECTED', pair:null, side:null, signalId:null, message:cTraderPreflight.message});
        liveRuntimeLog('WARN','AUTO_TRADING_BLOCKED_CTRADER_PREFLIGHT',{reason:cTraderPreflight.message,apiMode:cTraderPreflight.result.apiMode,apiEndpoint:cTraderPreflight.result.apiEndpoint});
        return;
      }

      if (killSwitch.isHalted()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Emergency kill switch is active.';
        this.preOpenStatus = 'UNAVAILABLE';
        liveRuntimeLog('WARN', 'AUTO_TRADING_PRE_OPEN_BLOCKED', { reason: this.lastCycleResult });
        return;
      }

      if (!refreshAutonomousExecutionPermission()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Autonomous permission was withdrawn during pre-open preparation.';
        this.preOpenStatus = 'UNAVAILABLE';
        liveRuntimeLog('WARN', 'AUTO_TRADING_PRE_OPEN_BLOCKED', { reason: this.lastCycleResult });
        return;
      }

      const newsPromise = fetchLiveForexNews({
        pairs: getConfiguredAutoForexPairs()
      });
      const trendResultsRaw = await mapWithConcurrency(
        getConfiguredAutoForexPairs(),
        PREOPEN_PAIR_CONCURRENCY,
        async pair => {
          try {
            await this.provider.refreshPair(pair);
            const analysis = this.signalEngine.analyzePair(pair);
            liveRuntimeLog('INFO', 'PREOPEN_TREND_EVALUATED', {
              pair,
              trend: analysis.trend.direction,
              strength: analysis.trend.strength,
              regime: analysis.regime,
              alignment: analysis.multiTimeframe.alignment,
              signalScore: analysis.signal.score
            });
            return {
              pair,
              trend: analysis.trend.direction,
              strength: analysis.trend.strength,
              regime: analysis.regime,
              alignment: analysis.multiTimeframe.alignment,
              score: analysis.signal.score
            };
          } catch (error: any) {
            liveRuntimeLog('WARN', 'PREOPEN_TREND_UNAVAILABLE', {
              pair,
              error: error?.message || String(error)
            });
            return null;
          }
        }
      );

      const trendResults = trendResultsRaw.filter(Boolean) as Array<{
        pair: string;
        trend: string;
        strength: number;
        regime: string;
        alignment: string;
        score: number;
      }>;

      this.preOpenTrendPairsEvaluated = trendResults.length;
      this.preOpenNews = await newsPromise;
      this.preOpenStatus = this.preOpenNews.status === 'LIVE' ? 'READY' : 'UNAVAILABLE';

      liveRuntimeLog(
        this.preOpenNews.status === 'UNAVAILABLE' ? 'WARN' : 'INFO',
        'PREOPEN_NEWS_EVALUATED',
        {
          source: this.preOpenNews.source,
          status: this.preOpenNews.status,
          articleCount: this.preOpenNews.articleCount,
          highImpactCount: this.preOpenNews.highImpactCount,
          elevatedCount: this.preOpenNews.elevatedCount,
          riskLevel: this.preOpenNews.riskLevel,
          providerStatus: this.preOpenNews.providerStatus,
          sentimentSummary: this.preOpenNews.sentimentSummary,
          error: this.preOpenNews.error
        }
      );

      this.lastPreOpenPreparedAt = Date.now();
      this.preOpenStatus = this.preOpenNews.status === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'READY';
      this.lastCycleResult = this.preOpenNews.status === 'UNAVAILABLE'
        ? `Pre-open trend preparation completed for ${trendResults.length} pairs, but live news is unavailable. No trade is placed until the normal execution gates pass.`
        : `Pre-open preparation completed: ${trendResults.length} live Forex pairs evaluated and live news checked. Waiting for a supported market to open.`;

      liveRuntimeLog('INFO', 'PREOPEN_PREPARATION_COMPLETED', {
        marketGate,
        trendPairsEvaluated: trendResults.length,
        newsStatus: this.preOpenNews.status,
        newsRiskLevel: this.preOpenNews.riskLevel,
        preparedAt: this.lastPreOpenPreparedAt
      });
    } catch (error: any) {
      this.preOpenStatus = 'UNAVAILABLE';
      this.lastCycleResult = error?.message || String(error);
      liveRuntimeLog('ERROR', 'AUTO_TRADING_PRE_OPEN_ERROR', { error: this.lastCycleResult });
    } finally {
      this.cycleInFlight = false;
    }
  }

  private async runCycle(): Promise<void> {
    if (this.state !== 'RUNNING' || this.cycleInFlight) return;
    this.cycleInFlight = true;

    this.lastCycleAt = Date.now();
    this.lastActions = [];
    this.setExecutionStatus({
      stage: 'SCANNING_MARKET',
      pair: null,
      side: null,
      signalId: null,
      message: 'Scanning configured Forex pairs for executable signals.'
    });
    liveRuntimeLog('INFO', 'AUTO_TRADING_CYCLE_STARTED', { timestamp: this.lastCycleAt, pairs: getConfiguredAutoForexPairs() });
    tradeAuditLog('CYCLE_STARTED', { timestamp: this.lastCycleAt, pairs: getConfiguredAutoForexPairs() });

    try {
      if (killSwitch.isHalted()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Emergency kill switch is active.';
        return;
      }

      if (!refreshAutonomousExecutionPermission()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Autonomous permission was withdrawn before cycle execution.';
        return;
      }

      // Stop the scan before news/market analysis when the authoritative
      // system-wide live-position capacity is already full. The timer remains
      // active so a later cycle can detect a freed slot and resume.
      if (!(await this.checkSystemPositionCapacity())) {
        return;
      }

      const positionCapacity = await this.getAuthoritativePositionCapacity();
      if (positionCapacity.available <= 0) {
        this.pauseForPositionLimit(positionCapacity.current, positionCapacity.max, 'Maximum configured live positions are already open.');
        this.setExecutionStatus({ stage: 'IDLE', pair: null, side: null, signalId: null, message: `Auto Live paused: system position limit reached (${positionCapacity.current}/${positionCapacity.max}).` });
        return;
      }
      this.clearPositionCapacityPause();

      // Live news is an execution input, not just a display metric. The
      // deterministic technical strategy can only enter a new trade when a
      // current authoritative news snapshot is available.
      const cycleNews = await fetchLiveForexNews({
        pairs: getConfiguredAutoForexPairs()
      });
      this.preOpenNews = cycleNews;
      this.currentCycleNews = cycleNews;
      this.preOpenStatus = cycleNews.status === 'LIVE' ? 'READY' : 'UNAVAILABLE';

      liveRuntimeLog(
        cycleNews.status === 'LIVE' ? 'INFO' : 'WARN',
        'LIVE_NEWS_CYCLE_INPUT',
        {
          source: cycleNews.source,
          status: cycleNews.status,
          articleCount: cycleNews.articleCount,
          highImpactCount: cycleNews.highImpactCount,
          activeHighImpactCount: cycleNews.activeHighImpactCount,
          elevatedCount: cycleNews.elevatedCount,
          riskLevel: cycleNews.riskLevel,
          providerStatus: cycleNews.providerStatus,
          sentimentSummary: cycleNews.sentimentSummary,
          error: cycleNews.error
        }
      );

      if (cycleNews.status !== 'LIVE') {
        this.lastActions = getConfiguredAutoForexPairs().map(pair => ({
          pair,
          result: 'BLOCKED',
          reason: 'Authoritative live news feed is unavailable; autonomous entry is blocked until fresh news is available.'
        }));
        this.lastCycleResult = 'Auto Live cycle blocked: authoritative live news is unavailable. No new trade is submitted.';
        liveRuntimeLog('WARN', 'AUTO_TRADING_BLOCKED_NEWS_UNAVAILABLE', {
          status: cycleNews.status,
          source: cycleNews.source,
          error: cycleNews.error
        });
        return;
      }

      const configuredPairs = getConfiguredAutoForexPairs();
      const blockedNewsPairs = configuredPairs.filter(pair => {
        const pairRisk = cycleNews.pairRisk?.[pair];
        // Backward-compatible fallback for snapshots produced by an older
        // process without pairRisk diagnostics.
        return pairRisk
          ? pairRisk.riskLevel === 'HIGH'
          : cycleNews.riskLevel === 'HIGH';
      });

      if (blockedNewsPairs.length > 0) {
        liveRuntimeLog('WARN', 'AUTO_TRADING_PAIR_NEWS_BLOCKS', {
          blockedPairs: blockedNewsPairs,
          articleCount: cycleNews.articleCount,
          highImpactCount: cycleNews.highImpactCount,
          pairRisk: cycleNews.pairRisk
        });
      }

      const pairsToEvaluate = configuredPairs.filter(pair => !blockedNewsPairs.includes(pair));
      liveRuntimeLog('INFO', 'AUTO_TRADING_SCAN_UNIVERSE', {
        configuredPairs,
        configuredPairCount: configuredPairs.length,
        blockedByNews: blockedNewsPairs,
        blockedByNewsCount: blockedNewsPairs.length,
        pairsToEvaluate,
        pairsToEvaluateCount: pairsToEvaluate.length
      });

      const session = getForexSessionState();
      if (session.activeSessions.includes('CLOSED (WEEKEND)')) {
        this.state = 'PREPARING';
        this.lastCycleResult = 'Forex market closed; pre-open preparation resumed.';
        liveRuntimeLog('INFO', 'AUTO_TRADING_MARKET_CLOSED', { session: session.activeSessions });
        return;
      }

      for (const pair of blockedNewsPairs) {
        const pairRisk = cycleNews.pairRisk?.[pair];
        const reason = 'Active pair-relevant high-impact news is inside the configured blackout window for ' + pair + '.';
        this.lastActions.push({
          pair,
          result: 'BLOCKED',
          reason
        });
        liveRuntimeLog('WARN', 'AUTO_TRADING_PAIR_BLOCKED_NEWS', {
          pair,
          signalId: undefined,
          reason,
          pairRisk: pairRisk || null
        });
      }

      // Scan/analyze every eligible configured pair in parallel. Each pair is
      // independently isolated, while the execution portion of evaluatePair
      // is serialized by withExecutionLock(). This removes the old sequential
      // scan bottleneck without weakening account-level safety gates.
      await Promise.all(pairsToEvaluate.map(pair => this.evaluatePair(pair)));

      const executed = this.lastActions.find(action => action.result === 'EXECUTED');
      if (!executed) {
        const reasons = this.lastActions
          .filter(action => action.reason)
          .map(action => `${action.pair}: ${action.reason}`)
          .slice(-8);
        const message = reasons.length
          ? `No trade executed this cycle. ${reasons.join(' | ')}`
          : 'No trade executed this cycle; see TradeLog for pair-level decisions.';
        this.finishExecution('REJECTED', message, {
          pair: null,
          side: null,
          signalId: null
        });
      }
      this.lastCycleResult = executed
        ? `Cycle completed. Executed ${executed.pair}.`
        : 'Cycle completed. No trade executed.';
      liveRuntimeLog('INFO', 'AUTO_TRADING_CYCLE_COMPLETED', { actions: this.lastActions });
      tradeAuditLog('CYCLE_COMPLETED', { actions: this.lastActions, result: this.lastCycleResult });
    } catch (error: any) {
      this.lastCycleResult = error?.message || String(error);
      liveRuntimeLog('ERROR', 'AUTO_TRADING_CYCLE_ERROR', { error: this.lastCycleResult });
    } finally {
      this.cycleInFlight = false;
    }
  }

  private async evaluatePair(pair: string): Promise<void> {
    try {
      this.setExecutionStatus({
        stage: 'SCANNING_MARKET',
        pair,
        side: null,
        signalId: null,
        message: 'Scanning live market data for ' + pair + '.'
      });
      await this.provider.refreshPair(pair);
      liveRuntimeLog('INFO', 'LIVE_DATA_REFRESHED', { pair });
      const signal = await this.signalEngine.generateSignal(pair);
      let marketTrendContext: Awaited<ReturnType<typeof getMarketTrendContext>> | null = null;
      try {
        marketTrendContext = await getMarketTrendContext(pair);
        liveRuntimeLog('INFO', 'MARKET_TREND_CONTEXT_CAPTURED', {
          pair,
          signalId: signal.id,
          direction: marketTrendContext.direction,
          returns: {
            days7: marketTrendContext.horizon.days7.returnPct,
            days30: marketTrendContext.horizon.days30.returnPct,
            days90: marketTrendContext.horizon.days90.returnPct,
            days365: marketTrendContext.horizon.days365.returnPct
          }
        });
      } catch (trendError: any) {
        liveRuntimeLog('WARN', 'MARKET_TREND_CONTEXT_UNAVAILABLE', {
          pair,
          signalId: signal.id,
          error: trendError?.message || String(trendError)
        });
      }
      const isDirectionalSignal = signal.direction.includes('BUY') || signal.direction.includes('SELL');
      const signalSide: 'BUY' | 'SELL' | null = signal.direction.includes('BUY')
        ? 'BUY'
        : signal.direction.includes('SELL')
          ? 'SELL'
          : null;

      this.setExecutionStatus({
        stage: 'ANALYZING_SIGNAL',
        pair,
        side: signalSide,
        signalId: signal.id,
        message: 'Analyzing ' + pair + ' signal and execution conditions.'
      });
      liveRuntimeLog('INFO', 'SIGNAL_EVALUATED', {
        pair,
        signalId: signal.id,
        direction: signal.direction,
        score: signal.score,
        status: signal.status,
        hasTradePlan: Boolean(signal.tradePlan),
        strategyId: signal.strategyVersion
      });

      // Persist the complete model state at decision time. This is research
      // telemetry only and does not participate in the execution decision.
      try {
      await recordLiveTradeResearchSignal({
        signalId: signal.id,
        symbol: pair,
        timestamp: signal.timestamp,
        direction: signal.direction,
        signalCategory: signal.signalCategory,
        score: signal.score,
        scoreBreakdown: signal.scoreBreakdown,
        strategyVersion: signal.strategyVersion,
        modelVersion: signal.modelVersion,
        marketRegime: signal.marketRegime,
        session: signal.session,
        dataStatus: signal.dataStatus,
        tradePlan: signal.tradePlan ? {
          entryMin: signal.tradePlan.entryMin,
          entryMax: signal.tradePlan.entryMax,
          entryPreferred: signal.tradePlan.entryPreferred,
          entryType: signal.tradePlan.entryType,
          stopLoss: signal.tradePlan.stopLoss,
          takeProfit1: signal.tradePlan.takeProfit1.targetPrice,
          takeProfit2: signal.tradePlan.takeProfit2.targetPrice,
          takeProfit3: signal.tradePlan.takeProfit3.targetPrice,
          riskReward: signal.tradePlan.riskReward
        } : null,
        reasons: signal.reasons,
        noTradeReasons: signal.noTradeReasons,
        news: this.currentCycleNews,
        context: {
          autoLiveCycleTimestamp: this.lastCycleAt,
          source: 'AUTO_LIVE',
          lifecycleCapture: 'SIGNAL_TIME',
          marketTrend: marketTrendContext
        }
      });
      } catch (researchError: any) {
        liveRuntimeLog('WARN', 'LIVE_TRADE_RESEARCH_TELEMETRY_FAILED', {
          signalId: signal.id,
          pair,
          operation: 'SIGNAL',
          error: researchError?.message || String(researchError)
        });
      }

      // The signal engine has multiple directional categories (BUY, STRONG_BUY,
      // WATCH_BUY and their SELL equivalents). The scanner already normalizes
      // these to BUY/SELL for the UI. Auto Live must use the same directional
      // classification, otherwise valid WATCH/STRONG setups are incorrectly
      // rejected before the configurable minimum-score gate is reached.
      if (!isDirectionalSignal || !signal.tradePlan) {
        const reason = !isDirectionalSignal
          ? `Signal engine returned non-directional setup: ${signal.direction}.`
          : 'Signal engine produced a directional signal without a valid trade plan.';
        this.lastActions.push({ pair, result: 'NO_TRADE', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'NO_TRADE', { pair, signalId: signal.id, reason });
                tradeAuditLog('NO_TRADE', { pair, signalId: signal.id, direction: signal.direction, score: signal.score, reason });
return;
      }

      return this.withExecutionLock(async () => {
      const config = getSystemConfig();
      const systemPositionCapacity = await this.getAuthoritativePositionCapacity();
      if (systemPositionCapacity.available <= 0) {
        this.pauseForPositionLimit(systemPositionCapacity.current, systemPositionCapacity.max, 'Maximum configured live positions were reached during this cycle.');
        this.setExecutionStatus({ stage: 'IDLE', pair, side: signalSide, signalId: signal.id, message: `Auto Live paused: system position limit reached (${systemPositionCapacity.current}/${systemPositionCapacity.max}).` });
        return;
      }

      // Another pair may have filled the final system-wide slot while this
      // signal was waiting in the serialized execution queue. Do not make
      // another broker position request or run the remaining execution work
      // once the service has already entered PAUSED_LIMIT.
      if (this.state === 'PAUSED_LIMIT' || this.state === 'PAUSED_RUNTIME') {
        const reason = this.state === 'PAUSED_RUNTIME'
          ? 'Auto Live execution paused because live broker/runtime health is unavailable. Waiting for authoritative recovery.'
          : 'Auto Live execution paused because the maximum system-wide live-position limit has been reached. Waiting for a slot to become available.';
        this.lastActions.push({ pair, result: 'PAUSED', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_LIMIT_QUEUE_PAUSED', {
          pair,
          signalId: signal.id,
          maxOpenPositions: Number(config.maxOpenPositions)
        });
        return;
      }

      const minSignalScore = Math.max(0, Math.min(100, Math.round(Number(config.autoLiveMinSignalScore))));
      if (signal.score < minSignalScore) {
        const reason = `Signal score ${signal.score} is below the configured Auto Live threshold of ${minSignalScore}.`;
        this.lastActions.push({ pair, result: 'FILTERED', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'SIGNAL_FILTERED', { pair, signalId: signal.id, score: signal.score, threshold: minSignalScore });
                tradeAuditLog('SIGNAL_FILTERED', { pair, signalId: signal.id, score: signal.score, reason });
return;
      }

      const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');

      // Re-check the authoritative account position count inside the serialized
      // execution lock. Another pair may have filled the final available slot
      // earlier in this same cycle.
      const positionsBeforeExecution = await adapter.getPositions();
      const maxOpenPositions = Math.max(
        1,
        Math.min(100, Math.floor(Number(config.maxOpenPositions)))
      );
      if (positionsBeforeExecution.length >= maxOpenPositions) {
        this.state = 'PAUSED_LIMIT';
        const reason =
          `Auto Live paused: maximum system-wide live positions reached (${positionsBeforeExecution.length}/${maxOpenPositions}). Waiting for a position slot to become available.`;
        this.lastActions.push({ pair, result: 'PAUSED', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_LIMIT_PAUSED', {
          pair,
          signalId: signal.id,
          activePositionsCount: positionsBeforeExecution.length,
          maxOpenPositions
        });
        tradeAuditLog('AUTO_TRADING_POSITION_LIMIT_PAUSED', {
          pair,
          signalId: signal.id,
          activePositionsCount: positionsBeforeExecution.length,
          maxOpenPositions
        });
        return;
      }

      const quote = await adapter.getQuote(pair);
      if (quote.status !== 'FRESH' || Date.now() - quote.timestamp >= LIVE_QUOTE_MAX_AGE_MS) {
        const reason = 'Fresh broker quote unavailable at dispatch boundary.';
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
                tradeAuditLog('QUOTE_BLOCKED', { pair, signalId: signal.id, score: signal.score, reason });
return;
      }

      const plan = signal.tradePlan;
      if (!signalSide) {
        const reason = `Directional side could not be resolved from signal direction ${signal.direction}.`;
        this.lastActions.push({ pair, result: 'NO_TRADE', signalId: signal.id, reason });
        tradeAuditLog('NO_TRADE', { pair, signalId: signal.id, direction: signal.direction, score: signal.score, reason });
        return;
      }
      const entryPrice = signalSide === 'BUY' ? quote.ask : quote.bid;

      try {
      await updateLiveTradeResearchQuote({
        signalId: signal.id,
        quote: {
          bid: quote.bid,
          ask: quote.ask,
          spread: quote.spread,
          timestamp: quote.timestamp,
          status: quote.status
        },
        context: {
          dispatchQuoteAgeMs: Math.max(0, Date.now() - quote.timestamp),
          selectedEntrySide: signalSide,
          selectedEntryPrice: entryPrice
        }
      });
      } catch (researchError: any) {
        liveRuntimeLog('WARN', 'LIVE_TRADE_RESEARCH_TELEMETRY_FAILED', {
          signalId: signal.id,
          pair,
          operation: 'QUOTE',
          error: researchError?.message || String(researchError)
        });
      }

      // Auto Live submits a MARKET order using the authoritative broker quote
      // available at the dispatch boundary. The signal entry zone is an
      // analytical/preferred-entry reference, not a second execution gate.
      // Trigger Now already follows this market-order path, and Auto Live must
      // use the same execution semantics; otherwise a valid live signal can be
      // generated and then discarded simply because the quote moved a few
      // points outside the model's original entry zone.
      liveRuntimeLog('INFO', 'MARKET_ENTRY_EXECUTION', {
        pair,
        signalId: signal.id,
        side: signalSide,
        entryPrice,
        entryMin: plan.entryMin,
        entryMax: plan.entryMax,
        entryZoneStatus: entryPrice >= plan.entryMin && entryPrice <= plan.entryMax ? 'INSIDE' : 'OUTSIDE_USING_MARKET_QUOTE'
      });
      tradeAuditLog('MARKET_ENTRY_EXECUTION', {
        pair,
        signalId: signal.id,
        score: signal.score,
        side: signalSide,
        entryPrice,
        entryMin: plan.entryMin,
        entryMax: plan.entryMax
      });

      const account = await adapter.getAccount();

      // Direct-quantity sizing does not require the cTrader account currency
      // to be USD. The configured Forex quantity is sent directly to the broker.
      const instrument = await adapter.getInstrument(pair);
      if (!instrument) {
        const reason = 'Live broker instrument metadata unavailable.';
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
                tradeAuditLog('INSTRUMENT_BLOCKED', { pair, signalId: signal.id, score: signal.score, reason });
return;
      }

      // Score-based parallel-trade ladder:
      //   score >= 65 and <= 70 -> 1 trade
      //   score > 70 and <= 78   -> 2 trades
      //   score > 78              -> 5 trades
      // Scores below 65 do not receive a parallel-trade allowance here.
      // Condition 13B remains authoritative and can still block the order when
      // the system-wide live-position limit has been reached.
      const score = Number(signal.score);
      const scorePolicy = getAutoLiveParallelTradePolicy(score);
      const configuredPairLimit = Math.max(
        1,
        Math.min(100, Math.floor(Number(config.autoLiveMaxTradesPerPair)))
      );
      const maxTradesPerPair = Math.min(scorePolicy.maxTradesPerPair, configuredPairLimit);
      const scoreParallelTradeTier = scorePolicy.tier;

      const positions = positionsBeforeExecution;
      const activePairPositionsCount = positions.filter(position =>
        String(position.symbol || '').toUpperCase() === pair.toUpperCase()
      ).length;
      if (maxTradesPerPair <= 0 || !hasPairPositionCapacity(activePairPositionsCount, maxTradesPerPair)) {
        const reason = maxTradesPerPair <= 0
          ? `Auto Live score ${score.toFixed(2)} is below the minimum parallel-trade threshold of 65.`
          : `Maximum simultaneous Auto Live trades for ${pair} is ${maxTradesPerPair}; ${activePairPositionsCount} position(s) are already open.`;
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'AUTO_TRADING_PAIR_POSITION_LIMIT', {
          pair,
          signalId: signal.id,
          activePairPositionsCount,
          effectiveMaxTradesPerPair: maxTradesPerPair,
          scoreParallelTradeTier,
          score: signal.score
        });
        tradeAuditLog('PAIR_LIMIT_BLOCKED', {
          pair,
          signalId: signal.id,
          score: signal.score,
          effectiveMaxTradesPerPair: maxTradesPerPair,
          scoreParallelTradeTier,
          reason
        });
        return;
      }

      // Operator-configured Forex pip margins are authoritative for every
      // new Auto Live order. Calculate SL/TP from the exact three-decimal
      // execution price that will be placed in the broker packet, rather than
      // from the signal engine's analytical trade-plan levels.
      const executionEntryPrice = normalizePriceToThreeDigits(entryPrice);
      let configuredTargets;
      try {
        configuredTargets = calculateForexPipTargets(
          signalSide,
          executionEntryPrice,
          instrument.pipSize,
          config.forexStopLossPips,
          config.forexTakeProfitPips
        );
      } catch (targetError: any) {
        const reason = targetError?.message || String(targetError);
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
        liveRuntimeLog('WARN', 'AUTO_PIP_TARGETS_BLOCKED', {
          pair,
          signalId: signal.id,
          entryPrice: executionEntryPrice,
          brokerQuotePrice: entryPrice,
          pipSize: instrument.pipSize,
          stopLossPips: config.forexStopLossPips,
          takeProfitPips: config.forexTakeProfitPips,
          error: reason
        });
        tradeAuditLog('AUTO_PIP_TARGETS_BLOCKED', {
          pair,
          signalId: signal.id,
          entryPrice: executionEntryPrice,
          brokerQuotePrice: entryPrice,
          stopLossPips: config.forexStopLossPips,
          takeProfitPips: config.forexTakeProfitPips,
          reason
        });
        return;
      }

      const riskBudget = Math.max(0, Number(account.balance || 0) * (Number(getSystemConfig().defaultRiskPct) / 100));
      const stopDistance = Math.abs(executionEntryPrice - configuredTargets.stopLoss);
      if (!(riskBudget > 0 && stopDistance > 0)) {
        const reason = 'Unable to calculate positive risk budget and stop distance.';
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
                tradeAuditLog('RISK_BLOCKED', { pair, signalId: signal.id, score: signal.score, reason });
return;
      }

      const riskQuantity = riskBudget / stopDistance;
      let sizing;
      try {
        sizing = await sizeForexOrderToMaxTradeValue(
          adapter,
          pair,
          entryPrice,
          instrument,
          riskQuantity
        );
      } catch (sizingError: any) {
        const reason = sizingError?.message || String(sizingError);
        this.lastActions.push({
          pair,
          result: 'BLOCKED',
          signalId: signal.id,
          reason
        });
        liveRuntimeLog('WARN', 'AUTO_ORDER_SIZING_BLOCKED', {
          pair,
          signalId: signal.id,
          requestedQuantity: riskQuantity,
          maxTradeValueUsd: getSystemConfig().maxTradeValueForexUsd,
          error: reason
        });
        return;
      }

      const quantity = sizing.quantity;

      await updateLiveTradeResearchQuote({
        signalId: signal.id,
        quote: {
          bid: quote.bid,
          ask: quote.ask,
          spread: quote.spread,
          timestamp: quote.timestamp,
          status: quote.status
        },
        requestedRiskQuantity: riskQuantity,
        configuredQuantity: sizing.maxTradeValueUsd,
        context: {
          dispatchQuoteAgeMs: Math.max(0, Date.now() - quote.timestamp),
          selectedEntrySide: signalSide,
          selectedEntryPrice: entryPrice,
          executionEntryPrice,
          stopLossPips: configuredTargets.stopLossPips,
          takeProfitPips: configuredTargets.takeProfitPips,
          pipSize: configuredTargets.pipSize,
          directQuantity: sizing.directQuantity,
          sizingAdjusted: sizing.adjusted
        }
      });

      this.setExecutionStatus({
        stage: 'PREPARING_ORDER',
        pair,
        side: signalSide,
        signalId: signal.id,
        message: 'Preparing live order for ' + pair + '.'
      });

      const order: OrderRequest = {
        market: 'FOREX',
        symbol: pair,
        side: signalSide,
        orderType: 'MARKET',
        quantity,
        price: executionEntryPrice,
        stopLoss: configuredTargets.stopLoss,
        takeProfit: configuredTargets.takeProfit,
        strategyId: signal.strategyVersion,
        signalId: signal.id,
        comment: 'Goldcrest autonomous FX strategy'
      };

      const dailyRealizedPnL = typeof adapter.getDailyRealizedPnL === 'function'
        ? await adapter.getDailyRealizedPnL()
        : 0;
      const totalExposure = positions
        .filter(position => position.currency === 'USD' && position.market === 'FOREX')
        .reduce((sum, position) => sum + Math.abs(Number(position.quantity || 0)) * Number(position.currentPrice || 0), 0)
        + (quantity * entryPrice);

      liveRuntimeLog('INFO', 'ORDER_CANDIDATE', {
        pair,
        signalId: signal.id,
        side: order.side,
        quantity,
        requestedRiskQuantity: riskQuantity,
        entryPrice: executionEntryPrice,
        brokerQuotePrice: entryPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        stopLossPips: configuredTargets.stopLossPips,
        takeProfitPips: configuredTargets.takeProfitPips,
        pipSize: configuredTargets.pipSize,
        directQuantity: sizing.directQuantity,
        configuredQuantity: sizing.maxTradeValueUsd,
        sizingAdjusted: sizing.adjusted,
        sizingMode: 'DIRECT_QUANTITY_NO_CURRENCY_CONVERSION'
      });

      this.setExecutionStatus({
        stage: 'SAFETY_GATE',
        pair,
        side: order.side,
        signalId: signal.id,
        message: 'Running live safety and readiness gates for ' + pair + '.'
      });

      const result = await autoExecutionEngine.processSignal(
        {
          signalId: signal.id,
          strategyId: signal.strategyVersion,
          market: 'FOREX',
          symbol: pair,
          side: order.side,
          signalTimestamp: signal.timestamp,
          entryPrice,
          currentPrice: entryPrice,
          stopLoss: configuredTargets.stopLoss,
          takeProfit: configuredTargets.takeProfit,
          spread: quote.spread,
          broker: 'CTRADER',
          environment: 'LIVE'
        },
        order,
        {
          signalAgeMs: Date.now() - signal.timestamp,
          currentQuote: {
            symbol: pair,
            bid: quote.bid,
            ask: quote.ask,
            spread: quote.spread,
            timestamp: quote.timestamp,
            source: quote.source,
            environment: 'LIVE',
            status: quote.status
          } satisfies NormalizedQuote,
          isMarketOpen: true,
          dailyRealizedLoss: Math.max(0, -Number(dailyRealizedPnL || 0)),
          dailyLossLimit: Math.max(Number(account.balance || 0) * (Number(getSystemConfig().maxDailyLossPct) / 100), 1),
          totalAccountExposure: totalExposure,
          maxAllowedExposure: Math.max(Number(account.equity || 0), 1),
          activePositionsCount: positions.length,
          maxOpenPositions: Number(config.maxOpenPositions),
          activePairPositionsCount,
          maxPairPositions: maxTradesPerPair
        },
        () => {
          this.setExecutionStatus({
            stage: 'SUBMITTING_ORDER',
            pair,
            side: order.side,
            signalId: signal.id,
            message: 'Submitting ' + pair + ' ' + order.side + ' to the live broker API.'
          });
        }
      );

      try {
      await updateLiveTradeResearchExecution({
        signalId: signal.id,
        status: result.executed ? 'FILLED' : 'BLOCKED',
        code: result.code,
        reason: result.reason,
        brokerOrderId: result.order?.brokerOrderId || result.order?.id,
        brokerPositionId: result.order?.fillEvents?.find((fill: any) => fill?.brokerPositionId)?.brokerPositionId,
        executedEntryPrice: result.order?.averageFillPrice ?? result.order?.price,
        executedQuantity: result.order?.filledQuantity ?? result.order?.quantity,
        commission: result.order?.commission,
        brokerStatus: result.order?.status,
        executionTimestamp: result.order?.timestamp || Date.now()
      });
      } catch (researchError: any) {
        liveRuntimeLog('WARN', 'LIVE_TRADE_RESEARCH_TELEMETRY_FAILED', {
          signalId: signal.id,
          pair,
          operation: 'EXECUTION',
          error: researchError?.message || String(researchError)
        });
      }

      if (result.executed) {
        this.finishExecution('TRADE_EXECUTED', pair + ' ' + order.side + ' trade confirmed by the execution engine.', {
          pair,
          side: order.side,
          signalId: signal.id
        });
      } else {
        this.finishExecution('REJECTED', pair + ' ' + order.side + ' was blocked or rejected before confirmed execution.', {
          pair,
          side: order.side,
          signalId: signal.id
        });
      }

      this.lastActions.push({
        pair,
        result: result.executed ? 'EXECUTED' : 'BLOCKED',
        signalId: signal.id,
        reason: result.reason,
        orderId: result.order?.brokerOrderId || result.order?.id
      });
      liveRuntimeLog(result.executed ? 'TRADE' : 'WARN', result.executed ? 'AUTO_ORDER_EXECUTION_RESULT' : 'AUTO_ORDER_BLOCKED', { pair, signalId: signal.id, result: result.executed ? 'EXECUTED' : 'BLOCKED', code: result.code, reason: result.reason, brokerOrderId: result.order?.brokerOrderId, brokerStatus: result.order?.status });
      });
    } catch (error: any) {
      const reason = error?.message || String(error);
      this.lastActions.push({
        pair,
        result: 'ERROR',
        reason
      });
      liveRuntimeLog('ERROR', 'PAIR_EVALUATION_ERROR', { pair, error: reason });
      tradeAuditLog('PAIR_EVALUATION_ERROR', { pair, reason });

      const runtimeErrorText = String(reason).toLowerCase();
      if (
        runtimeErrorText.includes('timeout')
        || runtimeErrorText.includes('network')
        || runtimeErrorText.includes('econn')
        || runtimeErrorText.includes('socket')
        || runtimeErrorText.includes('unavailable')
        || runtimeErrorText.includes('connection')
        || runtimeErrorText.includes('broker')
      ) {
        this.pauseForRuntimeFault(reason);
      }
    }
  }
}

export const autoTradingService = new AutoTradingService();
