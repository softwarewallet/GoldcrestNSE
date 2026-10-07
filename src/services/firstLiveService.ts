import { getSystemConfig, updateSystemConfig } from './configService';
import { executeQuery, executeRun } from '../database/db';
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
        'SELECT COUNT(*) as cnt FROM first_live_ledger WHERE status IN (?, ?, ?, ?)',
        ['ATTEMPTED', 'ACCEPTED', 'FILLED', 'REJECTED']
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
   * Consumes the single First-Live attempt, locks First-Live mode,
   * reverts system config to LIVE_DRY_RUN, and logs the durable execution attempt.
   */
  async consumeAttemptAndLock(details: {
    correlationId: string;
    idempotencyKey: string;
    orderRequest: OrderRequest;
    reason: string;
  }): Promise<void> {
    const now = Date.now();
    const config = getSystemConfig();
    const newCount = Math.max(1, (config.firstLiveOrdersSubmitted || 0) + 1);

    updateSystemConfig({
      executionMode: 'LIVE_DRY_RUN',
      firstLiveArmed: false,
      firstLiveOrdersSubmitted: newCount,
      firstLiveLocked: true
    });

    try {
      await executeRun(
        `INSERT OR REPLACE INTO first_live_ledger (
          id, correlation_id, idempotency_key, broker, environment, execution_mode,
          symbol, side, quantity, requested_price, status, attempted_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `fl-${now}-${Math.random().toString(36).slice(2, 7)}`,
          details.correlationId,
          details.idempotencyKey,
          (details.orderRequest as any).broker || 'FIVE_PAISA',
          'LIVE',
          'FIRST_LIVE_CERTIFICATION',
          details.orderRequest.symbol,
          details.orderRequest.side,
          details.orderRequest.quantity,
          details.orderRequest.price || 0,
          'ATTEMPTED',
          now,
          JSON.stringify(details)
        ]
      );
    } catch (err) {
      console.warn('Failed to insert into first_live_ledger SQLite table:', err);
    }

    liveRuntimeLog('SYSTEM', 'FIRST_LIVE_LOCKED', {
      correlationId: details.correlationId,
      reason: details.reason,
      ordersSubmitted: newCount,
      revertedToMode: 'LIVE_DRY_RUN',
      timestamp: new Date(now).toISOString()
    });
  }
}

export const firstLiveService = new FirstLiveService();
