import assert from 'node:assert/strict';
import { evaluateOperationalReadiness, type OperationalReadinessInput } from '../src/services/operationalReadinessService';

const scenarios: Array<{ id: number; name: string; run: () => void | Promise<void> }> = [];
const add = (id: number, name: string, run: () => void | Promise<void>) => scenarios.push({ id, name, run });

const validInput: OperationalReadinessInput = {
  releaseIntegrityOk: true,
  configurationIntegrityOk: true,
  tradingModeLiveOnly: true,
  databaseInitialized: true,
  databasePersistenceHealthy: true,
  runtimeLifecycleRunning: true,
  auditLogReady: true,
  operatorAuthConfigured: true,
  liveBrokerConfigured: true,
  liveBrokerConnected: true,
  autonomousExecutionAllowed: false
};

add(1, 'Valid production readiness is READY', () => assert.equal(evaluateOperationalReadiness(validInput).ready, true));
add(2, 'Valid production readiness returns HTTP 200', () => assert.equal(evaluateOperationalReadiness(validInput).statusCode, 200));
add(3, 'Valid production readiness has no failures', () => assert.deepEqual(evaluateOperationalReadiness(validInput).failures, []));
add(4, 'Release integrity is required', () => assert.equal(evaluateOperationalReadiness({ ...validInput, releaseIntegrityOk: false }).ready, false));
add(5, 'Release integrity failure returns HTTP 503', () => assert.equal(evaluateOperationalReadiness({ ...validInput, releaseIntegrityOk: false }).statusCode, 503));
add(6, 'Configuration integrity is required', () => assert.equal(evaluateOperationalReadiness({ ...validInput, configurationIntegrityOk: false }).ready, false));
add(7, 'LIVE_ONLY trading mode is required', () => assert.equal(evaluateOperationalReadiness({ ...validInput, tradingModeLiveOnly: false }).ready, false));
add(8, 'Database initialization is required', () => assert.equal(evaluateOperationalReadiness({ ...validInput, databaseInitialized: false }).ready, false));
add(9, 'Database persistence health is required', () => assert.equal(evaluateOperationalReadiness({ ...validInput, databasePersistenceHealthy: false }).ready, false));
add(10, 'RUNNING lifecycle is required', () => assert.equal(evaluateOperationalReadiness({ ...validInput, runtimeLifecycleRunning: false }).ready, false));
add(11, 'Audit log availability is required', () => assert.equal(evaluateOperationalReadiness({ ...validInput, auditLogReady: false }).ready, false));
add(12, 'Operator authentication is required', () => assert.equal(evaluateOperationalReadiness({ ...validInput, operatorAuthConfigured: false }).ready, false));
add(13, 'At least one LIVE broker must be configured', () => assert.equal(evaluateOperationalReadiness({ ...validInput, liveBrokerConfigured: false }).ready, false));
add(14, 'At least one LIVE broker must be connected', () => assert.equal(evaluateOperationalReadiness({ ...validInput, liveBrokerConnected: false }).ready, false));
add(15, 'Autonomous live execution must remain locked', () => assert.equal(evaluateOperationalReadiness({ ...validInput, autonomousExecutionAllowed: true }).ready, false));
add(16, 'Autonomous lock gate passes when execution is false', () => assert.equal(evaluateOperationalReadiness(validInput).gates.autonomousExecutionLocked.status, 'PASS'));
add(17, 'Autonomous lock gate fails when execution is true', () => assert.equal(evaluateOperationalReadiness({ ...validInput, autonomousExecutionAllowed: true }).gates.autonomousExecutionLocked.status, 'FAIL'));
add(18, 'Failure names identify release integrity', () => assert.ok(evaluateOperationalReadiness({ ...validInput, releaseIntegrityOk: false }).failures.includes('releaseIntegrity')));
add(19, 'Failure names identify configuration integrity', () => assert.ok(evaluateOperationalReadiness({ ...validInput, configurationIntegrityOk: false }).failures.includes('configurationIntegrity')));
add(20, 'Failure names identify database state', () => assert.ok(evaluateOperationalReadiness({ ...validInput, databaseInitialized: false }).failures.includes('database')));
add(21, 'Failure names identify database persistence', () => assert.ok(evaluateOperationalReadiness({ ...validInput, databasePersistenceHealthy: false }).failures.includes('databasePersistence')));
add(22, 'Failure names identify lifecycle state', () => assert.ok(evaluateOperationalReadiness({ ...validInput, runtimeLifecycleRunning: false }).failures.includes('runtimeLifecycle')));
add(23, 'Failure names identify audit log', () => assert.ok(evaluateOperationalReadiness({ ...validInput, auditLogReady: false }).failures.includes('auditLog')));
add(24, 'Failure names identify operator auth', () => assert.ok(evaluateOperationalReadiness({ ...validInput, operatorAuthConfigured: false }).failures.includes('operatorAuth')));
add(25, 'Failure names identify broker configuration', () => assert.ok(evaluateOperationalReadiness({ ...validInput, liveBrokerConfigured: false }).failures.includes('liveBrokerConfigured')));
add(26, 'Failure names identify broker connectivity', () => assert.ok(evaluateOperationalReadiness({ ...validInput, liveBrokerConnected: false }).failures.includes('liveBrokerConnected')));
add(27, 'Failure names identify autonomous unlock', () => assert.ok(evaluateOperationalReadiness({ ...validInput, autonomousExecutionAllowed: true }).failures.includes('autonomousExecutionLocked')));
add(28, 'Multiple failures are reported together', () => {
  const result = evaluateOperationalReadiness({ ...validInput, databaseInitialized: false, operatorAuthConfigured: false, liveBrokerConnected: false });
  assert.equal(result.failures.length, 3);
});
add(29, 'All eleven readiness gates are present', () => assert.equal(Object.keys(evaluateOperationalReadiness(validInput).gates).length, 11));
add(30, 'All valid gates report PASS', () => assert.ok(Object.values(evaluateOperationalReadiness(validInput).gates).every(value => value.status === 'PASS')));
add(31, 'Blocked readiness status is BLOCKED', () => assert.equal(evaluateOperationalReadiness({ ...validInput, auditLogReady: false }).status, 'BLOCKED'));
add(32, 'Ready status is READY', () => assert.equal(evaluateOperationalReadiness(validInput).status, 'READY'));
add(33, 'Ready result is internally consistent', () => {
  const result = evaluateOperationalReadiness(validInput);
  assert.equal(result.ready, result.status === 'READY');
  assert.equal(result.statusCode, 200);
});
add(34, 'Blocked result is internally consistent', () => {
  const result = evaluateOperationalReadiness({ ...validInput, auditLogReady: false });
  assert.equal(result.ready, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.statusCode, 503);
});
add(35, 'Release failure does not affect unrelated gate detail', () => {
  const result = evaluateOperationalReadiness({ ...validInput, releaseIntegrityOk: false });
  assert.equal(result.gates.operatorAuth.status, 'PASS');
});
add(36, 'Broker connectivity failure does not erase broker configuration state', () => {
  const result = evaluateOperationalReadiness({ ...validInput, liveBrokerConnected: false });
  assert.equal(result.gates.liveBrokerConfigured.status, 'PASS');
});
add(37, 'Autonomous lock is independent of broker connectivity', () => {
  const result = evaluateOperationalReadiness({ ...validInput, liveBrokerConnected: false });
  assert.equal(result.gates.autonomousExecutionLocked.status, 'PASS');
});
add(38, 'LIVE_ONLY gate is independent of operator auth', () => {
  const result = evaluateOperationalReadiness({ ...validInput, operatorAuthConfigured: false });
  assert.equal(result.gates.tradingMode.status, 'PASS');
});
add(39, 'Database persistence gate remains explicit', () => assert.equal(evaluateOperationalReadiness(validInput).gates.databasePersistence.status, 'PASS'));
add(40, 'Audit gate detail is explicit', () => assert.match(evaluateOperationalReadiness(validInput).gates.auditLog.detail, /Durable audit log/));
add(41, 'Broker connection gate detail is explicit', () => assert.match(evaluateOperationalReadiness(validInput).gates.liveBrokerConnected.detail, /CONNECTED/));
add(42, 'Autonomous gate detail proves lock', () => assert.match(evaluateOperationalReadiness(validInput).gates.autonomousExecutionLocked.detail, /locked/));
add(43, 'Empty failure list only occurs when all gates pass', () => {
  const result = evaluateOperationalReadiness(validInput);
  assert.equal(result.failures.length === 0, result.ready);
});
add(44, 'Single release failure produces exactly one blocker', () => {
  const result = evaluateOperationalReadiness({ ...validInput, releaseIntegrityOk: false });
  assert.deepEqual(result.failures, ['releaseIntegrity']);
});
add(45, 'Single operator failure produces exactly one blocker', () => {
  const result = evaluateOperationalReadiness({ ...validInput, operatorAuthConfigured: false });
  assert.deepEqual(result.failures, ['operatorAuth']);
});
add(46, 'Single broker connectivity failure produces exactly one blocker', () => {
  const result = evaluateOperationalReadiness({ ...validInput, liveBrokerConnected: false });
  assert.deepEqual(result.failures, ['liveBrokerConnected']);
});
add(47, 'Single autonomous unlock produces exactly one blocker', () => {
  const result = evaluateOperationalReadiness({ ...validInput, autonomousExecutionAllowed: true });
  assert.deepEqual(result.failures, ['autonomousExecutionLocked']);
});
add(48, 'Gate status values are restricted to PASS/FAIL', () => {
  const result = evaluateOperationalReadiness(validInput);
  assert.ok(Object.values(result.gates).every(value => value.status === 'PASS' || value.status === 'FAIL'));
});
add(49, 'Readiness evaluation is deterministic', () => assert.deepEqual(evaluateOperationalReadiness(validInput), evaluateOperationalReadiness({ ...validInput })));
add(50, 'Phase 9.1 certification contains exactly 50 scenarios', () => assert.equal(scenarios.length, 50));

for (const item of scenarios) {
  await item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/50] ' + item.name);
}

console.log('PHASE 9.1 OPERATIONAL READINESS CERTIFICATION: 50/50 PASSED');
