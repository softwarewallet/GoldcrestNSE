import assert from 'node:assert/strict';
import { evaluateProductionGoLiveValidation, type ProductionGoLiveValidationInput } from '../src/services/productionGoLiveValidationService';

const valid: ProductionGoLiveValidationInput = {
  profile: 'CTRADER',
  common: {
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
  },
  ctradr: {
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
  }
};

const scenarios: Array<{ id: number; name: string; run: () => void }> = [];
const add = (id: number, name: string, run: () => void) => scenarios.push({ id, name, run });

add(1, 'Complete production validation is ready', () => assert.equal(evaluateProductionGoLiveValidation(valid).ready, true));
add(2, 'Ready status is READY_FOR_ACTIVATION', () => assert.equal(evaluateProductionGoLiveValidation(valid).status, 'READY_FOR_ACTIVATION'));
add(3, 'Ready status code is 200', () => assert.equal(evaluateProductionGoLiveValidation(valid).statusCode, 200));

// Correctly nested tests
add(4, 'Production environment is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, common: { ...valid.common, productionEnvironment: false } }).ready, false));
add(5, 'Release integrity is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, common: { ...valid.common, releaseIntegrityOk: false } }).ready, false));
add(6, 'Configuration integrity is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, common: { ...valid.common, configurationIntegrityOk: false } }).ready, false));
add(7, 'LIVE_ONLY is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, common: { ...valid.common, tradingModeLiveOnly: false } }).ready, false));
add(8, 'Database initialization is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, common: { ...valid.common, databaseInitialized: false } }).ready, false));
add(9, 'Database persistence health is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, common: { ...valid.common, databasePersistenceHealthy: false } }).ready, false));
add(10, 'Runtime lifecycle must be RUNNING', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, common: { ...valid.common, runtimeLifecycleRunning: false } }).ready, false));
add(11, 'Audit logging is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, common: { ...valid.common, auditLogReady: false } }).ready, false));
add(12, 'Operator authentication is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, common: { ...valid.common, operatorAuthConfigured: false } }).ready, false));
add(13, 'cTrader credentials are required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, ctradr: { ...valid.ctradr!, cTraderCredentialsConfigured: false } }).ready, false));
add(14, 'cTrader broker verification is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, ctradr: { ...valid.ctradr!, cTraderBrokerVerified: false } }).ready, false));
add(15, 'cTrader connection is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, ctradr: { ...valid.ctradr!, cTraderConnected: false } }).ready, false));
add(16, 'cTrader account must be LIVE', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, ctradr: { ...valid.ctradr!, cTraderAccountIsLive: false } }).ready, false));
add(17, 'cTrader account ID is required', () => assert.equal(evaluateProductionGoLiveValidation({ ...valid, ctradr: { ...valid.ctradr!, cTraderAccountIdPresent: false } }).ready, false));

for(const item of scenarios){item.run();console.log('[PASS '+String(item.id).padStart(2,'0')+'/'+scenarios.length+'] '+item.name);}
console.log('PHASE 9.5 PRODUCTION GO-LIVE VALIDATION CERTIFICATION: PASSED');
