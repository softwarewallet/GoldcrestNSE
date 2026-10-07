import assert from 'node:assert/strict';
import {
  evaluateCTraderFunctionalValidation,
  type CTraderFunctionalValidationInput
} from '../src/services/cTraderFunctionalValidationService';

const live: CTraderFunctionalValidationInput = {
  configured: true,
  selectedApiMode: 'LIVE',
  connection: {
    connected: true,
    apiMode: 'LIVE',
    apiEndpoint: 'wss://live.ctraderapi.com:5036',
    account: '123456',
    accountType: 'LIVE',
    balance: 10000,
    equity: 9900,
    currency: 'USD',
    permissions: ['TRADING']
  },
  instrumentAvailable: true,
  quoteFresh: true,
  quoteBidAskValid: true,
  historicalDataAvailable: true,
  positionsReadSuccessful: true,
  openOrdersReadSuccessful: true,
  orderPacketValid: true,
  validationSubmittedOrder: false
};

const demo: CTraderFunctionalValidationInput = {
  ...live,
  selectedApiMode: 'DEMO',
  connection: {
    ...live.connection!,
    apiMode: 'DEMO',
    apiEndpoint: 'wss://demo.ctraderapi.com:5036',
    account: '654321',
    accountType: 'DEMO'
  }
};

const scenarios: Array<{ id: number; name: string; run: () => void }> = [];
const add = (id: number, name: string, run: () => void) => scenarios.push({ id, name, run });

