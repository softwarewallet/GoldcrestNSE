import assert from 'node:assert/strict';
import { evaluateAutoLiveActivation, type AutoLiveActivationInput } from '../src/services/autoLiveActivationService';

const valid: AutoLiveActivationInput = {
  productionEnvironment: true,
  releaseIntegrityOk: true,
  configurationIntegrityOk: true,
  tradingModeLiveOnly: true,
  runtimeLifecycleRunning: true,
  cTraderCredentialsConfigured: true,
  cTraderConnected: true,
  cTraderAccountIsLive: true,
  cTraderAccountIdPresent: true,
  cTraderCurrencyPresent: true,
  cTraderBalanceValid: true,
  cTraderEquityValid: true,
  cTraderTradingPermission: true,
  cTraderApiMode: 'LIVE',
  allowDemoApiMode: false,
  killSwitchClear: true
};

const scenarios: Array<{ id: number; name: string; run: () => void }> = [];
const add = (id: number, name: string, run: () => void) => scenarios.push({ id, name, run });

add(1, 'Complete production preflight is ready', () => assert.equal(evaluateAutoLiveActivation(valid).ready, true));
add(2, 'Complete production preflight status is READY_TO_ARM', () => assert.equal(evaluateAutoLiveActivation(valid).status, 'READY_TO_ARM'));
add(3, 'Complete production preflight returns HTTP 200', () => assert.equal(evaluateAutoLiveActivation(valid).statusCode, 200));
add(4, 'Production environment is required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, productionEnvironment: false }).ready, false));
add(5, 'Release integrity is required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, releaseIntegrityOk: false }).ready, false));
add(6, 'Configuration integrity is required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, configurationIntegrityOk: false }).ready, false));
add(7, 'LIVE_ONLY is required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, tradingModeLiveOnly: false }).ready, false));
add(8, 'Running lifecycle is required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, runtimeLifecycleRunning: false }).ready, false));
add(9, 'cTrader credentials are required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderCredentialsConfigured: false }).ready, false));
add(10, 'cTrader connection is required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderConnected: false }).ready, false));
add(11, 'cTrader account must be LIVE', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderAccountIsLive: false }).ready, false));
add(12, 'cTrader account identity is required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderAccountIdPresent: false }).ready, false));
add(13, 'cTrader account currency is required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderCurrencyPresent: false }).ready, false));
add(14, 'cTrader balance must be valid', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderBalanceValid: false }).ready, false));
add(15, 'cTrader equity must be valid', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderEquityValid: false }).ready, false));
add(16, 'cTrader trading permission is required', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderTradingPermission: false }).ready, false));
add(17, 'cTrader API mode must be LIVE for Auto Live', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderApiMode: 'DEMO' }).ready, false));
add(18, 'Kill switch must be clear', () => assert.equal(evaluateAutoLiveActivation({ ...valid, killSwitchClear: false }).ready, false));
add(19, 'Release failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, releaseIntegrityOk: false }).failures.includes('releaseIntegrity')));
add(20, 'Configuration failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, configurationIntegrityOk: false }).failures.includes('configurationIntegrity')));
add(21, 'Trading mode failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, tradingModeLiveOnly: false }).failures.includes('tradingMode')));
add(22, 'Lifecycle failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, runtimeLifecycleRunning: false }).failures.includes('runtimeLifecycle')));
add(23, 'Credentials failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, cTraderCredentialsConfigured: false }).failures.includes('cTraderCredentials')));
add(24, 'Connectivity failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, cTraderConnected: false }).failures.includes('cTraderConnected')));
add(25, 'Account-live failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, cTraderAccountIsLive: false }).failures.includes('cTraderAccountLive')));
add(26, 'Account-id failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, cTraderAccountIdPresent: false }).failures.includes('cTraderAccountId')));
add(27, 'Currency failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, cTraderCurrencyPresent: false }).failures.includes('cTraderCurrency')));
add(28, 'Balance failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, cTraderBalanceValid: false }).failures.includes('cTraderBalance')));
add(29, 'Equity failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, cTraderEquityValid: false }).failures.includes('cTraderEquity')));
add(30, 'Permission failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, cTraderTradingPermission: false }).failures.includes('cTraderTradingPermission')));
add(31, 'API mode failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, cTraderApiMode: 'DEMO' }).failures.includes('cTraderApiMode')));
add(32, 'Kill-switch failure is explicit', () => assert.ok(evaluateAutoLiveActivation({ ...valid, killSwitchClear: false }).failures.includes('killSwitch')));
add(33, 'Multiple blockers aggregate', () => {
  const result = evaluateAutoLiveActivation({ ...valid, releaseIntegrityOk: false, cTraderConnected: false, killSwitchClear: false });
  assert.deepEqual(result.failures, ['releaseIntegrity', 'cTraderConnected', 'killSwitch']);
});
add(34, 'A single blocker returns one failure', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderEquityValid: false }).failures.length, 1));
add(35, 'Ready evaluation has no failures', () => assert.deepEqual(evaluateAutoLiveActivation(valid).failures, []));
add(36, 'Blocked evaluation is not ready', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderConnected: false }).ready, false));
add(37, 'Blocked status is BLOCKED', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderConnected: false }).status, 'BLOCKED'));
add(38, 'Blocked status code is 409', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderConnected: false }).statusCode, 409));
add(39, 'All valid checks pass', () => assert.ok(Object.values(evaluateAutoLiveActivation(valid).checks).every(value => value === 'PASS')));
add(40, 'All check values expose PASS or FAIL only', () => assert.ok(Object.values(evaluateAutoLiveActivation(valid).checks).every(value => value === 'PASS' || value === 'FAIL')));
add(41, 'LIVE API mode itself is preserved in input', () => assert.equal(evaluateAutoLiveActivation(valid).checks.cTraderApiMode, 'PASS'));
add(42, 'Demo API mode never passes production activation', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderApiMode: 'DEMO', allowDemoApiMode: false }).checks.cTraderApiMode, 'FAIL'));
add(43, 'Demo API mode may pass local activation', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderApiMode: 'DEMO', allowDemoApiMode: true }).checks.cTraderApiMode, 'PASS'));
add(44, 'Trading permission is independent of balance validity', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderBalanceValid: false }).checks.cTraderTradingPermission, 'PASS'));
add(45, 'Account identity is independent of connectivity', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderConnected: false }).checks.cTraderAccountId, 'PASS'));
add(46, 'Kill switch is independent of account fields', () => assert.equal(evaluateAutoLiveActivation({ ...valid, cTraderBalanceValid: false }).checks.killSwitch, 'PASS'));
add(47, 'Configuration failure does not change broker check result', () => assert.equal(evaluateAutoLiveActivation({ ...valid, configurationIntegrityOk: false }).checks.cTraderConnected, 'PASS'));
add(48, 'Production environment failure does not alter API mode check', () => assert.equal(evaluateAutoLiveActivation({ ...valid, productionEnvironment: false }).checks.cTraderApiMode, 'PASS'));
add(49, 'Result is deterministic', () => assert.deepEqual(evaluateAutoLiveActivation(valid), evaluateAutoLiveActivation({ ...valid })));
add(50, 'Ready result is internally consistent', () => {
  const result = evaluateAutoLiveActivation(valid);
  assert.equal(result.ready, result.failures.length === 0);
  assert.equal(result.statusCode, 200);
});
add(51, 'Blocked result is internally consistent', () => {
  const result = evaluateAutoLiveActivation({ ...valid, killSwitchClear: false });
  assert.equal(result.ready, false);
  assert.equal(result.statusCode, 409);
});
add(52, 'Complete check count is 15', () => assert.equal(Object.keys(evaluateAutoLiveActivation(valid).checks).length, 15));
add(53, 'Production environment check is present', () => assert.equal(evaluateAutoLiveActivation(valid).checks.productionEnvironment, 'PASS'));
add(54, 'Runtime lifecycle check is present', () => assert.equal(evaluateAutoLiveActivation(valid).checks.runtimeLifecycle, 'PASS'));
add(55, 'cTrader account-live check is present', () => assert.equal(evaluateAutoLiveActivation(valid).checks.cTraderAccountLive, 'PASS'));
add(56, 'cTrader account ID check is present', () => assert.equal(evaluateAutoLiveActivation(valid).checks.cTraderAccountId, 'PASS'));
add(57, 'cTrader currency check is present', () => assert.equal(evaluateAutoLiveActivation(valid).checks.cTraderCurrency, 'PASS'));
add(58, 'cTrader balance check is present', () => assert.equal(evaluateAutoLiveActivation(valid).checks.cTraderBalance, 'PASS'));
add(59, 'cTrader equity check is present', () => assert.equal(evaluateAutoLiveActivation(valid).checks.cTraderEquity, 'PASS'));
add(60, 'cTrader trading permission check is present', () => assert.equal(evaluateAutoLiveActivation(valid).checks.cTraderTradingPermission, 'PASS'));
add(61, 'Phase 9.4 certification contains exactly 61 scenarios', () => assert.equal(scenarios.length, 61));

for (const item of scenarios) {
  item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/60] ' + item.name);
}

console.log('PHASE 9.4 AUTO LIVE ACTIVATION CERTIFICATION: 61/61 PASSED');
