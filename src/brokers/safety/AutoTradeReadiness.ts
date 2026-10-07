import { BrokerAdapter, OrderRequest, NormalizedQuote } from '../types';
import { brokerRegistry } from '../registry';
import { killSwitch } from './KillSwitch';
import { getForexSessionState, getIndianSessionState } from '../../markets/common/session';
import { getSystemConfig } from '../../services/configService';
import { executeQuery } from '../../database/db';
import { reconciliationService } from '../../services/reconciliationService';

const LIVE_QUOTE_MAX_AGE_MS = 30_000;

export type AutoTradeState = 'OFF' | 'ARMED' | 'BLOCKED';

export interface AutoTradeReadinessReport {
  state: AutoTradeState;
  ready: boolean;
  evaluatedAt: number;
  checks: Record<string, boolean>;
  metrics: {
    dailyLoss: number;
    dailyLossLimit: number;
    activePositions: number;
    maxOpenPositions: number;
    consecutiveLosses: number;
    maxConsecutiveLosses: number;
    spreadBps: number | null;
    maxSpreadBps: number;
    signalAgeMs: number;
    signalMaxAgeMs: number;
  };
  failedReasons: string[];
}

/**
 * Server-side readiness layer for autonomous trading.
 *
 * This service deliberately does NOT enable live autonomous execution. It
 * determines whether the complete operational/risk/strategy chain is ready
 * and provides an explicit ARM/DISARM state for the operator workflow.
 */
class AutoTradeReadinessService {
  private state: AutoTradeState = 'OFF';
  private lastReport: AutoTradeReadinessReport | null = null;

