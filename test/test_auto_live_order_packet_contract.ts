import assert from 'node:assert/strict';
import { validateAutoLiveOrderPacket } from '../src/brokers/safety/AutoExecutionEngine';

const buy = validateAutoLiveOrderPacket({
  market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', orderType: 'MARKET',
  quantity: 1000, price: 1.123, stopLoss: 1.120, takeProfit: 1.129,
  strategyId: 'fx_structure_v2a', signalId: 'packet-buy'
});
assert.equal(buy.valid, true);

const sell = validateAutoLiveOrderPacket({
  market: 'FOREX', symbol: 'GBP/USD', side: 'SELL', orderType: 'MARKET',
  quantity: 2000, price: 1.280, stopLoss: 1.285, takeProfit: 1.275,
  strategyId: 'fx_structure_v2a', signalId: 'packet-sell'
});
assert.equal(sell.valid, true);

const badDirection = validateAutoLiveOrderPacket({
  market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', orderType: 'MARKET',
  quantity: 1000, price: 1.123, stopLoss: 1.125, takeProfit: 1.129,
  signalId: 'packet-bad-direction'
});
assert.equal(badDirection.valid, false);
assert.match(badDirection.reasons.join(' '), /BUY packet/);

const badQuantity = validateAutoLiveOrderPacket({
  market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', orderType: 'MARKET',
  quantity: 1000.5, price: 1.123, stopLoss: 1.120, takeProfit: 1.129,
  signalId: 'packet-bad-quantity'
});
assert.equal(badQuantity.valid, false);
assert.match(badQuantity.reasons.join(' '), /quantity/);

const badOrderType = validateAutoLiveOrderPacket({
  market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', orderType: 'LIMIT',
  quantity: 1000, price: 1.123, stopLoss: 1.120, takeProfit: 1.129,
  signalId: 'packet-bad-type'
});
assert.equal(badOrderType.valid, false);
assert.match(badOrderType.reasons.join(' '), /MARKET/);

console.log('AUTO LIVE ORDER PACKET CONTRACT TESTS PASSED');
