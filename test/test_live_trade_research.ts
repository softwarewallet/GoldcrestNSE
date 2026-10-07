import assert from 'node:assert/strict';
import { executeQuery, executeRun } from '../src/database/db';
import {
  recordLiveTradeResearchSignal,
  updateLiveTradeResearchExecution,
  updateLiveTradeResearchQuote,
  updateLiveTradeResearchMark,
  closeLiveTradeResearchOutcome
} from '../src/services/liveTradeResearchService';

const signalId = 'research_test_signal_20260924';

await executeRun('DELETE FROM live_trade_research WHERE signal_id = ?', [signalId]);

await recordLiveTradeResearchSignal({
  signalId,
  symbol: 'EUR/USD',
  timestamp: Date.now(),
  direction: 'BUY',
  signalCategory: 'BUY',
  score: 82,
  scoreBreakdown: { trend: 18, momentum: 12, totalScore: 82 },
  strategyVersion: 'fx_structure_v2a',
  modelVersion: 'baseline',
  marketRegime: 'TRENDING',
  session: 'LONDON',
  dataStatus: 'LIVE',
  tradePlan: {
    entryMin: 1.1,
    entryMax: 1.101,
    entryPreferred: 1.1005,
    entryType: 'PULLBACK_ENTRY',
    stopLoss: 1.099,
    takeProfit1: 1.103,
    takeProfit2: 1.105,
    takeProfit3: 1.107,
    riskReward: 2.0
  },
  reasons: ['Test research record'],
  noTradeReasons: [],
  news: null,
  context: { test: true }
});

await updateLiveTradeResearchQuote({
  signalId,
  quote: {
    bid: 1.1004,
    ask: 1.1005,
    spread: 0.0001,
    timestamp: Date.now(),
    status: 'FRESH'
  },
  requestedRiskQuantity: 1234,
  configuredQuantity: 1000
});

await updateLiveTradeResearchExecution({
  signalId,
  status: 'FILLED',
  code: undefined,
  reason: undefined,
  brokerOrderId: 'test-order-1',
  brokerPositionId: 'test-position-1',
  executedEntryPrice: 1.1005,
  executedQuantity: 1000,
  commission: 0.25,
  brokerStatus: 'FILLED'
});

const rows = await executeQuery<any>(
  'SELECT * FROM live_trade_research WHERE signal_id = ?',
  [signalId]
);

assert.equal(rows.length, 1);
assert.equal(rows[0].lifecycle_status, 'OPEN');
assert.equal(rows[0].direction, 'BUY');
assert.equal(Number(rows[0].score), 82);
assert.equal(Number(rows[0].quote_ask), 1.1005);
assert.equal(Number(rows[0].executed_quantity), 1000);
assert.equal(rows[0].broker_order_id, 'test-order-1');
assert.equal(rows[0].broker_position_id, 'test-position-1');

await updateLiveTradeResearchMark({
  signalId,
  currentPnl: 12.5,
  currentPrice: 1.10175
});
await updateLiveTradeResearchMark({
  signalId,
  currentPnl: -4.25,
  currentPrice: 1.10008
});

await closeLiveTradeResearchOutcome({
  signalId,
  exitPrice: 1.0995,
  exitTimestamp: Date.now(),
  realizedPnl: -3.75,
  commission: 0.25
});

const closedRows = await executeQuery<any>(
  'SELECT * FROM live_trade_research WHERE signal_id = ?',
  [signalId]
);
assert.equal(closedRows[0].lifecycle_status, 'CLOSED');
assert.equal(Number(closedRows[0].realized_pnl), -3.75);
assert.equal(Number(closedRows[0].exit_price), 1.0995);
assert.equal(closedRows[0].outcome, 'LOSS');
assert.equal(Number(closedRows[0].mfe_pnl), 12.5);
assert.equal(Number(closedRows[0].mae_pnl), -4.25);
assert.ok(Number(closedRows[0].holding_duration_ms) >= 0);


await executeRun('DELETE FROM live_trade_research WHERE signal_id = ?', [signalId]);

console.log('LIVE TRADE RESEARCH TEST PASSED');
