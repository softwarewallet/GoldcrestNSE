import { logBrokerAction } from '../auditLog';
import { brokerRegistry } from '../registry';

export interface EmergencyHaltResult {
  requestedCount: number;
  cancelledCount: number;
  unconfirmedCount: number;
  brokerResults: Array<{
    broker: string;
    requestedCount: number;
    cancelledCount: number;
    unconfirmedCount: number;
    errors: string[];
  }>;
}

class KillSwitchService {
  private isEmergencyHalted: boolean = false;
  private haltReason: string = '';
  private haltedAt: number = 0;

  isHalted(): boolean {
    return this.isEmergencyHalted;
  }

  getHaltDetails() {
    return {
      isHalted: this.isEmergencyHalted,
      reason: this.haltReason,
      haltedAt: this.haltedAt
    };
  }

  /**
   * Activates Emergency Stop:
   * - Prevents new automatic orders
   * - Cancels pending live orders on BOTH active live brokers
   * - Re-queries broker state and only counts orders as cancelled after
   *   authoritative confirmation that they are no longer open
   * - Does not flatten existing positions; position closure remains an
   *   explicit operator action.
   */
  async triggerEmergencyHalt(reason: string = 'User initiated Emergency Stop'): Promise<EmergencyHaltResult> {
    this.isEmergencyHalted = true;
    this.haltReason = reason;
    this.haltedAt = Date.now();

    logBrokerAction({
      source: 'KILL_SWITCH',
      broker: 'CTRADER',
      environment: 'LIVE',
      account: 'ALL_ACCOUNTS',
      action: 'EMERGENCY_STOP_TRIGGERED',
      result: 'SUCCESS',
      error: reason
    });

    const brokerResults: EmergencyHaltResult['brokerResults'] = [];
    let requestedCount = 0;
    let cancelledCount = 0;
    let unconfirmedCount = 0;

    for (const adapter of brokerRegistry.getActiveLiveAdapters()) {
      const broker = String(adapter.broker);
      const result = {
        broker,
        requestedCount: 0,
        cancelledCount: 0,
        unconfirmedCount: 0,
        errors: [] as string[]
      };

      try {
        const openOrders = await adapter.getOpenOrders();
        const cancellable = openOrders.filter(ord =>
          ord.status === 'PENDING' ||
          ord.status === 'ACCEPTED' ||
          ord.status === 'PARTIALLY_FILLED'
        );

        result.requestedCount = cancellable.length;
        requestedCount += cancellable.length;

        for (const ord of cancellable) {
          try {
            const accepted = await adapter.cancelOrder(ord.id);
            if (!accepted) {
              result.errors.push(`Cancellation rejected for order ${ord.id}`);
            }
          } catch (err: any) {
            result.errors.push(`Order ${ord.id}: ${err?.message || String(err)}`);
          }
        }

        // A successful cancellation API call is not sufficient for an
        // emergency-stop confirmation. Reconcile the authoritative open-order
        // state after all cancellation requests have been submitted.
        const remaining = await adapter.getOpenOrders();
        const requestedIds = new Set(cancellable.map(ord => String(ord.brokerOrderId || ord.id)));
        const stillOpen = remaining.filter(ord =>
          requestedIds.has(String(ord.brokerOrderId || ord.id)) &&
          (ord.status === 'PENDING' ||
            ord.status === 'ACCEPTED' ||
            ord.status === 'PARTIALLY_FILLED')
        );

        result.cancelledCount = cancellable.length - stillOpen.length;
        result.unconfirmedCount = stillOpen.length;
        cancelledCount += result.cancelledCount;
        unconfirmedCount += result.unconfirmedCount;

        if (stillOpen.length > 0) {
          result.errors.push(
            `Authoritative broker state still shows ${stillOpen.length} targeted order(s) open.`
          );
        }
      } catch (err: any) {
        result.errors.push(err?.message || String(err));
        result.unconfirmedCount = result.requestedCount;
        unconfirmedCount += result.unconfirmedCount;
      }

      brokerResults.push(result);

      logBrokerAction({
        source: 'KILL_SWITCH',
        broker: adapter.broker,
        environment: 'LIVE',
        account: 'ALL_ACCOUNTS',
        action: 'EMERGENCY_ORDER_CANCELLATION',
        result: result.unconfirmedCount === 0 ? 'SUCCESS' : 'FAILURE',
        error: result.errors.length ? result.errors.join('; ') : undefined
      });
    }

    return {
      requestedCount,
      cancelledCount,
      unconfirmedCount,
      brokerResults
    };
  }

  resumeTrading(): void {
    this.isEmergencyHalted = false;
    this.haltReason = '';
    this.haltedAt = 0;

    logBrokerAction({
      source: 'KILL_SWITCH',
      broker: 'CTRADER',
      environment: 'LIVE',
      account: 'ALL_ACCOUNTS',
      action: 'TRADING_RESUMED',
      result: 'SUCCESS'
    });
  }
}

export const killSwitch = new KillSwitchService();
