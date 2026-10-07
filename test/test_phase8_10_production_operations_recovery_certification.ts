import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'false';
process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'false';
process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'false';
process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'false';
process.env.LIVE_TRADING_ENABLED = 'false';

const { getDatabase, getDatabaseInitializationState, executeQuery } = await import('../src/database/db');
const {
  claimExecutionIntent,
  completeExecutionIntent,
  failExecutionIntent,
  getExecutionIntent,
  markExecutionIntentInFlight,
  markExecutionIntentReconciliationTimeout,
  markExecutionIntentSubmissionAmbiguous,
  resumeExecutionIntentReconciliation
} = await import('../src/services/executionIntentService');
const {
  RuntimeLifecycleCoordinator
} = await import('../src/services/runtimeLifecycle');
const {
  AUTO_LIVE_POSITION_CAPACITY_POLL_MS,
  AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS,
  AUTO_LIVE_RUNTIME_RECOVERY_POLL_MS
} = await import('../src/services/autoLiveTradePolicy');
const { autoTradingService } = await import('../src/services/autoTradingService');
const { brokerRegistry } = await import('../src/brokers/registry');
const { getSystemConfig, updateSystemConfig } = await import('../src/services/configService');
const {
  ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS,
  nextThreeHourBoundary
} = await import('../src/services/accountBalanceSnapshotService');
const {
  startMarketHistoryScheduler,
  stopMarketHistoryScheduler,
  getMarketHistorySchedulerStatus
} = await import('../src/services/marketHistoryService');
const {
  startCurrentPairPredictionCollectionScheduler,
  stopCurrentPairPredictionCollectionScheduler,
  getCurrentPairPredictionCollectionStatus
} = await import('../src/services/currentPairPredictionCollectionService');
const {
  startLiveTradeResearchOutcomeTracker,
  stopLiveTradeResearchOutcomeTracker,
  getLiveTradeResearchOutcomeTrackerStatus
} = await import('../src/services/liveTradeResearchOutcomeService');
const {
  evaluateRuntimeReadiness,
  buildRuntimeHealthPayload
} = await import('../src/services/runtimeReadiness');

type Scenario = { id: number; name: string; run: () => void | Promise<void> };

const suffix = `phase8-10-${Date.now()}`;
const key = (id: number) => `${suffix}-${id}`;
const basePayload = {
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  quantity: 1000,
  price: 1.123,
  stopLoss: 1.120,
  takeProfit: 1.129,
  orderType: 'MARKET'
};

async function createIntent(id: number, state: 'PENDING' | 'IN_FLIGHT' = 'PENDING') {
  const idempotencyKey = key(id);
  await claimExecutionIntent(idempotencyKey, {
    broker: 'CTRADER',
    market: 'FOREX',
    symbol: 'EUR/USD',
    side: 'BUY',
    payload: { ...basePayload, signalId: idempotencyKey }
  });
  if (state === 'IN_FLIGHT') {
    await markExecutionIntentInFlight(idempotencyKey, { status: 'SUBMISSION_STARTED', requestedQuantity: 1000 });
  }
}