add(1, 'Complete LIVE functional validation passes', () => assert.equal(evaluateCTraderFunctionalValidation(live).status, 'FUNCTIONAL'));
add(2, 'Complete DEMO functional validation passes', () => assert.equal(evaluateCTraderFunctionalValidation(demo).status, 'FUNCTIONAL'));
add(3, 'LIVE status code is 200', () => assert.equal(evaluateCTraderFunctionalValidation(live).statusCode, 200));
add(4, 'DEMO status code is 200', () => assert.equal(evaluateCTraderFunctionalValidation(demo).statusCode, 200));
add(5, 'LIVE mode is retained', () => assert.equal(evaluateCTraderFunctionalValidation(live).mode, 'LIVE'));
add(6, 'DEMO mode is retained', () => assert.equal(evaluateCTraderFunctionalValidation(demo).mode, 'DEMO'));
add(7, 'Credentials are required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, configured: false }).ready, false));
add(8, 'Connection is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, connected: false } }).ready, false));
add(9, 'Selected LIVE mode must match connection', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, apiMode: 'DEMO' } }).ready, false));
add(10, 'Selected DEMO mode must match connection', () => assert.equal(evaluateCTraderFunctionalValidation({ ...demo, connection: { ...demo.connection!, apiMode: 'LIVE' } }).ready, false));
add(11, 'LIVE endpoint must match mode', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, apiEndpoint: 'wss://demo.ctraderapi.com:5036' } }).ready, false));
add(12, 'DEMO endpoint must match mode', () => assert.equal(evaluateCTraderFunctionalValidation({ ...demo, connection: { ...demo.connection!, apiEndpoint: 'wss://live.ctraderapi.com:5036' } }).ready, false));
add(13, 'LIVE account type is required in LIVE mode', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, accountType: 'DEMO' } }).ready, false));
add(14, 'DEMO account type is required in DEMO mode', () => assert.equal(evaluateCTraderFunctionalValidation({ ...demo, connection: { ...demo.connection!, accountType: 'LIVE' } }).ready, false));
add(15, 'Account ID is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, account: '' } }).ready, false));
add(16, 'Currency is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, currency: '' } }).ready, false));
add(17, 'Balance must be finite and non-negative', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, balance: Number.NaN } }).ready, false));
add(18, 'Zero balance remains a valid broker-state observation', () => assert.equal(evaluateCTraderFunctionalValidation({ ...demo, connection: { ...demo.connection!, balance: 0, equity: 0 } }).ready, true));
add(19, 'Equity must be finite and non-negative', () => assert.equal(evaluateCTraderFunctionalValidation({ ...demo, connection: { ...demo.connection!, equity: -1 } }).ready, false));
add(20, 'Trading permission is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, permissions: [] } }).ready, false));
add(21, 'Instrument read is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, instrumentAvailable: false }).ready, false));
add(22, 'Fresh quote is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, quoteFresh: false }).ready, false));
add(23, 'Valid bid/ask values are required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, quoteBidAskValid: false }).ready, false));
add(24, 'Historical data read is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, historicalDataAvailable: false }).ready, false));
add(25, 'Position read is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, positionsReadSuccessful: false }).ready, false));
add(26, 'Open-order read is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, openOrdersReadSuccessful: false }).ready, false));
add(27, 'Shared order packet validation is required', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, orderPacketValid: false }).ready, false));
add(28, 'Functional validation must not submit an order', () => assert.equal(evaluateCTraderFunctionalValidation({ ...live, validationSubmittedOrder: true }).ready, false));
add(29, 'Credential failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, configured: false }).failures.includes('credentials')));
add(30, 'Connection failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, connected: false } }).failures.includes('connection')));
add(31, 'API-mode failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, apiMode: 'DEMO' } }).failures.includes('apiMode')));
add(32, 'API-endpoint failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, apiEndpoint: 'wss://demo.ctraderapi.com:5036' } }).failures.includes('apiEndpoint')));
add(33, 'Account-type failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...demo, connection: { ...demo.connection!, accountType: 'LIVE' } }).failures.includes('accountType')));
add(34, 'Account-ID failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, account: '' } }).failures.includes('accountId')));
add(35, 'Currency failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, currency: '' } }).failures.includes('currency')));
add(36, 'Balance failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, balance: Infinity } }).failures.includes('balance')));
add(37, 'Equity failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, equity: Number.NaN } }).failures.includes('equity')));
add(38, 'Permission failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, connection: { ...live.connection!, permissions: ['CLOSE_ONLY'] } }).failures.includes('tradingPermission')));
add(39, 'Instrument failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, instrumentAvailable: false }).failures.includes('instrument')));
add(40, 'Quote failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, quoteFresh: false }).failures.includes('quote')));
add(41, 'Historical-data failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, historicalDataAvailable: false }).failures.includes('historicalData')));
add(42, 'Position-read failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, positionsReadSuccessful: false }).failures.includes('positionsRead')));
add(43, 'Open-order-read failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, openOrdersReadSuccessful: false }).failures.includes('openOrdersRead')));
add(44, 'Order-packet failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, orderPacketValid: false }).failures.includes('orderPacket')));
add(45, 'Order-submission failure is explicit', () => assert.ok(evaluateCTraderFunctionalValidation({ ...live, validationSubmittedOrder: true }).failures.includes('orderSubmission')));
add(46, 'Multiple failures aggregate in deterministic order', () => {
  const result = evaluateCTraderFunctionalValidation({
    ...demo,
    configured: false,
    instrumentAvailable: false,
    quoteFresh: false
  });
  assert.deepEqual(result.failures, ['credentials', 'instrument', 'quote']);
});
add(47, 'Successful LIVE validation has no failures', () => assert.deepEqual(evaluateCTraderFunctionalValidation(live).failures, []));
add(48, 'Successful DEMO validation has no failures', () => assert.deepEqual(evaluateCTraderFunctionalValidation(demo).failures, []));
add(49, 'All checks are PASS for valid DEMO input', () => assert.ok(Object.values(evaluateCTraderFunctionalValidation(demo).checks).every(value => value.status === 'PASS')));
add(50, 'Phase 9.7.1 certification contains exactly 50 scenarios', () => assert.equal(scenarios.length, 50));

for (const item of scenarios) {
  item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/50] ' + item.name);
}
console.log('PHASE 9.7.1 cTRADER FUNCTIONAL VALIDATION CERTIFICATION: 50/50 PASSED');
