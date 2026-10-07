import assert from 'node:assert/strict';
import { getDatabase, executeRun } from '../src/database/db';
import { getCurrentPairResearchReadinessLedger } from '../src/services/currentPairResearchReadinessLedgerService';

await getDatabase();
await executeRun('DELETE FROM live_trade_research_predictions');

const now = Date.now();
const insert = async (id: string, modelVersion: string, timestamp: number, direction: 'UP' | 'DOWN', actualDirection: 'UP' | 'DOWN') => {
  await executeRun(
    `INSERT INTO live_trade_research_predictions (
      prediction_id, model_version, prediction_source, symbol, signal_id, predicted_at,
      horizon, predicted_direction, confidence, feature_hash, model_agreement,
      reasoning, invalidation, actual_direction, actual_return_pct, outcome_status,
      evaluated_at, created_at, feature_snapshot_json, prediction_context
    ) VALUES (?, ?, 'TEST', 'EUR/USD', ?, ?, '1D', ?, 0.9, ?, 1, 'test', null, ?, 1, 'EVALUATED', ?, ?, ?, 'CURRENT_PAIR')`,
    [id, modelVersion, id, timestamp, direction, id + '-hash', actualDirection, now, now, JSON.stringify({ marketRegime: 'TREND', session: 'LONDON' })]
  );
};

// Keep this fixture deliberately below the 30-observation research threshold.
// The ledger must report insufficiency rather than infer readiness from tiny samples.
for (let i = 0; i < 2; i++) {
  const ts = now - (i + 1) * 1000;
  await insert(`ledger-base-${i}`, 'PAIR_FEATURE_BASELINE_V2', ts, 'UP', 'UP');
  await insert(`ledger-ai-${i}`, 'LLAMA_GATEWAY_QWEN_LLAMA_V1', ts, i === 0 ? 'UP' : 'DOWN', 'UP');
}

const ledger = await getCurrentPairResearchReadinessLedger({ symbol: 'EUR/USD', horizon: '1D' });

assert.equal(ledger.scope.symbol, 'EUR/USD');
assert.equal(ledger.scope.horizon, '1D');
assert.equal(ledger.scope.aiModelVersion, 'LLAMA_GATEWAY_QWEN_LLAMA_V1');
assert.equal(ledger.evidence.aiDirectionalEvaluated, 2);
assert.equal(ledger.evidence.baselineDirectionalEvaluated, 2);
assert.equal(ledger.evidence.pairedEvaluated, 2);
assert.equal(ledger.evidence.currentOosDirectionalEvaluated, 0);
assert.equal(ledger.checks.find(check => check.id === 'ai-sample')?.status, 'INSUFFICIENT');
assert.equal(ledger.checks.find(check => check.id === 'paired-sample')?.status, 'INSUFFICIENT');
assert.equal(ledger.checks.find(check => check.id === 'oos-windows')?.status, 'INSUFFICIENT');

console.log('CURRENT PAIR RESEARCH READINESS LEDGER TEST PASSED');
