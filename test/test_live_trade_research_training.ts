import assert from 'node:assert/strict';
import { executeQuery, executeRun } from '../src/database/db';
import {
  getLiveTradeResearchTrainingDataset,
  materializeLiveTradeResearchTrainingDataset
} from '../src/services/liveTradeResearchTrainingService';

const prefix = 'training-test-';
const signalId = prefix + '1';
const now = Date.now();
const base = now;

await executeRun('DELETE FROM live_trade_research WHERE signal_id LIKE ?', [prefix + '%']);
await executeRun('DELETE FROM live_trade_research_training WHERE signal_id LIKE ?', [prefix + '%']).catch(() => undefined);

await executeRun(
  `INSERT INTO live_trade_research (
    signal_id, symbol, broker, environment, signal_timestamp, captured_at,
    direction, signal_category, score, score_breakdown_json,
    strategy_version, model_version, market_regime, session, data_status,
    entry_preferred, stop_loss, take_profit_1, risk_reward,
    reasons_json, no_trade_reasons_json, context_json,
    lifecycle_status, realized_pnl, outcome, holding_duration_ms, updated_at
  ) VALUES (?, 'EUR/USD', 'CTRADER', 'LIVE', ?, ?, 'BUY', 'TEST', 82, '{}',
    'TEST', 'TEST', 'TRENDING', 'LONDON', 'LIVE',
    1.1000, 1.0980, 1.1040, 2.0,
    '[]', '[]', ?, 'CLOSED', 25, 'WIN', 60000, ?)`,
  [signalId, now, now, JSON.stringify({
    marketTrend: {
      direction: 'BULLISH',
      horizon: {
        days7: { returnPct: 1, volatilityPct: 5 },
        days30: { returnPct: 2, volatilityPct: 7 },
        days90: { returnPct: 4, volatilityPct: 9 },
        days365: { returnPct: 8, volatilityPct: 12 }
      }
    }
  }), now]
);

for (let i = 1; i <= 8; i += 1) {
  await executeRun(
    `INSERT OR REPLACE INTO candles
      (id, symbol, timeframe, timestamp, open, high, low, close, volume, oi, vwap)
     VALUES (?, 'EUR/USD', 'Daily', ?, ?, ?, ?, ?, 1000, NULL, NULL)`,
    [
      prefix + 'candle-' + i,
      base + i * 86_400_000,
      1.1000 + i * 0.001,
      1.1010 + i * 0.001,
      1.0990 + i * 0.001,
      1.1000 + i * 0.001
    ]
  );
}

const rows = await getLiveTradeResearchTrainingDataset({
  fromTimestamp: now - 1000,
  toTimestamp: now + 1000
});
assert.equal(rows.length, 1);
assert.equal(rows[0].signalId, signalId);
assert.equal(rows[0].label1dDirection, 'UP');
assert.equal(rows[0].label3dDirection, 'UP');
assert.equal(rows[0].label7dDirection, 'UP');
assert.ok((rows[0].label1dReturnPct ?? 0) > 0);
assert.ok((rows[0].label7dReturnPct ?? 0) > (rows[0].label1dReturnPct ?? 0));

const materialized = await materializeLiveTradeResearchTrainingDataset({
  fromTimestamp: now - 1000,
  toTimestamp: now + 1000
});
assert.equal(materialized.rowsProcessed, 1);
assert.equal(materialized.labeled1d, 1);
assert.equal(materialized.labeled3d, 1);
assert.equal(materialized.labeled7d, 1);

const stored = await executeQuery<any>(
  'SELECT * FROM live_trade_research_training WHERE signal_id = ?',
  [signalId]
);
assert.equal(stored.length, 1);
assert.equal(stored[0].label_1d_direction, 'UP');
assert.equal(stored[0].label_3d_direction, 'UP');
assert.equal(stored[0].label_7d_direction, 'UP');

await executeRun('DELETE FROM live_trade_research WHERE signal_id LIKE ?', [prefix + '%']);
await executeRun('DELETE FROM live_trade_research_training WHERE signal_id LIKE ?', [prefix + '%']);
await executeRun('DELETE FROM candles WHERE id LIKE ?', [prefix + '%']);

console.log('LIVE TRADE RESEARCH TRAINING DATASET TEST PASSED');
