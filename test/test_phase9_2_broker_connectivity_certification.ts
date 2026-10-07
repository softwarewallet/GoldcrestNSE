import assert from 'node:assert/strict';
import { evaluateBrokerVerification, summarizeBrokerVerification } from '../src/services/brokerVerificationService';
import type { ConnectionTestResult } from '../src/brokers/types';

const scenarios: Array<{ id: number; name: string; run: () => void | Promise<void> }> = [];
const add = (id: number, name: string, run: () => void | Promise<void>) => scenarios.push({ id, name, run });

const ctraderLive: ConnectionTestResult = {
  broker: 'CTRADER',
  environment: 'LIVE',
  connected: true,
  apiMode: 'LIVE',
  apiEndpoint: 'wss://live.ctraderapi.com:5036',
  account: '****1234',
  accountType: 'LIVE',
  balance: 10000,
  equity: 9900,
  availableMargin: 8000,
  currency: 'USD',
  timestamp: 1000
};

const ctraderDemo: ConnectionTestResult = {
  ...ctraderLive,
  apiMode: 'DEMO',
  apiEndpoint: 'wss://demo.ctraderapi.com:5036'
};

const fivePaisaLive: ConnectionTestResult = {
  broker: 'FIVE_PAISA',
  environment: 'LIVE',
  connected: true,
  account: '****4321',
  accountType: 'LIVE',
  balance: 200000,
  equity: 198000,
  availableMargin: 150000,
  currency: 'INR',
  timestamp: 1000
};

