import { executeQuery } from '../database/db';
import {
  getCurrentPairPredictionModelComparison,
  getCurrentPairPairedModelComparison,
  getCurrentPairPairedModelComparisonRolling,
  getCurrentPairPairedContextComparison,
  type CurrentPairPredictionHorizon
} from './currentPairPredictionOutcomeService';

export interface ResearchValidationCheck {
  id: string;
  status: 'PASS' | 'WARN' | 'INSUFFICIENT';
  title: string;
  detail: string;
}

export interface CurrentPairResearchValidationReport {
  scope: {
    symbol: string | null;
    horizon: CurrentPairPredictionHorizon;
    generatedAt: number;
  };
  data: {
    totalPredictions: number;
    baselinePredictions: number;
    aiPredictions: number;
    pairedObservations: number;
    pairedEvaluated: number;
    pairedPending: number;
    pendingPct: number | null;
    unmatchedBaseline: number;
    unmatchedAi: number;
    duplicatePairKeys: number;
    featureSnapshotRows: number;
    featureSnapshotLeakageRows: number;
  };
  models: Array<{
    modelVersion: string;
    predictions: number;
    evaluated: number;
    pending: number;
    directionalEvaluated: number;
    accuracyPct: number | null;
    brierScore: number | null;
    sampleSufficient: boolean;
    minimumSampleCount: number;
  }>;
  paired: {
    discordantPairs: number;
    baselineOnlyCorrect: number;
    aiOnlyCorrect: number;
    bothCorrect: number;
    bothIncorrect: number;
    directionAgreementPct: number | null;
    exactMcNemarPValue: number | null;
    sampleSufficient: boolean;
  };
  rolling: Array<{
    windowDays: 30 | 90;
    pairedObservations: number;
    pairedEvaluated: number;
    pairedPending: number;
    discordantPairs: number;
    directionAgreementPct: number | null;
    exactMcNemarPValue: number | null;
    sampleSufficient: boolean;
  }>;
  contexts: {
    total: number;
    sufficient: number;
    insufficient: number;
    evaluatedObservations: number;
  };
  checks: ResearchValidationCheck[];
}

const BASELINE_MODEL = 'PAIR_FEATURE_BASELINE_V2';
const AI_MODEL = 'LLAMA_GATEWAY_QWEN_LLAMA_V1';
const MIN_SAMPLE_COUNT = 30;

function positiveLimit(value: unknown, fallback = 50000): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(100000, Math.floor(number)) : fallback;
}

