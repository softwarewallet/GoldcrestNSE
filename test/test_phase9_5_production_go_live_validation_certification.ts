import assert from 'node:assert/strict';
import { evaluateProductionGoLiveValidation, type ProductionGoLiveValidationInput } from '../src/services/productionGoLiveValidationService';

const valid: ProductionGoLiveValidationInput = {
  productionEnvironment: true,
  releaseIntegrityOk: true,
  configurationIntegrityOk: true,
  tradingModeLiveOnly: true,
  databaseInitialized: true,
  databasePersistenceHealthy: true,
  runtimeLifecycleRunning: true,
  auditLogReady: true,
  operatorAuthConfigured: true,
  cTraderCredentialsConfigured: true,
  cTraderBrokerVerified: true,
  cTraderConnected: true,
  cTraderAccountIsLive: true,
  cTraderAccountIdPresent: true,
  cTraderCurrencyPresent: true,
  cTraderBalanceValid: true,
  cTraderEquityValid: true,
  cTraderTradingPermission: true,
  cTraderApiMode: 'LIVE',
  killSwitchClear: true,
  executionGateLocked: true,
  noUnresolvedExecutionIntents: true,
  cTraderAccountStateConsistent: true,
  validationSubmittedOrder: false
};

const scenarios: Array<{ id: number; name: string; run: () => void }> = [];
const add = (id: number, name: string, run: () => void) => scenarios.push({ id, name, run });

