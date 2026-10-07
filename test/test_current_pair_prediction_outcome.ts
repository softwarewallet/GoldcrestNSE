import assert from 'node:assert/strict';
import { executeRun, executeQuery } from '../src/database/db';
import { evaluatePendingCurrentPairPredictions, getCurrentPairPredictionAnalytics } from '../src/services/currentPairPredictionOutcomeService';
import { LiveForexProvider } from '../src/markets/forex/provider';

const originalRefresh = LiveForexProvider.prototype.refreshPair;
const originalGetCandles = LiveForexProvider.prototype.getCandles;
const now = Date.now();
const day = 24 * 60 * 60 * 1000;

LiveForexProvider.prototype.refreshPair = async function () {};
LiveForexProvider.prototype.getCandles = function () {
  return [
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now - 9 * day, open: 1.10, high: 1.11, low: 1.09, close: 1.10, bid: 1.10, ask: 1.10, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' },
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now - 8 * day, open: 1.10, high: 1.11, low: 1.10, close: 1.105, bid: 1.105, ask: 1.105, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' },
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now - 7 * day, open: 1.105, high: 1.115, low: 1.104, close: 1.11, bid: 1.11, ask: 1.11, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' },
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now - 6 * day, open: 1.11, high: 1.12, low: 1.109, close: 1.115, bid: 1.115, ask: 1.115, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' },
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now - 5 * day, open: 1.115, high: 1.12, low: 1.114, close: 1.118, bid: 1.118, ask: 1.118, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' },
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now - 4 * day, open: 1.118, high: 1.121, low: 1.117, close: 1.119, bid: 1.119, ask: 1.119, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' },
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now - 3 * day, open: 1.119, high: 1.123, low: 1.118, close: 1.12, bid: 1.12, ask: 1.12, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' },
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now - 2 * day, open: 1.12, high: 1.125, low: 1.119, close: 1.123, bid: 1.123, ask: 1.123, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' },
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now - day, open: 1.123, high: 1.13, low: 1.122, close: 1.126, bid: 1.126, ask: 1.126, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' },
    { pair: 'EUR/USD', timeframe: 'Daily', timestamp: now, open: 1.126, high: 1.13, low: 1.125, close: 1.128, bid: 1.128, ask: 1.128, spread: 0, volume: 1, provider: 'TEST', dataStatus: 'LIVE' }
  ] as any;
};

const predictionId = 'current-outcome-test-1';
try {
  await executeRun("DELETE FROM live_trade_research_predictions WHERE prediction_id = ?", [predictionId]);
  await executeRun(
    `INSERT INTO live_trade_research_predictions (
      prediction_id, model_version, prediction_source, symbol, signal_id, predicted_at,
      horizon, predicted_direction, confidence, feature_hash, model_agreement, reasoning,
      invalidation, actual_direction, actual_return_pct, outcome_status, evaluated_at,
      created_at, feature_snapshot_json, prediction_context
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [predictionId, 'PAIR_FEATURE_BASELINE_V2', 'LIVE_PAIR_FEATURES', 'EUR/USD', null,
      now - 8 * day, '1D', 'UP', 0.9, 'test-hash', 1, 'test', 'test',
      null, null, 'PENDING', null, now - 8 * day, '{"marketRegime":"TRENDING","session":"LONDON"}', 'CURRENT_PAIR']
  );

  const result = await evaluatePendingCurrentPairPredictions({
    symbol: 'EUR/USD',
    modelVersion: 'PAIR_FEATURE_BASELINE_V2',
    horizon: '1D'
  });

  assert.equal(result.evaluated, 1);
  assert.equal(result.pending, 0);
  assert.equal(result.correct, 1);
  assert.equal(result.directionalEvaluated, 1);
  assert.ok(result.brierScore !== null && result.brierScore < 0.05);

  const stored = await executeQuery<any>(
    'SELECT actual_direction, actual_return_pct, outcome_status, evaluated_at FROM live_trade_research_predictions WHERE prediction_id = ?',
    [predictionId]
  );
  assert.equal(stored[0].actual_direction, 'UP');
  assert.equal(stored[0].outcome_status, 'EVALUATED');
  assert.ok(Number(stored[0].actual_return_pct) > 0);
  assert.ok(Number(stored[0].evaluated_at) > 0);

  const analytics = await getCurrentPairPredictionAnalytics({
    symbol: 'EUR/USD',
    modelVersion: 'PAIR_FEATURE_BASELINE_V2',
    horizon: '1D'
  });
  assert.equal(analytics.total, 1);
  assert.equal(analytics.evaluated, 1);
  assert.equal(analytics.groups.length, 1);
  assert.equal(analytics.groups[0].symbol, 'EUR/USD');
  assert.equal(analytics.groups[0].horizon, '1D');
  assert.equal(analytics.groups[0].correct, 1);
  assert.equal(analytics.groups[0].upPredictions, 1);
  assert.equal(analytics.groups[0].downPredictions, 0);
  assert.equal(analytics.groups[0].upActuals, 1);
  assert.equal(analytics.groups[0].downActuals, 0);
  assert.equal(analytics.groups[0].calibration.length, 5);
  assert.equal(analytics.groups[0].calibration[4].predictions, 1);
  assert.equal(analytics.groups[0].calibration[4].correct, 1);
  assert.equal(analytics.groups[0].marketRegime, 'TRENDING');
  assert.equal(analytics.groups[0].session, 'LONDON');
  assert.equal(analytics.groups[0].sampleSufficient, false);
  assert.equal(analytics.groups[0].minimumSampleCount, 30);
  assert.ok(analytics.groups[0].accuracyConfidenceInterval95Pct !== null);
  assert.equal(analytics.groups[0].rollingWindows.length, 2);
  assert.equal(analytics.groups[0].rollingWindows[0].windowDays, 30);
  assert.equal(analytics.groups[0].rollingWindows[0].directionalEvaluated, 1);
  assert.equal(analytics.groups[0].rollingWindows[0].sampleSufficient, false);
  assert.equal(analytics.groups[0].sampleSufficient, false);
  assert.equal(analytics.groups[0].minimumSampleCount, 30);
  assert.ok(analytics.groups[0].accuracyConfidenceInterval95Pct !== null);
  assert.ok((analytics.groups[0].accuracyConfidenceInterval95Pct?.lowerPct || 0) < 100);
  assert.equal(analytics.groups[0].accuracyConfidenceInterval95Pct?.upperPct, 100);
  assert.equal(analytics.groups[0].calibration[4].sampleSufficient, false);
} finally {
  await executeRun("DELETE FROM live_trade_research_predictions WHERE prediction_id = ?", [predictionId]);
  LiveForexProvider.prototype.refreshPair = originalRefresh;
  LiveForexProvider.prototype.getCandles = originalGetCandles;
}

console.log('CURRENT PAIR OUTCOME EVALUATION TEST PASSED');
