import assert from 'node:assert/strict';
import { executeRun } from '../src/database/db';
import { getLiveTradeResearchAnalytics } from '../src/services/liveTradeResearchAnalyticsService';

const prefix = 'analytics-test-';
const now = Date.now();

await executeRun('DELETE FROM live_trade_research WHERE signal_id LIKE ?', [prefix + '%']);

const rows = [
  {
    id: prefix + '1', symbol: 'EUR/USD', direction: 'BUY', score: 84,
    regime: 'TRENDING', session: 'LONDON', pnl: 100, outcome: 'WIN',
    duration: 60000, mfe: 120, mae: -20, news: JSON.stringify({ status: 'OK', highImpactCount: 0 }),
    context: JSON.stringify({ marketTrend: { direction: 'BULLISH', horizon: { days7: { returnPct: 1 }, days30: { returnPct: 2 }, days90: { returnPct: 3 }, days365: { returnPct: 4 } } } })
  },
  {
    id: prefix + '2', symbol: 'EUR/USD', direction: 'BUY', score: 72,
    regime: 'RANGE', session: 'NEW_YORK', pnl: -40, outcome: 'LOSS',
    duration: 120000, mfe: 15, mae: -55, news: JSON.stringify({ status: 'OK', activeHighImpactCount: 1 }),
    context: JSON.stringify({ marketTrend: { direction: 'BEARISH', horizon: { days7: { returnPct: -1 }, days30: { returnPct: -2 }, days90: { returnPct: -3 }, days365: { returnPct: -4 } } } })
  },
  {
    id: prefix + '3', symbol: 'GBP/USD', direction: 'SELL', score: 66,
    regime: 'TRENDING', session: 'LONDON', pnl: 60, outcome: 'WIN',
    duration: 180000, mfe: 80, mae: -10, news: JSON.stringify({ status: 'OK', highImpactCount: 1 }),
    context: JSON.stringify({ marketTrend: { direction: 'MIXED', horizon: { days7: { returnPct: 1 }, days30: { returnPct: -1 }, days90: { returnPct: 0 }, days365: { returnPct: 2 } } } })
  },
  {
    id: prefix + '4', symbol: 'USD/JPY', direction: 'BUY', score: 58,
    regime: 'RANGE', session: 'ASIA', pnl: 0, outcome: 'BREAKEVEN',
    duration: 90000, mfe: 5, mae: -5, news: JSON.stringify({ status: 'UNAVAILABLE' }),
    context: JSON.stringify({ marketTrend: { direction: 'INSUFFICIENT_DATA', horizon: {} } })
  }
];

for (const row of rows) {
  await executeRun(
    `INSERT INTO live_trade_research (
      signal_id, symbol, broker, environment, signal_timestamp, captured_at,
      direction, signal_category, score, score_breakdown_json,
      strategy_version, model_version, market_regime, session, data_status,
      reasons_json, no_trade_reasons_json, context_json,
      lifecycle_status, realized_pnl, outcome, holding_duration_ms,
      mfe_pnl, mae_pnl, news_status, news_json, updated_at
    ) VALUES (?, ?, 'CTRADER', 'LIVE', ?, ?, ?, 'TEST', ?, '{}',
      'TEST', 'TEST', ?, ?, 'OK', '[]', '[]', ?, 'CLOSED', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.symbol, now, now, row.direction, row.score, row.regime, row.session,
      row.context, row.pnl, row.outcome, row.duration, row.mfe, row.mae,
      JSON.parse(row.news).status || null, row.news, now
    ]
  );
}

const analytics = await getLiveTradeResearchAnalytics({
  fromTimestamp: now - 1000,
  toTimestamp: now + 1000
});

assert.equal(analytics.overall.trades, 4);
assert.equal(analytics.overall.wins, 2);
assert.equal(analytics.overall.losses, 1);
assert.equal(analytics.overall.breakeven, 1);
assert.equal(analytics.overall.netPnl, 120);
assert.equal(analytics.overall.grossProfit, 160);
assert.equal(analytics.overall.grossLoss, -40);
assert.equal(analytics.overall.profitFactor, 4);
assert.equal(analytics.overall.winRatePct, 50);
assert.equal(analytics.dataCoverage.closedTrades, 4);
assert.ok(analytics.bySymbol.some(group => group.key === 'EUR/USD' && group.performance.trades === 2));
assert.ok(analytics.byScoreBand.some(group => group.key === '>80' && group.performance.wins === 1));
assert.ok(analytics.byMarketRegime.some(group => group.key === 'TRENDING' && group.performance.trades === 2));
assert.ok(analytics.byNewsImpact.some(group => group.key === 'ACTIVE_HIGH_IMPACT' && group.performance.losses === 1));
assert.ok(analytics.byTrendAlignment.some(group => group.key === 'ALIGNED' && group.performance.wins === 1));
assert.ok(analytics.byTrendAlignment.some(group => group.key === 'CONTRARY' && group.performance.losses === 1));
assert.ok(analytics.byTrendAlignment.some(group => group.key === 'MIXED' && group.performance.wins === 1));
assert.ok(analytics.byTrendHorizon.some(group => group.key === 'ALL_POSITIVE' && group.performance.wins === 1));
assert.ok(analytics.byTrendHorizon.some(group => group.key === 'ALL_NEGATIVE' && group.performance.losses === 1));

await executeRun('DELETE FROM live_trade_research WHERE signal_id LIKE ?', [prefix + '%']);

console.log('LIVE TRADE RESEARCH ANALYTICS TEST PASSED');
