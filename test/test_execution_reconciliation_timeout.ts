import assert from 'node:assert/strict';
import { executeRun } from '../src/database/db';
import { brokerRegistry } from '../src/brokers/registry';
import { claimExecutionIntent, getExecutionIntent } from '../src/services/executionIntentService';
import { reconcileExecutionIntent } from '../src/services/executionReconciliationService';

const throwingKey = `TEST-RECON-LOOKUP-THROW-${Date.now()}`;
const staleKey = `TEST-RECON-STALE-LOOKUP-${Date.now() + 1}`;

await claimExecutionIntent(throwingKey, {
  broker: 'CTRADER',
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  payload: {
    market: 'FOREX',
    symbol: 'EUR/USD',
    side: 'BUY',
    quantity: 1000,
    signalId: throwingKey
  }
});

await claimExecutionIntent(staleKey, {
  broker: 'CTRADER',
  market: 'FOREX',
  symbol: 'XAU/USD',
  side: 'SELL',
  payload: {
    market: 'FOREX',
    symbol: 'XAU/USD',
    side: 'SELL',
    quantity: 1000,
    signalId: staleKey
  }
});

await executeRun(
  'UPDATE execution_intents SET created_at = ?, updated_at = ? WHERE idempotency_key = ?',
  [Date.now() - 16 * 60 * 1000, Date.now(), staleKey]
);

const fakeAdapter: any = {
  getOrderByClientOrderId: async () => {
    throw new Error('cTrader market-data connection timeout');
  }
};

brokerRegistry.registerAdapter('CTRADER', 'LIVE', fakeAdapter);

await reconcileExecutionIntent(throwingKey);
const throwingIntent = await getExecutionIntent(throwingKey);
assert.equal(throwingIntent?.state, 'IN_FLIGHT', 'Transient native broker lookup failure must remain IN_FLIGHT.');

await reconcileExecutionIntent(staleKey);
const staleIntent = await getExecutionIntent(staleKey);
assert.equal(staleIntent?.state, 'RECONCILIATION_TIMEOUT', 'Stale unresolved native broker lookup must time out.');
assert.equal((staleIntent?.result as any)?.operatorActionRequired, true, 'Timed-out ambiguous intent must require operator action.');
assert.equal((staleIntent?.result as any)?.reconciliationErrorCode, 'TIMEOUT', 'Transport timeout should preserve normalized broker error code.');

await executeRun(
  'DELETE FROM execution_intents WHERE idempotency_key IN (?, ?)',
  [throwingKey, staleKey]
);

console.log('EXECUTION RECONCILIATION TIMEOUT REGRESSION TESTS PASSED');
