import assert from 'node:assert/strict';
import { evaluateDirectionalRows } from '../src/services/liveTradeResearchEvaluationService';
import type { ResearchTrainingRow } from '../src/services/liveTradeResearchTrainingService';

function row(id: string, timestamp: number, direction: string, actual: 'UP' | 'DOWN'): ResearchTrainingRow {
  return {
    signalId: id,
    symbol: 'EUR/USD',
    signalTimestamp: timestamp,
    direction,
    score: 80,
    marketRegime: 'TRENDING',
    session: 'LONDON',
    trendDirection: 'BULLISH',
    trendAlignment: 'ALIGNED',
    trend7dReturnPct: 1,
    trend30dReturnPct: 2,
    trend90dReturnPct: 3,
    trend365dReturnPct: 4,
    trend7dVolatilityPct: 5,
    trend30dVolatilityPct: 6,
    trend90dVolatilityPct: 7,
    trend365dVolatilityPct: 8,
    newsRiskLevel: 'LOW',
    newsHighImpactCount: 0,
    newsActiveHighImpactCount: 0,
    newsSentiment: 0.2,
    quoteSpread: 0.0001,
    riskReward: 2,
    stopDistance: 0.002,
    targetDistance: 0.004,
    realizedPnl: 10,
    outcome: 'WIN',
    holdingDurationMs: 60000,
    label1dReturnPct: actual === 'UP' ? 1 : -1,
    label3dReturnPct: actual === 'UP' ? 2 : -2,
    label7dReturnPct: actual === 'UP' ? 3 : -3,
    label1dDirection: actual,
    label3dDirection: actual,
    label7dDirection: actual
  };
}

const rows = [
  row('1', 1, 'BUY', 'UP'),
  row('2', 2, 'BUY', 'DOWN'),
  row('3', 3, 'SELL', 'DOWN'),
  row('4', 4, 'SELL', 'UP')
];

const metrics = evaluateDirectionalRows(rows, '1D');
assert.equal(metrics.samples, 4);
assert.equal(metrics.correct, 2);
assert.equal(metrics.accuracyPct, 50);
assert.equal(metrics.precisionPct, 50);
assert.equal(metrics.recallPct, 50);
assert.equal(metrics.f1Pct, 50);
assert.deepEqual(metrics.confusion, {
  trueUpPredictedUp: 1,
  trueUpPredictedDown: 1,
  trueDownPredictedUp: 1,
  trueDownPredictedDown: 1
});
assert.equal(metrics.majorityClassAccuracyPct, 50);

console.log('LIVE TRADE RESEARCH EVALUATION TEST PASSED');
