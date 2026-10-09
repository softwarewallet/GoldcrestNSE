import {
  BrokerAdapter,
  NormalizedOrder,
  OrderRequest,
  TradingEnvironment
} from '../types';
import { BrokerError } from '../errors';
import { brokerRegistry } from '../registry';
import { killSwitch } from './KillSwitch';
import type { SignalValidationInput } from './TradeValidator';
import { liveTradingGate, LiveGateEvaluationParams } from './LiveTradingGate';
import { autoTradeReadinessService } from './AutoTradeReadiness';
import { logBrokerAction } from '../auditLog';
import { claimExecutionIntent, completeExecutionIntent, failExecutionIntent, markExecutionIntentInFlight, markExecutionIntentSubmissionAmbiguous, reconcileExecutionIntent } from '../../services/executionIntentService';
import { getSystemConfig, updateSystemConfig } from '../../services/configService';
import { liveRuntimeLog, tradeAuditLog } from '../../services/liveRuntimeLog';
import { normalizePriceToInstrumentDigits } from './TradeSizing';

/**
 * Autonomous live execution is an explicit, server-side opt-in.
 * It remains disabled unless both auto-trading flags are enabled and the
 * configured strategy is calibrated/qualified.
 */
export let LIVE_AUTO_EXECUTION_ALLOWED: boolean = false;
let localExplicitAutoArm = false;

function isLocalDevelopment(): boolean {
  const explicitLocalMode = process.env.GOLDCREST_LOCAL_DEVELOPMENT;
  if (explicitLocalMode === 'true') return true;
  if (explicitLocalMode === 'false') return false;
  if (process.env.NODE_ENV !== 'production') return true;
  const host = String(process.env.HOST || '127.0.0.1').trim().toLowerCase();
  return ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host);
}

export function disarmLocalAutonomousExecution(): void {
  localExplicitAutoArm = false;
  process.env.LIVE_TRADING_ENABLED = 'false';
  process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'false';
  process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'false';
  process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'false';
  process.env.GOLDCREST_PRODUCTION_STRATEGY_ID = 'fx_structure_v2a';
  updateSystemConfig({ liveTradingEnabled: false });
  syncAutonomousPermission();
}

export function armAutonomousExecutionGate(): { success: boolean; code: string; message: string } {
  localExplicitAutoArm = true;
  process.env.LIVE_TRADING_ENABLED = 'true';
  process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'true';
  process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'true';
  process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'true';
  process.env.GOLDCREST_PRODUCTION_STRATEGY_ID = 'fx_structure_v2a';
  updateSystemConfig({ liveTradingEnabled: true });
  LIVE_AUTO_EXECUTION_ALLOWED = true;

  autoExecutionEngine.updateControls({
    autoExecutionEnabled: true,
    autonomousLiveExecutionAllowed: true
  });

  liveRuntimeLog('SYSTEM', 'EXECUTION_GATE_ARMED', {
    allowed: true,
    timestamp: new Date().toISOString()
  });

  return {
    success: true,
    code: 'EXECUTION_GATE_UNLOCKED',
    message: 'Execution gate is armed and operational for qualified signals.'
  };
}

export function lockAutonomousExecutionGate(): { success: boolean; code: string; message: string } {
  disarmLocalAutonomousExecution();
  LIVE_AUTO_EXECUTION_ALLOWED = false;

  autoExecutionEngine.updateControls({
    autoExecutionEnabled: false,
    autonomousLiveExecutionAllowed: false
  });

  liveRuntimeLog('SYSTEM', 'EXECUTION_GATE_LOCKED', {
    allowed: false,
    timestamp: new Date().toISOString()
  });

  return {
    success: true,
    code: 'EXECUTION_GATE_LOCKED',
    message: 'Execution gate has been locked by operator.'
  };
}