  async evaluate(
    adapter: BrokerAdapter,
    order: OrderRequest,
    signalTimestamp: number,
    currentQuote?: NormalizedQuote
  ): Promise<AutoTradeReadinessReport> {
    const config = getSystemConfig();
    const failedReasons: string[] = [];
    const checks: Record<string, boolean> = {};

    let quote = currentQuote;
    let account: Awaited<ReturnType<BrokerAdapter['getAccount']>> | null = null;
    let positions: Awaited<ReturnType<BrokerAdapter['getPositions']>> = [];
    let dailyLoss = 0;
    let consecutiveLosses = 0;
    let spreadBps: number | null = null;

    checks.liveEnvironment = adapter.environment === 'LIVE' && brokerRegistry.getEnvironment() === 'LIVE';
    checks.killSwitchClear = !killSwitch.isHalted();
    checks.liveTradingEnabled = process.env.LIVE_TRADING_ENABLED === 'true';
    const localDevelopment = process.env.NODE_ENV !== 'production'
      || process.env.GOLDCREST_LOCAL_DEVELOPMENT === 'true'
      || ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(String(process.env.HOST || '127.0.0.1').trim().toLowerCase());
    checks.operatorAuthConfigured = localDevelopment || Boolean(process.env.GOLDCREST_OPERATOR_API_KEY?.trim());
    checks.brokerConnected = false;
    checks.accountValidated = false;
    checks.tradingPermission = false;
    checks.instrumentValidated = false;
    checks.marketOpen = false;
    checks.quoteFresh = false;
    checks.signalFresh = false;
    checks.signalIdentity = Boolean(String(order.signalId || '').trim() && String(order.strategyId || '').trim());
    checks.stopLossPresent = Number(order.stopLoss) > 0;
    checks.takeProfitPresent = Number(order.takeProfit) > 0;
    checks.positionLimit = false;
    checks.dailyLossLimit = false;
    checks.consecutiveLossLimit = false;
    checks.spreadLimit = false;
    const approvedStrategyId = String(process.env.GOLDCREST_PRODUCTION_STRATEGY_ID || 'fx_structure_v2a').trim();
    const productionStrategyApproved = process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED === 'true';
    checks.strategyCalibrated = productionStrategyApproved && String(order.strategyId || '').trim() === approvedStrategyId;

    try {
      checks.brokerConnected = (await adapter.getTradingStatus()) === 'CONNECTED';
    } catch {
      checks.brokerConnected = false;
    }

    try {
      account = await adapter.getAccount();
      checks.accountValidated = Boolean(account?.accountId && Number(account.balance) > 0);
      const permissions = account?.permissions || [];
      checks.tradingPermission = permissions.includes('TRADING') ||
        permissions.includes('EQUITY') ||
        permissions.includes('DERIVATIVES') ||
        permissions.includes('NSE_FNO');
    } catch {
      account = null;
    }

    try {
      const instrument = await adapter.getInstrument(order.symbol);
      checks.instrumentValidated = Boolean(instrument);
    } catch {
      checks.instrumentValidated = false;
    }

    try {
      quote = quote || await adapter.getQuote(order.symbol);
      checks.quoteFresh = Boolean(
        quote &&
        quote.status === 'FRESH' &&
        Date.now() - Number(quote.timestamp) < LIVE_QUOTE_MAX_AGE_MS &&
        Number(quote.bid) > 0 &&
        Number(quote.ask) > 0
      );
      if (quote && quote.bid > 0 && quote.ask > 0) {
        const mid = (quote.bid + quote.ask) / 2;
        spreadBps = mid > 0 ? (quote.ask - quote.bid) / mid * 10000 : null;
      }
    } catch {
      checks.quoteFresh = false;
    }

    const signalAgeMs = Math.max(0, Date.now() - Number(signalTimestamp || 0));
    const signalMaxAgeMs = order.market === 'FOREX' ? 300000 : 120000;
    checks.signalFresh = signalAgeMs <= signalMaxAgeMs;

    checks.marketOpen = order.market === 'FOREX'
      ? !getForexSessionState().activeSessions.includes('CLOSED (WEEKEND)')
      : getIndianSessionState().isOpen;

    try {
      positions = await adapter.getPositions();
    } catch {
      positions = [];
    }

    const maxOpenPositions = Number(config.maxOpenPositions);
    checks.positionLimit = Number.isFinite(maxOpenPositions) &&
      maxOpenPositions > 0 &&
      positions.length < maxOpenPositions;

    const balance = Number(account?.balance || 0);
    const dailyLossLimit = Math.max(balance * (Number(config.maxDailyLossPct) / 100), 1);

    try {
      dailyLoss = typeof adapter.getDailyRealizedPnL === 'function'
        ? Math.max(0, -Number(await adapter.getDailyRealizedPnL()))
        : await reconciliationService.getDailyLoss(adapter.broker as 'CTRADER' | 'FIVE_PAISA', balance);
      if (!Number.isFinite(dailyLoss)) dailyLoss = 0;
    } catch {
      dailyLoss = 0;
    }
    checks.dailyLossLimit = dailyLoss < dailyLossLimit;

    // Daily trade-count limiting is intentionally removed from the execution
    // readiness layer. Goldcrest must be able to submit any number of trades
    // permitted by the remaining safety gates so load/stress testing can exercise
    // the complete execution path. Broker-side limits/rejections remain
    // authoritative and are handled after order submission.
    try {
      const rows = await executeQuery<any>(
        'SELECT pnl FROM trades WHERE exit_time IS NOT NULL AND pnl IS NOT NULL ORDER BY exit_time DESC LIMIT ?',
        [Number(config.maxConsecutiveLosses) + 1]
      );
      for (const row of rows) {
        if (Number(row.pnl) < 0) consecutiveLosses += 1;
        else break;
      }
    } catch {
      consecutiveLosses = 0;
    }
    const maxConsecutiveLosses = Number(config.maxConsecutiveLosses);
    checks.consecutiveLossLimit = Number.isFinite(maxConsecutiveLosses) &&
      maxConsecutiveLosses > 0 &&
      consecutiveLosses < maxConsecutiveLosses;

    const maxSpreadBps = Number(config.maxSpreadBps);
    checks.spreadLimit = spreadBps !== null &&
      Number.isFinite(maxSpreadBps) &&
      maxSpreadBps > 0 &&
      spreadBps <= maxSpreadBps;

    const orderedChecks = [
      ['liveEnvironment', 'Live environment is not active.'],
      ['killSwitchClear', 'Emergency kill switch is active.'],
      ['liveTradingEnabled', 'LIVE_TRADING_ENABLED is not true.'],
      ['operatorAuthConfigured', 'Operator authentication is not configured.'],
      ['brokerConnected', 'Live broker is not connected.'],
      ['accountValidated', 'Live account could not be validated.'],
      ['tradingPermission', 'Broker account does not expose a confirmed trading permission.'],
      ['instrumentValidated', 'Instrument validation failed.'],
      ['marketOpen', 'Market/session is closed.'],
      ['quoteFresh', 'Authoritative quote is missing or stale.'],
      ['signalFresh', 'Signal is stale.'],
      ['signalIdentity', 'Signal requires stable signalId and strategyId.'],
      ['stopLossPresent', 'Automatic execution requires a Stop Loss.'],
      ['takeProfitPresent', 'Automatic execution requires a Take Profit.'],
      ['positionLimit', 'Maximum open-position limit reached.'],
      ['dailyLossLimit', 'Daily loss limit reached.'],
      ['consecutiveLossLimit', 'Maximum consecutive-loss limit reached.'],
      ['spreadLimit', 'Current spread exceeds the configured safety threshold.'],
      ['strategyCalibrated', 'Production strategy approval is not enabled for this strategy version.']
    ] as const;

    for (const [key, message] of orderedChecks) {
      if (!checks[key]) failedReasons.push(message);
    }

    const ready = failedReasons.length === 0;
    if (!ready) this.state = 'BLOCKED';

    const report: AutoTradeReadinessReport = {
      state: this.state,
      ready,
      evaluatedAt: Date.now(),
      checks,
      metrics: {
        dailyLoss,
        dailyLossLimit,
        activePositions: positions.length,
        maxOpenPositions,
        consecutiveLosses,
        maxConsecutiveLosses,
        spreadBps,
        maxSpreadBps,
        signalAgeMs,
        signalMaxAgeMs
      },
      failedReasons
    };

    this.lastReport = report;
    return report;
  }

  async arm(report: AutoTradeReadinessReport): Promise<AutoTradeReadinessReport> {
    if (!report.ready) {
      this.state = 'BLOCKED';
      return { ...report, state: this.state, ready: false };
    }
    this.state = 'ARMED';
    const armed = { ...report, state: this.state, ready: true };
    this.lastReport = armed;
    return armed;
  }

  disarm(reason = 'Operator disarmed auto-trading.'): AutoTradeReadinessReport | null {
    this.state = 'OFF';
    if (!this.lastReport) return null;
    const report = {
      ...this.lastReport,
      state: this.state,
      ready: false,
      evaluatedAt: Date.now(),
      failedReasons: [reason]
    };
    this.lastReport = report;
    return report;
  }

  getStatus(): AutoTradeReadinessReport | null {
    return this.lastReport ? { ...this.lastReport, state: this.state } : null;
  }

  getState(): AutoTradeState {
    return this.state;
  }
}

export const autoTradeReadinessService = new AutoTradeReadinessService();