export async function getCurrentPairResearchValidationReport(params: {
  symbol?: string;
  horizon?: CurrentPairPredictionHorizon;
  limit?: number;
} = {}): Promise<CurrentPairResearchValidationReport> {
  const symbol = params.symbol?.trim().toUpperCase() || null;
  const horizon = params.horizon || '1D';
  const limit = positiveLimit(params.limit);

  const conditions = ["prediction_context = 'CURRENT_PAIR'", 'horizon = ?'];
  const values: unknown[] = [horizon];
  if (symbol) {
    conditions.push('symbol = ?');
    values.push(symbol);
  }

  const rows = await executeQuery<any>(
    `SELECT prediction_id, model_version, symbol, predicted_at, predicted_direction,
            outcome_status, actual_direction, feature_hash, feature_snapshot_json
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );

  const baselineRows = rows.filter(row => row.model_version === BASELINE_MODEL);
  const aiRows = rows.filter(row => row.model_version === AI_MODEL);

  const baselineKeys = new Set(baselineRows.map(row => `${row.symbol}|${Number(row.predicted_at)}`));
  const aiKeys = new Set(aiRows.map(row => `${row.symbol}|${Number(row.predicted_at)}`));
  const pairedKeys = new Set([...baselineKeys].filter(key => aiKeys.has(key)));

  const duplicatePairKeys = (() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.model_version !== BASELINE_MODEL && row.model_version !== AI_MODEL) continue;
      const key = `${row.model_version}|${row.symbol}|${Number(row.predicted_at)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.values()].filter(count => count > 1).length;
  })();

  const featureSnapshotLeakageRows = rows.filter(row => {
    if (!row.feature_snapshot_json) return false;
    try {
      const snapshot = JSON.parse(row.feature_snapshot_json);
      const forbidden = ['realizedPnl', 'outcome', 'holdingDurationMs', 'actualDirection', 'actualReturnPct', 'evaluatedAt'];
      return forbidden.some(key => Object.prototype.hasOwnProperty.call(snapshot || {}, key));
    } catch {
      return true;
    }
  }).length;

  const comparison = await getCurrentPairPredictionModelComparison({
    symbol: symbol || undefined,
    horizon,
    limit
  });
  const paired = await getCurrentPairPairedModelComparison({
    symbol: symbol || undefined,
    horizon,
    limit
  });
  const rolling = await getCurrentPairPairedModelComparisonRolling({
    symbol: symbol || undefined,
    horizon,
    limit
  });
  const context = await getCurrentPairPairedContextComparison({
    symbol: symbol || undefined,
    horizon,
    limit
  });

  const pendingPct = paired.pairedObservations
    ? (paired.pairedPending / paired.pairedObservations) * 100
    : null;

  const checks: ResearchValidationCheck[] = [
    {
      id: 'prediction-data',
      status: comparison.total > 0 ? 'PASS' : 'INSUFFICIENT',
      title: 'Prediction data present',
      detail: comparison.total > 0 ? `${comparison.total} persisted CURRENT_PAIR predictions are available.` : 'No CURRENT_PAIR predictions are available for this scope.'
    },
    {
      id: 'model-sample',
      status: comparison.models.length > 0 && comparison.models.every(model => model.sampleSufficient) ? 'PASS' : 'INSUFFICIENT',
      title: 'Model sample sufficiency',
      detail: `Minimum evaluated directional sample is ${MIN_SAMPLE_COUNT} per model.`
    },
    {
      id: 'paired-sample',
      status: paired.pairedEvaluated >= MIN_SAMPLE_COUNT ? 'PASS' : 'INSUFFICIENT',
      title: 'Paired sample sufficiency',
      detail: `${paired.pairedEvaluated} paired observations are jointly evaluated; minimum is ${MIN_SAMPLE_COUNT}.`
    },
    {
      id: 'temporal-stability',
      status: rolling.some(window => window.pairedEvaluated >= MIN_SAMPLE_COUNT) ? 'PASS' : 'INSUFFICIENT',
      title: 'Temporal stability evidence',
      detail: 'At least one rolling research window must contain the minimum paired evaluated sample.'
    },
    {
      id: 'context-coverage',
      status: context.groups.some(group => group.sampleSufficient) ? 'PASS' : context.groups.length ? 'WARN' : 'INSUFFICIENT',
      title: 'Regime/session context coverage',
      detail: `${context.groups.filter(group => group.sampleSufficient).length} of ${context.groups.length} contexts meet the minimum paired sample.`
    },
    {
      id: 'duplicate-pairs',
      status: duplicatePairKeys === 0 ? 'PASS' : 'WARN',
      title: 'Duplicate prediction-time keys',
      detail: duplicatePairKeys === 0 ? 'No duplicate model/time keys were detected.' : `${duplicatePairKeys} duplicate model/time keys were detected.`
    },
    {
      id: 'feature-leakage',
      status: featureSnapshotLeakageRows === 0 ? 'PASS' : 'WARN',
      title: 'Post-outcome feature leakage guard',
      detail: featureSnapshotLeakageRows === 0 ? 'No forbidden post-outcome fields were detected in persisted feature snapshots.' : `${featureSnapshotLeakageRows} prediction rows contain forbidden or malformed feature snapshot data.`
    }
  ];

  return {
    scope: { symbol, horizon, generatedAt: Date.now() },
    data: {
      totalPredictions: rows.length,
      baselinePredictions: baselineRows.length,
      aiPredictions: aiRows.length,
      pairedObservations: paired.pairedObservations,
      pairedEvaluated: paired.pairedEvaluated,
      pairedPending: paired.pairedPending,
      pendingPct,
      unmatchedBaseline: Math.max(0, baselineKeys.size - pairedKeys.size),
      unmatchedAi: Math.max(0, aiKeys.size - pairedKeys.size),
      duplicatePairKeys,
      featureSnapshotRows: rows.length,
      featureSnapshotLeakageRows
    },
    models: comparison.models.map(model => ({
      modelVersion: model.modelVersion,
      predictions: model.predictions,
      evaluated: model.evaluated,
      pending: model.pending,
      directionalEvaluated: model.directionalEvaluated,
      accuracyPct: model.accuracyPct,
      brierScore: model.brierScore,
      sampleSufficient: model.sampleSufficient,
      minimumSampleCount: model.minimumSampleCount
    })),
    paired: {
      discordantPairs: paired.discordantPairs,
      baselineOnlyCorrect: paired.baselineOnlyCorrect,
      aiOnlyCorrect: paired.aiOnlyCorrect,
      bothCorrect: paired.bothCorrect,
      bothIncorrect: paired.bothIncorrect,
      directionAgreementPct: paired.directionAgreementPct,
      exactMcNemarPValue: paired.exactMcNemarPValue,
      sampleSufficient: paired.pairedEvaluated >= MIN_SAMPLE_COUNT
    },
    rolling: rolling.map(window => ({
      windowDays: window.windowDays,
      pairedObservations: window.pairedObservations,
      pairedEvaluated: window.pairedEvaluated,
      pairedPending: window.pairedPending,
      discordantPairs: window.discordantPairs,
      directionAgreementPct: window.directionAgreementPct,
      exactMcNemarPValue: window.exactMcNemarPValue,
      sampleSufficient: window.pairedEvaluated >= MIN_SAMPLE_COUNT
    })),
    contexts: {
      total: context.groups.length,
      sufficient: context.groups.filter(group => group.sampleSufficient).length,
      insufficient: context.groups.filter(group => !group.sampleSufficient).length,
      evaluatedObservations: context.groups.reduce((sum, group) => sum + group.pairedEvaluated, 0)
    },
    checks
  };
}