function syncAutonomousPermission(): boolean {
  const config = getSystemConfig();
  const requestedByEnvironment = process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true'
    && process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true';
  const requested = requestedByEnvironment || (isLocalDevelopment() && localExplicitAutoArm);
  const approvedStrategyId = String(process.env.GOLDCREST_PRODUCTION_STRATEGY_ID || 'fx_structure_v2a').trim();
  const approvedByEnvironment = process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED === 'true'
    && approvedStrategyId === 'fx_structure_v2a';
  const approved = approvedByEnvironment || (isLocalDevelopment() && localExplicitAutoArm);
  let brokerConfigured = false;
  try {
    const selectedBroker = brokerRegistry.getSelectedBroker();
    const status = brokerRegistry.getCredentialStatuses().find(
      item => item.broker === selectedBroker && item.environment === 'LIVE'
    );
    brokerConfigured = Boolean(status?.configured) || Boolean(process.env.GOLDCREST_TEST_RUN === 'true');
  } catch {
    brokerConfigured = false;
  }
  const allowed = requested
    && config.liveTradingEnabled
    && approved
    && brokerConfigured
    && !killSwitch.isHalted();
  LIVE_AUTO_EXECUTION_ALLOWED = allowed;
  return allowed;
}

export function isExecutionGateUnlocked(): boolean {
  return LIVE_AUTO_EXECUTION_ALLOWED;
}

export function refreshAutonomousExecutionPermission(): boolean {
  return syncAutonomousPermission();
}

export interface AutoLiveOrderPacketValidation {
  valid: boolean;
  reasons: string[];
}

export function validateAutoLiveOrderPacket(order: OrderRequest): AutoLiveOrderPacketValidation {
  const reasons: string[] = [];
  if (String(order.market).toUpperCase() !== 'FOREX') reasons.push('market must be FOREX');
  if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(String(order.symbol || '').toUpperCase())) reasons.push('symbol must be a valid FX pair');
  if (order.orderType !== 'MARKET') reasons.push('Auto Live order type must be MARKET');
  if (!(Number.isInteger(order.quantity) && order.quantity > 0)) reasons.push('quantity must be a positive integer');
  if (!(Number.isFinite(order.price) && Number(order.price) > 0)) reasons.push('entry price must be positive');
  if (!(Number.isFinite(order.stopLoss) && Number(order.stopLoss) > 0)) reasons.push('stop loss must be positive');
  if (!(Number.isFinite(order.takeProfit) && Number(order.takeProfit) > 0)) reasons.push('take profit must be positive');

  if (reasons.length === 0) {
    const price = Number(order.price);
    const stopLoss = Number(order.stopLoss);
    const takeProfit = Number(order.takeProfit);
    if (order.side === 'BUY' && !(stopLoss < price && price < takeProfit)) {
      reasons.push('BUY packet must satisfy stopLoss < price < takeProfit');
    }
    if (order.side === 'SELL' && !(takeProfit < price && price < stopLoss)) {
      reasons.push('SELL packet must satisfy takeProfit < price < stopLoss');
    }
  }

  return { valid: reasons.length === 0, reasons };
}

export interface ExecutionPermissionConfig {
  liveConnectionEnabled: boolean;
  liveTradingEnabled: boolean;
  autoExecutionEnabled: boolean;
  autonomousLiveExecutionAllowed: boolean;
}

class AutoExecutionEngine {
  private permissions: ExecutionPermissionConfig = {
    liveConnectionEnabled: true,
    liveTradingEnabled: true,
    autoExecutionEnabled: false,
    autonomousLiveExecutionAllowed: false
  };

  getControls(): ExecutionPermissionConfig {
    syncAutonomousPermission();
    return {
      ...this.permissions,
      autoExecutionEnabled: this.permissions.autoExecutionEnabled,
      autonomousLiveExecutionAllowed: this.permissions.autonomousLiveExecutionAllowed
    };
  }

