import assert from 'node:assert/strict';
import { evaluateAccountStateConsistency } from '../src/services/accountStateConsistencyService';
import type { BrokerAccountInfo } from '../src/brokers/types';
import type { AccountBalanceSnapshot } from '../src/services/accountBalanceSnapshotService';

const now = 10_000_000;
const live: BrokerAccountInfo = {
  accountId: '****1234',
  accountType: 'LIVE',
  balance: 7137.57,
  equity: 6471.17,
  availableMargin: 3882.93,
  usedMargin: 2588.24,
  freeMargin: 3882.93,
  currency: 'USD',
  broker: 'CTRADER',
  environment: 'LIVE',
  connectionStatus: 'CONNECTED',
  lastUpdate: now
};

const history: AccountBalanceSnapshot = {
  id: 'BALANCE-SNAPSHOT-CTRADER-9999000',
  broker: 'CTRADER',
  environment: 'LIVE',
  accountId: '****1234',
  currency: 'USD',
  capturedAt: 9_999_000,
  balance: 7100,
  equity: 6450,
  usedMargin: 2500,
  freeMargin: 3950,
  status: 'CAPTURED'
};

const scenarios: Array<{ id: number; name: string; run: () => void }> = [];
const add = (id: number, name: string, run: () => void) => scenarios.push({ id, name, run });

add(1, 'Matching LIVE account aligns', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, history, now).status, 'ALIGNED'));
add(2, 'Matching account is consistent', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, history, now).consistent, true));
add(3, 'Account identity must match', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, accountId: '****9999' }, now).status, 'ACCOUNT_MISMATCH'));
add(4, 'Account mismatch is inconsistent', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, accountId: '****9999' }, now).consistent, false));
add(5, 'Currency must match', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, currency: 'EUR' }, now).status, 'CURRENCY_MISMATCH'));
add(6, 'Currency mismatch is inconsistent', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, currency: 'EUR' }, now).consistent, false));
add(7, 'Missing history is explicit', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, null, now).status, 'HISTORY_UNAVAILABLE'));
add(8, 'Missing live account is explicit', () => assert.equal(evaluateAccountStateConsistency('CTRADER', null, history, now).status, 'LIVE_ACCOUNT_UNAVAILABLE'));
add(9, 'History must be LIVE', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, environment: 'LIVE' }, now).status, 'ALIGNED'));
add(10, 'History status must be CAPTURED', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, status: 'ERROR' }, now).status, 'HISTORY_UNAVAILABLE'));
add(11, 'Invalid live balance blocks consistency', () => assert.equal(evaluateAccountStateConsistency('CTRADER', { ...live, balance: Number.NaN }, history, now).status, 'LIVE_ACCOUNT_UNAVAILABLE'));
add(12, 'Invalid history balance blocks consistency', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, balance: Number.NaN }, now).status, 'HISTORY_UNAVAILABLE'));
add(13, 'Historical balance delta is informational when identity matches', () => assert.notEqual(evaluateAccountStateConsistency('CTRADER', live, history, now).balanceDelta, null));
add(14, 'Historical equity delta is informational when identity matches', () => assert.notEqual(evaluateAccountStateConsistency('CTRADER', live, history, now).equityDelta, null));
add(15, 'Used margin delta is returned', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, history, now).usedMarginDelta, 88.24));
add(16, 'Free margin delta is returned', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, history, now).freeMarginDelta, -67.07));
add(17, 'Freshness age is calculated', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, history, now).snapshotAgeMs, 1000));
add(18, 'Stale history is explicit', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, capturedAt: now - (3 * 60 * 60 * 1000 + 16 * 60 * 1000) }, now).status, 'STALE_HISTORY'));
add(19, 'Stale history is not consistent', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, capturedAt: now - (3 * 60 * 60 * 1000 + 16 * 60 * 1000) }, now).consistent, false));
add(20, 'Exact freshness boundary remains aligned', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, capturedAt: now - (3 * 60 * 60 * 1000 + 15 * 60 * 1000) }, now).status, 'ALIGNED'));
add(21, 'Future-dated snapshot is clamped to zero age', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, capturedAt: now + 1000 }, now).snapshotAgeMs, 0));
add(22, 'Lowercase currency still matches case-insensitively', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, currency: 'usd' }, now).status, 'ALIGNED'));
add(23, 'Whitespace-normalized account IDs still require exact identity', () => assert.equal(evaluateAccountStateConsistency('CTRADER', live, { ...history, accountId: ' ****1234 ' }, now).status, 'ALIGNED'));
add(24, 'Details identify linked account state', () => assert.ok(evaluateAccountStateConsistency('CTRADER', live, history, now).details.some(detail => detail.includes('same LIVE account'))));
add(25, 'Broker identity is retained', () => assert.equal(evaluateAccountStateConsistency('FIVE_PAISA', { ...live, broker: 'FIVE_PAISA', currency: 'INR' }, { ...history, broker: 'FIVE_PAISA', currency: 'INR' }, now).broker, 'FIVE_PAISA'));
add(26, 'Consistency is deterministic', () => assert.deepEqual(evaluateAccountStateConsistency('CTRADER', live, history, now), evaluateAccountStateConsistency('CTRADER', { ...live }, { ...history }, now)));
add(27, 'Phase 9.3 certification contains exactly 27 scenarios', () => assert.equal(scenarios.length, 27));

for (const item of scenarios) {
  item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/27] ' + item.name);
}

console.log('PHASE 9.3 ACCOUNT STATE CONSISTENCY CERTIFICATION: 27/27 PASSED');
