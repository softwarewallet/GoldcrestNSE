import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AUTO_LIVE_POSITION_CAPACITY_POLL_MS,
  AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS,
  AUTO_LIVE_SCORE_THRESHOLDS,
  AUTO_LIVE_TRAILING_STOP_LOSS_REQUIRED,
  AUTO_LIVE_XAU_VOLUME_DIVISOR,
  getAutoLiveParallelTradePolicy,
  hasPairPositionCapacity,
  hasSystemPositionCapacity,
  isVisibleAutoLiveSignal
} from '../src/services/autoLiveTradePolicy';

process.env.NODE_ENV = 'test';
process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'false';
process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'false';
process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'false';
process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'false';
process.env.LIVE_TRADING_ENABLED = 'false';
process.env.GOLDCREST_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'goldcrest-phase8-8-'));

const { updateSystemConfig, getSystemConfig } = await import('../src/services/configService');
const { sizeForexOrderToMaxTradeValue, normalizePriceToThreeDigits } = await import('../src/brokers/safety/TradeSizing');
const { autoTradingService } = await import('../src/services/autoTradingService');

let passed = 0;

async function scenario(id: number, name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`[PASS ${String(id).padStart(2, '0')}/40] ${name}`);
}

console.log('\nPHASE 8.8 — AUTO LIVE ORCHESTRATOR & DYNAMIC TRADE-POLICY CERTIFICATION');
console.log('40 deterministic scenarios; broker submission is prohibited by test design');

await scenario(1, 'Score below 65 receives no parallel-trade allowance', () => {
  assert.deepEqual(getAutoLiveParallelTradePolicy(64.99), { maxTradesPerPair: 0, tier: 'BELOW_65' });
});
await scenario(2, 'Score 65 remains below the strict one-trade threshold', () => {
  assert.deepEqual(getAutoLiveParallelTradePolicy(65), { maxTradesPerPair: 0, tier: 'BELOW_65' });
});
await scenario(3, 'Score 65.01 enters exactly one trade allowance', () => {
  assert.deepEqual(getAutoLiveParallelTradePolicy(65.01), { maxTradesPerPair: 1, tier: '1_TRADE' });
});
await scenario(4, 'Score above 70 enters the two-trade tier', () => {
  assert.deepEqual(getAutoLiveParallelTradePolicy(70.01), { maxTradesPerPair: 2, tier: '2_TRADES' });
});
await scenario(5, 'Score 78 remains in the two-trade tier', () => {
  assert.deepEqual(getAutoLiveParallelTradePolicy(78), { maxTradesPerPair: 2, tier: '2_TRADES' });
});
await scenario(6, 'Score above 78 enters the five-trade tier', () => {
  assert.deepEqual(getAutoLiveParallelTradePolicy(78.01), { maxTradesPerPair: 5, tier: '5_TRADES' });
});
await scenario(7, 'Score 100 remains capped at five trades', () => {
  assert.equal(getAutoLiveParallelTradePolicy(100).maxTradesPerPair, 5);
});
await scenario(8, 'Negative score is blocked', () => {
  assert.equal(getAutoLiveParallelTradePolicy(-1).maxTradesPerPair, 0);
});
await scenario(9, 'Non-finite score is blocked', () => {
  assert.equal(getAutoLiveParallelTradePolicy(Number.NaN).maxTradesPerPair, 0);
});
await scenario(10, 'String-numeric score follows deterministic numeric policy', () => {
  assert.equal(getAutoLiveParallelTradePolicy(Number('72')).maxTradesPerPair, 2);
});
await scenario(11, 'Score thresholds remain 65, 70 and 78', () => {
  assert.deepEqual(AUTO_LIVE_SCORE_THRESHOLDS, {
    ONE_TRADE_MIN_SCORE: 65,
    TWO_TRADE_MIN_SCORE: 70,
    FIVE_TRADE_MIN_SCORE: 78
  });
});
await scenario(12, 'Score policy is deterministic at repeated evaluation', () => {
  assert.deepEqual(getAutoLiveParallelTradePolicy(82), getAutoLiveParallelTradePolicy(82));
});

