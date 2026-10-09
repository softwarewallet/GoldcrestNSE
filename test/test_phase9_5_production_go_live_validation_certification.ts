import assert from 'node:assert/strict';
import {
  evaluateProductionGoLiveValidation,
  type ProductionGoLiveValidationInput
} from '../src/services/productionGoLiveValidationService';
import type { CommonValidationInput, CTraderValidationInput, FivePaisaValidationInput } from '../src/services/validationProfileService';

const commonValid: CommonValidationInput = {
  productionEnvironment: true,
  releaseIntegrityOk: true,
  configurationIntegrityOk: true,
  tradingModeLiveOnly: true,
  databaseInitialized: true,
  databasePersistenceHealthy: true,
  runtimeLifecycleRunning: true,
  auditLogReady: true,
  operatorAuthConfigured: true,
  killSwitchClear: true,
  executionGateLocked: true,
  noUnresolvedExecutionIntents: true,
  validationSubmittedOrder: false
};

const cTraderValid: CTraderValidationInput = {
  cTraderCredentialsConfigured: true,
  cTraderBrokerVerified: true,
  cTraderConnected: true,
  cTraderAccountIsLive: true,
  cTraderAccountIdPresent: true,
  cTraderCurrencyPresent: true,
  balanceValid: true,
  equityValid: true,
  tradingPermission: true,
  apiMode: 'LIVE',
  accountStateConsistent: true
} as any;

// Use typed structure from CTraderValidationInput:
const cTraderSpecificValid: CTraderValidationInput = {
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
  cTraderAccountStateConsistent: true
};

const fivePaisaSpecificValid: FivePaisaValidationInput = {
  fivePaisaConnected: true,
  fivePaisaAccountIsLive: true,
  fivePaisaAccountIdPresent: true,
  fivePaisaCurrencyPresent: true,
  fivePaisaBalanceValid: true,
  fivePaisaEquityValid: true,
  fivePaisaTradingPermission: true,
  fivePaisaAccountStateConsistent: true
};

const validCTraderInput: ProductionGoLiveValidationInput = {
  profile: 'CTRADER',
  common: { ...commonValid },
  ctradr: { ...cTraderSpecificValid }
};

const validFivePaisaInput: ProductionGoLiveValidationInput = {
  profile: '5PAISA',
  common: { ...commonValid },
  fivePaisa: { ...fivePaisaSpecificValid }
};

const scenarios: Array<{ id: number; name: string; run: () => void }> = [];
const add = (id: number, name: string, run: () => void) => scenarios.push({ id, name, run });

// 1 - 3: Baseline Healthy CTRADER
add(1, 'Complete CTRADER production validation is ready', () => {
  const res = evaluateProductionGoLiveValidation(validCTraderInput);
  assert.equal(res.ready, true);
  assert.equal(res.status, 'READY_FOR_ACTIVATION');
  assert.equal(res.statusCode, 200);
  assert.equal(res.orderSubmissionPerformed, false);
  assert.deepEqual(res.failures, []);
});

// 4 - 6: Baseline Healthy 5PAISA
add(2, 'Complete 5PAISA production validation is ready', () => {
  const res = evaluateProductionGoLiveValidation(validFivePaisaInput);
  assert.equal(res.ready, true);
  assert.equal(res.status, 'READY_FOR_ACTIVATION');
  assert.equal(res.statusCode, 200);
  assert.equal(res.orderSubmissionPerformed, false);
  assert.deepEqual(res.failures, []);
});

add(3, 'FIVE_PAISA profile alias is also supported and ready', () => {
  const res = evaluateProductionGoLiveValidation({
    profile: 'FIVE_PAISA',
    common: { ...commonValid },
    fivePaisa: { ...fivePaisaSpecificValid }
  });
  assert.equal(res.ready, true);
  assert.equal(res.status, 'READY_FOR_ACTIVATION');
  assert.equal(res.statusCode, 200);
});

// Common Validation Gates (7 - 19)
add(4, 'Common gate: Production environment is required', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, productionEnvironment: false }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.failures.includes('productionEnvironment'));
  assert.equal(res.orderSubmissionPerformed, false);
});

add(5, 'Common gate: Release integrity is required', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, releaseIntegrityOk: false }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.failures.includes('releaseIntegrity'));
});

add(6, 'Common gate: Configuration integrity is required', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, configurationIntegrityOk: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('configurationIntegrity'));
});

add(7, 'Common gate: LIVE_ONLY trading mode is required', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, tradingModeLiveOnly: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('tradingMode'));
});

add(8, 'Common gate: Database initialization is required', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, databaseInitialized: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('database'));
});

add(9, 'Common gate: Database persistence health is required', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, databasePersistenceHealthy: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('databasePersistence'));
});

add(10, 'Common gate: Runtime lifecycle RUNNING is required', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, runtimeLifecycleRunning: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('runtimeLifecycle'));
});

add(11, 'Common gate: Audit logging is required', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, auditLogReady: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('auditLog'));
});

add(12, 'Common gate: Operator authentication is required', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, operatorAuthConfigured: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('operatorAuth'));
});

add(13, 'Common gate: Kill switch must be clear (halted fails)', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, killSwitchClear: false }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.failures.includes('killSwitch'));
});

add(14, 'Common gate: Autonomous execution gate must remain locked during validation', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, executionGateLocked: false }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.failures.includes('executionGate'));
});

add(15, 'Common gate: Unresolved execution intents blocks go-live', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, noUnresolvedExecutionIntents: false }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.failures.includes('unresolvedExecutionIntents'));
});

add(16, 'Common gate: Validation must never submit a broker order', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    common: { ...validCTraderInput.common, validationSubmittedOrder: true }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.failures.includes('orderSubmission'));
  assert.equal(res.orderSubmissionPerformed, false);
});

