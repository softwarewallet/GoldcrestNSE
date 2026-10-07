import assert from 'node:assert/strict';
import { CTraderBrokerAdapter, CTraderConfig } from '../src/brokers/adapters/cTrader/CTraderBrokerAdapter';
import { BrokerAccountInfo } from '../src/brokers/types';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';

class DiagnosticCTraderAdapter extends CTraderBrokerAdapter {
  readonly environment = 'LIVE' as const;
  readonly isLive = true;

  constructor(config: CTraderConfig) {
    super(config);
  }

  async getAccount(): Promise<BrokerAccountInfo> {
    return {
      accountId: 'TEST-ACCOUNT',
      accountType: 'LIVE',
      balance: 10000,
      equity: 10000,
      availableMargin: 9000,
      usedMargin: 1000,
      freeMargin: 9000,
      currency: 'USD',
      broker: 'CTRADER',
      environment: 'LIVE',
      connectionStatus: 'CONNECTED',
      permissions: ['READ', 'TRADE', 'TRADING'],
      lastUpdate: Date.now(),
      isLiveAccount: true
    };
  }
}

const previousMode = getSystemConfig().cTraderApiMode;

try {
  const adapter = new DiagnosticCTraderAdapter({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    accessToken: 'test-token',
    accountId: 'TEST-ACCOUNT',
    environment: 'LIVE'
  });

  updateSystemConfig({ cTraderApiMode: 'DEMO' });
  const demo = await adapter.testConnection();
  assert.equal(demo.connected, true);
  assert.equal(demo.apiMode, 'DEMO');
  assert.equal(demo.apiEndpoint, 'wss://demo.ctraderapi.com:5036');

  updateSystemConfig({ cTraderApiMode: 'LIVE' });
  const live = await adapter.testConnection();
  assert.equal(live.connected, true);
  assert.equal(live.apiMode, 'LIVE');
  assert.equal(live.apiEndpoint, 'wss://live.ctraderapi.com:5036');

  console.log('cTrader connection diagnostic mode regression test: PASSED');
} finally {
  updateSystemConfig({ cTraderApiMode: previousMode });
}
