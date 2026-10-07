import assert from 'node:assert/strict';
import { getDatabase, executeRun } from '../src/database/db';
import { getCurrentPairResearchValidationReport } from '../src/services/currentPairResearchValidationService';

await getDatabase();
await executeRun('DELETE FROM live_trade_research_predictions');

const now = Date.now();
const insert = async (id: string, modelVersion: string, timestamp: number, direction: 'UP' | 'DOWN', actualDirection: 'UP' | 'DOWN', snapshot: object) => {
  await executeRun(
    `INSERT INTO live_trade_research_predictions (
      prediction_id, model_version, prediction_source, symbol, signal_id, predicted_at,
      horizon, predicted_direction, confidence, feature_hash, model_agreement,
      reasoning, invalidation, actual_direction, actual_return_pct, outcome_status,
      evaluated_at, created_at, feature_snapshot_json, prediction_context
    ) VALUES (?, ?, 'TEST', 'EUR/USD', ?, ?, '1D', ?, 0.9, ?, 1, 'test', null, ?, 1, 'EVALUATED', ?, ?, ?, 'CURRENT_PAIR')`,
    [id, modelVersion, id, timestamp, direction, id + '-hash', actualDirection, now, now, JSON.stringify(snapshot)]
  );
};

const snapshot = { marketRegime: 'TREND', session: 'LONDON' };
await insert('validation-base-1', 'PAIR_FEATURE_BASELINE_V2', now - 2000, 'UP', 'UP', snapshot);
await insert('validation-ai-1', 'LLAMA_GATEWAY_QWEN_LLAMA_V1', now - 2000, 'DOWN', 'UP', snapshot);
await insert('validation-base-2', 'PAIR_FEATURE_BASELINE_V2', now - 1000, 'UP', 'UP', snapshot);
await insert('validation-ai-2', 'LLAMA_GATEWAY_QWEN_LLAMA_V1', now - 1000, 'UP', 'UP', snapshot);
await insert('validation-unmatched-base', 'PAIR_FEATURE_BASELINE_V2', now, 'UP', 'UP', { ...snapshot, outcome: 'WIN' });

const report = await getCurrentPairResearchValidationReport({ symbol: 'EUR/USD', horizon: '1D' });

assert.equal(report.data.totalPredictions, 5);
assert.equal(report.data.pairedObservations, 2);
assert.equal(report.data.pairedEvaluated, 2);
assert.equal(report.data.unmatchedBaseline, 1);
assert.equal(report.data.unmatchedAi, 0);
assert.equal(report.data.featureSnapshotLeakageRows, 1);
assert.equal(report.data.duplicatePairKeys, 0);
assert.equal(report.paired.baselineOnlyCorrect, 1);
assert.equal(report.paired.aiOnlyCorrect, 0);
assert.equal(report.paired.bothCorrect, 1);
assert.equal(report.paired.sampleSufficient, false);
assert.equal(report.contexts.total, 1);
assert.equal(report.contexts.sufficient, 0);
assert.equal(report.checks.find(check => check.id === 'feature-leakage')?.status, 'WARN');
assert.equal(report.checks.find(check => check.id === 'paired-sample')?.status, 'INSUFFICIENT');

console.log('CURRENT PAIR RESEARCH VALIDATION TEST PASSED');