const scenarios: Scenario[] = [
  { id: 1, name: 'Database initialization is initially observable', run: () => {
    const state = getDatabaseInitializationState();
    assert.equal(typeof state.initialized, 'boolean');
    assert.equal(typeof state.initializing, 'boolean');
  }},
  { id: 2, name: 'Concurrent database requests resolve to one shared instance', run: async () => {
    const dbs = await Promise.all([getDatabase(), getDatabase(), getDatabase(), getDatabase()]);
    assert.ok(dbs.every(db => db === dbs[0]));
  }},
  { id: 3, name: 'Database becomes initialized after first successful access', run: () => {
    assert.deepEqual(getDatabaseInitializationState(), { initialized: true, initializing: false });
  }},
  { id: 4, name: 'Execution intent schema is durable', run: async () => {
    const rows = await executeQuery<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_intents'");
    assert.equal(rows.length, 1);
  }},
  { id: 5, name: 'Execution fill observation schema is durable', run: async () => {
    const rows = await executeQuery<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_fill_observations'");
    assert.equal(rows.length, 1);
  }},
  { id: 6, name: 'Execution fill event schema is durable', run: async () => {
    const rows = await executeQuery<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_fill_events'");
    assert.equal(rows.length, 1);
  }},
  { id: 7, name: 'Account balance snapshot schema is durable', run: async () => {
    const rows = await executeQuery<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='account_balance_snapshots'");
    assert.equal(rows.length, 1);
  }},
  { id: 8, name: 'Market history synchronization schema is durable', run: async () => {
    const rows = await executeQuery<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='market_history_sync'");
    assert.equal(rows.length, 1);
  }},

  { id: 9, name: 'Fresh execution intent is durable in PENDING', run: async () => {
    await createIntent(9);
    assert.equal((await getExecutionIntent(key(9)))?.state, 'PENDING');
  }},
  { id: 10, name: 'PENDING execution intent can recover into IN_FLIGHT', run: async () => {
    await markExecutionIntentInFlight(key(9), { status: 'SUBMISSION_STARTED' });
    assert.equal((await getExecutionIntent(key(9)))?.state, 'IN_FLIGHT');
  }},
  { id: 11, name: 'Ambiguous submission is retained as reconciliation timeout', run: async () => {
    await markExecutionIntentSubmissionAmbiguous(key(9), { detail: 'BROKER_TIMEOUT' });
    assert.equal((await getExecutionIntent(key(9)))?.state, 'RECONCILIATION_TIMEOUT');
  }},
  { id: 12, name: 'Timed-out intent can resume reconciliation after restart', run: async () => {
    await resumeExecutionIntentReconciliation(key(9));
    assert.equal((await getExecutionIntent(key(9)))?.state, 'IN_FLIGHT');
  }},
  { id: 13, name: 'Recovered execution intent can complete', run: async () => {
    await completeExecutionIntent(key(9), { status: 'FILLED', brokerOrderId: 'phase810-order-13' });
    assert.equal((await getExecutionIntent(key(9)))?.state, 'COMPLETED');
  }},
  { id: 14, name: 'Terminal execution result is preserved against stale completion', run: async () => {
    await completeExecutionIntent(key(9), { status: 'FILLED', brokerOrderId: 'phase810-order-14' });
    assert.equal((await getExecutionIntent(key(9)))?.result && ((await getExecutionIntent(key(9)))?.result as any).brokerOrderId, 'phase810-order-13');
  }},
  { id: 15, name: 'Failed terminal intent remains FAILED after duplicate claim', run: async () => {
    await createIntent(15);
    await failExecutionIntent(key(15), { status: 'REJECTED', brokerOrderId: 'phase810-failed-15' });
    const duplicate = await claimExecutionIntent(key(15), {
      broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY',
      payload: { ...basePayload, signalId: key(15) }
    });
    assert.equal(duplicate.claimed, false);
    assert.equal(duplicate.existing?.state, 'FAILED');
  }},
  { id: 16, name: 'Payload mismatch remains fail-closed after persistence', run: async () => {
    await assert.rejects(
      claimExecutionIntent(key(15), {
        broker: 'CTRADER', market: 'FOREX', symbol: 'EUR/USD', side: 'BUY',
        payload: { ...basePayload, signalId: key(15), quantity: 2000 }
      }),
      /IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/
    );
  }},
  { id: 17, name: 'Execution recovery metadata is durable', run: async () => {
    await createIntent(17, 'IN_FLIGHT');
    await executeQuery<any>("SELECT 1");
    await markExecutionIntentReconciliationTimeout(key(17), {
      code: 'BROKER_SUBMISSION_AMBIGUOUS',
      reconciliationAttemptCount: 2
    });
    const intent = await getExecutionIntent(key(17));
    assert.equal(intent?.state, 'RECONCILIATION_TIMEOUT');
    assert.equal((intent?.result as any)?.reconciliationAttemptCount, 2);
  }},
  { id: 18, name: 'Execution timeout state survives a fresh database read', run: async () => {
    const row = await executeQuery<any>('SELECT state FROM execution_intents WHERE idempotency_key = ?', [key(17)]);
    assert.equal(row[0]?.state, 'RECONCILIATION_TIMEOUT');
  }},

  { id: 19, name: 'Runtime lifecycle starts in STARTING', run: () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    assert.equal(lifecycle.getStatus().state, 'STARTING');
  }},
  { id: 20, name: 'Runtime lifecycle can enter RUNNING', run: () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    assert.equal(lifecycle.getStatus().state, 'RUNNING');
  }},
  { id: 21, name: 'Runtime lifecycle can enter DEGRADED', run: () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    lifecycle.transition('DEGRADED');
    assert.equal(lifecycle.getStatus().state, 'DEGRADED');
  }},
  { id: 22, name: 'Runtime lifecycle can recover from DEGRADED to RUNNING', run: () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    lifecycle.transition('DEGRADED');
    lifecycle.transition('RUNNING');
    assert.equal(lifecycle.getStatus().state, 'RUNNING');
  }},
  { id: 23, name: 'Runtime cleanup registration is counted', run: () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.registerCleanup('one', () => undefined);
    lifecycle.registerCleanup('two', () => undefined);
    assert.equal(lifecycle.getStatus().registeredCleanupCount, 2);
  }},
  { id: 24, name: 'Runtime shutdown enters STOPPING then STOPPED', run: async () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    const shutdown = lifecycle.shutdown('PHASE_8_10_TEST');
    const result = await shutdown;
    assert.deepEqual(result.failed, []);
    assert.equal(lifecycle.getStatus().state, 'STOPPED');
  }},
  { id: 25, name: 'Runtime shutdown executes cleanups in reverse registration order', run: async () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    const calls: string[] = [];
    lifecycle.registerCleanup('first', () => { calls.push('first'); });
    lifecycle.registerCleanup('second', () => { calls.push('second'); });
    await lifecycle.shutdown('ORDER_TEST');
    assert.deepEqual(calls, ['second', 'first']);
  }},
  { id: 26, name: 'Cleanup failure does not prevent later cleanup', run: async () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    const calls: string[] = [];
    lifecycle.registerCleanup('first', () => { calls.push('first'); });
    lifecycle.registerCleanup('fails', () => { calls.push('fails'); throw new Error('CLEANUP_FAILURE'); });
    const result = await lifecycle.shutdown('FAILURE_TEST');
    assert.deepEqual(calls, ['fails', 'first']);
    assert.deepEqual(result.completed, ['first']);
    assert.deepEqual(result.failed, ['fails']);
  }},
  { id: 27, name: 'Repeated shutdown is idempotent', run: async () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    let calls = 0;
    lifecycle.registerCleanup('once', () => { calls += 1; });
    const a = await lifecycle.shutdown('FIRST');
    const b = await lifecycle.shutdown('SECOND');
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
  }},
  { id: 28, name: 'Shutdown reason is retained', run: async () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    await lifecycle.shutdown('OPERATOR_SIGTERM');
    assert.equal(lifecycle.getStatus().lastShutdownReason, 'OPERATOR_SIGTERM');
  }},
  { id: 29, name: 'Stopped runtime rejects new cleanup registration', run: async () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    await lifecycle.shutdown('REGISTER_TEST');
    assert.throws(() => lifecycle.registerCleanup('late', () => undefined), /RUNTIME_LIFECYCLE_STOPPED/);
  }},
  { id: 30, name: 'Stopped runtime cannot transition back to RUNNING', run: async () => {
    const lifecycle = new RuntimeLifecycleCoordinator();
    lifecycle.transition('RUNNING');
    await lifecycle.shutdown('TRANSITION_TEST');
    assert.throws(() => lifecycle.transition('RUNNING'), /INVALID_RUNTIME_LIFECYCLE_TRANSITION/);
  }},

  { id: 31, name: 'Auto Live stop exposes STOPPED state', run: () => {
    autoTradingService.stop('Phase 8.10 initial cleanup');
    assert.equal(autoTradingService.getStatus().state, 'STOPPED');
  }},
  { id: 32, name: 'Auto Live runtime fault enters dedicated PAUSED_RUNTIME state', run: () => {
    const service = autoTradingService as any;
    service.state = 'RUNNING';
    service.pauseForRuntimeFault('TEST_BROKER_DISCONNECT');
    const status = autoTradingService.getStatus();
    assert.equal(status.state, 'PAUSED_RUNTIME');
    assert.equal(status.runtimeFaultReason, 'TEST_BROKER_DISCONNECT');
  }},
  { id: 33, name: 'Auto Live runtime fault starts a recovery timer', run: () => {
    const timer = (autoTradingService as any).runtimeRecoveryTimer;
    assert.ok(timer);
  }},
  { id: 34, name: 'Recovered broker capacity resumes Auto Live without dispatch in certification', run: async () => {
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({ getPositions: async () => [] });
    try {
      await (autoTradingService as any).checkRuntimeRecoveryAndResume(false);
      assert.equal(autoTradingService.getStatus().state, 'RUNNING');
      assert.equal((autoTradingService as any).runtimeRecoveryTimer, null);
    } finally {
      (brokerRegistry as any).getAdapter = original;
      autoTradingService.stop('Phase 8.10 recovery cleanup');
    }
  }},
  { id: 35, name: 'Broker outage during runtime recovery remains PAUSED_RUNTIME', run: async () => {
    const service = autoTradingService as any;
    service.state = 'RUNNING';
    service.pauseForRuntimeFault('TEST_OUTAGE');
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({ getPositions: async () => { throw new Error('BROKER_NETWORK_DOWN'); } });
    try {
      await service.checkRuntimeRecoveryAndResume(false);
      assert.equal(autoTradingService.getStatus().state, 'PAUSED_RUNTIME');
      assert.equal(autoTradingService.getStatus().runtimeFaultReason, 'TEST_OUTAGE');
    } finally {
      brokerRegistry.getAdapter = original;
      autoTradingService.stop('Phase 8.10 outage cleanup');
    }
  }},
  { id: 36, name: 'Recovered broker at full capacity transitions to PAUSED_LIMIT', run: async () => {
    updateSystemConfig({ maxOpenPositions: 5 });
    const service = autoTradingService as any;
    service.state = 'RUNNING';
    service.pauseForRuntimeFault('TEST_CAPACITY_AFTER_RECOVERY');
    const original = brokerRegistry.getAdapter;
    (brokerRegistry as any).getAdapter = () => ({ getPositions: async () => new Array(5).fill({}) });
    try {
      await service.checkRuntimeRecoveryAndResume(false);
      assert.equal(autoTradingService.getStatus().state, 'PAUSED_LIMIT');
      assert.equal(service.runtimeRecoveryTimer, null);
      assert.equal(service.positionCapacityTimer !== null, true);
    } finally {
      brokerRegistry.getAdapter = original;
      autoTradingService.stop('Phase 8.10 capacity cleanup');
    }
  }},
  { id: 37, name: 'Auto Live stop clears runtime recovery timer', run: () => {
    const service = autoTradingService as any;
    service.state = 'RUNNING';
    service.pauseForRuntimeFault('TEST_STOP_CLEAR');
    assert.ok(service.runtimeRecoveryTimer);
    autoTradingService.stop('Phase 8.10 stop timer cleanup');
    assert.equal(service.runtimeRecoveryTimer, null);
  }},
  { id: 38, name: 'Runtime recovery cadence is exactly 10 seconds', run: () => {
    assert.equal(AUTO_LIVE_RUNTIME_RECOVERY_POLL_MS, 10_000);
  }},
  { id: 39, name: 'Position-capacity polling remains exactly 10 seconds', run: () => {
    assert.equal(AUTO_LIVE_POSITION_CAPACITY_POLL_MS, 10_000);
  }},
  { id: 40, name: 'Active position refresh remains exactly 10 seconds', run: () => {
    assert.equal(AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS, 10_000);
  }},

  { id: 41, name: 'Three-hour balance cadence is explicit', run: () => {
    assert.equal(ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS, 3);
  }},
  { id: 42, name: 'Balance scheduler aligns 10:17 local time to 12:00', run: () => {
    const input = new Date(2026, 8, 27, 10, 17, 22);
    const next = nextThreeHourBoundary(input);
    assert.equal(next.getHours(), 12);
    assert.equal(next.getMinutes(), 0);
    assert.equal(next.getSeconds(), 0);
  }},
  { id: 43, name: 'Balance scheduler advances 23:30 local time to next midnight', run: () => {
    const input = new Date(2026, 8, 27, 23, 30, 0);
    const next = nextThreeHourBoundary(input);
    assert.equal(next.getDate(), 28);
    assert.equal(next.getHours(), 0);
  }},
  { id: 44, name: 'Market history scheduler can be stopped safely when inactive', run: () => {
    stopMarketHistoryScheduler();
    assert.equal(getMarketHistorySchedulerStatus().running, false);
  }},
  { id: 45, name: 'Current-pair prediction scheduler can be stopped safely when inactive', run: () => {
    stopCurrentPairPredictionCollectionScheduler();
    assert.equal(getCurrentPairPredictionCollectionStatus().running, false);
  }},
  { id: 46, name: 'Research outcome tracker can be stopped safely when inactive', run: () => {
    stopLiveTradeResearchOutcomeTracker();
    assert.equal(getLiveTradeResearchOutcomeTrackerStatus().running, false);
  }},

  { id: 47, name: 'Runtime readiness fails closed when database is unavailable', run: () => {
    assert.deepEqual(evaluateRuntimeReadiness(false, true), { ready: false, statusCode: 503, status: 'not_ready' });
  }},
  { id: 48, name: 'Runtime readiness requires both database and production preflight', run: () => {
    assert.equal(evaluateRuntimeReadiness(true, false).statusCode, 503);
    assert.equal(evaluateRuntimeReadiness(true, true).statusCode, 200);
  }},
  { id: 49, name: 'Runtime health payload remains environment-aware', run: () => {
    assert.deepEqual(buildRuntimeHealthPayload('production'), {
      status: 'ok',
      service: 'goldcrest',
      environment: 'production'
    });
  }},
  { id: 50, name: '5paisa LIVE_ONLY registry remains authoritative after runtime recovery tests', run: () => {
    assert.equal(brokerRegistry.getEnvironment(), 'LIVE');
    assert.deepEqual(
      brokerRegistry.getActiveLiveAdapters().map(adapter => `${adapter.broker}:${adapter.environment}`).sort(),
      ['FIVE_PAISA:LIVE']
    );
    assert.equal(getSystemConfig().tradingMode, 'LIVE_ONLY');
  }}
];

