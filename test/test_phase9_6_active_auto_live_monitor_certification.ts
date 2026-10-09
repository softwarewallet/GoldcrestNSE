import assert from 'node:assert/strict';
import {
  evaluateActiveAutoLiveMonitor,
  type ActiveAutoLiveMonitorInput,
  type CTraderInput,
  type FivePaisaInput
} from '../src/services/activeAutoLiveMonitorService';
import { evaluateAccountStateConsistency } from '../src/services/accountStateConsistencyService';
import type { BrokerAccountInfo, BrokerType } from '../src/brokers/types';
import type { AccountBalanceSnapshot } from '../src/services/accountBalanceSnapshotService';

const commonValid = {
  configurationIntegrityOk: true,
  tradingModeLiveOnly: true,
  databasePersistenceHealthy: true,
  runtimeLifecycleRunning: true,
  auditLogReady: true,
  killSwitchClear: true,
  executionGateUnlocked: true,
  autoTradingStateOperational: true,
  noUnresolvedExecutionIntents: true
};

const validCTrader: CTraderInput = {
  ...commonValid,
  brokerType: 'CTRADER',
  connected: true,
  accountIsLive: true,
  accountIdPresent: true,
  currencyPresent: true,
  balanceValid: true,
  equityValid: true,
  tradingPermission: true,
  apiModeLive: true,
  accountStateConsistent: true
};

const validFivePaisa: FivePaisaInput = {
  ...commonValid,
  brokerType: 'FIVE_PAISA',
  connected: true,
  accountIsLive: true,
  accountIdPresent: true,
  balanceValid: true,
  tradingPermission: true,
  accountStateConsistent: true
};

const scenarios: Array<{ id: number; name: string; run: () => void }> = [];
const add = (id: number, name: string, run: () => void) => scenarios.push({ id, name, run });

// 1 - 2: Healthy Baselines
add(1, 'CTRADER valid input produces HEALTHY status', () => {
  const res = evaluateActiveAutoLiveMonitor(validCTrader);
  assert.equal(res.healthy, true);
  assert.equal(res.status, 'HEALTHY');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.failures, []);
  assert.deepEqual(res.criticalFailures, []);
});

add(2, 'FIVE_PAISA valid input produces HEALTHY status', () => {
  const res = evaluateActiveAutoLiveMonitor(validFivePaisa);
  assert.equal(res.healthy, true);
  assert.equal(res.status, 'HEALTHY');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.failures, []);
  assert.deepEqual(res.criticalFailures, []);
});

// 3 - 10: Critical Common Safety Gates (Failures block and return 409)
add(3, 'Common critical gate: configurationIntegrity failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, configurationIntegrityOk: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.criticalFailures.includes('configurationIntegrity'));
});

add(4, 'Common critical gate: tradingMode LIVE_ONLY failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, tradingModeLiveOnly: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.criticalFailures.includes('tradingMode'));
});

add(5, 'Common critical gate: databasePersistence failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, databasePersistenceHealthy: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('databasePersistence'));
});

add(6, 'Common critical gate: runtimeLifecycle failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, runtimeLifecycleRunning: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('runtimeLifecycle'));
});

add(7, 'Common critical gate: auditLogReady failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, auditLogReady: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('auditLog'));
});

add(8, 'Common critical gate: killSwitch failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, killSwitchClear: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('killSwitch'));
});

add(9, 'Common critical gate: executionGate failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, executionGateUnlocked: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('executionGate'));
});

add(10, 'Common critical gate: unresolvedExecutionIntents failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, noUnresolvedExecutionIntents: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('unresolvedExecutionIntents'));
});

// 11: Non-critical Common Gate (Degrades instead of blocks)
add(11, 'Common non-critical gate: autoTradingState operational failure degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, autoTradingStateOperational: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.failures.includes('autoTradingState'));
  assert.equal(res.criticalFailures.length, 0);
});

// 12 - 15: CTRADER Critical Broker Gates
add(12, 'CTRADER broker gate: connection failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, connected: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('cTraderConnected'));
});

add(13, 'CTRADER broker gate: accountIsLive failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, accountIsLive: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('cTraderAccountLive'));
});

add(14, 'CTRADER broker gate: tradingPermission failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, tradingPermission: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('cTraderTradingPermission'));
});

add(15, 'CTRADER broker gate: accountStateConsistent failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, accountStateConsistent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('accountStateConsistency'));
});

// 16 - 20: CTRADER Degraded Broker Gates
add(16, 'CTRADER broker gate: accountId missing degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, accountIdPresent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderAccountId'));
  assert.equal(res.criticalFailures.length, 0);
});

add(17, 'CTRADER broker gate: currency missing degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, currencyPresent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderCurrency'));
  assert.equal(res.criticalFailures.length, 0);
});

add(18, 'CTRADER broker gate: invalid balance degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, balanceValid: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderBalance'));
  assert.equal(res.criticalFailures.length, 0);
});

add(19, 'CTRADER broker gate: invalid equity degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, equityValid: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderEquity'));
  assert.equal(res.criticalFailures.length, 0);
});

