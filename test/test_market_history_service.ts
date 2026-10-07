import assert from 'node:assert/strict';

const { calculateMarketPeriodStats } = await import('../src/services/marketHistoryService');

const bars = Array.from({ length: 30 }, (_, index) => {
  const timestamp = Date.UTC(2026, 0, 1 + index);
  const open = 100 + index;
  const close = open + 1;
  return {
    symbol: 'EUR/USD',
    timeframe: 'Daily' as const,
    timestamp,
    open,
    high: open + 3,
    low: open - 2,
    close,
    volume: 1000 + index
  };
});

const rolling7 = calculateMarketPeriodStats('EUR/USD', 'ROLLING_7D', bars.slice(-7));
assert.ok(rolling7);
assert.equal(rolling7.symbol, 'EUR/USD');
assert.equal(rolling7.dataPoints, 7);
assert.equal(rolling7.open, 123);
assert.equal(rolling7.close, 130);
assert.equal(rolling7.high, 132);
assert.equal(rolling7.low, 121);
assert.equal(Number(rolling7.returnPct.toFixed(6)), Number((((130 / 123) - 1) * 100).toFixed(6)));
assert.equal(Number(rolling7.rangePct.toFixed(6)), Number((((132 - 121) / 123) * 100).toFixed(6)));
assert.ok(rolling7.volatilityPct !== null);

const short = calculateMarketPeriodStats('EUR/USD', 'ROLLING_7D', bars.slice(-1));
assert.ok(short);
assert.equal(short?.atr14, null);
assert.equal(short?.volatilityPct, null);

const invalid = calculateMarketPeriodStats('EUR/USD', 'ROLLING_7D', []);
assert.equal(invalid, null);

console.log('MARKET HISTORY STATISTICS TEST PASSED');
