import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

// Configure test isolation
const TEST_DB_PATH = path.resolve('data/test_phase9_6_endpoint.sqlite');
process.env.GOLDCREST_TEST_RUN = 'true';
process.env.GOLDCREST_DB_FILE = TEST_DB_PATH;
process.env.NODE_ENV = 'development';

// Clean up any stale test database files
for (const ext of ['', '.tmp', '.bak']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
}

import {
  evaluateActiveAutoLiveMonitor,
  type CTraderInput,
  type FivePaisaInput
} from '../src/services/activeAutoLiveMonitorService';
import { evaluateAccountStateConsistency } from '../src/services/accountStateConsistencyService';
import { brokerRegistry } from '../src/brokers/registry';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import { armAutonomousExecutionGate, disarmLocalAutonomousExecution } from '../src/brokers/safety/AutoExecutionEngine';
import { executeRun, getDatabase } from '../src/database/db';
import { operatorAuthRequired } from '../src/server/security';
import { handleActiveAutoLiveMonitor } from '../src/services/activeAutoLiveMonitorEndpoint';
import { runtimeLifecycle } from '../src/services/runtimeLifecycle';
import { initializeLiveRuntimeLog } from '../src/services/liveRuntimeLog';
import { autoTradingService } from '../src/services/autoTradingService';
import { updateSystemConfig } from '../src/services/configService';
import type { BrokerAccountInfo, BrokerType, ConnectionTestResult } from '../src/brokers/types';

// ============================================================================
// PART 1: UNIT CERTIFICATION TESTS (Service Logic)
// ============================================================================

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

const unitScenarios: Array<{ id: number; name: string; run: () => void }> = [];
const addUnit = (id: number, name: string, run: () => void) => unitScenarios.push({ id, name, run });

addUnit(1, '[UNIT] CTRADER valid input produces HEALTHY status', () => {
  const res = evaluateActiveAutoLiveMonitor(validCTrader);
  assert.equal(res.healthy, true);
  assert.equal(res.status, 'HEALTHY');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.failures, []);
  assert.deepEqual(res.criticalFailures, []);
});

addUnit(2, '[UNIT] FIVE_PAISA valid input produces HEALTHY status', () => {
  const res = evaluateActiveAutoLiveMonitor(validFivePaisa);
  assert.equal(res.healthy, true);
  assert.equal(res.status, 'HEALTHY');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.failures, []);
  assert.deepEqual(res.criticalFailures, []);
});

addUnit(3, '[UNIT] Common critical gate: configurationIntegrity failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, configurationIntegrityOk: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.criticalFailures.includes('configurationIntegrity'));
});

addUnit(4, '[UNIT] Common critical gate: tradingMode LIVE_ONLY failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, tradingModeLiveOnly: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.criticalFailures.includes('tradingMode'));
});

addUnit(5, '[UNIT] Common critical gate: databasePersistence failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, databasePersistenceHealthy: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('databasePersistence'));
});

addUnit(6, '[UNIT] Common critical gate: runtimeLifecycle failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, runtimeLifecycleRunning: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('runtimeLifecycle'));
});

addUnit(7, '[UNIT] Common critical gate: auditLogReady failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, auditLogReady: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('auditLog'));
});

addUnit(8, '[UNIT] Common critical gate: killSwitch failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, killSwitchClear: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('killSwitch'));
});

addUnit(9, '[UNIT] Common critical gate: executionGate failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, executionGateUnlocked: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('executionGate'));
});

addUnit(10, '[UNIT] Common critical gate: unresolvedExecutionIntents failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, noUnresolvedExecutionIntents: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('unresolvedExecutionIntents'));
});

addUnit(11, '[UNIT] Common non-critical gate: autoTradingState operational failure degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, autoTradingStateOperational: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.failures.includes('autoTradingState'));
  assert.equal(res.criticalFailures.length, 0);
});

addUnit(12, '[UNIT] CTRADER broker gate: connection failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, connected: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('cTraderConnected'));
});

addUnit(13, '[UNIT] CTRADER broker gate: accountIsLive failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, accountIsLive: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('cTraderAccountLive'));
});

addUnit(14, '[UNIT] CTRADER broker gate: tradingPermission failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, tradingPermission: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('cTraderTradingPermission'));
});

addUnit(15, '[UNIT] CTRADER broker gate: accountStateConsistent failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, accountStateConsistent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('accountStateConsistency'));
});

addUnit(16, '[UNIT] CTRADER broker gate: accountId missing degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, accountIdPresent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderAccountId'));
  assert.equal(res.criticalFailures.length, 0);
});