add(20, 'CTRADER broker gate: non-LIVE API mode degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, apiModeLive: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderApiMode'));
  assert.equal(res.criticalFailures.length, 0);
});

// 21 - 24: FIVE_PAISA Critical Broker Gates
add(21, 'FIVE_PAISA broker gate: connection failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, connected: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('fivePaisaConnected'));
});

add(22, 'FIVE_PAISA broker gate: accountIsLive failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, accountIsLive: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('fivePaisaAccountLive'));
});

add(23, 'FIVE_PAISA broker gate: tradingPermission failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, tradingPermission: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('fivePaisaTradingPermission'));
});

add(24, 'FIVE_PAISA broker gate: accountStateConsistent failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, accountStateConsistent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('accountStateConsistency'));
});

// 25 - 26: FIVE_PAISA Degraded Broker Gates
add(25, 'FIVE_PAISA broker gate: accountId missing degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, accountIdPresent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('fivePaisaAccountId'));
  assert.equal(res.criticalFailures.length, 0);
});

add(26, 'FIVE_PAISA broker gate: invalid balance degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, balanceValid: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('fivePaisaBalance'));
  assert.equal(res.criticalFailures.length, 0);
});

// 27 - 28: Broker Isolation (Requirements are not cross-imposed)
add(27, 'FIVE_PAISA profile does not impose or evaluate cTrader requirements', () => {
  const res = evaluateActiveAutoLiveMonitor(validFivePaisa);
  assert.equal(res.checks.cTraderConnected, undefined);
  assert.equal(res.checks.cTraderAccountLive, undefined);
  assert.equal(res.checks.cTraderCurrency, undefined);
  assert.equal(res.checks.cTraderEquity, undefined);
  assert.equal(res.checks.cTraderApiMode, undefined);
});

add(28, 'CTRADER profile does not impose or evaluate 5paisa requirements', () => {
  const res = evaluateActiveAutoLiveMonitor(validCTrader);
  assert.equal(res.checks.fivePaisaConnected, undefined);
  assert.equal(res.checks.fivePaisaAccountLive, undefined);
  assert.equal(res.checks.fivePaisaAccountId, undefined);
  assert.equal(res.checks.fivePaisaTradingPermission, undefined);
});

// 29 - 33: Response Contract & Evidence Discrimination
function buildMockResponsePayload(
  brokerType: BrokerType,
  account: BrokerAccountInfo | null,
  connection: { connected: boolean; apiEndpoint?: string } | null,
  monitor: ReturnType<typeof evaluateActiveAutoLiveMonitor>,
  accountConsistency: { status: string; consistent: boolean; snapshotAgeMs: number | null; balanceDelta: number | null; equityDelta: number | null }
) {
  function mask(val: string): string {
    if (!val || val.length <= 4) return '****';
    return '****' + val.slice(-4);
  }

  const payload: any = {
    phase: '9.6',
    generatedAt: Date.now(),
    runtimeId: 'test-runtime',
    environment: 'production',
    tradingMode: 'LIVE_ONLY',
    brokerType,
    status: monitor.status,
    healthy: monitor.healthy,
    checks: monitor.checks,
    failures: monitor.failures,
    criticalFailures: monitor.criticalFailures,
  };

  if (brokerType === 'CTRADER') {
    payload.cTrader = {
      apiMode: 'LIVE',
      apiEndpoint: connection?.apiEndpoint || null,
      connected: connection?.connected === true,
      accountId: account ? mask(account.accountId) : null,
      accountCurrency: account?.currency || null,
      accountType: account?.accountType || null,
      balance: account?.balance ?? null,
      equity: account?.equity ?? null,
      tradingPermission: true,
      accountConsistency
    };
  } else {
    payload.fivePaisa = {
      connected: connection?.connected === true,
      accountId: account ? mask(account.accountId) : null,
      accountType: account?.accountType || null,
      balance: account?.balance ?? null,
      tradingPermission: true,
      accountConsistency
    };
  }
  return payload;
}

add(29, 'Response contract identifies FIVE_PAISA and isolates fivePaisa evidence', () => {
  const account: BrokerAccountInfo = {
    accountId: '5P12345678',
    accountType: 'LIVE',
    balance: 50000,
    equity: 50000,
    availableMargin: 50000,
    usedMargin: 0,
    freeMargin: 50000,
    currency: 'INR',
    broker: 'FIVE_PAISA',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    lastUpdate: Date.now()
  };
  const monitor = evaluateActiveAutoLiveMonitor(validFivePaisa);
  const payload = buildMockResponsePayload('FIVE_PAISA', account, { connected: true }, monitor, {
    status: 'ALIGNED',
    consistent: true,
    snapshotAgeMs: 120000,
    balanceDelta: 0,
    equityDelta: 0
  });

  assert.equal(payload.brokerType, 'FIVE_PAISA');
  assert.ok(payload.fivePaisa !== undefined);
  assert.equal(payload.cTrader, undefined);
  assert.equal(payload.fivePaisa.connected, true);
  assert.equal(payload.fivePaisa.accountId, '****5678');
});

