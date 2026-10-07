import assert from 'node:assert/strict';
import {
  claimExecutionIntent,
  completeExecutionIntent,
  failExecutionIntent,
  getExecutionIntent,
  markExecutionIntentSubmissionAmbiguous,
  resumeExecutionIntentReconciliation,
  reconcileExecutionIntent
} from '../src/services/executionIntentService';

const key = 'test-reconciliation-' + Date.now();
const payload = {
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  orderType: 'MARKET',
  quantity: 1000,
  price: 1.123,
  stopLoss: 1.120,
  takeProfit: 1.129,
  signalId: key
};

const first = await claimExecutionIntent(key, {
  broker: 'CTRADER',
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  payload
});
assert.equal(first.claimed, true);
assert.equal(first.existing?.state, 'PENDING');

const duplicate = await claimExecutionIntent(key, {
  broker: 'CTRADER',
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  payload
});
assert.equal(duplicate.claimed, false);
assert.equal(duplicate.existing?.state, 'PENDING');

await markExecutionIntentSubmissionAmbiguous(key, {
  message: 'network timeout after broker submission'
});
let intent = await getExecutionIntent(key);
assert.equal(intent?.state, 'RECONCILIATION_TIMEOUT');
assert.equal((intent?.result as any)?.code, 'BROKER_SUBMISSION_AMBIGUOUS');

const duplicateDuringReconciliation = await claimExecutionIntent(key, {
  broker: 'CTRADER',
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  payload
});
assert.equal(duplicateDuringReconciliation.claimed, false);
assert.equal(duplicateDuringReconciliation.existing?.state, 'RECONCILIATION_TIMEOUT');

await resumeExecutionIntentReconciliation(key);
intent = await getExecutionIntent(key);
assert.equal(intent?.state, 'IN_FLIGHT');

const reconciledOrder = {
  id: 'broker-order-reconciled',
  broker: 'CTRADER' as const,
  environment: 'LIVE' as const,
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY' as const,
  orderType: 'MARKET' as const,
  quantity: 1000,
  requestedQuantity: 1000,
  price: 1.123,
  status: 'FILLED' as const,
  filledQuantity: 1000,
  averageFillPrice: 1.1231,
  timestamp: Date.now(),
  brokerOrderId: 'broker-order-reconciled'
};
const reconciliation = await reconcileExecutionIntent(key, {
  getOrderHistory: async () => [reconciledOrder],
  getOrderHistoryRange: async () => [reconciledOrder]
} as any);
assert.equal(reconciliation.status, 'RESOLVED');
assert.equal(reconciliation.order?.brokerOrderId, 'broker-order-reconciled');
intent = await getExecutionIntent(key);
assert.equal(intent?.state, 'COMPLETED');


await failExecutionIntent(key, {
  status: 'REJECTED'
});
intent = await getExecutionIntent(key);
assert.equal(intent?.state, 'COMPLETED');

const nativeKey = 'test-native-reconciliation-' + Date.now();
const nativePayload = { ...payload, signalId: nativeKey };
await claimExecutionIntent(nativeKey, {
  broker: 'CTRADER',
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  payload: nativePayload
});
await markExecutionIntentSubmissionAmbiguous(nativeKey, { message: 'timeout after send' });
const nativeOrder = {
  id: 'ctrader-987654',
  broker: 'CTRADER' as const,
  environment: 'LIVE' as const,
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY' as const,
  orderType: 'MARKET' as const,
  quantity: 1000,
  requestedQuantity: 1000,
  price: 1.123,
  status: 'FILLED' as const,
  filledQuantity: 1000,
  averageFillPrice: 1.1231,
  timestamp: Date.now(),
  brokerOrderId: '987654',
  clientOrderId: nativeKey
};
const nativeResult = await reconcileExecutionIntent(nativeKey, {
  getOrderByClientOrderId: async (clientOrderId: string) => clientOrderId === nativeKey ? nativeOrder : null,
  getOrderHistory: async () => [],
  getOrderHistoryRange: async () => []
} as any);
assert.equal(nativeResult.status, 'RESOLVED');
assert.equal(nativeResult.order?.clientOrderId, nativeKey);
const nativeIntent = await getExecutionIntent(nativeKey);
assert.equal(nativeIntent?.state, 'COMPLETED');

console.log('EXECUTION INTENT RECONCILIATION TESTS PASSED');