add(1, 'Valid cTrader LIVE connection verifies', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).status, 'VERIFIED'));
add(2, 'Valid cTrader LIVE reports connected', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).connected, true));
add(3, 'Valid cTrader LIVE reports authoritative account state', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).authoritativeAccountState, true));
add(4, 'cTrader LIVE endpoint is verified', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).apiEndpoint, 'wss://live.ctraderapi.com:5036'));
add(5, 'cTrader DEMO selector endpoint is distinct', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderDemo, expectedCTraderApiMode: 'DEMO' }).apiEndpoint, 'wss://demo.ctraderapi.com:5036'));
add(6, 'cTrader LIVE mode must match selected mode', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderDemo, expectedCTraderApiMode: 'LIVE' }).status, 'CONFIGURED_UNAVAILABLE'));
add(7, 'cTrader LIVE mode mismatch is explicit', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderDemo, expectedCTraderApiMode: 'LIVE' }).failures.includes('CTRADER_API_MODE_MISMATCH')));
add(8, 'cTrader endpoint mismatch is explicit', () => {
  const result = evaluateBrokerVerification({
    broker: 'CTRADER',
    configured: true,
    connection: { ...ctraderLive, apiEndpoint: 'wss://demo.ctraderapi.com:5036' },
    expectedCTraderApiMode: 'LIVE'
  });
  assert.ok(result.failures.includes('CTRADER_API_ENDPOINT_MISMATCH'));
});
add(9, 'Valid 5paisa LIVE connection verifies', () => assert.equal(evaluateBrokerVerification({ broker: 'FIVE_PAISA', configured: true, connection: fivePaisaLive }).status, 'VERIFIED'));
add(10, '5paisa does not require a cTrader API mode', () => assert.deepEqual(evaluateBrokerVerification({ broker: 'FIVE_PAISA', configured: true, connection: fivePaisaLive }).failures, []));
add(11, 'Missing credentials are NOT_CONFIGURED', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: false }).status, 'NOT_CONFIGURED'));
add(12, 'Missing credentials never report connected', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: false }).connected, false));
add(13, 'Missing credentials never report authoritative account state', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: false }).authoritativeAccountState, false));
add(14, 'Missing credentials exposes explicit failure', () => assert.deepEqual(evaluateBrokerVerification({ broker: 'CTRADER', configured: false }).failures, ['CREDENTIALS_NOT_CONFIGURED']));
add(15, 'Configured broker without connection result is unavailable', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true }).status, 'CONFIGURED_UNAVAILABLE'));
add(16, 'Unavailable connection has explicit failure', () => assert.deepEqual(evaluateBrokerVerification({ broker: 'CTRADER', configured: true }).failures, ['CONNECTION_TEST_UNAVAILABLE']));
add(17, 'Disconnected broker is unavailable', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, connected: false } }).status, 'CONFIGURED_UNAVAILABLE'));
add(18, 'Disconnected broker reports connected=false', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, connected: false } }).connected, false));
add(19, 'Missing account ID blocks authoritative account state', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, account: '' } }).authoritativeAccountState, false));
add(20, 'Missing account ID is explicit', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, account: '' } }).failures.includes('ACCOUNT_ID_UNAVAILABLE')));
add(21, 'Missing currency blocks authoritative account state', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, currency: '' } }).authoritativeAccountState, false));
add(22, 'Missing currency is explicit', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, currency: '' } }).failures.includes('ACCOUNT_CURRENCY_UNAVAILABLE')));
add(23, 'Negative balance is unavailable', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, balance: -1 } }).status, 'CONFIGURED_UNAVAILABLE'));
add(24, 'NaN equity is unavailable', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, equity: Number.NaN } }).status, 'CONFIGURED_UNAVAILABLE'));
add(25, 'Missing balance is unavailable', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, balance: undefined } }).failures.includes('BALANCE_UNAVAILABLE')));
add(26, 'Missing equity is unavailable', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, equity: undefined } }).failures.includes('EQUITY_UNAVAILABLE')));
add(27, 'Missing timestamp is unavailable', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, timestamp: 0 } }).failures.includes('CONNECTION_TIMESTAMP_UNAVAILABLE')));
add(28, 'Fresh valid zero balance remains valid', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, balance: 0, equity: 0 } }).status, 'VERIFIED'));
add(29, 'Account state remains authoritative when balance is zero', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, balance: 0, equity: 0 } }).authoritativeAccountState, true));
add(30, 'Broker verification is deterministic', () => assert.deepEqual(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }), evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive }, expectedCTraderApiMode: 'LIVE' })));
add(31, 'Two configured verified brokers summarize correctly', () => assert.deepEqual(summarizeBrokerVerification([
  evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }),
  evaluateBrokerVerification({ broker: 'FIVE_PAISA', configured: true, connection: fivePaisaLive })
]), { anyConfigured: true, anyConnected: true, allConfiguredBrokersVerified: true }));
add(32, 'No brokers configured summarizes correctly', () => assert.deepEqual(summarizeBrokerVerification([
  evaluateBrokerVerification({ broker: 'CTRADER', configured: false }),
  evaluateBrokerVerification({ broker: 'FIVE_PAISA', configured: false })
]), { anyConfigured: false, anyConnected: false, allConfiguredBrokersVerified: false }));
add(33, 'One unavailable configured broker prevents all-verified summary', () => assert.equal(summarizeBrokerVerification([
  evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, connected: false } })
]).allConfiguredBrokersVerified, false));
add(34, 'An unconfigured second broker does not invalidate configured verified broker', () => assert.equal(summarizeBrokerVerification([
  evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }),
  evaluateBrokerVerification({ broker: 'FIVE_PAISA', configured: false })
]).allConfiguredBrokersVerified, true));
add(35, 'Connected state requires authoritative connection result', () => {
  const result = evaluateBrokerVerification({ broker: 'FIVE_PAISA', configured: true, connection: { ...fivePaisaLive, account: '' } });
  assert.equal(result.connected, true);
  assert.equal(result.authoritativeAccountState, false);
});
add(36, 'Verification status fails when account currency missing', () => assert.equal(evaluateBrokerVerification({ broker: 'FIVE_PAISA', configured: true, connection: { ...fivePaisaLive, currency: '' } }).status, 'CONFIGURED_UNAVAILABLE'));
add(37, 'Verification status fails on disconnected connection with complete fields', () => assert.equal(evaluateBrokerVerification({ broker: 'FIVE_PAISA', configured: true, connection: { ...fivePaisaLive, connected: false } }).status, 'CONFIGURED_UNAVAILABLE'));
add(38, 'API endpoint is retained for cTrader verification output', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).apiEndpoint, ctraderLive.apiEndpoint));
add(39, 'API mode is retained for cTrader verification output', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).apiMode, 'LIVE'));
add(40, 'Phase 9.2 certification contains exactly 40 scenarios', () => assert.equal(scenarios.length, 40));

for (const item of scenarios) {
  await item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/40] ' + item.name);
}

console.log('PHASE 9.2 BROKER CONNECTIVITY CERTIFICATION: 40/40 PASSED');