addUnit(17, '[UNIT] CTRADER broker gate: currency missing degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, currencyPresent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderCurrency'));
  assert.equal(res.criticalFailures.length, 0);
});

addUnit(18, '[UNIT] CTRADER broker gate: invalid balance degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, balanceValid: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderBalance'));
  assert.equal(res.criticalFailures.length, 0);
});

addUnit(19, '[UNIT] CTRADER broker gate: invalid equity degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, equityValid: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderEquity'));
  assert.equal(res.criticalFailures.length, 0);
});

addUnit(20, '[UNIT] CTRADER broker gate: non-LIVE API mode degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validCTrader, apiModeLive: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('cTraderApiMode'));
  assert.equal(res.criticalFailures.length, 0);
});

addUnit(21, '[UNIT] FIVE_PAISA broker gate: connection failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, connected: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('fivePaisaConnected'));
});

addUnit(22, '[UNIT] FIVE_PAISA broker gate: accountIsLive failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, accountIsLive: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('fivePaisaAccountLive'));
});

addUnit(23, '[UNIT] FIVE_PAISA broker gate: tradingPermission failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, tradingPermission: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('fivePaisaTradingPermission'));
});

addUnit(24, '[UNIT] FIVE_PAISA broker gate: accountStateConsistent failure blocks', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, accountStateConsistent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.criticalFailures.includes('accountStateConsistency'));
});

addUnit(25, '[UNIT] FIVE_PAISA broker gate: accountId missing degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, accountIdPresent: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('fivePaisaAccountId'));
  assert.equal(res.criticalFailures.length, 0);
});

addUnit(26, '[UNIT] FIVE_PAISA broker gate: invalid balance degrades', () => {
  const res = evaluateActiveAutoLiveMonitor({ ...validFivePaisa, balanceValid: false });
  assert.equal(res.healthy, false);
  assert.equal(res.status, 'DEGRADED');
  assert.ok(res.failures.includes('fivePaisaBalance'));
  assert.equal(res.criticalFailures.length, 0);
});

addUnit(27, '[UNIT] FIVE_PAISA profile does not impose or evaluate cTrader requirements', () => {
  const res = evaluateActiveAutoLiveMonitor(validFivePaisa);
  assert.equal(res.checks.cTraderConnected, undefined);
  assert.equal(res.checks.cTraderAccountLive, undefined);
  assert.equal(res.checks.cTraderCurrency, undefined);
  assert.equal(res.checks.cTraderEquity, undefined);
  assert.equal(res.checks.cTraderApiMode, undefined);
});

addUnit(28, '[UNIT] CTRADER profile does not impose or evaluate 5paisa requirements', () => {
  const res = evaluateActiveAutoLiveMonitor(validCTrader);
  assert.equal(res.checks.fivePaisaConnected, undefined);
  assert.equal(res.checks.fivePaisaAccountLive, undefined);
  assert.equal(res.checks.fivePaisaAccountId, undefined);
  assert.equal(res.checks.fivePaisaTradingPermission, undefined);
});

for (const item of unitScenarios) {
  item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/' + unitScenarios.length + '] ' + item.name);
}

// ============================================================================
// PART 2: ENDPOINT INTEGRATION TESTS (Actual Route Invocations)
// ============================================================================

console.log('\n--- STARTING PHASE 9.6 ENDPOINT INTEGRATION TESTS ---');

