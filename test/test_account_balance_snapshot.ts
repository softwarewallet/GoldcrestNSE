import assert from 'node:assert/strict';
import { executeRun } from '../src/database/db';
import { brokerRegistry } from '../src/brokers/registry';
import { captureAccountBalanceSnapshots, getAccountBalanceSnapshots } from '../src/services/accountBalanceSnapshotService';

const capturedAt = Date.now();
const fakeAccounts: Record<string, any> = {
  CTRADER: {
    accountId: 'TEST-CTRADER',
    accountType: 'LIVE',
    balance: 10000,
    equity: 10125,
    availableMargin: 8125,
    usedMargin: 2000,
    freeMargin: 8125,
    currency: 'USD',
    broker: 'CTRADER',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    lastUpdate: capturedAt
  },
  FIVE_PAISA: {
    accountId: 'TEST-5PAISA',
    accountType: 'LIVE',
    balance: 250000,
    equity: 251500,
    availableMargin: 201500,
    usedMargin: 50000,
    freeMargin: 201500,
    currency: 'INR',
    broker: 'FIVE_PAISA',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    lastUpdate: capturedAt
  }
};

for (const broker of ['CTRADER', 'FIVE_PAISA'] as const) {
  brokerRegistry.registerAdapter(broker, 'LIVE', {
    getAccount: async () => fakeAccounts[broker]
  } as any);
}

const rows = await captureAccountBalanceSnapshots(capturedAt);
assert.equal(rows.length, 2);

// Regression fixture: a prior interrupted test run must never remain visible.
await executeRun(
  `INSERT OR REPLACE INTO account_balance_snapshots
   (id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status, error_message)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ['synthetic-balance-fixture', 'CTRADER', 'LIVE', 'TEST-CTRADER', 'USD', capturedAt - 1, 1000, 1000, 0, 1000, 'CAPTURED', null]
);
assert.equal(rows.every(row => row.status === 'CAPTURED'), true);

const stored = await getAccountBalanceSnapshots({ from: capturedAt, to: capturedAt, limit: 10 });
assert.equal(stored.length, 2);

const ctrader = stored.find(row => row.broker === 'CTRADER');
assert.equal(ctrader?.balance, 10000);
assert.equal(ctrader?.equity, 10125);
assert.equal(ctrader?.usedMargin, 2000);
assert.equal(ctrader?.freeMargin, 8125);
assert.equal(ctrader?.currency, 'USD');

const fivePaisa = stored.find(row => row.broker === 'FIVE_PAISA');
assert.equal(fivePaisa?.balance, 250000);
assert.equal(fivePaisa?.equity, 251500);
assert.equal(fivePaisa?.usedMargin, 50000);
assert.equal(fivePaisa?.freeMargin, 201500);
assert.equal(fivePaisa?.currency, 'INR');

try {
  const visibleRows = await getAccountBalanceSnapshots({ from: capturedAt - 5, to: capturedAt + 5, limit: 20 });
  assert.equal(visibleRows.some(row => row.accountId === 'TEST-CTRADER'), false);
} finally {
  await executeRun('DELETE FROM account_balance_snapshots WHERE captured_at >= ? AND captured_at <= ?', [capturedAt - 5, capturedAt + 5]);
  await executeRun(`DELETE FROM account_balance_snapshots WHERE account_id LIKE 'TEST-%'`);
}

// Session Guard Regression Test:
// When 5paisa has no active session, captureAccountBalanceSnapshots must not throw
// and should gracefully handle unauthenticated state.
{
  let getAccountCalled = false;
  brokerRegistry.registerAdapter('FIVE_PAISA', 'LIVE', {
    hasActiveSession: () => false,
    getAccount: async () => {
      getAccountCalled = true;
      throw new Error('5paisa API requires an Access Token or TOTP session to fetch actual balance.');
    }
  } as any);

  const testTime = Date.now();
  const sessionGuardRows = await captureAccountBalanceSnapshots(testTime);
  assert.equal(sessionGuardRows.length >= 1, true);
  assert.equal(getAccountCalled, false, 'getAccount must NOT be called when hasActiveSession() returns false');
  const fivePaisaSnapshot = sessionGuardRows.find(r => r.broker === 'FIVE_PAISA');
  assert.ok(fivePaisaSnapshot, 'FIVE_PAISA snapshot must be returned');

  await executeRun('DELETE FROM account_balance_snapshots WHERE captured_at = ?', [testTime]);
}

console.log('ACCOUNT BALANCE SNAPSHOT TESTS PASSED');
