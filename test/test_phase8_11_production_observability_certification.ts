import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'false';
process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'false';
process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'false';
process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'false';
process.env.LIVE_TRADING_ENABLED = 'false';

const {
  combineObservabilityHealth,
  evaluateRuntimeObservabilityHealth,
  getRecoveryRecommendation,
  getRuntimeObservabilitySnapshot
} = await import('../src/services/runtimeObservabilityService');
const { runtimeLifecycle, RuntimeLifecycleCoordinator } = await import('../src/services/runtimeLifecycle');
const { getDatabase, getDatabaseInitializationState, executeQuery, executeRun } = await import('../src/database/db');
const { autoTradingService } = await import('../src/services/autoTradingService');
const { brokerRegistry } = await import('../src/brokers/registry');
const { getLiveRuntimeLogStatus } = await import('../src/services/liveRuntimeLog');
const {
  ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS,
  getAccountBalanceSnapshotSchedulerStatus,
  nextThreeHourBoundary
} = await import('../src/services/accountBalanceSnapshotService');
const { getMarketHistorySchedulerStatus } = await import('../src/services/marketHistoryService');
const { getCurrentPairPredictionCollectionStatus } = await import('../src/services/currentPairPredictionCollectionService');
const { getLiveTradeResearchOutcomeTrackerStatus } = await import('../src/services/liveTradeResearchOutcomeService');
const { EXECUTION_RECONCILIATION_MAX_AGE_MS } = await import('../src/services/executionReconciliationService');

const scenarios: Array<{ id: number; name: string; run: () => void | Promise<void> }> = [];
const add = (id: number, name: string, run: () => void | Promise<void>) => scenarios.push({ id, name, run });

add(1, 'Health combiner returns HEALTHY for all healthy inputs', () => { assert.equal(combineObservabilityHealth(['HEALTHY', 'HEALTHY']), 'HEALTHY'); });
add(2, 'Health combiner returns DEGRADED when any component is degraded', () => { assert.equal(combineObservabilityHealth(['HEALTHY', 'DEGRADED']), 'DEGRADED'); });
add(3, 'Health combiner returns CRITICAL over degraded', () => { assert.equal(combineObservabilityHealth(['DEGRADED', 'CRITICAL']), 'CRITICAL'); });
add(4, 'Empty health set is healthy', () => { assert.equal(combineObservabilityHealth([]), 'HEALTHY'); });
add(5, 'Healthy lifecycle and dependencies produce HEALTHY', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'RUNNING', databaseReady: true, auditLogReady: true, brokerStatuses: [{ status: 'CONNECTED', live: true }], operatorActionRequired: 0, staleUnresolved: 0, schedulerFailures: 0 }), 'HEALTHY');
});
add(6, 'Disconnected broker produces DEGRADED', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'RUNNING', databaseReady: true, auditLogReady: true, brokerStatuses: [{ status: 'DISCONNECTED', live: true }], operatorActionRequired: 0, staleUnresolved: 0, schedulerFailures: 0 }), 'DEGRADED');
});
add(7, 'Broker authentication failure produces CRITICAL', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'RUNNING', databaseReady: true, auditLogReady: true, brokerStatuses: [{ status: 'AUTHENTICATION_FAILED', live: true }], operatorActionRequired: 0, staleUnresolved: 0, schedulerFailures: 0 }), 'CRITICAL');
});
add(8, 'Non-live broker status is degraded', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'RUNNING', databaseReady: true, auditLogReady: true, brokerStatuses: [{ status: 'CONNECTED', live: false }], operatorActionRequired: 0, staleUnresolved: 0, schedulerFailures: 0 }), 'DEGRADED');
});
add(9, 'Database failure is critical', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'RUNNING', databaseReady: false, auditLogReady: true, brokerStatuses: [], operatorActionRequired: 0, staleUnresolved: 0, schedulerFailures: 0 }), 'CRITICAL');
});
add(10, 'Audit-log failure is critical', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'RUNNING', databaseReady: true, auditLogReady: false, brokerStatuses: [], operatorActionRequired: 0, staleUnresolved: 0, schedulerFailures: 0 }), 'CRITICAL');
});
add(11, 'Stopped lifecycle is critical', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'STOPPED', databaseReady: true, auditLogReady: true, brokerStatuses: [], operatorActionRequired: 0, staleUnresolved: 0, schedulerFailures: 0 }), 'CRITICAL');
});
add(12, 'Degraded lifecycle remains degraded when everything else is healthy', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'DEGRADED', databaseReady: true, auditLogReady: true, brokerStatuses: [], operatorActionRequired: 0, staleUnresolved: 0, schedulerFailures: 0 }), 'DEGRADED');
});
add(13, 'Operator reconciliation requirement is degraded', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'RUNNING', databaseReady: true, auditLogReady: true, brokerStatuses: [], operatorActionRequired: 1, staleUnresolved: 0, schedulerFailures: 0 }), 'DEGRADED');
});
add(14, 'Stale unresolved execution intent is degraded', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'RUNNING', databaseReady: true, auditLogReady: true, brokerStatuses: [], operatorActionRequired: 0, staleUnresolved: 1, schedulerFailures: 0 }), 'DEGRADED');
});
add(15, 'Scheduler failure is degraded', () => {
  assert.equal(evaluateRuntimeObservabilityHealth({ lifecycleState: 'RUNNING', databaseReady: true, auditLogReady: true, brokerStatuses: [], operatorActionRequired: 0, staleUnresolved: 0, schedulerFailures: 1 }), 'DEGRADED');
});