function createMockAdapter(broker: BrokerType, overrides: {
  account?: Partial<BrokerAccountInfo> | null;
  connection?: Partial<ConnectionTestResult>;
} = {}) {
  let orderCalls = 0;
  let modifyCalls = 0;
  let cancelCalls = 0;

  const defaultAccount: BrokerAccountInfo = {
    accountId: broker === 'CTRADER' ? 'CT_LIVE_1234' : '5P_LIVE_5678',
    accountType: 'LIVE',
    isLiveAccount: true,
    balance: 50000,
    equity: 50000,
    availableMargin: 50000,
    usedMargin: 0,
    freeMargin: 50000,
    currency: broker === 'CTRADER' ? 'USD' : 'INR',
    broker,
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    permissions: ['TRADING', 'EQUITY', 'DERIVATIVES', 'NSE_FNO'],
    lastUpdate: Date.now()
  };

  const adapter = {
    broker,
    environment: 'LIVE' as const,
    isLive: true,
    async authenticate() { return true; },
    async disconnect() {},
    async testConnection(): Promise<ConnectionTestResult> {
      if (overrides.connection?.connected === false) {
        return {
          broker,
          environment: 'LIVE',
          connected: false,
          error: overrides.connection?.error || 'Connection failed',
          timestamp: Date.now(),
          ...overrides.connection
        };
      }
      return {
        broker,
        environment: 'LIVE',
        connected: true,
        apiMode: broker === 'CTRADER' ? 'LIVE' : undefined,
        apiEndpoint: broker === 'CTRADER' ? 'wss://live.ctrader.com' : undefined,
        account: defaultAccount.accountId,
        currency: defaultAccount.currency,
        balance: defaultAccount.balance,
        equity: defaultAccount.equity,
        permissions: defaultAccount.permissions,
        timestamp: Date.now(),
        ...overrides.connection
      };
    },
    async getAccount(): Promise<BrokerAccountInfo> {
      if (overrides.account === null) {
        throw new Error('Account information unavailable from broker');
      }
      return {
        ...defaultAccount,
        ...overrides.account
      };
    },
    async getBalance() { return 50000; },
    async getEquity() { return 50000; },
    async getMargin() { return { usedMargin: 0, freeMargin: 50000 }; },
    async getPositions() { return []; },
    async getOpenOrders() { return []; },
    async getOrderHistory() { return []; },
    async getQuote() { throw new Error('Not implemented in monitor test'); },
    async getInstrument() { return null; },
    async getInstruments() { return []; },
    async placeOrder() { orderCalls++; throw new Error('VIOLATION: placeOrder called during monitoring'); },
    async modifyOrder() { modifyCalls++; throw new Error('VIOLATION: modifyOrder called during monitoring'); },
    async cancelOrder() { cancelCalls++; throw new Error('VIOLATION: cancelOrder called during monitoring'); },
    async closePosition() { throw new Error('VIOLATION: closePosition called during monitoring'); },
    async getOrderStatus() { throw new Error('VIOLATION: getOrderStatus called during monitoring'); },
    async getTradingStatus() { return 'CONNECTED' as const; },
    getOrderCalls: () => orderCalls,
    getModifyCalls: () => modifyCalls,
    getCancelCalls: () => cancelCalls,
    getTotalOrderOperations: () => orderCalls + modifyCalls + cancelCalls
  };
  return adapter;
}

async function setupSnapshotFixture(broker: BrokerType, accountId: string, balance: number, currency: string, ageMs: number = 60000) {
  await executeRun(`
    CREATE TABLE IF NOT EXISTS account_balance_snapshots (
      id TEXT PRIMARY KEY,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      account_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      balance REAL,
      equity REAL,
      used_margin REAL,
      free_margin REAL,
      status TEXT NOT NULL,
      error_message TEXT
    );
  `);

  await executeRun('DELETE FROM account_balance_snapshots WHERE broker = ?', [broker]);

  const capturedAt = Date.now() - ageMs;
  await executeRun(`
    INSERT INTO account_balance_snapshots (
      id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status
    ) VALUES (?, ?, 'LIVE', ?, ?, ?, ?, ?, 0, ?, 'CAPTURED')
  `, [
    `SNAPSHOT-${broker}-${capturedAt}`,
    broker,
    accountId,
    currency,
    capturedAt,
    balance,
    balance,
    balance
  ]);
}

// Initialize database
await getDatabase();

// Initialize runtime lifecycle, audit logging, and operational state for endpoint tests
try {
  runtimeLifecycle.transition('RUNNING');
} catch {}
initializeLiveRuntimeLog('TEST');
updateSystemConfig({ liveTradingEnabled: true, cTraderApiMode: 'LIVE' });
autoTradingService.setStateForTesting('RUNNING');

// Mount test Express app with the exact same route handler and middleware as server.ts
const testApp = express();
testApp.use(operatorAuthRequired);
testApp.get('/api/operations/active-auto-live-monitor', handleActiveAutoLiveMonitor);

const server = testApp.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => {
  server.once('listening', () => resolve());
});

const port = (server.address() as any).port;
const baseUrl = `http://127.0.0.1:${port}`;

const endpointScenarios: Array<{ id: number; name: string; run: () => Promise<void> }> = [];
const addEndpoint = (id: number, name: string, run: () => Promise<void>) => endpointScenarios.push({ id, name, run });

