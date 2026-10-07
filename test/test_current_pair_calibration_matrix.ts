import assert from 'node:assert/strict';
import { getDatabase, executeRun } from '../src/database/db';
import { getCurrentPairCalibrationMatrix } from '../src/services/currentPairCalibrationMatrixService';

await getDatabase();
await executeRun('DELETE FROM live_trade_research_predictions');

const now = Date.now();
const insert = async (id: string, symbol: string, horizon: string, timestamp: number, actual: 'UP' | 'DOWN', confidence: number) => {
  await executeRun(
    `INSERT INTO live_trade_research_predictions (
      prediction_id, model_version, prediction_source, symbol, signal_id, predicted_at,
      horizon, predicted_direction, confidence, feature_hash, model_agreement,
      reasoning, invalidation, actual_direction, actual_return_pct, outcome_status,
      evaluated_at, created_at, feature_snapshot_json, prediction_context
    ) VALUES (?, 'LLAMA_GATEWAY_QWEN_LLAMA_V1', 'TEST', ?, ?, ?, ?, 'UP', ?, ?, 1, 'test', null, ?, 1, 'EVALUATED', ?, ?, '{}', 'CURRENT_PAIR')`,
    [id, symbol, id, timestamp, horizon, confidence, id + '-hash', actual, now, now]
  );
};

for (let i = 0; i < 30; i++) {
  await insert(`old-eur-${i}`, 'EUR/USD', '1D', now - 60 * 24 * 60 * 60 * 1000 + i * 1000, i < 24 ? 'UP' : 'DOWN', i < 15 ? 0.65 : 0.75);
}
for (let i = 0; i < 30; i++) {
  await insert(`new-eur-${i}`, 'EUR/USD', '1D', now - 10 * 24 * 60 * 60 * 1000 + i * 1000, i < 18 ? 'UP' : 'DOWN', i < 15 ? 0.85 : 0.95);
}
for (let i = 0; i < 10; i++) {
  await insert(`new-gbp-${i}`, 'GBP/USD', '3D', now - 10 * 24 * 60 * 60 * 1000 + i * 1000, 'UP', 0.8);
}

const matrix = await getCurrentPairCalibrationMatrix({
  modelVersion: 'LLAMA_GATEWAY_QWEN_LLAMA_V1',
  now
});

assert.equal(matrix.currentWindowDays, 30);
assert.equal(matrix.referenceWindowDays, 90);
assert.equal(matrix.minimumSampleCount, 30);

const eur = matrix.rows.find(row => row.symbol === 'EUR/USD' && row.horizon === '1D');
assert.ok(eur);
assert.equal(eur.current.directionalEvaluated, 30);
assert.equal(eur.reference.directionalEvaluated, 30);
assert.equal(eur.current.sampleSufficient, true);
assert.equal(eur.reference.sampleSufficient, true);
assert.ok(eur.current.expectedCalibrationErrorPct != null);
assert.ok(eur.reference.expectedCalibrationErrorPct != null);
assert.ok(eur.deltas.expectedCalibrationErrorDeltaPct != null);
assert.ok(eur.current.calibrationSlope != null);
assert.ok(eur.reference.calibrationSlope != null);
assert.ok(eur.current.calibrationInterceptPct != null);
assert.ok(eur.reference.calibrationInterceptPct != null);
assert.ok(eur.deltas.calibrationSlopeDelta != null);
assert.ok(eur.deltas.calibrationInterceptDeltaPct != null);

const gbp = matrix.rows.find(row => row.symbol === 'GBP/USD' && row.horizon === '3D');
assert.ok(gbp);
assert.equal(gbp.current.directionalEvaluated, 10);
assert.equal(gbp.current.sampleSufficient, false);
assert.equal(gbp.reference.directionalEvaluated, 0);
assert.equal(gbp.deltas.expectedCalibrationErrorDeltaPct, null);

console.log('CURRENT PAIR CALIBRATION MATRIX TEST PASSED');
