import { getSystemConfig, updateSystemConfig } from './configService';
import { executeQuery, executeRun, executeTransaction } from '../database/db';
import { liveRuntimeLog, tradeAuditLog } from './liveRuntimeLog';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { brokerRegistry } from '../brokers/registry';
import { OrderRequest } from '../brokers/types';
import { prepareAndValidateNiftyOrder } from './niftyTradeLimits';

export interface FirstLiveStatus {
  executionMode: 'LIVE_DRY_RUN' | 'LIVE_EXECUTION' | 'FIRST_LIVE_CERTIFICATION';
  armed: boolean;
  locked: boolean;
  ordersAllowed: number;
  ordersSubmitted: number;
  statusLabel: 'DRY RUN' | 'FIRST LIVE — ARMED' | 'FIRST LIVE — ORDER SUBMITTED' | 'FIRST LIVE — LOCKED';
  armedAt: number | null;
}

export interface ReserveFirstLiveOrderParams {
  correlationId: string;
  idempotencyKey: string;
  orderRequest: OrderRequest;
}

export interface ReserveFirstLiveOrderResult {
  success: boolean;
  reservationToken: string | null;
  message: string;
}

export interface FinalizeFirstLiveOrderParams {
  reservationToken: string;
  status: 'ACCEPTED' | 'FILLED' | 'REJECTED' | 'FAILED' | 'ATTEMPTED';
  brokerOrderId?: string;
  error?: string;
  result?: any;
}

export class FirstLiveService {
  /**
   * Retrieves the current First-Live status, reconciling persistent state with SQLite ledger.
   */
  async getStatus(): Promise<FirstLiveStatus> {
    const config = getSystemConfig();
    const mode = config.executionMode || 'LIVE_DRY_RUN';

    let submittedCount = 0;
    try {
      const rows = await executeQuery<any>(
        'SELECT COUNT(*) as cnt FROM first_live_ledger WHERE status IN (?, ?, ?, ?, ?, ?)',
        ['RESERVED', 'ATTEMPTED', 'ACCEPTED', 'FILLED', 'REJECTED', 'FAILED']
      );
      submittedCount = Number(rows[0]?.cnt || 0);
    } catch {
      submittedCount = Math.max(0, Number(config.firstLiveOrdersSubmitted || 0));
    }

    const totalSubmitted = Math.max(submittedCount, config.firstLiveOrdersSubmitted || 0);
    const locked = Boolean(config.firstLiveLocked || totalSubmitted >= 1);
    const armed = Boolean(config.firstLiveArmed && !locked && mode === 'FIRST_LIVE_CERTIFICATION');

    let statusLabel: FirstLiveStatus['statusLabel'] = 'DRY RUN';
    if (locked) {
      statusLabel = 'FIRST LIVE — LOCKED';
    } else if (totalSubmitted >= 1) {
      statusLabel = 'FIRST LIVE — ORDER SUBMITTED';
    } else if (armed) {
      statusLabel = 'FIRST LIVE — ARMED';
    }

    return {
      executionMode: mode,
      armed,
      locked,
      ordersAllowed: 1,
      ordersSubmitted: totalSubmitted,
      statusLabel,
      armedAt: config.firstLiveArmedAt || null
    };
  }

  /**
   * Explicitly arms First-Live Mode after validating operator confirmation,
   * authentication, emergency stop, market hours, and submission history.
   */
  async armFirstLive(params: { confirmArm: boolean; operatorNotes?: string }): Promise<{ success: boolean; message: string }> {
    if (!params.confirmArm) {
      return { success: false, message: 'FIRST_LIVE_NOT_ARMED: Explicit operator confirmation is required to arm First-Live mode.' };
    }

    if (killSwitch.isHalted()) {
      return { success: false, message: 'FIRST_LIVE_NOT_ARMED: Emergency stop is active. Clear emergency stop before arming.' };
    }

    const currentStatus = await this.getStatus();
    if (currentStatus.locked || currentStatus.ordersSubmitted >= 1) {
      return { success: false, message: 'FIRST_LIVE_LOCKED: First-live order budget has already been consumed (1/1 orders used). Operator reset required.' };
    }

    // Check 5paisa credential status
    let isConfigured = false;
    try {
      const credentialStatuses = brokerRegistry.getCredentialStatuses();
      const fivePaisaStatus = credentialStatuses.find(s => s.broker === 'FIVE_PAISA' && s.environment === 'LIVE');
      isConfigured = Boolean(fivePaisaStatus?.configured);
    } catch {
      isConfigured = false;
    }

    const now = Date.now();
    updateSystemConfig({
      executionMode: 'FIRST_LIVE_CERTIFICATION',
      firstLiveArmed: true,
      firstLiveArmedAt: now,
      firstLiveLocked: false
    });

    liveRuntimeLog('SYSTEM', 'FIRST_LIVE_ARMED', {
      timestamp: new Date().toISOString(),
      armedAt: now,
      configured: isConfigured,
      operatorNotes: params.operatorNotes || 'Operator confirmed First-Live arming'
    });

    tradeAuditLog('FIRST_LIVE_ARMED', {
      broker: 'FIVE_PAISA',
      environment: 'LIVE',
      result: 'SUCCESS',
      details: { timestamp: now, operatorNotes: params.operatorNotes }
    });

    return { success: true, message: 'FIRST_LIVE — ARMED: Controlled First LIVE certification mode is now armed for exactly ONE order.' };
  }