// 1. Healthy CTRADER response
addEndpoint(1, '[ENDPOINT] Healthy CTRADER response (HTTP 200, status HEALTHY, discriminated cTrader payload)', async () => {
  armAutonomousExecutionGate();
  killSwitch.resumeTrading();

  const adapter = createMockAdapter('CTRADER');
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('CTRADER');

  await setupSnapshotFixture('CTRADER', 'CT_LIVE_1234', 50000, 'USD', 60000);

  const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.phase, '9.6');
  assert.equal(data.brokerType, 'CTRADER');
  assert.equal(data.healthy, true);
  assert.equal(data.status, 'HEALTHY');
  assert.ok(data.cTrader !== undefined);
  assert.equal(data.fivePaisa, undefined);
  assert.equal(data.cTrader.connected, true);
  assert.equal(data.cTrader.accountId, '****1234');
  assert.equal(data.cTrader.accountConsistency.consistent, true);
  assert.equal(adapter.getTotalOrderOperations(), 0);
});

// 2. Healthy FIVE_PAISA response
addEndpoint(2, '[ENDPOINT] Healthy FIVE_PAISA response (HTTP 200, status HEALTHY, discriminated fivePaisa payload)', async () => {
  armAutonomousExecutionGate();
  killSwitch.resumeTrading();

  const adapter = createMockAdapter('FIVE_PAISA');
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('FIVE_PAISA');

  await setupSnapshotFixture('FIVE_PAISA', '5P_LIVE_5678', 50000, 'INR', 60000);

  const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.phase, '9.6');
  assert.equal(data.brokerType, 'FIVE_PAISA');
  assert.equal(data.healthy, true);
  assert.equal(data.status, 'HEALTHY');
  assert.ok(data.fivePaisa !== undefined);
  assert.equal(data.cTrader, undefined);
  assert.equal(data.fivePaisa.connected, true);
  assert.equal(data.fivePaisa.accountId, '****5678');
  assert.equal(data.fivePaisa.accountConsistency.consistent, true);
  assert.equal(adapter.getTotalOrderOperations(), 0);
});

// 3. Connection failure for CTRADER
addEndpoint(3, '[ENDPOINT] Connection failure for CTRADER blocks (HTTP 409, cTraderConnected critical failure)', async () => {
  armAutonomousExecutionGate();
  const adapter = createMockAdapter('CTRADER', { connection: { connected: false } });
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('CTRADER');

  const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
  const data = await res.json();

  assert.equal(res.status, 409);
  assert.equal(data.healthy, false);
  assert.equal(data.status, 'BLOCKED');
  assert.ok(data.criticalFailures.includes('cTraderConnected'));
  assert.equal(adapter.getTotalOrderOperations(), 0);
});

// 4. Connection failure for FIVE_PAISA
addEndpoint(4, '[ENDPOINT] Connection failure for FIVE_PAISA blocks (HTTP 409, fivePaisaConnected critical failure)', async () => {
  armAutonomousExecutionGate();
  const adapter = createMockAdapter('FIVE_PAISA', { connection: { connected: false } });
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('FIVE_PAISA');

  const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
  const data = await res.json();

  assert.equal(res.status, 409);
  assert.equal(data.healthy, false);
  assert.equal(data.status, 'BLOCKED');
  assert.ok(data.criticalFailures.includes('fivePaisaConnected'));
  assert.equal(adapter.getTotalOrderOperations(), 0);
});

// 5. Missing account evidence fails closed
addEndpoint(5, '[ENDPOINT] Missing account evidence fails closed (HTTP 409, status BLOCKED)', async () => {
  armAutonomousExecutionGate();
  const adapter = createMockAdapter('FIVE_PAISA', { account: null });
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('FIVE_PAISA');

  const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
  const data = await res.json();

  assert.equal(res.status, 409);
  assert.equal(data.healthy, false);
  assert.equal(data.status, 'BLOCKED');
  assert.ok(data.criticalFailures.includes('fivePaisaAccountLive') || data.criticalFailures.includes('fivePaisaConnected'));
  assert.equal(adapter.getTotalOrderOperations(), 0);
});

// 6. Account or snapshot broker mismatch
addEndpoint(6, '[ENDPOINT] Account/snapshot cross-broker mismatch fails closed (HTTP 409, status BLOCKED)', async () => {
  armAutonomousExecutionGate();
  const adapter = createMockAdapter('FIVE_PAISA');
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('FIVE_PAISA');

  // Insert a CTRADER snapshot for a FIVE_PAISA account
  await setupSnapshotFixture('CTRADER', '5P_LIVE_5678', 50000, 'INR', 60000);
  await executeRun('DELETE FROM account_balance_snapshots WHERE broker = ?', ['FIVE_PAISA']);

  const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
  const data = await res.json();

  assert.equal(res.status, 409);
  assert.equal(data.healthy, false);
  assert.equal(data.status, 'BLOCKED');
  assert.ok(data.criticalFailures.includes('accountStateConsistency'));
});

