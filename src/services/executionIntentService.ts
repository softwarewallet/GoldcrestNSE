import crypto from 'node:crypto';
import { executeQuery, executeRun, executeTransaction } from '../database/db';
import type { BrokerAdapter, NormalizedOrder } from '../brokers/types';

export type ExecutionIntentState = 'PENDING' | 'IN_FLIGHT' | 'RECONCILIATION_TIMEOUT' | 'COMPLETED' | 'FAILED';

export interface ExecutionIntentRecord {
  idempotencyKey: string;
  broker: string;
  market: string;
  symbol: string;
  side: string;
  state: ExecutionIntentState;
  payload: unknown;
  result?: unknown;
}

export async function claimExecutionIntent(
  idempotencyKey: string,
  metadata: Omit<ExecutionIntentRecord, 'idempotencyKey' | 'state' | 'result'>
): Promise<{ claimed: boolean; existing?: ExecutionIntentRecord }> {
  const claimToken = crypto.randomUUID();
  const payloadJson = JSON.stringify(metadata.payload ?? null);

  return executeTransaction((db) => {
    const readExisting = () => {
      const stmt = db.prepare('SELECT * FROM execution_intents WHERE idempotency_key = ?');
      try {
        stmt.bind([idempotencyKey]);
        if (!stmt.step()) return undefined;
        return stmt.getAsObject() as any;
      } finally {
        stmt.free();
      }
    };

    const existing = readExisting();
    if (!existing) {
      const now = Date.now();
      db.run(
        'INSERT INTO execution_intents (idempotency_key, claim_token, broker, market, symbol, side, state, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [idempotencyKey, claimToken, metadata.broker, metadata.market, metadata.symbol, metadata.side, 'PENDING', payloadJson, now, now]
      );
    }

    const row = readExisting();
    if (!row) throw new Error('EXECUTION_INTENT_NOT_PERSISTED');

    const storedPayload = JSON.parse(row.payload_json || 'null');
    if (JSON.stringify(storedPayload) !== payloadJson) {
      throw new Error('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    }

    return {
      claimed: row.claim_token === claimToken,
      existing: {
        idempotencyKey: row.idempotency_key,
        broker: row.broker,
        market: row.market,
        symbol: row.symbol,
        side: row.side,
        state: row.state,
        payload: storedPayload,
        result: row.result_json ? JSON.parse(row.result_json) : undefined
      }
    };
  });
}

export async function markExecutionIntentInFlight(idempotencyKey: string, result: unknown): Promise<void> {
  await executeRun(
    'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state = ?',
    ['IN_FLIGHT', JSON.stringify(result), Date.now(), idempotencyKey, 'PENDING']
  );
}

export async function completeExecutionIntent(idempotencyKey: string, result: unknown): Promise<void> {
  const brokerOrderId = (result as any)?.brokerOrderId || (result as any)?.broker_order_id || null;
  if (brokerOrderId) {
    await executeRun(
      'UPDATE execution_intents SET state = ?, result_json = ?, broker_order_id = ?, updated_at = ? WHERE idempotency_key = ? AND state IN (?, ?, ?)',
      ['COMPLETED', JSON.stringify(result), String(brokerOrderId), Date.now(), idempotencyKey, 'IN_FLIGHT', 'RECONCILIATION_TIMEOUT']
    );
  } else {
    await executeRun(
      'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state IN (?, ?, ?)',
      ['COMPLETED', JSON.stringify(result), Date.now(), idempotencyKey, 'IN_FLIGHT', 'RECONCILIATION_TIMEOUT']
    );
  }
}

export async function failExecutionIntent(idempotencyKey: string, result: unknown): Promise<void> {
  await executeRun(
    'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state IN (?, ?, ?)',
    ['FAILED', JSON.stringify(result), Date.now(), idempotencyKey, 'PENDING', 'IN_FLIGHT', 'RECONCILIATION_TIMEOUT']
  );
}

export async function markExecutionIntentSubmissionAmbiguous(
  idempotencyKey: string,
  result: unknown
): Promise<void> {
  await markExecutionIntentReconciliationTimeout(idempotencyKey, {
    code: 'BROKER_SUBMISSION_AMBIGUOUS',
    ...(typeof result === 'object' && result !== null ? result : { detail: result })
  });
}

export async function markExecutionIntentReconciliationTimeout(idempotencyKey: string, result: unknown): Promise<void> {
  await executeRun(
    'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state IN (?, ?, ?)',
    ['RECONCILIATION_TIMEOUT', JSON.stringify(result), Date.now(), idempotencyKey, 'PENDING', 'IN_FLIGHT', 'RECONCILIATION_TIMEOUT']
  );
}

export async function resumeExecutionIntentReconciliation(idempotencyKey: string): Promise<void> {
  await executeRun(
    'UPDATE execution_intents SET state = ?, updated_at = ? WHERE idempotency_key = ? AND state = ?',
    ['IN_FLIGHT', Date.now(), idempotencyKey, 'RECONCILIATION_TIMEOUT']
  );
}

export async function getExecutionIntent(idempotencyKey: string): Promise<ExecutionIntentRecord | undefined> {
  const rows = await executeQuery<any>('SELECT * FROM execution_intents WHERE idempotency_key = ?', [idempotencyKey]);
  const row = rows[0];
  if (!row) return undefined;
  return {
    idempotencyKey: row.idempotency_key,
    broker: row.broker,
    market: row.market,
    symbol: row.symbol,
    side: row.side,
    state: row.state,
    payload: JSON.parse(row.payload_json || 'null'),
    result: row.result_json ? JSON.parse(row.result_json) : undefined
  };
}


export interface ExecutionIntentReconciliationResult {
  status: 'RESOLVED' | 'AMBIGUOUS' | 'NOT_FOUND' | 'SKIPPED';
  candidates: NormalizedOrder[];
  order?: NormalizedOrder;
  reason: string;
}

/**
 * Reconciles an ambiguous submission against authoritative broker order history.
 * Resolution is deliberately fail-closed: exactly one recent order must match
 * the durable intent on broker, market, symbol, side, and requested quantity.
 */
export async function reconcileExecutionIntent(
  idempotencyKey: string,
  adapter: BrokerAdapter,
  lookbackMs = 10 * 60 * 1000
): Promise<ExecutionIntentReconciliationResult> {
  const intent = await getExecutionIntent(idempotencyKey);
  if (!intent) {
    return { status: 'SKIPPED', candidates: [], reason: 'EXECUTION_INTENT_NOT_FOUND' };
  }
  if (intent.state !== 'RECONCILIATION_TIMEOUT' && intent.state !== 'IN_FLIGHT') {
    return { status: 'SKIPPED', candidates: [], reason: `EXECUTION_INTENT_STATE_${intent.state}` };
  }

  const payload = (intent.payload && typeof intent.payload === 'object') ? intent.payload as Record<string, unknown> : {};
  const clientOrderId = String(payload.signalId || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 50);
  if (clientOrderId && adapter.getOrderByClientOrderId) {
    const nativeOrder = await adapter.getOrderByClientOrderId(clientOrderId);
    if (nativeOrder) {
      if (nativeOrder.status === 'FILLED') await completeExecutionIntent(idempotencyKey, nativeOrder);
      else if (nativeOrder.status === 'REJECTED' || nativeOrder.status === 'CANCELLED' || nativeOrder.status === 'EXPIRED') await failExecutionIntent(idempotencyKey, nativeOrder);
      else await markExecutionIntentInFlight(idempotencyKey, nativeOrder);
      return { status: 'RESOLVED', candidates: [nativeOrder], order: nativeOrder, reason: `Execution intent reconciled using broker-native clientOrderId ${clientOrderId}.` };
    }
  }
  const from = Math.max(0, Date.now() - Math.max(60_000, lookbackMs));
  const orders = adapter.getOrderHistoryRange
    ? await adapter.getOrderHistoryRange(from, Date.now())
    : await adapter.getOrderHistory();

  const symbol = String(payload.symbol || intent.symbol).toUpperCase();
  const side = String(payload.side || intent.side).toUpperCase();
  const quantity = Number(payload.quantity || 0);

  const candidates = orders.filter(order => {
    const orderSymbol = String(order.symbol || '').toUpperCase();
    const orderSide = String(order.side || '').toUpperCase();
    const orderQuantity = Number(order.requestedQuantity || order.quantity || order.filledQuantity || 0);
    const timestamp = Number(order.timestamp || 0);
    const symbolMatches = orderSymbol === symbol;
    const sideMatches = orderSide === side;
    const quantityMatches = quantity > 0 && Math.abs(orderQuantity - quantity) < 1e-9;
    const recent = timestamp <= 0 || (timestamp >= from && timestamp <= Date.now());
    const terminal = order.status === 'FILLED' || order.status === 'REJECTED' || order.status === 'CANCELLED' || order.status === 'EXPIRED';
    return symbolMatches && sideMatches && quantityMatches && recent && terminal;
  });

  if (candidates.length !== 1) {
    return {
      status: candidates.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS',
      candidates,
      reason: candidates.length === 0
        ? 'No unique authoritative broker order matched the execution intent.'
        : `Multiple authoritative broker orders matched the execution intent (${candidates.length}).`
    };
  }

  const order = candidates[0];
  if (order.status === 'FILLED') {
    await completeExecutionIntent(idempotencyKey, order);
  } else {
    await failExecutionIntent(idempotencyKey, order);
  }

  return {
    status: 'RESOLVED',
    candidates,
    order,
    reason: `Execution intent reconciled to broker order ${order.brokerOrderId || order.id}.`
  };
}