add(1, 'Complete production validation is ready', () => assert.equal(evaluateProductionGoLiveValidation(valid).ready, true));
add(2, 'Ready status is READY_FOR_ACTIVATION', () => assert.equal(evaluateProductionGoLiveValidation(valid).status, 'READY_FOR_ACTIVATION'));
add(3, 'Ready status code is 200', () => assert.equal(evaluateProductionGoLiveValidation(valid).statusCode, 200));
add(4, 'Production environment is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, productionEnvironment: false }).ready, false));
add(5, 'Release integrity is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, releaseIntegrityOk: false }).ready, false));
add(6, 'Configuration integrity is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, configurationIntegrityOk: false }).ready, false));
add(7, 'LIVE_ONLY is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, tradingModeLiveOnly: false }).ready, false));
add(8, 'Database initialization is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, databaseInitialized: false }).ready, false));
add(9, 'Database persistence health is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, databasePersistenceHealthy: false }).ready, false));
add(10, 'Runtime lifecycle must be RUNNING', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, runtimeLifecycleRunning: false }).ready, false));
add(11, 'Audit logging is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, auditLogReady: false }).ready, false));
add(12, 'Operator authentication is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, operatorAuthConfigured: false }).ready, false));
add(13, 'cTrader credentials are required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderCredentialsConfigured: false }).ready, false));
add(14, 'cTrader broker verification is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderBrokerVerified: false }).ready, false));
add(15, 'cTrader connection is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderConnected: false }).ready, false));
add(16, 'cTrader account must be LIVE', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderAccountIsLive: false }).ready, false));
add(17, 'cTrader account ID is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderAccountIdPresent: false }).ready, false));
add(18, 'cTrader currency is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderCurrencyPresent: false }).ready, false));
add(19, 'cTrader balance must be positive and valid', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderBalanceValid: false }).ready, false));
add(20, 'cTrader equity must be positive and valid', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderEquityValid: false }).ready, false));
add(21, 'cTrader trading permission is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderTradingPermission: false }).ready, false));
add(22, 'cTrader API mode must be LIVE', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderApiMode: 'DEMO' }).ready, false));
add(23, 'Kill switch must be clear', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, killSwitchClear: false }).ready, false));
add(24, 'Execution gate must remain locked during validation', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, executionGateLocked: false }).ready, false));
add(25, 'Unresolved execution intents block activation', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, noUnresolvedExecutionIntents: false }).ready, false));
add(26, 'Account-state consistency is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderAccountStateConsistent: false }).ready, false));
add(27, 'Validation must not submit a broker order', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, validationSubmittedOrder: true }).ready, false));
add(28, 'Release failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, releaseIntegrityOk: false }).failures.includes('releaseIntegrity')));
add(29, 'Configuration failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, configurationIntegrityOk: false }).failures.includes('configurationIntegrity')));
add(30, 'Database failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, databaseInitialized: false }).failures.includes('database')));
add(31, 'Persistence failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, databasePersistenceHealthy: false }).failures.includes('databasePersistence')));
add(32, 'Lifecycle failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, runtimeLifecycleRunning: false }).failures.includes('runtimeLifecycle')));
add(33, 'Audit failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, auditLogReady: false }).failures.includes('auditLog')));
add(34, 'Operator auth failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, operatorAuthConfigured: false }).failures.includes('operatorAuth')));
add(35, 'cTrader credentials failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderCredentialsConfigured: false }).failures.includes('cTraderCredentials')));
add(36, 'Broker verification failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderBrokerVerified: false }).failures.includes('cTraderBrokerVerification')));
add(37, 'cTrader connection failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderConnected: false }).failures.includes('cTraderConnected')));
add(38, 'Account-live failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderAccountIsLive: false }).failures.includes('cTraderAccountLive')));
add(39, 'Account identity failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderAccountIdPresent: false }).failures.includes('cTraderAccountId')));
add(40, 'Currency failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderCurrencyPresent: false }).failures.includes('cTraderCurrency')));
add(41, 'Balance failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderBalanceValid: false }).failures.includes('cTraderBalance')));
add(42, 'Equity failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderEquityValid: false }).failures.includes('cTraderEquity')));
add(43, 'Permission failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderTradingPermission: false }).failures.includes('cTraderTradingPermission')));
add(44, 'API mode failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderApiMode: 'DEMO' }).failures.includes('cTraderApiMode')));
add(45, 'Kill-switch failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, killSwitchClear: false }).failures.includes('killSwitch')));
add(46, 'Execution gate failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, executionGateLocked: false }).failures.includes('executionGate')));
add(47, 'Unresolved-intent failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, noUnresolvedExecutionIntents: false }).failures.includes('unresolvedExecutionIntents')));
add(48, 'Account-state consistency failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, cTraderAccountStateConsistent: false }).failures.includes('accountStateConsistency')));
add(49, 'Order-submission failure is explicit', () => assert.ok(evaluateProductionGoLiveValidation({ ...valid, validationSubmittedOrder: true }).failures.includes('orderSubmission')));
add(50, 'Multiple blockers aggregate deterministically', () => {
  const result = evaluateProductionGoLiveValidation({ ...valid, releaseIntegrityOk: false, cTraderConnected: false, executionGateLocked: false, noUnresolvedExecutionIntents: false });
  assert.deepEqual(result.failures, ['releaseIntegrity', 'cTraderConnected', 'executionGate', 'unresolvedExecutionIntents']);
});
add(51, 'A single blocker returns one failure', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderEquityValid: false }).failures.length, 1));
add(52, 'Ready result has no failures', () => assert.deepEqual(evaluateProductionGoLiveValidation(valid).failures, []));
add(53, 'Blocked status is BLOCKED', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderConnected: false }).status, 'BLOCKED'));
add(54, 'Blocked status code is 409', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, cTraderConnected: false }).statusCode, 409));
add(55, 'All checks pass for valid input', () => assert.ok(Object.values(evaluateProductionGoLiveValidation(valid).checks).every(value => value.status === 'PASS')));
add(56, 'Check values are only PASS or FAIL', () => assert.ok(Object.values(evaluateProductionGoLiveValidation(valid).checks).every(value => value.status === 'PASS' || value.status === 'FAIL')));
add(57, 'Complete check count is 24', () => assert.equal(Object.keys(evaluateProductionGoLiveValidation(valid).checks).length, 24));
add(58, 'Production check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.productionEnvironment.status, 'PASS'));
add(59, 'Release check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.releaseIntegrity.status, 'PASS'));
add(60, 'Configuration check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.configurationIntegrity.status, 'PASS'));
add(61, 'Database check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.database.status, 'PASS'));
add(62, 'Persistence check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.databasePersistence.status, 'PASS'));
add(63, 'Lifecycle check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.runtimeLifecycle.status, 'PASS'));
add(64, 'Audit check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.auditLog.status, 'PASS'));
add(65, 'Broker verification check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.cTraderBrokerVerification.status, 'PASS'));
add(66, 'Account-live check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.cTraderAccountLive.status, 'PASS'));
add(67, 'Account identity check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.cTraderAccountId.status, 'PASS'));
add(68, 'Currency check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.cTraderCurrency.status, 'PASS'));
add(69, 'Balance check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.cTraderBalance.status, 'PASS'));
add(70, 'Equity check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.cTraderEquity.status, 'PASS'));
add(71, 'Permission check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.cTraderTradingPermission.status, 'PASS'));
add(72, 'API mode check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.cTraderApiMode.status, 'PASS'));
add(73, 'Kill-switch check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.killSwitch.status, 'PASS'));
add(74, 'Execution gate check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.executionGate.status, 'PASS'));
add(75, 'Unresolved-intent check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.unresolvedExecutionIntents.status, 'PASS'));
add(76, 'Account consistency check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.accountStateConsistency.status, 'PASS'));
add(77, 'Order submission check is present', () => assert.equal(evaluateProductionGoLiveValidation(valid).checks.orderSubmission.status, 'PASS'));
add(78, 'Validation declares no broker order submitted', () => assert.equal(evaluateProductionGoLiveValidation(valid).orderSubmissionPerformed, false));
add(79, 'Result is deterministic', () => assert.deepEqual(evaluateProductionGoLiveValidation(valid), evaluateProductionGoLiveValidation({ ...valid })));
add(80, 'Phase 9.5 certification contains exactly 80 scenarios', () => assert.equal(scenarios.length, 80));

for (const item of scenarios) {
  item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/80] ' + item.name);
}

console.log('PHASE 9.5 PRODUCTION GO-LIVE VALIDATION CERTIFICATION: 80/80 PASSED');