// CTRADER specific gates (17 - 27)
add(17, 'cTrader credentials required for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderCredentialsConfigured: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderCredentials'));
});

add(18, 'cTrader broker verification required for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderBrokerVerified: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderBrokerVerification'));
});

add(19, 'cTrader connection required for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderConnected: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderConnected'));
});

add(20, 'cTrader account must be LIVE for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderAccountIsLive: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderAccountLive'));
});

add(21, 'cTrader account ID required for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderAccountIdPresent: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderAccountId'));
});

add(22, 'cTrader currency required for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderCurrencyPresent: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderCurrency'));
});

add(23, 'cTrader balance valid required for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderBalanceValid: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderBalance'));
});

add(24, 'cTrader equity valid required for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderEquityValid: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderEquity'));
});

add(25, 'cTrader trading permission required for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderTradingPermission: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderTradingPermission'));
});

add(26, 'cTrader API mode must be LIVE for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderApiMode: 'DEMO' }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderApiMode'));
});

add(27, 'cTrader account state consistency required for CTRADER profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validCTraderInput,
    ctradr: { ...validCTraderInput.ctradr!, cTraderAccountStateConsistent: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('cTraderAccountStateConsistent'));
});

// 5PAISA specific gates (28 - 35)
add(28, '5paisa connection required for 5PAISA profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validFivePaisaInput,
    fivePaisa: { ...validFivePaisaInput.fivePaisa!, fivePaisaConnected: false }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.failures.includes('fivePaisaConnected'));
});

add(29, '5paisa account must be LIVE for 5PAISA profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validFivePaisaInput,
    fivePaisa: { ...validFivePaisaInput.fivePaisa!, fivePaisaAccountIsLive: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('fivePaisaAccountLive'));
});

add(30, '5paisa account ID required for 5PAISA profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validFivePaisaInput,
    fivePaisa: { ...validFivePaisaInput.fivePaisa!, fivePaisaAccountIdPresent: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('fivePaisaAccountId'));
});

add(31, '5paisa currency required for 5PAISA profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validFivePaisaInput,
    fivePaisa: { ...validFivePaisaInput.fivePaisa!, fivePaisaCurrencyPresent: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('fivePaisaCurrency'));
});

add(32, '5paisa balance valid required for 5PAISA profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validFivePaisaInput,
    fivePaisa: { ...validFivePaisaInput.fivePaisa!, fivePaisaBalanceValid: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('fivePaisaBalance'));
});

add(33, '5paisa equity valid required for 5PAISA profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validFivePaisaInput,
    fivePaisa: { ...validFivePaisaInput.fivePaisa!, fivePaisaEquityValid: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('fivePaisaEquity'));
});

add(34, '5paisa trading permission required for 5PAISA profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validFivePaisaInput,
    fivePaisa: { ...validFivePaisaInput.fivePaisa!, fivePaisaTradingPermission: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('fivePaisaTradingPermission'));
});

add(35, '5paisa account state consistency required for 5PAISA profile', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validFivePaisaInput,
    fivePaisa: { ...validFivePaisaInput.fivePaisa!, fivePaisaAccountStateConsistent: false }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('fivePaisaAccountStateConsistent'));
});

// Profile Mismatch & Evidence Isolation (36 - 40)
add(36, 'Missing ctradr evidence for CTRADER profile triggers profileMismatch', () => {
  const res = evaluateProductionGoLiveValidation({
    profile: 'CTRADER',
    common: { ...commonValid }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.failures.includes('profileMismatch'));
});

add(37, 'Missing fivePaisa evidence for 5PAISA profile triggers profileMismatch', () => {
  const res = evaluateProductionGoLiveValidation({
    profile: '5PAISA',
    common: { ...commonValid }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.failures.includes('profileMismatch'));
});

add(38, 'Unknown profile triggers profileMismatch', () => {
  const res = evaluateProductionGoLiveValidation({
    profile: 'UNKNOWN_BROKER' as any,
    common: { ...commonValid }
  });
  assert.equal(res.ready, false);
  assert.ok(res.failures.includes('profileMismatch'));
});

add(39, '5PAISA profile does not evaluate or impose cTrader gates', () => {
  const res = evaluateProductionGoLiveValidation(validFivePaisaInput);
  assert.equal(res.checks.cTraderCredentials, undefined);
  assert.equal(res.checks.cTraderBrokerVerification, undefined);
  assert.equal(res.checks.cTraderConnected, undefined);
  assert.equal(res.checks.cTraderApiMode, undefined);
});

add(40, 'CTRADER profile does not evaluate or impose 5paisa gates', () => {
  const res = evaluateProductionGoLiveValidation(validCTraderInput);
  assert.equal(res.checks.fivePaisaConnected, undefined);
  assert.equal(res.checks.fivePaisaTradingPermission, undefined);
  assert.equal(res.checks.fivePaisaAccountLive, undefined);
});

add(41, 'Common gate failure also blocks 5PAISA profile (e.g. killSwitch)', () => {
  const res = evaluateProductionGoLiveValidation({
    ...validFivePaisaInput,
    common: { ...validFivePaisaInput.common, killSwitchClear: false }
  });
  assert.equal(res.ready, false);
  assert.equal(res.status, 'BLOCKED');
  assert.equal(res.statusCode, 409);
  assert.ok(res.failures.includes('killSwitch'));
});

for (const item of scenarios) {
  item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/' + scenarios.length + '] ' + item.name);
}
console.log('PHASE 9.5 PRODUCTION GO-LIVE VALIDATION CERTIFICATION: 41/41 PASSED');