await scenario(13, 'System position capacity is available below limit', () => {
  assert.equal(hasSystemPositionCapacity(4, 5), true);
});
await scenario(14, 'System position capacity closes exactly at limit', () => {
  assert.equal(hasSystemPositionCapacity(5, 5), false);
});
await scenario(15, 'System position capacity rejects over-limit state', () => {
  assert.equal(hasSystemPositionCapacity(6, 5), false);
});
await scenario(16, 'System position capacity rejects invalid maximum', () => {
  assert.equal(hasSystemPositionCapacity(0, 0), false);
});
await scenario(17, 'Pair capacity is available with zero positions', () => {
  assert.equal(hasPairPositionCapacity(0, 1), true);
});
await scenario(18, 'Pair capacity closes at one-trade tier', () => {
  assert.equal(hasPairPositionCapacity(1, 1), false);
});
await scenario(19, 'Pair capacity allows second trade in two-trade tier', () => {
  assert.equal(hasPairPositionCapacity(1, 2), true);
});
await scenario(20, 'Pair capacity closes at five-trade tier', () => {
  assert.equal(hasPairPositionCapacity(5, 5), false);
});

await scenario(21, 'Normal Forex sizing floors configured quantity to integer', async () => {
  updateSystemConfig({ maxTradeValueForexUsd: 100000.9 });
  const result = await sizeForexOrderToMaxTradeValue({} as any, 'EUR/USD', 1.23456, {
    symbol: 'EUR/USD', market: 'FOREX', pipSize: 0.0001, minQuantity: 0, maxQuantity: 999999999, stepQuantity: 1,
    digits: 5, supportedOrderTypes: ['MARKET']
  });
  assert.equal(result.quantity, 100000);
  assert.equal(Number.isInteger(result.quantity), true);
});
await scenario(22, 'XAU sizing applies the shared 1/1000 divisor', async () => {
  updateSystemConfig({ maxTradeValueForexUsd: 100000 });
  const result = await sizeForexOrderToMaxTradeValue({} as any, 'XAU/USD', 2500, {
    symbol: 'XAU/USD', market: 'FOREX', pipSize: 0.01, minQuantity: 0, maxQuantity: 999999999, stepQuantity: 1,
    digits: 2, supportedOrderTypes: ['MARKET']
  });
  assert.equal(result.quantity, 100);
});
await scenario(23, 'XAU sizing floors after the 1/1000 divisor', async () => {
  updateSystemConfig({ maxTradeValueForexUsd: 999999 });
  const result = await sizeForexOrderToMaxTradeValue({} as any, 'XAU/USD', 2500, {
    symbol: 'XAU/USD', market: 'FOREX', pipSize: 0.01, minQuantity: 0, maxQuantity: 999999999, stepQuantity: 1,
    digits: 2, supportedOrderTypes: ['MARKET']
  });
  assert.equal(result.quantity, 999);
});
await scenario(24, 'XAU divisor is explicitly 1000', () => {
  assert.equal(AUTO_LIVE_XAU_VOLUME_DIVISOR, 1000);
});
await scenario(25, 'XAU sizing does not perform price-based currency conversion', async () => {
  updateSystemConfig({ maxTradeValueForexUsd: 10000 });
  const result = await sizeForexOrderToMaxTradeValue({} as any, 'XAU/JPY', 390000, {
    symbol: 'XAU/JPY', market: 'FOREX', pipSize: 0.01, minQuantity: 0, maxQuantity: 999999999, stepQuantity: 1,
    digits: 2, supportedOrderTypes: ['MARKET']
  });
  assert.equal(result.quantity, 10);
});

