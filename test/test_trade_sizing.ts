import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldcrest-sizing-'));
process.env.GOLDCREST_CONFIG_DIR = configDir;
process.env.GOLDCREST_CONFIG_FILE = path.join(configDir, 'system-config.json');

const { updateSystemConfig } = await import('../src/services/configService');
const { calculateForexPipTargets, normalizePriceToInstrumentDigits, sizeForexOrderToMaxTradeValue } = await import('../src/brokers/safety/TradeSizing');
process.env.LIVE_TRADING_ENABLED = 'true';
const { liveTradingGate } = await import('../src/brokers/safety/LiveTradingGate');

const instrument = {
  symbol: 'GBP/USD',
  market: 'FOREX',
  pipSize: 0.0001,
  // cTrader protocol minVolume/stepVolume = 1000 cents => 10.00 base units.
  // The normalized application representation is therefore 10-unit steps.
  minQuantity: 10,
  maxQuantity: 10_000_000,
  stepQuantity: 10,
  digits: 5,
  supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP'],
  baseCurrency: 'GBP',
  quoteCurrency: 'USD'
};

const adapter: any = {
  getAccountCurrencyConversionRate: async () => 1
};

updateSystemConfig({
  maxTradeValueForexUsd: 10_000
});

const forcedFromOne = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  instrument,
  1
);

assert.equal(forcedFromOne.quantity, 10_000);
assert.equal(forcedFromOne.directQuantity, 10_000);
assert.equal(forcedFromOne.adjusted, true);
assert.equal(forcedFromOne.rawMaxQuantity, 10_000);
assert.equal(forcedFromOne.estimatedTradeValueUsd, undefined);
assert.equal(forcedFromOne.quoteToUsdRate, undefined);

updateSystemConfig({
  maxTradeValueForexUsd: 20_000
});

const forcedFromLargeRequest = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  instrument,
  10_000
);

// The configured maximum is used directly as the broker order quantity.
// Price, quote currency and broker step/minimum calculations are not involved.
assert.equal(forcedFromLargeRequest.quantity, 20_000);
assert.equal(forcedFromLargeRequest.directQuantity, 20_000);
assert.equal(forcedFromLargeRequest.adjusted, true);
assert.equal(forcedFromLargeRequest.estimatedTradeValueUsd, undefined);

updateSystemConfig({
  maxTradeValueForexUsd: 100
});

const belowBrokerMinimum = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  instrument,
  1
);

// The configured value is passed directly. Broker minimum/step constraints
// remain authoritative at the actual cTrader execution boundary.
assert.equal(belowBrokerMinimum.quantity, 100);
assert.equal(belowBrokerMinimum.directQuantity, 100);
assert.equal(belowBrokerMinimum.estimatedTradeValueUsd, undefined);

const fineGrainedInstrument = {
  ...instrument,
  minQuantity: 0.01,
  stepQuantity: 0.01
};

updateSystemConfig({
  maxTradeValueForexUsd: 10.22
});

const fractionalQuantity = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  fineGrainedInstrument,
  1
);

// Direct quantity is floored to an integer because cTrader volume is an
// integer protocol field: 10.22 -> 10.
assert.equal(fractionalQuantity.quantity, 10);
assert.ok(Number.isFinite(fractionalQuantity.quantity));
assert.equal(Number.isInteger(fractionalQuantity.quantity), true);
assert.equal(fractionalQuantity.estimatedTradeValueUsd, undefined);

// XAU volume rule: the configured Forex volume is divided by 1000 for any
// Forex symbol containing XAU. This must be enforced by the common sizing
// function so Auto Live and Trigger Now produce the same broker quantity.
updateSystemConfig({
  maxTradeValueForexUsd: 1000
});

const xauSizing = await sizeForexOrderToMaxTradeValue(
  adapter,
  'XAU/USD',
  2650.123,
  instrument,
  1
);