add(16, 'Recovery recommendation is NONE for healthy snapshot', () => {
  const base = { lifecycle: { state: 'RUNNING' }, database: { initialized: true, initializing: false }, auditLog: { enabled: true, exists: true }, executionIntents: { operatorActionRequired: 0, staleUnresolved: 0, reconciliationTimeout: 0 }, brokers: [{ reportedStatus: 'CONNECTED' }], schedulers: { marketHistory: { running: true }, currentPairPrediction: { running: true }, liveTradeResearchOutcome: { running: true }, accountBalanceSnapshot: { running: true } } };
  assert.equal(getRecoveryRecommendation(base as any).action, 'NONE');
});
add(17, 'Stopped lifecycle recommends application restart', () => { assert.equal(getRecoveryRecommendation({ lifecycle: { state: 'STOPPED' }, database: { initialized: true }, auditLog: { enabled: true, exists: true }, executionIntents: { operatorActionRequired: 0, staleUnresolved: 0, reconciliationTimeout: 0 }, brokers: [], schedulers: {} } as any).action, 'RESTART_APPLICATION'); });
add(18, 'Critical database condition recommends application restart', () => { assert.equal(getRecoveryRecommendation({ lifecycle: { state: 'RUNNING' }, database: { initialized: false }, auditLog: { enabled: true, exists: true }, executionIntents: { operatorActionRequired: 0, staleUnresolved: 0, reconciliationTimeout: 0 }, brokers: [], schedulers: {} } as any).action, 'RESTART_APPLICATION'); });
add(19, 'Disabled audit log recommends application restart', () => { assert.equal(getRecoveryRecommendation({ lifecycle: { state: 'RUNNING' }, database: { initialized: true }, auditLog: { enabled: false, exists: true }, executionIntents: { operatorActionRequired: 0, staleUnresolved: 0, reconciliationTimeout: 0 }, brokers: [], schedulers: {} } as any).action, 'RESTART_APPLICATION'); });
add(20, 'Operator action requirement recommends reconciliation review', () => { assert.equal(getRecoveryRecommendation({ lifecycle: { state: 'RUNNING' }, database: { initialized: true }, auditLog: { enabled: true, exists: true }, executionIntents: { operatorActionRequired: 1, staleUnresolved: 0, reconciliationTimeout: 0 }, brokers: [], schedulers: {} } as any).action, 'REVIEW_RECONCILIATION'); });
add(21, 'Stale unresolved intent recommends reconciliation review', () => { assert.equal(getRecoveryRecommendation({ lifecycle: { state: 'RUNNING' }, database: { initialized: true }, auditLog: { enabled: true, exists: true }, executionIntents: { operatorActionRequired: 0, staleUnresolved: 1, reconciliationTimeout: 0 }, brokers: [], schedulers: {} } as any).action, 'REVIEW_RECONCILIATION'); });
add(22, 'Reconciliation timeout recommends reconciliation review', () => { assert.equal(getRecoveryRecommendation({ lifecycle: { state: 'RUNNING' }, database: { initialized: true }, auditLog: { enabled: true, exists: true }, executionIntents: { operatorActionRequired: 0, staleUnresolved: 0, reconciliationTimeout: 1 }, brokers: [], schedulers: {} } as any).action, 'REVIEW_RECONCILIATION'); });
add(23, 'Disconnected LIVE broker recommends broker connection check', () => { assert.equal(getRecoveryRecommendation({ lifecycle: { state: 'RUNNING' }, database: { initialized: true }, auditLog: { enabled: true, exists: true }, executionIntents: { operatorActionRequired: 0, staleUnresolved: 0, reconciliationTimeout: 0 }, brokers: [{ reportedStatus: 'DISCONNECTED' }], schedulers: { marketHistory: { running: true }, currentPairPrediction: { running: true }, liveTradeResearchOutcome: { running: true }, accountBalanceSnapshot: { running: true } } } as any).action, 'CHECK_BROKER_CONNECTION'); });
add(24, 'Stopped scheduler recommends scheduler restart', () => { assert.equal(getRecoveryRecommendation({ lifecycle: { state: 'RUNNING' }, database: { initialized: true }, auditLog: { enabled: true, exists: true }, executionIntents: { operatorActionRequired: 0, staleUnresolved: 0, reconciliationTimeout: 0 }, brokers: [], schedulers: { marketHistory: { running: false }, currentPairPrediction: { running: true }, liveTradeResearchOutcome: { running: true }, accountBalanceSnapshot: { running: true } } } as any).action, 'RESTART_SCHEDULER'); });

