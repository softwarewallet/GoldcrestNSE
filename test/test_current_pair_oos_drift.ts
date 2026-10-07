import assert from 'node:assert/strict';
import { getDatabase, executeRun } from '../src/database/db';
import { getCurrentPairOosDriftReport } from '../src/services/currentPairOosDriftService';

await getDatabase();
await executeRun('DELETE FROM live_trade_research_predictions');

const now = Date.now();
const insert = async (id: string, timestamp: number, direction: 'UP' | 'DOWN', actual: 'UP' | 'DOWN', confidence: number) => {
  await executeRun(
    `INSERT INTO live_trade_research_predictions (
      prediction_id, model_version, prediction_source, symbol, signal_id, predicted_at,
      horizon, predicted_direction, confidence, feature_hash, model_agreement,
      reasoning, invalidation, actual_direction, actual_return_pct, outcome_status,
      evaluated_at, created_at, feature_snapshot_json, prediction_context
    ) VALUES (?, 'LLAMA_GATEWAY_QWEN_LLAMA_V1', 'TEST', 'EUR/USD', ?, ?, '1D', ?, ?, ?, 1, 'test', null, ?, 1, 'EVALUATED', ?, ?, '{}', 'CURRENT_PAIR')`,
    [id, id, timestamp, direction, confidence, id + '-hash', actual, now, now]
  );
};

for (let i = 0; i < 31; i++) {
  await insert(`old-${i}`, now - 60 * 24 * 60 * 60 * 1000 + i * 1000, 'UP', i < 20 ? 'UP' : 'DOWN', 0.7);
}
for (let i = 0; i < 31; i++) {
  await insert(`new-${i}`, now - 10 * 24 * 60 * 60 * 1000 + i * 1000, 'UP', i < 10 ? 'UP' : 'DOWN', 0.9);
}

const report = await getCurrentPairOosDriftReport({
  symbol: 'EUR/USD',
  horizon: '1D',
  modelVersion: 'LLAMA_GATEWAY_QWEN_LLAMA_V1',
  now
});

assert.equal(report.currentWindow.directionalEvaluated, 31);
assert.equal(report.currentWindow.sampleSufficient, true);
assert.equal(report.baselineWindow.directionalEvaluated, 31);
assert.equal(report.baselineWindow.sampleSufficient, true);
assert.ok(Math.abs((report.currentWindow.averageConfidencePct || 0) - 90) < 1e-9);
assert.ok(Math.abs((report.baselineWindow.averageConfidencePct || 0) - 70) < 1e-9);
assert.equal(report.drift.accuracyDriftFlag, true);
assert.equal(report.drift.confidenceDriftFlag, true);
assert.ok(report.uncertainty.accuracyDelta95Pct);
assert.ok(report.uncertainty.brierDelta95);
assert.ok(report.uncertainty.calibrationErrorDelta95Pct);
assert.ok(report.uncertainty.maximumCalibrationErrorDelta95Pct);
assert.equal(report.uncertainty.accuracyDelta95Pct?.confidenceLevelPct, 95);
assert.equal(report.uncertainty.brierDelta95?.confidenceLevelPct, 95);
assert.equal(report.uncertainty.accuracyDelta95Pct?.resamples, 2000);
assert.equal(report.uncertainty.brierDelta95?.resamples, 2000);
assert.equal(report.uncertainty.calibrationErrorDelta95Pct?.confidenceLevelPct, 95);
assert.equal(report.uncertainty.maximumCalibrationErrorDelta95Pct?.confidenceLevelPct, 95);
assert.equal(report.uncertainty.calibrationErrorDelta95Pct?.resamples, 2000);
assert.equal(report.uncertainty.maximumCalibrationErrorDelta95Pct?.resamples, 2000);
assert.ok((report.uncertainty.accuracyDelta95Pct?.lower ?? 0) <= (report.uncertainty.accuracyDelta95Pct?.upper ?? 0));
assert.ok((report.uncertainty.brierDelta95?.lower ?? 0) <= (report.uncertainty.brierDelta95?.upper ?? 0));
assert.ok((report.uncertainty.calibrationErrorDelta95Pct?.lower ?? 0) <= (report.uncertainty.calibrationErrorDelta95Pct?.upper ?? 0));
assert.ok((report.uncertainty.maximumCalibrationErrorDelta95Pct?.lower ?? 0) <= (report.uncertainty.maximumCalibrationErrorDelta95Pct?.upper ?? 0));
assert.equal(report.currentWindow.calibrationBuckets.length, 5);
assert.equal(report.baselineWindow.calibrationBuckets.length, 5);
const currentHighConfidence = report.currentWindow.calibrationBuckets.find(bucket => bucket.lowerPct === 80);
assert.equal(currentHighConfidence?.predictions, 31);
assert.equal(currentHighConfidence?.directionalEvaluated, 31);
assert.equal(currentHighConfidence?.correct, 10);
assert.ok(currentHighConfidence?.accuracyConfidenceInterval95Pct);
assert.ok(report.currentWindow.expectedCalibrationErrorPct != null);
assert.ok(report.currentWindow.maximumCalibrationErrorPct != null);
assert.ok(report.baselineWindow.expectedCalibrationErrorPct != null);
assert.ok(report.baselineWindow.maximumCalibrationErrorPct != null);
assert.ok(Math.abs((report.currentWindow.expectedCalibrationErrorPct || 0) - Math.abs(90 - (10 / 31) * 100)) < 1e-9);
assert.ok(Math.abs((report.currentWindow.maximumCalibrationErrorPct || 0) - Math.abs(90 - (10 / 31) * 100)) < 1e-9);
assert.ok(Math.abs((report.baselineWindow.expectedCalibrationErrorPct || 0) - Math.abs(70 - (20 / 31) * 100)) < 1e-9);
assert.ok(Math.abs((report.baselineWindow.maximumCalibrationErrorPct || 0) - Math.abs(70 - (20 / 31) * 100)) < 1e-9);
assert.ok(report.drift.calibrationErrorDeltaPct != null);
assert.equal(report.drift.calibrationErrorDriftFlag, true);
assert.equal(currentHighConfidence?.sampleSufficient, true);
const baselineHighConfidence = report.baselineWindow.calibrationBuckets.find(bucket => bucket.lowerPct === 60);
assert.equal(baselineHighConfidence?.predictions, 31);
assert.equal(baselineHighConfidence?.directionalEvaluated, 31);
assert.equal(baselineHighConfidence?.correct, 20);
assert.ok(baselineHighConfidence?.accuracyConfidenceInterval95Pct);
assert.equal(report.checks.find(check => check.id === 'current-sample')?.status, 'PASS');

console.log('CURRENT PAIR OOS DRIFT TEST PASSED');
