import assert from 'node:assert/strict';
import { executeRun } from '../src/database/db';
import { getCurrentPairPredictionModelComparison, getCurrentPairPairedModelComparison, getCurrentPairPairedModelComparisonRolling, getCurrentPairPairedContextComparison } from '../src/services/currentPairPredictionOutcomeService';

const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const rows = [
  ['model-comparison-baseline-1', 'PAIR_FEATURE_BASELINE_V2', now - 10 * day, 'UP', 0.8, 'UP', 1.5],
  ['model-comparison-baseline-2', 'PAIR_FEATURE_BASELINE_V2', now - 11 * day, 'DOWN', 0.7, 'UP', 1.0],
  ['model-comparison-ai-1', 'LLAMA_GATEWAY_QWEN_LLAMA_V1', now - 10 * day, 'DOWN', 0.9, 'UP', 1.2],
  ['model-comparison-ai-2', 'LLAMA_GATEWAY_QWEN_LLAMA_V1', now - 11 * day, 'UP', 0.6, 'UP', 1.0]
] as const;

try {
  for (const [id, model, predictedAt, predictedDirection, confidence, actualDirection, actualReturn] of rows) {
    await executeRun('DELETE FROM live_trade_research_predictions WHERE prediction_id = ?', [id]);
    await executeRun(
      `INSERT INTO live_trade_research_predictions (
        prediction_id, model_version, prediction_source, symbol, signal_id, predicted_at,
        horizon, predicted_direction, confidence, feature_hash, model_agreement, reasoning,
        invalidation, actual_direction, actual_return_pct, outcome_status, evaluated_at,
        created_at, feature_snapshot_json, prediction_context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, model, model.includes('LLAMA') ? 'LLAMA_GATEWAY' : 'LIVE_PAIR_FEATURES', 'EUR/USD', `${id}-signal`,
        predictedAt, '1D', predictedDirection, confidence, `${id}-feature`, 1, 'test', 'test',
        actualDirection, actualReturn, 'EVALUATED', predictedAt + day, predictedAt,
        JSON.stringify(id.endsWith('-1') ? { marketRegime: 'TREND', session: 'LONDON' } : { marketRegime: 'RANGE', session: 'NEW_YORK' }), 'CURRENT_PAIR']
    );
  }

  const comparison = await getCurrentPairPredictionModelComparison({
    symbol: 'EUR/USD',
    horizon: '1D'
  });

  assert.equal(comparison.total, 4);
  assert.equal(comparison.evaluated, 4);
  assert.equal(comparison.pending, 0);
  assert.equal(comparison.models.length, 2);

  const baseline = comparison.models.find(model => model.modelVersion === 'PAIR_FEATURE_BASELINE_V2');
  const ai = comparison.models.find(model => model.modelVersion === 'LLAMA_GATEWAY_QWEN_LLAMA_V1');

  assert.ok(baseline);
  assert.ok(ai);

  assert.equal(baseline.predictions, 2);
  assert.equal(baseline.evaluated, 2);
  assert.equal(baseline.correct, 1);
  assert.equal(baseline.directionalEvaluated, 2);
  assert.equal(baseline.accuracyPct, 50);
  assert.equal(baseline.sampleSufficient, false);
  assert.equal(baseline.minimumSampleCount, 30);
  assert.ok(baseline.brierScore !== null);
  assert.ok(baseline.accuracyConfidenceInterval95Pct !== null);

  assert.equal(ai.predictions, 2);
  assert.equal(ai.evaluated, 2);
  assert.equal(ai.correct, 1);
  assert.equal(ai.directionalEvaluated, 2);
  assert.equal(ai.accuracyPct, 50);
  assert.equal(ai.sampleSufficient, false);
  assert.equal(ai.minimumSampleCount, 30);
  assert.ok(ai.brierScore !== null);
  assert.ok(ai.accuracyConfidenceInterval95Pct !== null);
  const paired = await getCurrentPairPairedModelComparison({
    symbol: 'EUR/USD',
    horizon: '1D'
  });

  assert.equal(paired.baselineModelVersion, 'PAIR_FEATURE_BASELINE_V2');
  assert.equal(paired.aiModelVersion, 'LLAMA_GATEWAY_QWEN_LLAMA_V1');
  assert.equal(paired.pairedObservations, 2);
  assert.equal(paired.pairedEvaluated, 2);
  assert.equal(paired.pairedPending, 0);
  assert.equal(paired.bothCorrect, 0);
  assert.equal(paired.baselineOnlyCorrect, 1);
  assert.equal(paired.aiOnlyCorrect, 1);
  assert.equal(paired.bothIncorrect, 0);
  assert.equal(paired.directionAgreementPct, 0);
  assert.equal(paired.discordantPairs, 2);
  assert.equal(paired.exactMcNemarPValue, 1);

  const discordantAt = now - 12 * day;
  const discordantRows = [
    ['model-comparison-baseline-3', 'PAIR_FEATURE_BASELINE_V2', discordantAt, 'DOWN', 0.8, 'DOWN', -1.2],
    ['model-comparison-ai-3', 'LLAMA_GATEWAY_QWEN_LLAMA_V1', discordantAt, 'UP', 0.8, 'DOWN', -1.2]
  ] as const;
  for (const [id, model, predictedAt, predictedDirection, confidence, actualDirection, actualReturn] of discordantRows) {
    await executeRun(
      `INSERT INTO live_trade_research_predictions (
        prediction_id, model_version, prediction_source, symbol, signal_id, predicted_at,
        horizon, predicted_direction, confidence, feature_hash, model_agreement, reasoning,
        invalidation, actual_direction, actual_return_pct, outcome_status, evaluated_at,
        created_at, feature_snapshot_json, prediction_context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, model, model.includes('LLAMA') ? 'LLAMA_GATEWAY' : 'LIVE_PAIR_FEATURES', 'EUR/USD', `${id}-signal`,
        predictedAt, '1D', predictedDirection, confidence, `${id}-feature`, 1, 'test', 'test',
        actualDirection, actualReturn, 'EVALUATED', predictedAt + day, predictedAt,
        JSON.stringify({ marketRegime: 'RANGE', session: 'NEW_YORK' }), 'CURRENT_PAIR']
    );
  }

  const discordant = await getCurrentPairPairedModelComparison({ symbol: 'EUR/USD', horizon: '1D' });
  assert.equal(discordant.pairedEvaluated, 3);
  assert.equal(discordant.baselineOnlyCorrect, 2);
  assert.equal(discordant.aiOnlyCorrect, 1);
  assert.equal(discordant.discordantPairs, 3);
  assert.equal(discordant.exactMcNemarPValue, 1);

  const contextComparison = await getCurrentPairPairedContextComparison({ symbol: 'EUR/USD', horizon: '1D' });
  assert.equal(contextComparison.groups.length, 2);
  const trendLondon = contextComparison.groups.find(group => group.marketRegime === 'TREND' && group.session === 'LONDON');
  const rangeNewYork = contextComparison.groups.find(group => group.marketRegime === 'RANGE' && group.session === 'NEW_YORK');
  assert.ok(trendLondon);
  assert.ok(rangeNewYork);
  assert.equal(trendLondon?.pairedObservations, 1);
  assert.equal(trendLondon?.sampleSufficient, false);
  assert.ok(trendLondon?.accuracyConfidenceInterval95Pct !== null);
  assert.equal(rangeNewYork?.pairedObservations, 2);
  const rolling = await getCurrentPairPairedModelComparisonRolling({ symbol: 'EUR/USD', horizon: '1D' });
  assert.equal(rolling.length, 2);
  assert.equal(rolling[0].windowDays, 30);
  assert.equal(rolling[0].pairedObservations, 3);
  assert.equal(rolling[0].pairedEvaluated, 3);
  assert.equal(rolling[0].discordantPairs, 3);
  assert.equal(rolling[1].windowDays, 90);
  assert.equal(rolling[1].pairedObservations, 3);
  assert.equal(rolling[1].pairedEvaluated, 3);
  assert.equal(rolling[1].discordantPairs, 3);

  for (const [id] of discordantRows) {
    await executeRun('DELETE FROM live_trade_research_predictions WHERE prediction_id = ?', [id]);
  }


} finally {
  for (const [id] of rows) {
    await executeRun('DELETE FROM live_trade_research_predictions WHERE prediction_id = ?', [id]);
  }
}

console.log('CURRENT PAIR MODEL COMPARISON TEST PASSED');