assert.equal(xauSizing.quantity, 1);
assert.equal(xauSizing.directQuantity, 1);
assert.equal(xauSizing.rawMaxQuantity, 1);
assert.equal(xauSizing.maxTradeValueUsd, 1000);

const xauReverseSizing = await sizeForexOrderToMaxTradeValue(
  adapter,
  'USD/XAU',
  0.000377,
  instrument,
  1
);

assert.equal(xauReverseSizing.quantity, 1);
assert.equal(xauReverseSizing.directQuantity, 1);

// Goldcrest-wide price precision policy: every symbol is normalized to three
// decimal places, regardless of broker-reported symbol precision.
assert.equal(normalizePriceToInstrumentDigits(157.71077, 3), 157.711);
assert.equal(normalizePriceToInstrumentDigits(157.7104, 3), 157.71);
assert.equal(normalizePriceToInstrumentDigits(1.123456, 5), 1.123);
assert.equal(normalizePriceToInstrumentDigits(1.1239, 5), 1.124);
assert.equal(normalizePriceToInstrumentDigits(210.70722, 3), 210.707);

// Configurable Forex pip-margin regression tests.
const gbpUsdBuyTargets = calculateForexPipTargets('BUY', 1.234, 0.0001, 20, 40);
assert.equal(gbpUsdBuyTargets.stopLoss, 1.232);
assert.equal(gbpUsdBuyTargets.takeProfit, 1.238);

const gbpUsdSellTargets = calculateForexPipTargets('SELL', 1.234, 0.0001, 20, 40);
assert.equal(gbpUsdSellTargets.stopLoss, 1.236);
assert.equal(gbpUsdSellTargets.takeProfit, 1.23);

const usdJpyBuyTargets = calculateForexPipTargets('BUY', 157.650, 0.01, 20, 40);
assert.equal(usdJpyBuyTargets.stopLoss, 157.45);
assert.equal(usdJpyBuyTargets.takeProfit, 158.05);

const usdJpySellTargets = calculateForexPipTargets('SELL', 157.650, 0.01, 20, 40);
assert.equal(usdJpySellTargets.stopLoss, 157.85);
assert.equal(usdJpySellTargets.takeProfit, 157.25);

console.log('Trade sizing tests passed.');

updateSystemConfig({
  maxTradeValueForexUsd: 200,
  maxTradeValueIndianInr: 1_000_000
});

const gateAdapter: any = {
  broker: 'CTRADER',
  environment: 'LIVE',
  isLive: true,
  getTradingStatus: async () => 'CONNECTED',
  getAccount: async () => ({
    accountId: 'test',
    accountType: 'LIVE',
    balance: 1000,
    equity: 1000,
    availableMargin: 1000,
    usedMargin: 0,
    freeMargin: 1000,
    currency: 'USD',
    broker: 'CTRADER',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    permissions: ['READ', 'TRADE', 'TRADING'],
    lastUpdate: Date.now()
  }),
  getInstrument: async () => instrument,
  getPositions: async () => [],
  getAccountCurrencyConversionRate: async () => 1
};

const boundaryQuote = {
  symbol: 'GBP/USD',
  bid: 1,
  ask: 1,
  spread: 0,
  timestamp: Date.now(),
  source: 'test',
  environment: 'LIVE',
  status: 'FRESH'
};

const exactBoundary = await liveTradingGate.evaluate(gateAdapter, {
  order: {
    market: 'FOREX',
    symbol: 'GBP/USD',
    side: 'BUY',
    orderType: 'MARKET',
    quantity: 200,
    price: 1.0000000000000002,
    stopLoss: 0.99
  },
  signalAgeMs: 1000,
  currentQuote: boundaryQuote,
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 1000,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});

assert.equal(exactBoundary.checks.maxExposureNotExceeded, true);
assert.equal(exactBoundary.checks.maximumTradeValueCheckPassed, true);

