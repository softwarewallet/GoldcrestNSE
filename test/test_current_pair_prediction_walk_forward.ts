import assert from 'node:assert/strict';
import { executeRun } from '../src/database/db';
import { getCurrentPairPredictionWalkForwardAnalytics } from '../src/services/currentPairPredictionOutcomeService';

const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const ids = ['walk-forward-1', 'walk-forward-2', 'walk-forward-3'];

try {
  for (const id of ids) {
    await executeRun('DELETE FROM live_trade_research_predictions WHERE prediction_id = ?', [id]);
  }

  const rows = [
    { id: ids[0], predictedAt: now - 10 * day, direction: 'UP', actual: 'UP' },
    { id: ids[1], predictedAt: now - 40 * day, direction: 'UP', actual: 'DOWN' },
    { id: ids[2], predictedAt: now - 70 * day, direction: 'DOWN', actual: 'DOWN' }
  ];

  for (const row of rows) {
    await executeRun(
      `INSERT INTO live_trade_research_predictions (
        prediction_id, model_version, prediction_source, symbol, signal_id, predicted_at,
        horizon, predicted_direction, confidence, feature_hash, model_agreement, reasoning,
        invalidation, actual_direction, actual_return_pct, outcome_status, evaluated_at,
        created_at, feature_snapshot_json, prediction_context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, 'PAIR_FEATURE_BASELINE_V2', 'LIVE_PAIR_FEATURES', 'EUR/USD', null, row.predictedAt,
        '1D', row.direction, 0.8, row.id, 1, 'walk-forward test', 'test',
        row.actual, row.actual === 'UP' ? 0.5 : -0.5, 'EVALUATED', now, row.predictedAt,
        '{"marketRegime":"TRENDING","session":"LONDON"}', 'CURRENT_PAIR'
      ]
    );
  }

  const analytics = await getCurrentPairPredictionWalkForwardAnalytics({
    symbol: 'EUR/USD',
    modelVersion: 'PAIR_FEATURE_BASELINE_V2',
    horizon: '1D',
    cohortDays: 30,
    maxCohorts: 3
  });

  assert.equal(analytics.total, 3);
  assert.equal(analytics.evaluated, 3);
  assert.equal(analytics.cohortDays, 30);
  assert.equal(analytics.minimumSampleCount, 30);
  assert.equal(analytics.groups.length, 1);
  assert.equal(analytics.groups[0].cohorts.length, 3);

  const cohorts = analytics.groups[0].cohorts;
  assert.deepEqual(cohorts.map(cohort => cohort.cohortIndex), [1, 2, 3]);
  assert.deepEqual(cohorts.map(cohort => cohort.directionalEvaluated), [1, 1, 1]);
  assert.deepEqual(cohorts.map(cohort => cohort.correct), [1, 0, 1]);
  assert.equal(cohorts.every(cohort => cohort.sampleSufficient === false), true);
  assert.ok(cohorts.every(cohort => cohort.accuracyConfidenceInterval95Pct !== null));
  assert.ok(cohorts[0].toTimestamp > cohorts[1].toTimestamp);
  assert.ok(cohorts[1].toTimestamp > cohorts[2].toTimestamp);
} finally {
  for (const id of ids) {
    await executeRun('DELETE FROM live_trade_research_predictions WHERE prediction_id = ?', [id]);
  }
}

console.log('CURRENT PAIR WALK-FORWARD COHORT TEST PASSED');
