import { executeQuery } from '../database/db';
import { brokerRegistry } from '../brokers/registry';
import { liveRuntimeLog } from './liveRuntimeLog';
import {
  closeLiveTradeResearchOutcome,
  updateLiveTradeResearchExecution,
  updateLiveTradeResearchMark
} from './liveTradeResearchService';

const OUTCOME_POLL_MS = Math.max(
  5_000,
  Number(process.env.GOLDCREST_LIVE_TRADE_OUTCOME_POLL_MS || 10_000)
);

let timer: NodeJS.Timeout | null = null;
let syncInFlight = false;
let lastSyncAt: number | null = null;
let lastSyncResult: string | null = null;
let lastError: string | null = null;
let trackedOpenTrades = 0;
let closedTradesUpdated = 0;

/**
 * Observational lifecycle tracker for Auto Live research records.
 *
 * This service never places, modifies, or blocks orders. It only observes
 * authoritative broker positions/deals and enriches the research ledger.
 */
export async function syncLiveTradeResearchOutcomes(): Promise<void> {
  if (syncInFlight) return;
  syncInFlight = true;
  lastSyncAt = Date.now();

  try {
    const openRows = await executeQuery<any>(
      `SELECT signal_id, symbol, direction, broker_order_id, broker_position_id,
              execution_timestamp, executed_entry_price, mfe_pnl, mae_pnl
         FROM live_trade_research
        WHERE lifecycle_status = 'OPEN'
        ORDER BY execution_timestamp ASC
        LIMIT 5000`
    );

    trackedOpenTrades = openRows.length;
    if (openRows.length === 0) {
      lastSyncResult = 'NO_OPEN_RESEARCH_TRADES';
      lastError = null;
      return;
    }

    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE');
    const positions = await adapter.getPositions();
    const positionsById = new Map(
      positions.map(position => [String(position.brokerPositionId || position.id), position])
    );

    for (const row of openRows) {
      try {
        let positionId = row.broker_position_id
          ? String(row.broker_position_id)
          : null;

        // Older research rows may have an order ID but no captured position ID.
        // Ask the broker for authoritative order status once and persist the
        // position ID exposed on its native fill event.
        if (!positionId && row.broker_order_id) {
          try {
            const order = await adapter.getOrderStatus(String(row.broker_order_id));
            const fill = order.fillEvents?.find(event => event.brokerPositionId);
            if (fill?.brokerPositionId) {
              positionId = String(fill.brokerPositionId);
              await updateLiveTradeResearchExecution({
                signalId: String(row.signal_id),
                status: order.status,
                brokerOrderId: order.brokerOrderId || row.broker_order_id,
                brokerPositionId: positionId,
                executedEntryPrice: order.averageFillPrice,
                executedQuantity: order.filledQuantity,
                commission: order.commission,
                brokerStatus: order.status,
                executionTimestamp: order.timestamp
              });
            }
          } catch {
            // Position ID discovery is best-effort telemetry; do not block
            // outcome processing or trading on a broker history lookup.
          }
        }

        if (!positionId) continue;

        const position = positionsById.get(positionId);
        if (position) {
          await updateLiveTradeResearchMark({
            signalId: String(row.signal_id),
            currentPnl: Number(position.unrealizedPnL || 0),
            observedAt: Date.now()
          });
          continue;
        }

        // The position is no longer open. Query the broker's authoritative
        // position-specific deal history to determine whether it was fully
        // closed and obtain the realized P&L/exit price.
        if (typeof adapter.getPositionHistory !== 'function') continue;

        const fromTimestamp = Math.max(
          0,
          Number(row.execution_timestamp || Date.now()) - 60_000
        );
        const closes = await adapter.getPositionHistory(
          positionId,
          fromTimestamp,
          Date.now()
        );

        if (!Array.isArray(closes) || closes.length === 0) continue;

        const filledCloses = closes.filter(close =>
          Number(close.quantity) > 0 && Number(close.exitPrice) > 0
        );
        if (filledCloses.length === 0) continue;

        const totalQuantity = filledCloses.reduce(
          (sum, close) => sum + Number(close.quantity || 0),
          0
        );
        const realizedPnl = filledCloses.reduce(
          (sum, close) => sum + Number(close.realizedPnL || 0),
          0
        );
        const commission = filledCloses.reduce(
          (sum, close) => sum + Number(close.commission || 0),
          0
        );
        const weightedExitPrice = totalQuantity > 0
          ? filledCloses.reduce(
              (sum, close) => sum + Number(close.exitPrice || 0) * Number(close.quantity || 0),
              0
            ) / totalQuantity
          : Number(filledCloses[filledCloses.length - 1].exitPrice || 0);
        const exitTimestamp = Math.max(
          ...filledCloses.map(close => Number(close.timestamp || Date.now()))
        );

        await closeLiveTradeResearchOutcome({
          signalId: String(row.signal_id),
          exitPrice: weightedExitPrice,
          exitTimestamp,
          realizedPnl,
          commission
        });
        closedTradesUpdated += 1;

        liveRuntimeLog('INFO', 'LIVE_TRADE_RESEARCH_OUTCOME_CAPTURED', {
          signalId: row.signal_id,
          symbol: row.symbol,
          brokerPositionId: positionId,
          realizedPnl,
          exitPrice: weightedExitPrice,
          exitTimestamp,
          holdingDurationMs: Math.max(0, exitTimestamp - Number(row.execution_timestamp || exitTimestamp))
        });
      } catch (tradeError: any) {
        liveRuntimeLog('WARN', 'LIVE_TRADE_RESEARCH_OUTCOME_FAILED', {
          signalId: row.signal_id,
          symbol: row.symbol,
          error: tradeError?.message || String(tradeError)
        });
      }
    }

    lastSyncResult = `TRACKED_${openRows.length}`;
    lastError = null;
  } catch (error: any) {
    lastError = error?.message || String(error);
    lastSyncResult = 'SYNC_FAILED';
    liveRuntimeLog('WARN', 'LIVE_TRADE_RESEARCH_OUTCOME_SYNC_FAILED', {
      error: lastError
    });
  } finally {
    syncInFlight = false;
  }
}

export function startLiveTradeResearchOutcomeTracker(): void {
  if (timer) return;
  void syncLiveTradeResearchOutcomes();
  timer = setInterval(() => {
    void syncLiveTradeResearchOutcomes();
  }, OUTCOME_POLL_MS);
  timer.unref?.();
  liveRuntimeLog('INFO', 'LIVE_TRADE_RESEARCH_OUTCOME_TRACKER_STARTED', {
    pollIntervalMs: OUTCOME_POLL_MS
  });
}

export function stopLiveTradeResearchOutcomeTracker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  liveRuntimeLog('INFO', 'LIVE_TRADE_RESEARCH_OUTCOME_TRACKER_STOPPED');
}

export function getLiveTradeResearchOutcomeTrackerStatus() {
  return {
    running: Boolean(timer),
    pollIntervalMs: OUTCOME_POLL_MS,
    syncInFlight,
    lastSyncAt,
    lastSyncResult,
    lastError,
    trackedOpenTrades,
    closedTradesUpdated
  };
}
