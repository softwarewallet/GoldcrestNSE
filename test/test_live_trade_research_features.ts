import assert from 'node:assert/strict';
import { executeQuery, executeRun } from '../src/database/db';
import {
  getLiveTradeResearchFeatures,
  materializeLiveTradeResearchFeatures
} from '../src/services/liveTradeResearchFeatureService';

const prefix = 'feature-test-';
const signalId = prefix + '1';
const now = Date.now();

await executeRun('DELETE FROM live_trade_research WHERE signal_id LIKE ?', [prefix + '%']);
await executeRun('DELETE FROM live_trade_research_features WHERE signal_id LIKE ?', [prefix + '%']).catch(() => undefined);

await executeRun(
  `INSERT INTO live_trade_research (
    signal_id, symbol, broker, environment, signal_timestamp, captured_at,
    direction, signal_category, score, score_breakdown_json,
    strategy_version, model_version, market_regime, session, data_status,
    entry_min, entry_max, entry_preferred, entry_type,
    stop_loss, take_profit_1, take_profit_2, take_profit_3, risk_reward,
    quote_bid, quote_ask, quote_spread, quote_timestamp, quote_status,
    news_status, news_source, news_json,
    reasons_json, no_trade_reasons_json, context_json,
    lifecycle_status, realized_pnl, outcome, holding_duration_ms, updated_at
  ) VALUES (
    ?, 'EUR/USD', 'CTRADER', 'LIVE', ?, ?, 'BUY', 'TEST', 84, '{}',
    'TEST', 'TEST', 'TRENDING', 'LONDON', 'LIVE',
    1.1000, 1.1010, 1.1005, 'MARKET',
    1.0990, 1.1030, 1.1050, 1.1070, 2.5,
    1.1004, 1.1005, 0.0001, ?, 'FRESH',
    'OK', 'TEST',
    ?, '[]', '[]', ?, 'CLOSED', -12.5, 'LOSS', 90000, ?
  )`,
  [
    signalId,
    now,
    now,
    now,
    JSON.stringify({
      riskLevel: 'ELEVATED',
      highImpactCount: 2,
      activeHighImpactCount: 1,
      sentimentSummary: { score: -0.35 }
    }),
    JSON.stringify({
      marketTrend: {
        direction: 'BULLISH',
        horizon: {
          days7: { returnPct: 1.2, volatilityPct: 8.1 },
          days30: { returnPct: 3.4, volatilityPct: 10.2 },
          days90: { returnPct: 5.6, volatilityPct: 12.3 },
          days365: { returnPct: 8.9, volatilityPct: 15.4 }
        }
      }
    }),
    now
  ]
);

const features = await getLiveTradeResearchFeatures({
  fromTimestamp: now - 1000,
  toTimestamp: now + 1000,
  closedOnly: true,
  limit: 10
});

assert.equal(features.length, 1);
const row = features[0];

assert.equal(row.signalId, signalId);
assert.equal(row.symbol, 'EUR/USD');
assert.equal(row.direction, 'BUY');
assert.equal(row.score, 84);
assert.equal(row.marketRegime, 'TRENDING');
assert.equal(row.session, 'LONDON');
assert.equal(row.trendDirection, 'BULLISH');
assert.equal(row.trendAlignment, 'ALIGNED');

assert.equal(row.trend7dReturnPct, 1.2);
assert.equal(row.trend30dReturnPct, 3.4);
assert.equal(row.trend90dReturnPct, 5.6);
assert.equal(row.trend365dReturnPct, 8.9);
assert.equal(row.trend7dVolatilityPct, 8.1);
assert.equal(row.trend30dVolatilityPct, 10.2);
assert.equal(row.trend90dVolatilityPct, 12.3);
assert.equal(row.trend365dVolatilityPct, 15.4);

assert.equal(row.newsRiskLevel, 'ELEVATED');
assert.equal(row.newsHighImpactCount, 2);
assert.equal(row.newsActiveHighImpactCount, 1);
assert.equal(row.newsSentiment, -0.35);
assert.equal(row.quoteSpread, 0.0001);
assert.equal(row.riskReward, 2.5);
assert.ok(Math.abs((row.stopDistance ?? 0) - 0.0015) < 1e-12);
assert.ok(Math.abs((row.targetDistance ?? 0) - 0.0025) < 1e-12);
assert.equal(row.realizedPnl, -12.5);
assert.equal(row.outcome, 'LOSS');
assert.equal(row.holdingDurationMs, 90000);

const openSignalId = prefix + 'open';
await executeRun(
  `INSERT INTO live_trade_research (
    signal_id, symbol, broker, environment, signal_timestamp, captured_at,
    direction, signal_category, score, score_breakdown_json,
    strategy_version, model_version, market_regime, session, data_status,
    reasons_json, no_trade_reasons_json, context_json,
    lifecycle_status, updated_at
  ) VALUES (?, 'GBP/USD', 'CTRADER', 'LIVE', ?, ?, 'SELL', 'TEST', 72, '{}',
    'TEST', 'TEST', 'RANGE', 'ASIA', 'LIVE', '[]', '[]', ?, 'OPEN', ?)`,
  [
    openSignalId,
    now,
    now,
    JSON.stringify({ marketTrend: { direction: 'BEARISH', horizon: {} } }),
    now
  ]
);

const closedOnlyFeatures = await getLiveTradeResearchFeatures({
  fromTimestamp: now - 1000,
  toTimestamp: now + 1000,
  closedOnly: true
});
assert.equal(closedOnlyFeatures.some(item => item.signalId === openSignalId), false);

const allFeatures = await getLiveTradeResearchFeatures({
  fromTimestamp: now - 1000,
  toTimestamp: now + 1000,
  closedOnly: false
});
assert.equal(allFeatures.some(item => item.signalId === openSignalId), true);

const materialized = await materializeLiveTradeResearchFeatures({
  fromTimestamp: now - 1000,
  toTimestamp: now + 1000
});
assert.equal(materialized.rowsProcessed, 1);
assert.ok(materialized.updatedAt > 0);

const materializedRows = await executeQuery<any>(
  'SELECT * FROM live_trade_research_features WHERE signal_id = ?',
  [signalId]
);
assert.equal(materializedRows.length, 1);
assert.equal(materializedRows[0].symbol, 'EUR/USD');
assert.equal(Number(materializedRows[0].score), 84);
assert.equal(materializedRows[0].trend_direction, 'BULLISH');
assert.equal(materializedRows[0].trend_alignment, 'ALIGNED');
assert.equal(Number(materializedRows[0].news_high_impact_count), 2);
assert.equal(Number(materializedRows[0].realized_pnl), -12.5);

const materializedAgain = await materializeLiveTradeResearchFeatures({
  fromTimestamp: now - 1000,
  toTimestamp: now + 1000
});
assert.equal(materializedAgain.rowsProcessed, 1);

const duplicateRows = await executeQuery<any>(
  'SELECT * FROM live_trade_research_features WHERE signal_id = ?',
  [signalId]
);
assert.equal(duplicateRows.length, 1);

await executeRun('DELETE FROM live_trade_research WHERE signal_id LIKE ?', [prefix + '%']);
await executeRun('DELETE FROM live_trade_research_features WHERE signal_id LIKE ?', [prefix + '%']);

console.log('LIVE TRADE RESEARCH FEATURES TEST PASSED');