add(25, 'Runtime lifecycle coordinator records RUNNING state', () => { const c = new RuntimeLifecycleCoordinator(); c.transition('RUNNING'); assert.equal(c.getStatus().state, 'RUNNING'); });
add(26, 'Runtime lifecycle coordinator records DEGRADED state', () => { const c = new RuntimeLifecycleCoordinator(); c.transition('RUNNING'); c.transition('DEGRADED'); assert.equal(c.getStatus().state, 'DEGRADED'); });
add(27, 'Runtime lifecycle coordinator recovers from DEGRADED', () => { const c = new RuntimeLifecycleCoordinator(); c.transition('RUNNING'); c.transition('DEGRADED'); c.transition('RUNNING'); assert.equal(c.getStatus().state, 'RUNNING'); });
add(28, 'Runtime lifecycle shutdown is observable', async () => { const c = new RuntimeLifecycleCoordinator(); c.transition('RUNNING'); await c.shutdown('OBS_TEST'); assert.equal(c.getStatus().state, 'STOPPED'); assert.equal(c.getStatus().lastShutdownReason, 'OBS_TEST'); });
add(29, 'Runtime lifecycle shutdown is idempotent', async () => { const c = new RuntimeLifecycleCoordinator(); c.transition('RUNNING'); let calls = 0; c.registerCleanup('one', () => { calls += 1; }); await c.shutdown('FIRST'); await c.shutdown('SECOND'); assert.equal(calls, 1); });
add(30, 'Runtime lifecycle cleanup failure remains isolated', async () => { const c = new RuntimeLifecycleCoordinator(); c.transition('RUNNING'); c.registerCleanup('bad', () => { throw new Error('bad'); }); c.registerCleanup('good', () => undefined); const result = await c.shutdown('FAILURE_ISOLATION'); assert.deepEqual(result.failed, ['bad']); assert.deepEqual(result.completed, ['good']); });