// 7. Account-state consistency failure (stale snapshot > 3.25 hours)
addEndpoint(7, '[ENDPOINT] Stale account history snapshot blocks (HTTP 409, accountStateConsistency failure)', async () => {
  armAutonomousExecutionGate();
  const adapter = createMockAdapter('FIVE_PAISA');
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('FIVE_PAISA');

  // 4 hours old (> 3.25h freshness boundary)
  await setupSnapshotFixture('FIVE_PAISA', '5P_LIVE_5678', 50000, 'INR', 4 * 60 * 60 * 1000);

  const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
  const data = await res.json();

  assert.equal(res.status, 409);
  assert.equal(data.healthy, false);
  assert.equal(data.status, 'BLOCKED');
  assert.ok(data.criticalFailures.includes('accountStateConsistency'));
});

// 8. Common critical safety-gate failure (Kill Switch triggered)
addEndpoint(8, '[ENDPOINT] Emergency Kill Switch halted blocks (HTTP 409, killSwitch critical failure)', async () => {
  armAutonomousExecutionGate();
  const adapter = createMockAdapter('FIVE_PAISA');
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('FIVE_PAISA');
  await setupSnapshotFixture('FIVE_PAISA', '5P_LIVE_5678', 50000, 'INR', 60000);

  await killSwitch.triggerEmergencyHalt('Test Emergency Stop');

  try {
    const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
    const data = await res.json();

    assert.equal(res.status, 409);
    assert.equal(data.healthy, false);
    assert.equal(data.status, 'BLOCKED');
    assert.ok(data.criticalFailures.includes('killSwitch'));
  } finally {
    killSwitch.resumeTrading();
  }
});

// 9. Correct broker-discriminated fields, masked account identifiers, and absence of secrets
addEndpoint(9, '[ENDPOINT] Response contract masks identifiers and strictly leaks no secrets', async () => {
  armAutonomousExecutionGate();
  const adapter = createMockAdapter('FIVE_PAISA');
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('FIVE_PAISA');
  await setupSnapshotFixture('FIVE_PAISA', '5P_LIVE_5678', 50000, 'INR', 60000);

  const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
  const rawText = await res.text();
  const data = JSON.parse(rawText);

  // Account identity must be masked
  assert.equal(data.fivePaisa.accountId, '****5678');

  // Verify no secret, token, password, or pin appears in the serialized payload
  const lower = rawText.toLowerCase();
  assert.equal(lower.includes('secret'), false);
  assert.equal(lower.includes('password'), false);
  assert.equal(lower.includes('pin'), false);
  assert.equal(lower.includes('token'), false);
  assert.equal(lower.includes('totp'), false);
});

// 10. Zero broker order submissions, modifications, cancellations
addEndpoint(10, '[ENDPOINT] Zero broker order submissions, modifications, or cancellations during monitoring', async () => {
  armAutonomousExecutionGate();
  const adapter = createMockAdapter('FIVE_PAISA');
  brokerRegistry.registerAdapter(adapter);
  brokerRegistry.setSelectedBroker('FIVE_PAISA');
  await setupSnapshotFixture('FIVE_PAISA', '5P_LIVE_5678', 50000, 'INR', 60000);

  // Perform multiple consecutive monitor checks
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${baseUrl}/api/operations/active-auto-live-monitor`);
    assert.equal(res.status, 200);
  }

  // Strictly verify 0 order submissions, modifications, and cancellations
  assert.equal(adapter.getOrderCalls(), 0);
  assert.equal(adapter.getModifyCalls(), 0);
  assert.equal(adapter.getCancelCalls(), 0);
  assert.equal(adapter.getTotalOrderOperations(), 0);
});

// Execute all endpoint scenarios sequentially
for (const item of endpointScenarios) {
  await item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/' + endpointScenarios.length + '] ' + item.name);
}

// Ensure execution gate is safely disarmed after tests complete
disarmLocalAutonomousExecution();

// Close ephemeral HTTP server cleanly
await new Promise<void>((resolve) => {
  server.close(() => resolve());
});

// Clean up isolated test database files
for (const ext of ['', '.tmp', '.bak']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
}

console.log('--- ALL PHASE 9.6 UNIT AND ENDPOINT INTEGRATION TESTS PASSED ---\n');
process.exit(0);