// Condition 13B regression: it must use the broker's authoritative CURRENT
// position count, not the stale caller snapshot. A USD/CAD order can be
// blocked by the account-wide limit even when USD/CAD itself has zero positions.
const fivePositionAdapter: any = {
  ...gateAdapter,
  getPositions: async () => [
    { symbol: 'EUR/GBP' },
    { symbol: 'NZD/USD' },
    { symbol: 'USD/CHF' },
    { symbol: 'AUD/JPY' },
    { symbol: 'EUR/AUD' }
  ]
};

const staleCallerCount = await liveTradingGate.evaluate(fivePositionAdapter, {
  order: {
    market: 'FOREX',
    symbol: 'USD/CAD',
    side: 'BUY',
    orderType: 'MARKET',
    quantity: 200,
    price: 1,
    stopLoss: 0.99
  },
  signalAgeMs: 1000,
  currentQuote: boundaryQuote,
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 0,
  maxAllowedExposure: 1000,
  // Deliberately stale: broker actually has 5 current positions.
  activePositionsCount: 0,
  maxOpenPositions: 5,
  activePairPositionsCount: 0,
  maxPairPositions: 5
});

assert.equal(staleCallerCount.checks.maxExposureNotExceeded, true);
assert.equal(staleCallerCount.checks.duplicatePositionCheckPassed, true);
assert.equal(staleCallerCount.checks.maxOpenPositionsCheckPassed, false);
assert.ok(
  staleCallerCount.failedReasons.some(
    reason => reason.includes('Condition 13B Failed') && reason.includes('Current account positions: 5')
  )
);

const realExposureOverage = await liveTradingGate.evaluate(gateAdapter, {
  order: {
    market: 'FOREX',
    symbol: 'GBP/USD',
    side: 'BUY',
    orderType: 'MARKET',
    quantity: 200,
    price: 1,
    stopLoss: 0.99
  },
  signalAgeMs: 1000,
  currentQuote: boundaryQuote,
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 1000.0001,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});

// Condition 12 is intentionally disabled while the exposure root cause is investigated.
// Exposure overage must therefore not reject the order or mark the gate check failed.
assert.equal(realExposureOverage.checks.maxExposureNotExceeded, true);
assert.equal(realExposureOverage.failedReasons.some(reason => reason.includes('Condition 12 Failed')), false);

const realTradeOverage = await liveTradingGate.evaluate(gateAdapter, {
  order: {
    market: 'FOREX',
    symbol: 'GBP/USD',
    side: 'BUY',
    orderType: 'MARKET',
    quantity: 200.000001,
    price: 1,
    stopLoss: 0.99
  },
  signalAgeMs: 1000,
  currentQuote: boundaryQuote,
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 10,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});

assert.equal(realTradeOverage.checks.maximumTradeValueCheckPassed, false);
assert.ok(realTradeOverage.failedReasons.some(reason => reason.includes('Condition 16 Failed')));


// Live quote freshness regression: the gate must accept a 29.9s-old quote
// and reject a quote older than the fixed 30s policy. No caller override exists.
const quoteAt = Date.now() - 29_900;
const freshAt20s = await liveTradingGate.evaluate(gateAdapter, {
  order: { market: 'FOREX', symbol: 'GBP/USD', side: 'BUY', orderType: 'MARKET', quantity: 1, price: 1, stopLoss: 0.99 },
  signalAgeMs: 1000,
  currentQuote: { ...boundaryQuote, timestamp: quoteAt },
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 0,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});
assert.equal(freshAt20s.checks.marketDataFresh, true);

const staleAt20s = await liveTradingGate.evaluate(gateAdapter, {
  order: { market: 'FOREX', symbol: 'GBP/USD', side: 'BUY', orderType: 'MARKET', quantity: 1, price: 1, stopLoss: 0.99 },
  signalAgeMs: 1000,
  currentQuote: { ...boundaryQuote, timestamp: Date.now() - 30_100 },
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 0,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});
assert.equal(staleAt20s.checks.marketDataFresh, false);
assert.ok(staleAt20s.failedReasons.some(reason => reason.includes('>30s old')));