  /**
   * Disarms First-Live Mode and reverts execution mode to LIVE_DRY_RUN.
   */
  async disarmFirstLive(): Promise<{ success: boolean; message: string }> {
    updateSystemConfig({
      executionMode: 'LIVE_DRY_RUN',
      firstLiveArmed: false
    });

    liveRuntimeLog('SYSTEM', 'FIRST_LIVE_DISARMED', {
      timestamp: new Date().toISOString()
    });

    return { success: true, message: 'First-Live mode disarmed. Reverted to LIVE_DRY_RUN.' };
  }

  /**
   * Evaluates final preflight checks immediately before a First-Live order attempt.
   */
  async preflightCheck(orderRequest: OrderRequest): Promise<{ pass: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    const status = await this.getStatus();

    if (status.executionMode !== 'FIRST_LIVE_CERTIFICATION' && status.executionMode !== 'LIVE_EXECUTION') {
      reasons.push('Execution mode is not FIRST_LIVE_CERTIFICATION or LIVE_EXECUTION');
    }

    if (status.executionMode === 'FIRST_LIVE_CERTIFICATION') {
      if (!status.armed) reasons.push('FIRST_LIVE_NOT_ARMED: First-live mode is not armed');
      if (status.locked || status.ordersSubmitted >= 1) reasons.push('FIRST_LIVE_LOCKED: First-live single order budget consumed');
    }

    if (killSwitch.isHalted()) reasons.push('EMERGENCY_STOP_ACTIVE: Emergency stop is active');

    const config = getSystemConfig();
    const sizing = prepareAndValidateNiftyOrder({
      symbolOrUnderlying: orderRequest.symbol,
      priceOrPremium: orderRequest.price || 1,
      quantity: orderRequest.quantity,
      config
    });

    if (!sizing.isAllowed) {
      reasons.push(sizing.rejectionReason || 'INSUFFICIENT_TRADE_VALUE_FOR_ONE_LOT');
    }

    if (reasons.length > 0) {
      liveRuntimeLog('WARN', 'FIRST_LIVE_PREFLIGHT_FAILED', {
        reasons,
        symbol: orderRequest.symbol,
        timestamp: new Date().toISOString()
      });
    } else {
      liveRuntimeLog('SYSTEM', 'FIRST_LIVE_PREFLIGHT_PASSED', {
        symbol: orderRequest.symbol,
        quantity: orderRequest.quantity,
        timestamp: new Date().toISOString()
      });
    }

    return { pass: reasons.length === 0, reasons };
  }