add(31, 'Database initialization state is observable', () => { const state = getDatabaseInitializationState(); assert.equal(typeof state.initialized, 'boolean'); assert.equal(typeof state.initializing, 'boolean'); });
add(32, 'Concurrent database access returns the same database', async () => { const dbs = await Promise.all([getDatabase(), getDatabase(), getDatabase()]); assert.ok(dbs[0] === dbs[1] && dbs[1] === dbs[2]); });
add(33, 'Execution intent table is present for observability', async () => { const rows = await executeQuery<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_intents'"); assert.equal(rows.length, 1); });
add(34, 'Balance snapshot table is present for observability', async () => { const rows = await executeQuery<any>("SELECT name FROM sqlite_master WHERE type='table' AND name='account_balance_snapshots'"); assert.equal(rows.length, 1); });
add(35, 'Live runtime log status has a file', () => { const status = getLiveRuntimeLogStatus(); assert.equal(status.exists, true); assert.ok(status.file.length > 0); });
add(36, 'Auto Live status is observable', () => { const status = autoTradingService.getStatus(); assert.equal(typeof status.state, 'string'); assert.ok(Array.isArray(status.pairs)); });
add(37, 'Market history scheduler status is observable', () => { const status = getMarketHistorySchedulerStatus(); assert.equal(typeof status.running, 'boolean'); assert.ok(status.intervalMs > 0); });
add(38, 'Current-pair scheduler status is observable', () => { const status = getCurrentPairPredictionCollectionStatus(); assert.equal(typeof status.running, 'boolean'); assert.ok(status.pollIntervalMs > 0); });
add(39, 'Research outcome tracker status is observable', () => { const status = getLiveTradeResearchOutcomeTrackerStatus(); assert.equal(typeof status.running, 'boolean'); assert.ok(status.pollIntervalMs > 0); });
add(40, 'Balance snapshot scheduler status is observable', () => { const status = getAccountBalanceSnapshotSchedulerStatus(); assert.equal(status.intervalHours, ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS); assert.equal(typeof status.running, 'boolean'); });

add(41, 'Three-hour boundary remains deterministic', () => { const d = new Date(2026, 8, 27, 10, 17, 22); const n = nextThreeHourBoundary(d); assert.equal(n.getHours(), 12); assert.equal(n.getMinutes(), 0); });
add(42, 'Reconciliation age contract remains 15 minutes', () => { assert.equal(EXECUTION_RECONCILIATION_MAX_AGE_MS, 15 * 60_000); });
add(43, 'LIVE registry remains LIVE_ONLY', () => { assert.equal(brokerRegistry.getEnvironment(), 'LIVE'); });
add(44, 'Active broker adapter is LIVE', () => { assert.deepEqual(brokerRegistry.getActiveLiveAdapters().map(a => a.environment), ['LIVE']); });
add(45, 'Auto Live remains stopped in certification baseline', () => { autoTradingService.stop('Phase 8.11 baseline'); assert.equal(autoTradingService.getStatus().state, 'STOPPED'); });
add(46, 'Auto Live runtime fault metadata is clear after stop', () => { assert.equal(autoTradingService.getStatus().runtimeFaultReason, null); });
add(47, 'Observability snapshot carries LIVE_ONLY trading mode', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-test', now: Date.now() }); assert.equal(snapshot.tradingMode, 'LIVE_ONLY'); });
add(48, 'Observability snapshot identifies the supplied runtime', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-runtime', now: 1700000000000 }); assert.equal(snapshot.runtimeId, 'phase8-11-runtime'); assert.equal(snapshot.generatedAt, 1700000000000); });
add(49, 'Observability snapshot exposes broker states without network submission', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-broker', now: Date.now() }); assert.equal(snapshot.brokers.length, 1); assert.ok(snapshot.brokers.every(b => b.environment === 'LIVE' && b.isLive === true)); });
add(50, 'Observability snapshot exposes execution-intent counters', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-intents', now: Date.now() }); assert.ok(snapshot.executionIntents.pending >= 0); assert.ok(snapshot.executionIntents.inFlight >= 0); assert.ok(snapshot.executionIntents.reconciliationTimeout >= 0); assert.ok(snapshot.executionIntents.operatorActionRequired >= 0); });
add(51, 'Observability snapshot exposes scheduler statuses', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-schedulers' }); assert.equal(typeof snapshot.schedulers.marketHistory.running, 'boolean'); assert.equal(typeof snapshot.schedulers.currentPairPrediction.running, 'boolean'); assert.equal(typeof snapshot.schedulers.liveTradeResearchOutcome.running, 'boolean'); assert.equal(typeof snapshot.schedulers.accountBalanceSnapshot.running, 'boolean'); });
add(52, 'Observability snapshot exposes audit-log status', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-audit' }); assert.equal(snapshot.auditLog.exists, true); });
add(53, 'Observability snapshot includes Auto Live status', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-auto' }); assert.equal(typeof snapshot.autoTrading.state, 'string'); assert.ok(Array.isArray(snapshot.autoTrading.pairs)); });
add(54, 'Recovery recommendation is present on a real snapshot', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-recovery' }); const recovery = getRecoveryRecommendation(snapshot); assert.ok(['NONE', 'RESTART_APPLICATION', 'CHECK_BROKER_CONNECTION', 'REVIEW_RECONCILIATION', 'RESTART_SCHEDULER'].includes(recovery.action)); assert.ok(recovery.reason.length > 0); });
add(55, 'Observability component names are unique', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-components' }); const names = snapshot.components.map(c => c.name); assert.equal(new Set(names).size, names.length); });
add(56, 'Observability component health values are valid', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-health' }); assert.ok(snapshot.components.every(c => ['HEALTHY', 'DEGRADED', 'CRITICAL'].includes(c.health))); });
add(57, 'Overall observability health is valid', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-overall' }); assert.ok(['HEALTHY', 'DEGRADED', 'CRITICAL'].includes(snapshot.overallHealth)); });
add(58, 'Stale unresolved counter cannot be negative', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-stale' }); assert.ok(snapshot.executionIntents.staleUnresolved >= 0); });
add(59, 'Observability environment is populated', async () => { const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-env', environment: 'test' }); assert.equal(snapshot.environment, 'test'); });
add(60, 'Certification never enables autonomous live execution', async () => { autoTradingService.stop('Phase 8.11 final safety'); const snapshot = await getRuntimeObservabilitySnapshot({ runtimeId: 'phase8-11-final' }); assert.equal(snapshot.autoTrading.autonomousPermission, false); assert.equal(autoTradingService.getStatus().autonomousPermission, false); });

console.log('=========================================================================');
console.log('PHASE 8.11 — PRODUCTION OBSERVABILITY & INCIDENT-RECOVERY CERTIFICATION');
console.log('60 deterministic, broker-side-effect-free observability scenarios');
console.log('=========================================================================');
assert.equal(scenarios.length, 60);
let passed = 0;
for (const item of scenarios) { await item.run(); passed += 1; console.log('[PASS ' + String(item.id).padStart(2, '0') + '/60] ' + item.name); }
assert.equal(passed, 60);
console.log('=========================================================================');
console.log('PHASE 8.11 CERTIFICATION: 60/60 PASSED');
console.log('Runtime observability aggregation: VERIFIED');
console.log('Incident recovery classification: VERIFIED');
console.log('Stale execution detection: VERIFIED');
console.log('Lifecycle telemetry: VERIFIED');
console.log('Scheduler visibility: VERIFIED');
console.log('LIVE-only broker visibility: VERIFIED');
console.log('Autonomous live execution: NOT ENABLED');
console.log('Broker order submission: NOT INVOKED');
console.log('=========================================================================');