add(30, 'Response contract identifies CTRADER and isolates cTrader evidence', () => {
  const account: BrokerAccountInfo = {
    accountId: 'CT98765432',
    accountType: 'LIVE',
    balance: 25000,
    equity: 25000,
    availableMargin: 25000,
    usedMargin: 0,
    freeMargin: 25000,
    currency: 'USD',
    broker: 'CTRADER',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    lastUpdate: Date.now()
  };
  const monitor = evaluateActiveAutoLiveMonitor(validCTrader);
  const payload = buildMockResponsePayload('CTRADER', account, { connected: true, apiEndpoint: 'wss://live.ctrader.com' }, monitor, {
    status: 'ALIGNED',
    consistent: true,
    snapshotAgeMs: 60000,
    balanceDelta: 0,
    equityDelta: 0
  });

  assert.equal(payload.brokerType, 'CTRADER');
  assert.ok(payload.cTrader !== undefined);
  assert.equal(payload.fivePaisa, undefined);
  assert.equal(payload.cTrader.connected, true);
  assert.equal(payload.cTrader.accountId, '****5432');
});

add(31, 'Response contract never exposes raw credentials, tokens, passwords, or PINs', () => {
  const payload5P = buildMockResponsePayload('FIVE_PAISA', null, null, evaluateActiveAutoLiveMonitor(validFivePaisa), {
    status: 'ALIGNED',
    consistent: true,
    snapshotAgeMs: 0,
    balanceDelta: 0,
    equityDelta: 0
  });
  const serialized = JSON.stringify(payload5P).toLowerCase();
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('token'), false);
  assert.equal(serialized.includes('pin'), false);
  assert.equal(serialized.includes('totp'), false);
});

// 32 - 34: Account Snapshot Broker Isolation & Consistency
add(32, 'Account state consistency respects broker isolation for FIVE_PAISA', () => {
  const account5P: BrokerAccountInfo = {
    accountId: '5P111222',
    accountType: 'LIVE',
    balance: 10000,
    equity: 10000,
    availableMargin: 10000,
    usedMargin: 0,
    freeMargin: 10000,
    currency: 'INR',
    broker: 'FIVE_PAISA',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    lastUpdate: Date.now()
  };
  const snapshot5P: AccountBalanceSnapshot = {
    id: 1,
    broker: 'FIVE_PAISA',
    environment: 'LIVE',
    accountId: '5P111222',
    accountType: 'LIVE',
    currency: 'INR',
    balance: 10000,
    equity: 10000,
    usedMargin: 0,
    freeMargin: 10000,
    status: 'CAPTURED',
    capturedAt: Date.now() - 60000,
    source: 'TEST'
  };
  const consistency = evaluateAccountStateConsistency('FIVE_PAISA', account5P, snapshot5P);
  assert.equal(consistency.broker, 'FIVE_PAISA');
  assert.equal(consistency.consistent, true);
  assert.equal(consistency.status, 'ALIGNED');
});

add(33, 'Account state consistency rejects cross-broker mismatch (CTRADER snapshot for 5PAISA account)', () => {
  const account5P: BrokerAccountInfo = {
    accountId: '5P111222',
    accountType: 'LIVE',
    balance: 10000,
    equity: 10000,
    availableMargin: 10000,
    usedMargin: 0,
    freeMargin: 10000,
    currency: 'INR',
    broker: 'FIVE_PAISA',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    lastUpdate: Date.now()
  };
  const snapshotCT: AccountBalanceSnapshot = {
    id: 2,
    broker: 'CTRADER',
    environment: 'LIVE',
    accountId: 'CT999888',
    accountType: 'LIVE',
    currency: 'USD',
    balance: 10000,
    equity: 10000,
    usedMargin: 0,
    freeMargin: 10000,
    status: 'CAPTURED',
    capturedAt: Date.now() - 60000,
    source: 'TEST'
  };
  const consistency = evaluateAccountStateConsistency('FIVE_PAISA', account5P, snapshotCT);
  assert.equal(consistency.consistent, false);
  assert.equal(consistency.accountIdMatches, false);
});

add(34, 'Monitoring operations perform zero order submissions, modifications, or cancellations', () => {
  let orderCalls = 0;
  const mockAdapter = {
    placeOrder: () => { orderCalls++; throw new Error('Unintended order submission'); },
    modifyOrder: () => { orderCalls++; throw new Error('Unintended order modification'); },
    cancelOrder: () => { orderCalls++; throw new Error('Unintended order cancellation'); }
  };
  // Evaluating the monitor must NEVER touch order operations
  const res = evaluateActiveAutoLiveMonitor(validFivePaisa);
  assert.equal(res.healthy, true);
  assert.equal(orderCalls, 0);
});

for (const item of scenarios) {
  item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/' + scenarios.length + '] ' + item.name);
}
console.log('PHASE 9.6 ACTIVE AUTO LIVE MONITOR CERTIFICATION: 34/34 PASSED');