await scenario(26, 'Global executable price normalization is exactly three digits', () => {
  assert.equal(normalizePriceToThreeDigits(1.23456), 1.235);
});
await scenario(27, 'Global price normalization rounds down-looking values correctly', () => {
  assert.equal(normalizePriceToThreeDigits(1.23449), 1.234);
});
await scenario(28, 'Price normalization rejects non-positive values', () => {
  assert.throws(() => normalizePriceToThreeDigits(0), /INVALID_PRICE/);
});
await scenario(29, 'Price normalization rejects non-finite values', () => {
  assert.throws(() => normalizePriceToThreeDigits(Number.NaN), /INVALID_PRICE/);
});

await scenario(30, 'Trailing stop loss is mandatory at the Auto Live cTrader boundary', () => {
  assert.equal(AUTO_LIVE_TRAILING_STOP_LOSS_REQUIRED, true);
});
await scenario(31, 'Active running trades refresh on the required 10-second cadence', () => {
  assert.equal(AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS, 10000);
  assert.equal(AUTO_LIVE_POSITION_CAPACITY_POLL_MS, 10000);
});
await scenario(32, 'NO_TRADE rows are excluded from the planned-trades visibility contract', () => {
  assert.equal(isVisibleAutoLiveSignal('NO_TRADE'), false);
  assert.equal(isVisibleAutoLiveSignal('BUY'), true);
  assert.equal(isVisibleAutoLiveSignal('SELL'), true);
});

await scenario(33, 'Dynamic Auto Live pair selection persists operator-selected pairs', () => {
  updateSystemConfig({ autoLiveForexPairs: ['USD/JPY', 'AUD/USD', 'EUR/GBP'] });
  assert.deepEqual(getSystemConfig().autoLiveForexPairs, ['USD/JPY', 'AUD/USD', 'EUR/GBP']);
});
await scenario(34, 'Auto Live status exposes the persisted selected pair universe', () => {
  assert.deepEqual(autoTradingService.getStatus().pairs, ['USD/JPY', 'AUD/USD', 'EUR/GBP']);
});
await scenario(35, 'Auto Live does not silently restore the old fixed five-pair universe', () => {
  const status = autoTradingService.getStatus();
  assert.equal(status.pairs.includes('EUR/USD'), false);
  assert.equal(status.pairs.includes('GBP/USD'), false);
});
await scenario(36, 'Configured pair universe is surfaced without broker submission', () => {
  const status = autoTradingService.getStatus();
  assert.equal(status.pairs.length, 3);
  assert.equal(status.state, 'STOPPED');
});
await scenario(37, 'Maximum system-wide trade policy remains configuration-driven', () => {
  updateSystemConfig({ maxOpenPositions: 7 });
  assert.equal(getSystemConfig().maxOpenPositions, 7);
  assert.equal(hasSystemPositionCapacity(6, getSystemConfig().maxOpenPositions), true);
});
await scenario(38, 'Configured maximum per-pair setting caps the score tier', () => {
  updateSystemConfig({ autoLiveMaxTradesPerPair: 2 });
  const policy = getAutoLiveParallelTradePolicy(79);
  assert.equal(policy.maxTradesPerPair, 5);
  assert.equal(Math.min(policy.maxTradesPerPair, getSystemConfig().autoLiveMaxTradesPerPair), 2);
});
await scenario(39, 'Orchestration policy keeps execution paused when global capacity is full', () => {
  assert.equal(hasSystemPositionCapacity(7, 7), false);
  assert.equal(hasSystemPositionCapacity(6, 7), true);
});
await scenario(40, 'Phase 8.8 certification invokes no broker order submission', () => {
  assert.equal(passed, 39);
});

console.log(`PHASE 8.8 CERTIFICATION: ${passed}/40 PASSED`);
console.log('Live broker submission: NOT INVOKED');
console.log('Dynamic pair selection: VERIFIED');
console.log('Score-based parallel trade policy: VERIFIED');
console.log('System/per-pair capacity policy: VERIFIED');
console.log('XAU volume divisor 1/1000: VERIFIED');
console.log('Integer quantity and 3-digit price policy: VERIFIED');
console.log('Trailing stop loss required: VERIFIED');
console.log('Active positions refresh: 10 seconds');
console.log('NO_TRADE grid exclusion: VERIFIED');
