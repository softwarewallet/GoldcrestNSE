import assert from 'node:assert/strict';
import { CTraderBrokerAdapter } from '../src/brokers/adapters/cTrader/CTraderBrokerAdapter';
import { getCTraderApiMode, updateSystemConfig } from '../src/services/configService';

const prototype = CTraderBrokerAdapter.prototype as any;

let placeOrderCalls = 0;
const liveStub = {
  isLive: true,
  environment: 'LIVE',
  placeOrder: async (order: any) => {
    placeOrderCalls += 1;
    return { status: 'FILLED', id: 'stub-order', ...order };
  }
};

const order = {
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  orderType: 'MARKET',
  quantity: 1000,
  price: 1.123,
  stopLoss: 1.12,
  takeProfit: 1.13,
  signalId: 'test-live-autonomous-order',
  strategyId: 'fx_structure_v2a'
};

const previousApiMode = getCTraderApiMode();

try {
  // The cTrader API selector controls transport/account discovery. It must not
  // disable the guarded Auto Live capability: the application-level broker
  // adapter remains LIVE while the selected cTrader Open API endpoint may be
  // LIVE or DEMO.
  updateSystemConfig({ cTraderApiMode: 'DEMO' });
  assert.equal(getCTraderApiMode(), 'DEMO');

  const result = await prototype.placeAutonomousOrder.call(liveStub, order);
  assert.equal(placeOrderCalls, 1);
  assert.equal(result.status, 'FILLED');
  assert.equal(result.signalId, order.signalId);

  updateSystemConfig({ cTraderApiMode: 'LIVE' });
  assert.equal(getCTraderApiMode(), 'LIVE');

  const liveResult = await prototype.placeAutonomousOrder.call(liveStub, {
    ...order,
    signalId: 'test-live-autonomous-order-live-mode'
  });
  assert.equal(placeOrderCalls, 2);
  assert.equal(liveResult.status, 'FILLED');
} finally {
  updateSystemConfig({ cTraderApiMode: previousApiMode });
}

const demoStub = {
  isLive: false,
  environment: 'DEMO',
  placeOrder: async () => {
    throw new Error('placeOrder must not be called for non-LIVE autonomous execution');
  }
};

await assert.rejects(
  prototype.placeAutonomousOrder.call(demoStub, order),
  /Autonomous execution is available only for cTrader LIVE/
);

console.log('CTRADER AUTONOMOUS ORDER CAPABILITY TEST PASSED');