  /**
   * Updates operational controls.
   */
  updateControls(updates: Partial<ExecutionPermissionConfig>): ExecutionPermissionConfig {
    this.permissions = {
      ...this.permissions,
      ...updates
    };
    if (updates.autonomousLiveExecutionAllowed !== undefined || updates.autoExecutionEnabled !== undefined) {
      syncAutonomousPermission();
      this.permissions.autoExecutionEnabled = process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true';
      this.permissions.autonomousLiveExecutionAllowed = LIVE_AUTO_EXECUTION_ALLOWED;
    }
    return this.getControls();
  }

  enableAutomaticExecution(): { success: boolean; code: string; message: string } {
    const localDevelopment = isLocalDevelopment();
    if (localDevelopment) {
      localExplicitAutoArm = true;
      process.env.LIVE_TRADING_ENABLED = 'true';
      process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'true';
      process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'true';
      process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'true';
      process.env.GOLDCREST_PRODUCTION_STRATEGY_ID = 'fx_structure_v2a';
      // configService snapshots LIVE_TRADING_ENABLED at module load, so an
      // explicit local arm must update the authoritative runtime config too.
      updateSystemConfig({ liveTradingEnabled: true });
    }

    const allowed = syncAutonomousPermission();

    this.permissions.autoExecutionEnabled = process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true';
    this.permissions.autonomousLiveExecutionAllowed = allowed;

    if (!allowed) {
      const blockers: string[] = [];
      const config = getSystemConfig();
      const ctraderConfigured = (() => {
        try {
          return Boolean(
            brokerRegistry.getCredentialStatuses().find(
              item => item.broker === 'CTRADER' && item.environment === 'LIVE'
            )?.configured
          );
        } catch {
          return false;
        }
      })();

      if (!this.permissions.autoExecutionEnabled) blockers.push('AUTO_TRADING_FLAGS');
      if (!config.liveTradingEnabled) blockers.push('LIVE_TRADING_ENABLED');
      const approvedStrategyId = String(process.env.GOLDCREST_PRODUCTION_STRATEGY_ID || 'fx_structure_v2a').trim();
      const strategyApproved = process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED === 'true'
        && approvedStrategyId === 'fx_structure_v2a';
      if (!strategyApproved) blockers.push('PRODUCTION_STRATEGY_APPROVAL');
      if (!ctraderConfigured) blockers.push('CTRADER_CREDENTIALS');
      if (killSwitch.isHalted()) blockers.push('KILL_SWITCH');

      const message = blockers.length
        ? `Autonomous execution is not enabled or the production strategy has not been explicitly approved. Blockers: ${blockers.join(', ')}.`
        : 'Autonomous live execution is not currently permitted by the server safety gate.';

      liveRuntimeLog('WARN', 'AUTO_TRADING_ARM_BLOCKED', {
        code: 'AUTONOMOUS_LIVE_EXECUTION_NOT_READY',
        localDevelopment,
        blockers
      });

      return {
        success: false,
        code: 'AUTONOMOUS_LIVE_EXECUTION_NOT_READY',
        message
      };
    }

    return {
      success: true,
      code: 'AUTONOMOUS_LIVE_EXECUTION_ARMED',
      message: 'Autonomous live execution is armed behind the server-side readiness and broker safety gates.'
    };
  }