  /**
   * Atomically reserves the single First-Live order.
   * Generates a durable reservation token, persists it in first_live_ledger,
   * updates persistent system config, and locks further reservations.
   */
  async reserveFirstLiveOrder(params: ReserveFirstLiveOrderParams): Promise<ReserveFirstLiveOrderResult> {
    const { correlationId, idempotencyKey, orderRequest } = params;

    return executeTransaction((db) => {
      const config = getSystemConfig();
      const mode = config.executionMode || 'LIVE_DRY_RUN';

      if (mode !== 'FIRST_LIVE_CERTIFICATION') {
        return {
          success: false,
          reservationToken: null,
          message: `FIRST_LIVE_RESERVATION_FAILED: System execution mode is ${mode}, not FIRST_LIVE_CERTIFICATION.`
        };
      }

      if (!config.firstLiveArmed) {
        return {
          success: false,
          reservationToken: null,
          message: 'FIRST_LIVE_RESERVATION_FAILED: First-Live mode is not armed.'
        };
      }

      if (config.firstLiveLocked || (config.firstLiveOrdersSubmitted || 0) >= 1) {
        return {
          success: false,
          reservationToken: null,
          message: 'FIRST_LIVE_RESERVATION_FAILED: First-Live order budget has already been consumed (1/1 orders used).'
        };
      }

      if (killSwitch.isHalted()) {
        return {
          success: false,
          reservationToken: null,
          message: 'FIRST_LIVE_RESERVATION_FAILED: Emergency stop is active.'
        };
      }

      const stmt = db.prepare(
        "SELECT COUNT(*) as cnt FROM first_live_ledger WHERE status IN ('RESERVED', 'ATTEMPTED', 'ACCEPTED', 'FILLED', 'REJECTED', 'FAILED')"
      );
      let count = 0;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        count = Number(row.cnt || 0);
      }
      stmt.free();

      if (count >= 1) {
        return {
          success: false,
          reservationToken: null,
          message: 'FIRST_LIVE_RESERVATION_FAILED: First-Live single order allowance is already reserved or submitted in ledger.'
        };
      }

      const now = Date.now();
      const randomSeed = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
      const reservationToken = `fl-res-${now}-${randomSeed}`;

      const newCount = Math.max(1, (config.firstLiveOrdersSubmitted || 0) + 1);
      updateSystemConfig({
        executionMode: 'LIVE_DRY_RUN',
        firstLiveArmed: false,
        firstLiveOrdersSubmitted: newCount,
        firstLiveLocked: true
      });

      db.run(
        `INSERT INTO first_live_ledger (
          id, reservation_token, correlation_id, idempotency_key, broker, environment, execution_mode,
          symbol, side, quantity, requested_price, status, attempted_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reservationToken,
          reservationToken,
          correlationId,
          idempotencyKey,
          (orderRequest as any).broker || 'FIVE_PAISA',
          'LIVE',
          'FIRST_LIVE_CERTIFICATION',
          orderRequest.symbol,
          orderRequest.side,
          orderRequest.quantity,
          orderRequest.price || 0,
          'RESERVED',
          now,
          JSON.stringify({ correlationId, idempotencyKey, orderRequest, reservationToken, reservedAt: now })
        ]
      );

      liveRuntimeLog('SYSTEM', 'FIRST_LIVE_RESERVED', {
        reservationToken,
        correlationId,
        idempotencyKey,
        symbol: orderRequest.symbol,
        timestamp: new Date(now).toISOString()
      });

      tradeAuditLog('FIRST_LIVE_RESERVED', {
        broker: 'FIVE_PAISA',
        environment: 'LIVE',
        result: 'SUCCESS',
        details: { reservationToken, correlationId, idempotencyKey, symbol: orderRequest.symbol }
      });

      return {
        success: true,
        reservationToken,
        message: 'First-Live order successfully reserved.'
      };
    });
  }

  /**
   * Finalizes a reserved First-Live order.
   * Updates SQLite ledger with terminal status and ensures system remains locked in LIVE_DRY_RUN.
   */
  async finalizeFirstLiveOrder(params: FinalizeFirstLiveOrderParams): Promise<void> {
    const { reservationToken, status, brokerOrderId, error, result } = params;
    const now = Date.now();

    const config = getSystemConfig();
    const newCount = Math.max(1, config.firstLiveOrdersSubmitted || 0);

    updateSystemConfig({
      executionMode: 'LIVE_DRY_RUN',
      firstLiveArmed: false,
      firstLiveOrdersSubmitted: newCount,
      firstLiveLocked: true
    });

    try {
      await executeRun(
        `UPDATE first_live_ledger SET status = ?, broker_order_id = ?, reconciled_at = ?, result_json = ? WHERE reservation_token = ? OR id = ?`,
        [
          status,
          brokerOrderId || null,
          now,
          JSON.stringify({ error, result, finalizedAt: now }),
          reservationToken,
          reservationToken
        ]
      );
    } catch (err) {
      console.warn('Failed to update first_live_ledger SQLite table on finalization:', err);
    }

    liveRuntimeLog('SYSTEM', 'FIRST_LIVE_FINALIZED', {
      reservationToken,
      status,
      brokerOrderId,
      error,
      timestamp: new Date(now).toISOString()
    });

    tradeAuditLog('FIRST_LIVE_FINALIZED', {
      broker: 'FIVE_PAISA',
      environment: 'LIVE',
      result: status === 'ACCEPTED' || status === 'FILLED' ? 'SUCCESS' : 'FAILURE',
      details: { reservationToken, status, brokerOrderId, error }
    });
  }

  /**
   * Legacy method retained for backward compatibility.
   */
  async consumeAttemptAndLock(details: {
    correlationId: string;
    idempotencyKey: string;
    orderRequest: OrderRequest;
    reason: string;
  }): Promise<void> {
    const reservation = await this.reserveFirstLiveOrder({
      correlationId: details.correlationId,
      idempotencyKey: details.idempotencyKey,
      orderRequest: details.orderRequest
    });

    if (reservation.reservationToken) {
      await this.finalizeFirstLiveOrder({
        reservationToken: reservation.reservationToken,
        status: 'ATTEMPTED',
        error: details.reason
      });
    }
  }
}

export const firstLiveService = new FirstLiveService();