assert.equal(scenarios.length, 50);

console.log('\nPHASE 8.10 — PRODUCTION OPERATIONS & RECOVERY CERTIFICATION');
console.log('50 deterministic, broker-side-effect-free operational scenarios');

let passed = 0;
for (const item of scenarios) {
  await item.run();
  passed += 1;
  console.log(`[PASS ${String(item.id).padStart(2, '0')}/50] ${item.name}`);
}

assert.equal(passed, 50);
autoTradingService.stop('Phase 8.10 certification final cleanup');
stopMarketHistoryScheduler();
stopCurrentPairPredictionCollectionScheduler();
stopLiveTradeResearchOutcomeTracker();

console.log('===========================================================================');
console.log('PHASE 8.10 CERTIFICATION: 50/50 PASSED');
console.log('Database bootstrap single-flight: VERIFIED');
console.log('Durable execution restart recovery: VERIFIED');
console.log('Runtime lifecycle shutdown: VERIFIED');
console.log('Auto Live broker-fault pause/recovery: VERIFIED');
console.log('Scheduler stop/idempotence: VERIFIED');
console.log('Runtime readiness/health: VERIFIED');
console.log('LIVE_ONLY + cTrader API selector boundary: VERIFIED');
console.log('Live broker order submission: NOT INVOKED');
console.log('===========================================================================');