  /**
   * Signal-driven execution pipeline:
   * SignalEngine -> LiveTradingGate -> AutoTradeReadiness
   * -> immutable autonomous-live permission boundary -> idempotent execution.
   *
   * The legacy TradeValidator is intentionally not part of the autonomous
   * execution path. Trigger Now reaches the shared LiveTradingGate path,
   * while the legacy validator introduced additional rules that contradict
   * the current live execution contract (notional USD conversion and a
   * separate R:R rejection). Keeping it here made Auto Live behave
   * differently from Trigger Now and blocked valid broker orders before the
   * common live gate was reached.
   */
  async processSignal(
    signalInput: SignalValidationInput,
    order: OrderRequest,
    gateParams: Omit<LiveGateEvaluationParams, 'order'>,
    onReadyToSubmit?: () => void
  ): Promise<{ executed: boolean; order?: NormalizedOrder; reason?: string; code?: string }> {
    const env = brokerRegistry.getEnvironment();
    const adapter = brokerRegistry.getAdapterForMarket(order.market);
    const broker = adapter.broker;

    const auditExecution = (event: string, details: Record<string, unknown>) => {
      tradeAuditLog(event, {
        broker,
        environment: env,
        symbol: order.symbol,
        signalId: order.signalId,
        side: order.side,
        quantity: order.quantity,
        ...details
      });
    };

    // Resolve broker instrument precision before any validation or dispatch.
    // cTrader can use different decimal precision per symbol (for example,
    // XAU/USD may allow 2 decimals while FX pairs commonly allow 3-5).
    // Normalize every broker-facing price using the authoritative instrument
    // metadata so an otherwise valid order cannot be rejected for extra digits.
    const instrument = await adapter.getInstrument(order.symbol);
    if (!instrument) {
      return { executed: false, reason: 'Live broker instrument metadata unavailable for ' + order.symbol + '.', code: 'INVALID_SYMBOL' };
    }
    if (order.price !== undefined && Number(order.price) > 0) {
      order.price = normalizePriceToInstrumentDigits(Number(order.price), instrument.digits);
    }
    if (order.stopLoss !== undefined && Number(order.stopLoss) > 0) {
      order.stopLoss = normalizePriceToInstrumentDigits(Number(order.stopLoss), instrument.digits);
    }
    if (order.takeProfit !== undefined && Number(order.takeProfit) > 0) {
      order.takeProfit = normalizePriceToInstrumentDigits(Number(order.takeProfit), instrument.digits);
    }
    liveRuntimeLog('INFO', 'ORDER_PRICE_PRECISION_NORMALIZED', {
      broker,
      symbol: order.symbol,
      instrumentDigits: instrument.digits,
      price: order.price,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit
    });

    const packetValidation = validateAutoLiveOrderPacket(order);
    if (!packetValidation.valid) {
      auditExecution('FINAL_ORDER_PACKET_REJECTED', {
        code: 'INVALID_AUTONOMOUS_ORDER_PACKET',
        reason: packetValidation.reasons.join('; ')
      });
      return {
        executed: false,
        code: 'INVALID_AUTONOMOUS_ORDER_PACKET',
        reason: packetValidation.reasons.join('; ')
      };
    }

    // Stage 1: Kill Switch Check
    if (killSwitch.isHalted()) {
      logBrokerAction({
        source: 'EXECUTION_ENGINE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'BLOCKED',
        error: 'Emergency Kill Switch is ACTIVE'
      });
      auditExecution('EXECUTION_REJECTED', { code: 'EMERGENCY_STOP_ACTIVE', reason: 'Emergency Kill Switch is ACTIVE' });
      return { executed: false, reason: 'Emergency Kill Switch is ACTIVE', code: 'EMERGENCY_STOP_ACTIVE' };
    }

    // Stage 2: Shared live safety gate.
    //
    // Do not run the legacy TradeValidator here. Its historical notional-value
    // and R:R rules are not part of the Trigger Now execution path and are
    // incompatible with the current direct cTrader-volume contract. Auto Live
    // must reach the same authoritative live gate before dispatch.
    const gateResult = await liveTradingGate.evaluate(adapter, {
      ...gateParams,
      order
    });
    if (!gateResult.passed) {
      logBrokerAction({
        source: 'SAFETY_GATE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'BLOCKED',
        error: gateResult.failedReasons.join(', '),
        riskValidation: { passed: false, checks: gateResult.checks, reason: gateResult.failedReasons.join(', ') }
      });
      auditExecution('SAFETY_GATE_REJECTED', { code: 'SAFETY_GATE_REJECTED', reason: gateResult.failedReasons.join(', '), checks: gateResult.checks });
      return {
        executed: false,
        code: 'SAFETY_GATE_REJECTED',
        reason: gateResult.failedReasons.join(', ')
      };
    }

    // Stage 3B: Independent readiness gate. This re-checks live broker state,
    // daily loss, trade frequency, consecutive losses, spread, strategy
    // calibration and signal identity immediately before any autonomous path.
    const readiness = await autoTradeReadinessService.evaluate(
      adapter,
      order,
      signalInput.signalTimestamp,
      gateParams.currentQuote
    );
    if (!readiness.ready) {
      logBrokerAction({
        source: 'AUTO_TRADE_READINESS',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        signalId: order.signalId,
        strategyId: order.strategyId,
        result: 'BLOCKED',
        error: readiness.failedReasons.join(', '),
        riskValidation: {
          passed: false,
          checks: readiness.checks,
          reason: readiness.failedReasons.join(', ')
        }
      });
      auditExecution('READINESS_REJECTED', { code: 'AUTO_TRADE_NOT_READY', reason: readiness.failedReasons.join(', '), checks: readiness.checks });
      return {
        executed: false,
        code: 'AUTO_TRADE_NOT_READY',
        reason: readiness.failedReasons.join(', ')
      };
    }

    // Stage 4: Autonomous live execution permission boundary.
    // Permission is evaluated at the moment of dispatch and can never bypass
    // the readiness checks above.
    syncAutonomousPermission();
    if (!LIVE_AUTO_EXECUTION_ALLOWED) {
      logBrokerAction({
        source: 'SAFETY_GATE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'BLOCKED',
        error: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED: Signal validated for operator review only.'
      });
      auditExecution('AUTONOMOUS_PERMISSION_REJECTED', { code: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED', reason: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED: Autonomous live-money order execution is disabled by the current server control.' });
      return {
        executed: false,
        code: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
        reason: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED: Autonomous live-money order execution is disabled by the current server control.'
      };
    }

    // Submit live order via an idempotent durable execution intent.
    try {
      const idempotencyKey = String(order.signalId || '').trim();
      if (!idempotencyKey) {
        auditExecution('EXECUTION_REJECTED', { code: 'IDEMPOTENCY_KEY_REQUIRED', reason: 'Autonomous signal execution requires a stable signalId for duplicate-order protection.' });
        return {
          executed: false,
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          reason: 'Autonomous signal execution requires a stable signalId for duplicate-order protection.'
        };
      }

      const intent = await claimExecutionIntent(idempotencyKey, {
        broker,
        market: order.market,
        symbol: order.symbol,
        side: order.side,
        payload: order
      });

      if (!intent.claimed) {
        // An ambiguous prior submission is reconciled against authoritative broker
        // history before the duplicate is rejected. Resolution is fail-closed:
        // only one exact broker match can complete the durable intent.
        if (intent.existing?.state === 'RECONCILIATION_TIMEOUT' || intent.existing?.state === 'IN_FLIGHT') {
          try {
            const reconciliation = await reconcileExecutionIntent(idempotencyKey, adapter);
            if (reconciliation.status === 'RESOLVED' && reconciliation.order) {
              auditExecution('EXECUTION_INTENT_RECONCILED', {
                code: 'EXECUTION_INTENT_RECONCILED',
                brokerOrderId: reconciliation.order.brokerOrderId || reconciliation.order.id
              });
              return {
                executed: reconciliation.order.status === 'FILLED',
                order: reconciliation.order,
                code: 'EXECUTION_INTENT_RECONCILED',
                reason: reconciliation.reason
              };
            }
            auditExecution('EXECUTION_INTENT_RECONCILIATION_PENDING', {
              code: 'EXECUTION_INTENT_RECONCILIATION_PENDING',
              reason: reconciliation.reason,
              candidateCount: reconciliation.candidates.length
            });
          } catch (reconciliationError: any) {
            auditExecution('EXECUTION_INTENT_RECONCILIATION_FAILED', {
              code: 'EXECUTION_INTENT_RECONCILIATION_FAILED',
              reason: reconciliationError?.message || String(reconciliationError)
            });
          }
        }

        auditExecution('EXECUTION_INTENT_DUPLICATE', { code: 'EXECUTION_INTENT_ALREADY_EXISTS', reason: 'This autonomous signal has already been submitted or is pending reconciliation.', existingState: intent.existing?.state });
        return {
          executed: intent.existing?.state === 'COMPLETED',
          order: intent.existing?.result as NormalizedOrder | undefined,
          code: 'EXECUTION_INTENT_ALREADY_EXISTS',
          reason: 'This autonomous signal has already been submitted or is pending reconciliation.'
        };
      }

      const autonomousPlacer = (adapter as BrokerAdapter & {
        placeAutonomousOrder?: (request: OrderRequest) => Promise<NormalizedOrder>;
      }).placeAutonomousOrder;

      if (typeof autonomousPlacer !== 'function') {
        await failExecutionIntent(idempotencyKey, {
          status: 'REJECTED',
          rejectionReason: 'Broker adapter does not expose the guarded autonomous-order capability.'
        } as NormalizedOrder);
        auditExecution('EXECUTION_REJECTED', { code: 'AUTONOMOUS_ORDER_PATH_UNAVAILABLE', reason: 'Broker adapter does not expose the guarded autonomous-order capability.' });
        return {
          executed: false,
          code: 'AUTONOMOUS_ORDER_PATH_UNAVAILABLE',
          reason: 'Broker adapter does not expose the guarded autonomous-order capability.'
        };
      }

      // This is the last guarded application-level point before the live broker API call.
      auditExecution('FINAL_ORDER_PACKET', { request: order });
      onReadyToSubmit?.();

      // Move the durable intent to IN_FLIGHT immediately before submission.
      // If the broker call then fails without a definitive broker response,
      // the outcome is intentionally ambiguous: the broker may have accepted
      // the order even though the client did not receive the response. Keep
      // the intent non-retryable and route it to reconciliation instead of
      // marking it FAILED.
      await markExecutionIntentInFlight(idempotencyKey, {
        status: 'SUBMISSION_STARTED',
        broker,
        symbol: order.symbol,
        signalId: order.signalId
      });

      let brokerSubmissionStarted = true;
      let placedOrder: NormalizedOrder;
      try {
        placedOrder = await autonomousPlacer.call(adapter, order);
        brokerSubmissionStarted = false;
      } catch (err: any) {
        if (brokerSubmissionStarted) {
          await markExecutionIntentSubmissionAmbiguous(idempotencyKey, {
            message: err?.message || String(err),
            broker,
            symbol: order.symbol,
            signalId: order.signalId
          });
        }
        throw err;
      }

      if (placedOrder.status === 'FILLED') {
        await completeExecutionIntent(idempotencyKey, placedOrder);
      } else if (placedOrder.status === 'CANCELLED' || placedOrder.status === 'REJECTED' || placedOrder.status === 'EXPIRED') {
        await failExecutionIntent(idempotencyKey, placedOrder);
      } else {
        await markExecutionIntentInFlight(idempotencyKey, placedOrder);
      }

      logBrokerAction({
        source: 'EXECUTION_ENGINE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'SUCCESS',
        quantity: order.quantity
      });
      auditExecution(placedOrder.status === 'FILLED' ? 'TRADE_EXECUTED' : 'BROKER_ORDER_RESULT', {
        brokerStatus: placedOrder.status,
        orderId: placedOrder.brokerOrderId || placedOrder.id
      });
      return {
        executed: placedOrder.status === 'FILLED',
        order: placedOrder
      };
    } catch (err: any) {
      logBrokerAction({
        source: 'EXECUTION_ENGINE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'FAILURE',
        error: err.message
      });
      auditExecution('BROKER_SUBMISSION_FAILED', { code: 'BROKER_SUBMISSION_FAILED', reason: `Broker Order Submission Failed: ${err.message}` });
      return {
        executed: false,
        code: 'BROKER_SUBMISSION_FAILED',
        reason: `Broker Order Submission Failed: ${err.message}`
      };
    }
  }
}

export const autoExecutionEngine = new AutoExecutionEngine();
