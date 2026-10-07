import assert from 'node:assert/strict';
import { resolveLivePositionPrice } from '../src/brokers/adapters/cTrader/CTraderBrokerAdapter';

const buy = resolveLivePositionPrice('BUY', {
  status: 'FRESH',
  bid: 157.123,
  ask: 157.128
});
assert.equal(buy.currentPrice, 157.123);
assert.equal(buy.currentPriceStatus, 'LIVE');

const sell = resolveLivePositionPrice('SELL', {
  status: 'FRESH',
  bid: 157.123,
  ask: 157.128
});
assert.equal(sell.currentPrice, 157.128);
assert.equal(sell.currentPriceStatus, 'LIVE');

const stale = resolveLivePositionPrice('BUY', {
  status: 'STALE',
  bid: 157.123,
  ask: 157.128
});
assert.equal(stale.currentPrice, 0);
assert.equal(stale.currentPriceStatus, 'UNAVAILABLE');

const invalid = resolveLivePositionPrice('SELL', {
  status: 'FRESH',
  bid: 0,
  ask: Number.NaN
});
assert.equal(invalid.currentPrice, 0);
assert.equal(invalid.currentPriceStatus, 'UNAVAILABLE');

console.log('LIVE POSITION PRICE CONTRACT TESTS PASSED');
