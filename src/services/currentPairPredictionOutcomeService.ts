import { executeQuery, executeRun } from '../database/db';
import { LiveForexProvider } from '../markets/forex/provider';
import type { ForexCandle } from '../markets/forex/types';

export type CurrentPairPredictionHorizon = '1D' | '3D' | '7D';

interface CurrentPairPredictionRow {
  prediction_id: string;
  model_version: string;
  prediction_source: string;
  symbol: string;
  predicted_at: number;
  horizon: CurrentPairPredictionHorizon;
  predicted_direction: 'UP' | 'DOWN' | 'FLAT';
  confidence: number;
  actual_direction: 'UP' | 'DOWN' | 'FLAT' | null;
  actual_return_pct: number | null;
  outcome_status: string;
  feature_snapshot_json: string | null;
}

export interface CurrentPairOutcomeEvaluationResult {
  evaluated: number;
  pending: number;
  correct: number;
  directionalEvaluated: number;
  accuracyPct: number | null;
  brierScore: number | null;
  updatedAt: number;
}

export const CURRENT_PAIR_MIN_SAMPLE_COUNT = 30;

export interface CurrentPairPredictionCalibrationBin {
  lowerPct: number;
  upperPct: number;
  predictions: number;
  evaluated: number;
  correct: number;
  accuracyPct: number | null;
  averageConfidencePct: number | null;
  sampleSufficient: boolean;
}

export interface CurrentPairRollingWindowMetrics {
  windowDays: 30 | 90;
  evaluated: number;
  directionalEvaluated: number;
  correct: number;
  accuracyPct: number | null;
  brierScore: number | null;
  sampleSufficient: boolean;
  accuracyConfidenceInterval95Pct: { lowerPct: number; upperPct: number } | null;
}

export interface CurrentPairPredictionGroupMetrics {
  symbol: string;
  modelVersion: string;
  horizon: CurrentPairPredictionHorizon;
  predictions: number;
  evaluated: number;
  pending: number;
  correct: number;
  directionalEvaluated: number;
  accuracyPct: number | null;
  brierScore: number | null;
  upPredictions: number;
  downPredictions: number;
  flatPredictions: number;
  upActuals: number;
  downActuals: number;
  flatActuals: number;
  calibration: CurrentPairPredictionCalibrationBin[];
  marketRegime: string;
  session: string;
  sampleSufficient: boolean;
  minimumSampleCount: number;
  accuracyConfidenceInterval95Pct: { lowerPct: number; upperPct: number } | null;
  rollingWindows: CurrentPairRollingWindowMetrics[];
  walkForwardCohorts: CurrentPairWalkForwardCohortMetrics[];
}

export interface CurrentPairWalkForwardCohortMetrics {
  cohortIndex: number;
  cohortDays: number;
  fromTimestamp: number;
  toTimestamp: number;
  evaluated: number;
  directionalEvaluated: number;
  correct: number;
  accuracyPct: number | null;
  brierScore: number | null;
  sampleSufficient: boolean;
  accuracyConfidenceInterval95Pct: { lowerPct: number; upperPct: number } | null;
}

export interface CurrentPairWalkForwardGroupMetrics {
  symbol: string;
  modelVersion: string;
  horizon: CurrentPairPredictionHorizon;
  marketRegime: string;
  session: string;
  cohortDays: number;
  minimumSampleCount: number;
  cohorts: CurrentPairWalkForwardCohortMetrics[];
}

const liveForexProvider = new LiveForexProvider();

function horizonMs(horizon: CurrentPairPredictionHorizon): number {
  if (horizon === '1D') return 24 * 60 * 60 * 1000;
  if (horizon === '3D') return 3 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function directionalScore(predicted: CurrentPairPredictionRow, actual: 'UP' | 'DOWN' | 'FLAT') {
  if (actual === 'FLAT' || predicted.predicted_direction === 'FLAT') {
    return { evaluated: false, correct: false, brier: null as number | null };
  }
  const correct = predicted.predicted_direction === actual;
  const confidence = Math.max(0, Math.min(1, Number(predicted.confidence) || 0));
  const probabilityUp = predicted.predicted_direction === 'UP' ? confidence : 1 - confidence;
  const actualUp = actual === 'UP' ? 1 : 0;
  return {
    evaluated: true,
    correct,
    brier: Math.pow(probabilityUp - actualUp, 2)
  };
}

function wilsonConfidenceInterval95(successes: number, trials: number): { lowerPct: number; upperPct: number } | null {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0) return null;
  const n = Math.max(0, Math.floor(trials));
  const k = Math.max(0, Math.min(n, Math.floor(successes)));
  const z = 1.959963984540054;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    lowerPct: Math.max(0, centre - margin) * 100,
    upperPct: Math.min(1, centre + margin) * 100
  };
}

function actualFromReturn(returnPct: number): 'UP' | 'DOWN' | 'FLAT' {
  if (returnPct > 0) return 'UP';
  if (returnPct < 0) return 'DOWN';
  return 'FLAT';
}

function selectCandleAtOrAfter(candles: ForexCandle[], timestamp: number): ForexCandle | null {
  return candles.find(candle => Number(candle.timestamp) >= timestamp) || null;
}

function selectLatestCandleAtOrBefore(candles: ForexCandle[], timestamp: number): ForexCandle | null {
  let selected: ForexCandle | null = null;
  for (const candle of candles) {
    if (Number(candle.timestamp) <= timestamp) selected = candle;
    else break;
  }
  return selected;
}

/**
 * Evaluates CURRENT_PAIR predictions against authoritative cTrader Daily candles.
 *
 * The reference price is the latest Daily close at or before prediction time.
 * The horizon price is the first Daily close at or after prediction time + horizon.
 * This is deliberately separate from the historical signal/training evaluator:
 * current-pair snapshots do not require a historical live_trade_research signal.
 */
export async function evaluatePendingCurrentPairPredictions(params: {
  modelVersion?: string;
  horizon?: CurrentPairPredictionHorizon;
  symbol?: string;
  limit?: number;
} = {}): Promise<CurrentPairOutcomeEvaluationResult> {
  const conditions = [
    "prediction_context = 'CURRENT_PAIR'",
    "(outcome_status IS NULL OR outcome_status != 'EVALUATED')"
  ];
  const values: unknown[] = [];

  if (params.modelVersion) {
    conditions.push('model_version = ?');
    values.push(params.modelVersion);
  }
  if (params.horizon) {
    conditions.push('horizon = ?');
    values.push(params.horizon);
  }
  if (params.symbol) {
    conditions.push('symbol = ?');
    values.push(params.symbol);
  }

  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  const rows = await executeQuery<CurrentPairPredictionRow>(
    `SELECT prediction_id, model_version, prediction_source, symbol, predicted_at,
            horizon, predicted_direction, confidence, actual_direction,
            actual_return_pct, outcome_status, feature_snapshot_json
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );

  let evaluated = 0;
  let pending = 0;
  let correct = 0;
  let directionalEvaluated = 0;
  let brierSum = 0;

  const candlesBySymbol = new Map<string, ForexCandle[]>();
  for (const prediction of rows) {
    if (!candlesBySymbol.has(prediction.symbol)) {
      try {
        await liveForexProvider.refreshPair(prediction.symbol);
        candlesBySymbol.set(prediction.symbol, liveForexProvider.getCandles(prediction.symbol, 'Daily', 80));
      } catch {
        candlesBySymbol.set(prediction.symbol, []);
      }
    }

    const candles = candlesBySymbol.get(prediction.symbol) || [];
    const targetTimestamp = Number(prediction.predicted_at) + horizonMs(prediction.horizon);
    const reference = selectLatestCandleAtOrBefore(candles, Number(prediction.predicted_at));
    const target = selectCandleAtOrAfter(candles, targetTimestamp);

    // Do not label a prediction until the requested horizon is actually represented
    // by authoritative market history.
    if (!reference || !target || !(Number(reference.close) > 0) || !(Number(target.close) > 0)) {
      pending++;
      continue;
    }

    const actualReturnPct = ((Number(target.close) - Number(reference.close)) / Number(reference.close)) * 100;
    const actualDirection = actualFromReturn(actualReturnPct);
    const score = directionalScore(prediction, actualDirection);

    await executeRun(
      `UPDATE live_trade_research_predictions
          SET actual_direction = ?, actual_return_pct = ?, outcome_status = 'EVALUATED', evaluated_at = ?
        WHERE prediction_id = ? AND prediction_context = 'CURRENT_PAIR'`,
      [actualDirection, actualReturnPct, Date.now(), prediction.prediction_id]
    );

    evaluated++;
    if (score.evaluated) {
      directionalEvaluated++;
      if (score.correct) correct++;
      brierSum += score.brier || 0;
    }
  }

  return {
    evaluated,
    pending,
    correct,
    directionalEvaluated,
    accuracyPct: directionalEvaluated ? (correct / directionalEvaluated) * 100 : null,
    brierScore: directionalEvaluated ? brierSum / directionalEvaluated : null,
    updatedAt: Date.now()
  };
}

function predictionContextValue(row: CurrentPairPredictionRow, field: 'marketRegime' | 'session'): string {
  try {
    const snapshot = row.feature_snapshot_json ? JSON.parse(row.feature_snapshot_json) : null;
    const value = snapshot?.[field];
    return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

export async function getCurrentPairPredictionWalkForwardAnalytics(params: {
  modelVersion?: string; horizon?: CurrentPairPredictionHorizon; symbol?: string; limit?: number; cohortDays?: number; maxCohorts?: number;
} = {}): Promise<{ total: number; evaluated: number; cohortDays: number; minimumSampleCount: number; groups: CurrentPairWalkForwardGroupMetrics[]; generatedAt: number }> {
  const conditions = ["prediction_context = 'CURRENT_PAIR'", "outcome_status = 'EVALUATED'"];
  const values: unknown[] = [];
  if (params.modelVersion) { conditions.push('model_version = ?'); values.push(params.modelVersion); }
  if (params.horizon) { conditions.push('horizon = ?'); values.push(params.horizon); }
  if (params.symbol) { conditions.push('symbol = ?'); values.push(params.symbol); }
  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  const cohortDays = Math.max(7, Math.min(365, Math.floor(Number(params.cohortDays) || 30)));
  const maxCohorts = Math.max(1, Math.min(24, Math.floor(Number(params.maxCohorts) || 6)));
  const rows = await executeQuery<CurrentPairPredictionRow>(
    `SELECT prediction_id, model_version, prediction_source, symbol, predicted_at, horizon, predicted_direction, confidence, actual_direction, actual_return_pct, outcome_status, feature_snapshot_json FROM live_trade_research_predictions WHERE ${conditions.join(' AND ')} ORDER BY predicted_at ASC LIMIT ?`,
    [...values, limit]
  );
  const grouped = new Map<string, CurrentPairPredictionRow[]>();
  for (const row of rows) {
    const key = [row.symbol, row.model_version, row.horizon, predictionContextValue(row, 'marketRegime'), predictionContextValue(row, 'session')].join('|');
    const group = grouped.get(key) || []; group.push(row); grouped.set(key, group);
  }
  const cohortMs = cohortDays * 24 * 60 * 60 * 1000;
  const groups: CurrentPairWalkForwardGroupMetrics[] = [...grouped.values()].map(group => {
    const latest = group.reduce((value, row) => Math.max(value, Number(row.predicted_at) || 0), 0);
    const cohorts: CurrentPairWalkForwardCohortMetrics[] = [];
    for (let index = 0; index < maxCohorts; index++) {
      const toTimestamp = latest - index * cohortMs;
      const fromTimestamp = toTimestamp - cohortMs;

      // Assign observations by elapsed age from the latest observation rather than
      // relying on adjacent timestamp range predicates. This keeps cohort membership
      // deterministic at exact cohort boundaries and prevents boundary observations
      // from being skipped between adjacent cohorts.
      const cohortRows = group.filter(row => {
        const timestamp = Number(row.predicted_at);
        if (!Number.isFinite(timestamp)) return false;
        const ageMs = latest - timestamp;
        if (ageMs < 0) return false;
        const cohortIndex = Math.floor(ageMs / cohortMs);
        return cohortIndex === index;
      });
      if (cohortRows.length === 0) continue;
      const directional = cohortRows.map(row => directionalScore(row, row.actual_direction as 'UP' | 'DOWN' | 'FLAT')).filter(result => result.evaluated);
      const correct = directional.filter(result => result.correct).length;
      const brierValues = directional.map(result => result.brier).filter((value): value is number => value !== null);
      cohorts.push({ cohortIndex: index + 1, cohortDays, fromTimestamp, toTimestamp, evaluated: cohortRows.length, directionalEvaluated: directional.length, correct, accuracyPct: directional.length ? (correct / directional.length) * 100 : null, brierScore: brierValues.length ? brierValues.reduce((sum, value) => sum + value, 0) / brierValues.length : null, sampleSufficient: directional.length >= CURRENT_PAIR_MIN_SAMPLE_COUNT, accuracyConfidenceInterval95Pct: wilsonConfidenceInterval95(correct, directional.length) });
    }
    return { symbol: group[0].symbol, modelVersion: group[0].model_version, horizon: group[0].horizon, marketRegime: predictionContextValue(group[0], 'marketRegime'), session: predictionContextValue(group[0], 'session'), cohortDays, minimumSampleCount: CURRENT_PAIR_MIN_SAMPLE_COUNT, cohorts };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.modelVersion.localeCompare(b.modelVersion) || a.horizon.localeCompare(b.horizon));
  return { total: rows.length, evaluated: rows.length, cohortDays, minimumSampleCount: CURRENT_PAIR_MIN_SAMPLE_COUNT, groups, generatedAt: Date.now() };
}
export interface CurrentPairPredictionModelComparisonMetric {
  modelVersion: string;
  predictions: number;
  evaluated: number;
  pending: number;
  correct: number;
  directionalEvaluated: number;
  accuracyPct: number | null;
  brierScore: number | null;
  sampleSufficient: boolean;
  minimumSampleCount: number;
  accuracyConfidenceInterval95Pct: { lowerPct: number; upperPct: number } | null;
}

export async function getCurrentPairPredictionModelComparison(params: {
  horizon?: CurrentPairPredictionHorizon;
  symbol?: string;
  limit?: number;
} = {}): Promise<{
  total: number;
  evaluated: number;
  pending: number;
  models: CurrentPairPredictionModelComparisonMetric[];
  generatedAt: number;
}> {
  const conditions = ["prediction_context = 'CURRENT_PAIR'"];
  const values: unknown[] = [];

  if (params.horizon) {
    conditions.push('horizon = ?');
    values.push(params.horizon);
  }
  if (params.symbol) {
    conditions.push('symbol = ?');
    values.push(params.symbol);
  }

  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  const rows = await executeQuery<CurrentPairPredictionRow>(
    `SELECT prediction_id, model_version, prediction_source, symbol, predicted_at,
            horizon, predicted_direction, confidence, actual_direction,
            actual_return_pct, outcome_status, feature_snapshot_json
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );

  const grouped = new Map<string, CurrentPairPredictionRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.model_version) || [];
    group.push(row);
    grouped.set(row.model_version, group);
  }

  const models = [...grouped.entries()].map(([modelVersion, modelRows]) => {
    const evaluatedRows = modelRows.filter(row => row.outcome_status === 'EVALUATED' && row.actual_direction);
    const directional = evaluatedRows
      .map(row => directionalScore(row, row.actual_direction as 'UP' | 'DOWN' | 'FLAT'))
      .filter(result => result.evaluated);
    const correct = directional.filter(result => result.correct).length;
    const brierValues = directional
      .map(result => result.brier)
      .filter((value): value is number => value !== null);

    return {
      modelVersion,
      predictions: modelRows.length,
      evaluated: evaluatedRows.length,
      pending: modelRows.length - evaluatedRows.length,
      correct,
      directionalEvaluated: directional.length,
      accuracyPct: directional.length ? (correct / directional.length) * 100 : null,
      brierScore: brierValues.length ? brierValues.reduce((sum, value) => sum + value, 0) / brierValues.length : null,
      sampleSufficient: directional.length >= CURRENT_PAIR_MIN_SAMPLE_COUNT,
      minimumSampleCount: CURRENT_PAIR_MIN_SAMPLE_COUNT,
      accuracyConfidenceInterval95Pct: wilsonConfidenceInterval95(correct, directional.length)
    };
  }).sort((a, b) => a.modelVersion.localeCompare(b.modelVersion));

  const evaluated = rows.filter(row => row.outcome_status === 'EVALUATED').length;

  return {
    total: rows.length,
    evaluated,
    pending: rows.length - evaluated,
    models,
    generatedAt: Date.now()
  };
}


export interface CurrentPairPairedModelComparison {
  baselineModelVersion: string;
  aiModelVersion: string;
  pairedObservations: number;
  pairedEvaluated: number;
  pairedPending: number;
  bothCorrect: number;
  baselineOnlyCorrect: number;
  aiOnlyCorrect: number;
  bothIncorrect: number;
  directionAgreementPct: number | null;
  discordantPairs: number;
  exactMcNemarPValue: number | null;
}

export interface CurrentPairPairedRollingWindowMetrics {
  windowDays: 30 | 90;
  pairedObservations: number;
  pairedEvaluated: number;
  pairedPending: number;
  bothCorrect: number;
  baselineOnlyCorrect: number;
  aiOnlyCorrect: number;
  bothIncorrect: number;
  directionAgreementPct: number | null;
  discordantPairs: number;
  exactMcNemarPValue: number | null;
}

export interface CurrentPairPairedContextComparison {
  symbol: string;
  horizon: CurrentPairPredictionHorizon;
  marketRegime: string;
  session: string;
  pairedObservations: number;
  pairedEvaluated: number;
  pairedPending: number;
  bothCorrect: number;
  baselineOnlyCorrect: number;
  aiOnlyCorrect: number;
  bothIncorrect: number;
  directionAgreementPct: number | null;
  discordantPairs: number;
  exactMcNemarPValue: number | null;
  sampleSufficient: boolean;
  accuracyConfidenceInterval95Pct: { lowerPct: number; upperPct: number } | null;
}

function exactMcNemarTwoSidedPValue(baselineOnlyCorrect: number, aiOnlyCorrect: number): number | null {
  const n = baselineOnlyCorrect + aiOnlyCorrect;
  if (n === 0) return null;

  const k = Math.min(baselineOnlyCorrect, aiOnlyCorrect);
  let probability = Math.pow(0.5, n);
  let cumulative = probability;

  for (let i = 0; i < k; i++) {
    probability *= (n - i) / (i + 1);
    cumulative += probability;
  }

  return Math.min(1, 2 * cumulative);
}

export async function getCurrentPairPairedModelComparison(params: {
  horizon?: CurrentPairPredictionHorizon;
  symbol?: string;
  limit?: number;
} = {}): Promise<CurrentPairPairedModelComparison> {
  const conditions = ["prediction_context = 'CURRENT_PAIR'"];
  const values: unknown[] = [];

  if (params.horizon) {
    conditions.push('horizon = ?');
    values.push(params.horizon);
  }
  if (params.symbol) {
    conditions.push('symbol = ?');
    values.push(params.symbol);
  }

  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  const rows = await executeQuery<CurrentPairPredictionRow>(
    `SELECT prediction_id, model_version, prediction_source, symbol, predicted_at,
            horizon, predicted_direction, confidence, actual_direction,
            actual_return_pct, outcome_status, feature_snapshot_json
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );

  const baselineModelVersion = 'PAIR_FEATURE_BASELINE_V2';
  const aiModelVersion = 'LLAMA_GATEWAY_QWEN_LLAMA_V1';
  const baseline = new Map<string, CurrentPairPredictionRow>();
  const ai = new Map<string, CurrentPairPredictionRow>();

  for (const row of rows) {
    const key = `${row.symbol}|${row.horizon}|${Number(row.predicted_at)}`;
    if (row.model_version === baselineModelVersion) baseline.set(key, row);
    if (row.model_version === aiModelVersion) ai.set(key, row);
  }

  let pairedObservations = 0;
  let pairedEvaluated = 0;
  let pairedPending = 0;
  let bothCorrect = 0;
  let baselineOnlyCorrect = 0;
  let aiOnlyCorrect = 0;
  let bothIncorrect = 0;
  let directionAgreement = 0;

  for (const [key, baselineRow] of baseline.entries()) {
    const aiRow = ai.get(key);
    if (!aiRow) continue;

    pairedObservations++;
    if (baselineRow.predicted_direction === aiRow.predicted_direction) directionAgreement++;

    const baselineEvaluated = baselineRow.outcome_status === 'EVALUATED' && Boolean(baselineRow.actual_direction);
    const aiEvaluated = aiRow.outcome_status === 'EVALUATED' && Boolean(aiRow.actual_direction);
    if (!baselineEvaluated || !aiEvaluated) {
      pairedPending++;
      continue;
    }

    if (baselineRow.actual_direction !== aiRow.actual_direction) {
      pairedPending++;
      continue;
    }
    const actual = baselineRow.actual_direction as 'UP' | 'DOWN' | 'FLAT';
    const baselineScore = directionalScore(baselineRow, actual);
    const aiScore = directionalScore(aiRow, actual);
    if (!baselineScore.evaluated || !aiScore.evaluated) {
      pairedPending++;
      continue;
    }

    pairedEvaluated++;
    if (baselineScore.correct && aiScore.correct) bothCorrect++;
    else if (baselineScore.correct) baselineOnlyCorrect++;
    else if (aiScore.correct) aiOnlyCorrect++;
    else bothIncorrect++;
  }

  return {
    baselineModelVersion,
    aiModelVersion,
    pairedObservations,
    pairedEvaluated,
    pairedPending,
    bothCorrect,
    baselineOnlyCorrect,
    aiOnlyCorrect,
    bothIncorrect,
    directionAgreementPct: pairedObservations ? (directionAgreement / pairedObservations) * 100 : null,
    discordantPairs: baselineOnlyCorrect + aiOnlyCorrect,
    exactMcNemarPValue: exactMcNemarTwoSidedPValue(baselineOnlyCorrect, aiOnlyCorrect)
  };
}

export async function getCurrentPairPairedModelComparisonRolling(params: {
  horizon?: CurrentPairPredictionHorizon;
  symbol?: string;
  limit?: number;
} = {}): Promise<CurrentPairPairedRollingWindowMetrics[]> {
  const conditions = ["prediction_context = 'CURRENT_PAIR'"];
  const values: unknown[] = [];

  if (params.horizon) {
    conditions.push('horizon = ?');
    values.push(params.horizon);
  }
  if (params.symbol) {
    conditions.push('symbol = ?');
    values.push(params.symbol);
  }

  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  const rows = await executeQuery<CurrentPairPredictionRow>(
    `SELECT prediction_id, model_version, prediction_source, symbol, predicted_at,
            horizon, predicted_direction, confidence, actual_direction,
            actual_return_pct, outcome_status, feature_snapshot_json
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );

  const paired = new Map<string, { baseline: CurrentPairPredictionRow; ai: CurrentPairPredictionRow }>();
  for (const row of rows) {
    const key = `${row.symbol}|${row.horizon}|${Number(row.predicted_at)}`;
    const existing = paired.get(key);
    if (row.model_version === 'PAIR_FEATURE_BASELINE_V2') {
      paired.set(key, { baseline: row, ai: existing?.ai as CurrentPairPredictionRow });
    } else if (row.model_version === 'LLAMA_GATEWAY_QWEN_LLAMA_V1') {
      paired.set(key, { baseline: existing?.baseline as CurrentPairPredictionRow, ai: row });
    }
  }

  const validPairs = [...paired.values()].filter(pair => pair.baseline && pair.ai);
  const latest = validPairs.reduce((value, pair) => Math.max(value, Number(pair.baseline.predicted_at) || 0), 0);

  return ([30, 90] as const).map(windowDays => {
    const cutoff = latest - windowDays * 24 * 60 * 60 * 1000;
    const windowPairs = validPairs.filter(pair => Number(pair.baseline.predicted_at) >= cutoff && Number(pair.baseline.predicted_at) <= latest);

    let pairedEvaluated = 0;
    let pairedPending = 0;
    let bothCorrect = 0;
    let baselineOnlyCorrect = 0;
    let aiOnlyCorrect = 0;
    let bothIncorrect = 0;
    let directionAgreement = 0;

    for (const pair of windowPairs) {
      if (pair.baseline.predicted_direction === pair.ai.predicted_direction) directionAgreement++;
      const baselineEvaluated = pair.baseline.outcome_status === 'EVALUATED' && Boolean(pair.baseline.actual_direction);
      const aiEvaluated = pair.ai.outcome_status === 'EVALUATED' && Boolean(pair.ai.actual_direction);
      if (!baselineEvaluated || !aiEvaluated || pair.baseline.actual_direction !== pair.ai.actual_direction) {
        pairedPending++;
        continue;
      }

      const actual = pair.baseline.actual_direction as 'UP' | 'DOWN' | 'FLAT';
      const baselineScore = directionalScore(pair.baseline, actual);
      const aiScore = directionalScore(pair.ai, actual);
      if (!baselineScore.evaluated || !aiScore.evaluated) {
        pairedPending++;
        continue;
      }

      pairedEvaluated++;
      if (baselineScore.correct && aiScore.correct) bothCorrect++;
      else if (baselineScore.correct) baselineOnlyCorrect++;
      else if (aiScore.correct) aiOnlyCorrect++;
      else bothIncorrect++;
    }

    return {
      windowDays,
      pairedObservations: windowPairs.length,
      pairedEvaluated,
      pairedPending,
      bothCorrect,
      baselineOnlyCorrect,
      aiOnlyCorrect,
      bothIncorrect,
      directionAgreementPct: windowPairs.length ? (directionAgreement / windowPairs.length) * 100 : null,
      discordantPairs: baselineOnlyCorrect + aiOnlyCorrect,
      exactMcNemarPValue: exactMcNemarTwoSidedPValue(baselineOnlyCorrect, aiOnlyCorrect),
      sampleSufficient: pairedEvaluated >= CURRENT_PAIR_MIN_SAMPLE_COUNT,
      accuracyConfidenceInterval95Pct: wilsonConfidenceInterval95(baselineOnlyCorrect + bothCorrect, pairedEvaluated)
    };
  });
}

export async function getCurrentPairPairedContextComparison(params: {
  horizon?: CurrentPairPredictionHorizon;
  symbol?: string;
  marketRegime?: string;
  session?: string;
  limit?: number;
} = {}): Promise<{ groups: CurrentPairPairedContextComparison[]; generatedAt: number }> {
  const conditions = ["prediction_context = 'CURRENT_PAIR'"];
  const values: unknown[] = [];
  if (params.horizon) { conditions.push('horizon = ?'); values.push(params.horizon); }
  if (params.symbol) { conditions.push('symbol = ?'); values.push(params.symbol); }

  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  const rows = await executeQuery<CurrentPairPredictionRow>(
    `SELECT prediction_id, model_version, prediction_source, symbol, predicted_at,
            horizon, predicted_direction, confidence, actual_direction,
            actual_return_pct, outcome_status, feature_snapshot_json
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );

  const pairs = new Map<string, { baseline?: CurrentPairPredictionRow; ai?: CurrentPairPredictionRow }>();
  for (const row of rows) {
    const marketRegime = predictionContextValue(row, 'marketRegime');
    const session = predictionContextValue(row, 'session');
    if (params.marketRegime && marketRegime !== params.marketRegime.trim().toUpperCase()) continue;
    if (params.session && session !== params.session.trim().toUpperCase()) continue;
    const key = [row.symbol, row.horizon, marketRegime, session, Number(row.predicted_at)].join('|');
    const pair = pairs.get(key) || {};
    if (row.model_version === 'PAIR_FEATURE_BASELINE_V2') pair.baseline = row;
    if (row.model_version === 'LLAMA_GATEWAY_QWEN_LLAMA_V1') pair.ai = row;
    pairs.set(key, pair);
  }

  const grouped = new Map<string, { symbol: string; horizon: CurrentPairPredictionHorizon; marketRegime: string; session: string; pairs: { baseline?: CurrentPairPredictionRow; ai?: CurrentPairPredictionRow }[] }>();
  for (const pair of pairs.values()) {
    if (!pair.baseline || !pair.ai) continue;
    const marketRegime = predictionContextValue(pair.baseline, 'marketRegime');
    const session = predictionContextValue(pair.baseline, 'session');
    const key = [pair.baseline.symbol, pair.baseline.horizon, marketRegime, session].join('|');
    const group = grouped.get(key) || { symbol: pair.baseline.symbol, horizon: pair.baseline.horizon, marketRegime, session, pairs: [] };
    group.pairs.push(pair);
    grouped.set(key, group);
  }

  const groups = [...grouped.values()].map(group => {
    let pairedEvaluated = 0;
    let pairedPending = 0;
    let bothCorrect = 0;
    let baselineOnlyCorrect = 0;
    let aiOnlyCorrect = 0;
    let bothIncorrect = 0;
    let directionAgreement = 0;

    for (const pair of group.pairs) {
      if (pair.baseline!.predicted_direction === pair.ai!.predicted_direction) directionAgreement++;
      const baselineEvaluated = pair.baseline!.outcome_status === 'EVALUATED' && Boolean(pair.baseline!.actual_direction);
      const aiEvaluated = pair.ai!.outcome_status === 'EVALUATED' && Boolean(pair.ai!.actual_direction);
      if (!baselineEvaluated || !aiEvaluated || pair.baseline!.actual_direction !== pair.ai!.actual_direction) {
        pairedPending++;
        continue;
      }
      const actual = pair.baseline!.actual_direction as 'UP' | 'DOWN' | 'FLAT';
      const baselineScore = directionalScore(pair.baseline!, actual);
      const aiScore = directionalScore(pair.ai!, actual);
      if (!baselineScore.evaluated || !aiScore.evaluated) {
        pairedPending++;
        continue;
      }
      pairedEvaluated++;
      if (baselineScore.correct && aiScore.correct) bothCorrect++;
      else if (baselineScore.correct) baselineOnlyCorrect++;
      else if (aiScore.correct) aiOnlyCorrect++;
      else bothIncorrect++;
    }

    return {
      symbol: group.symbol,
      horizon: group.horizon,
      marketRegime: group.marketRegime,
      session: group.session,
      pairedObservations: group.pairs.length,
      pairedEvaluated,
      pairedPending,
      bothCorrect,
      baselineOnlyCorrect,
      aiOnlyCorrect,
      bothIncorrect,
      directionAgreementPct: group.pairs.length ? (directionAgreement / group.pairs.length) * 100 : null,
      discordantPairs: baselineOnlyCorrect + aiOnlyCorrect,
      exactMcNemarPValue: exactMcNemarTwoSidedPValue(baselineOnlyCorrect, aiOnlyCorrect),
      sampleSufficient: pairedEvaluated >= CURRENT_PAIR_MIN_SAMPLE_COUNT,
      accuracyConfidenceInterval95Pct: wilsonConfidenceInterval95(baselineOnlyCorrect + bothCorrect, pairedEvaluated)
    };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.horizon.localeCompare(b.horizon) || a.marketRegime.localeCompare(b.marketRegime) || a.session.localeCompare(b.session));

  return { groups, generatedAt: Date.now() };
}

export async function getCurrentPairPredictionAnalytics(params: {
  modelVersion?: string;
  horizon?: CurrentPairPredictionHorizon;
  symbol?: string;
  limit?: number;
} = {}): Promise<{
  total: number;
  evaluated: number;
  pending: number;
  groups: CurrentPairPredictionGroupMetrics[];
  generatedAt: number;
}> {
  const conditions = ["prediction_context = 'CURRENT_PAIR'"];
  const values: unknown[] = [];
  if (params.modelVersion) {
    conditions.push('model_version = ?');
    values.push(params.modelVersion);
  }
  if (params.horizon) {
    conditions.push('horizon = ?');
    values.push(params.horizon);
  }
  if (params.symbol) {
    conditions.push('symbol = ?');
    values.push(params.symbol);
  }

  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  const rows = await executeQuery<CurrentPairPredictionRow>(
    `SELECT prediction_id, model_version, prediction_source, symbol, predicted_at,
            horizon, predicted_direction, confidence, actual_direction,
            actual_return_pct, outcome_status, feature_snapshot_json
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );

  const groups = new Map<string, CurrentPairPredictionRow[]>();
  for (const row of rows) {
    const key = [row.symbol, row.model_version, row.horizon, predictionContextValue(row, 'marketRegime'), predictionContextValue(row, 'session')].join('|');
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }

  const metrics: CurrentPairPredictionGroupMetrics[] = [...groups.values()].map(group => {
    const evaluatedRows = group.filter(row => row.outcome_status === 'EVALUATED' && row.actual_direction);
    const directional = evaluatedRows
      .map(row => directionalScore(row, row.actual_direction as 'UP' | 'DOWN' | 'FLAT'))
      .filter(result => result.evaluated);
    const correct = directional.filter(result => result.correct).length;
    const brierValues = directional
      .map(result => result.brier)
      .filter((value): value is number => value !== null);

    const calibration = [0, 1, 2, 3, 4].map(index => {
      const lower = index * 0.2;
      const upper = index === 4 ? 1 : lower + 0.2;
      const binRows = evaluatedRows.filter(row => {
        const confidence = Math.max(0, Math.min(1, Number(row.confidence) || 0));
        return confidence >= lower && (index === 4 ? confidence <= upper : confidence < upper);
      });
      const binDirectional = binRows
        .map(row => directionalScore(row, row.actual_direction as 'UP' | 'DOWN' | 'FLAT'))
        .filter(result => result.evaluated);
      const binCorrect = binDirectional.filter(result => result.correct).length;
      return {
        lowerPct: lower * 100,
        upperPct: upper * 100,
        predictions: binRows.length,
        evaluated: binDirectional.length,
        correct: binCorrect,
        accuracyPct: binDirectional.length ? (binCorrect / binDirectional.length) * 100 : null,
        averageConfidencePct: binRows.length
          ? binRows.reduce((sum, row) => sum + Math.max(0, Math.min(1, Number(row.confidence) || 0)), 0) / binRows.length * 100
          : null,
        sampleSufficient: binDirectional.length >= CURRENT_PAIR_MIN_SAMPLE_COUNT
      };
    });

    const latestEvaluatedAt = evaluatedRows.reduce((latest, row) => Math.max(latest, Number(row.predicted_at) || 0), 0);
    const rollingWindows = ([30, 90] as const).map(windowDays => {
      const cutoff = latestEvaluatedAt - windowDays * 24 * 60 * 60 * 1000;
      const windowRows = evaluatedRows.filter(row => Number(row.predicted_at) >= cutoff);
      const windowDirectional = windowRows
        .map(row => directionalScore(row, row.actual_direction as 'UP' | 'DOWN' | 'FLAT'))
        .filter(result => result.evaluated);
      const windowCorrect = windowDirectional.filter(result => result.correct).length;
      const windowBrier = windowDirectional
        .map(result => result.brier)
        .filter((value): value is number => value !== null);
      return {
        windowDays,
        evaluated: windowRows.length,
        directionalEvaluated: windowDirectional.length,
        correct: windowCorrect,
        accuracyPct: windowDirectional.length ? (windowCorrect / windowDirectional.length) * 100 : null,
        brierScore: windowBrier.length ? windowBrier.reduce((sum, value) => sum + value, 0) / windowBrier.length : null,
        sampleSufficient: windowDirectional.length >= CURRENT_PAIR_MIN_SAMPLE_COUNT,
        accuracyConfidenceInterval95Pct: wilsonConfidenceInterval95(windowCorrect, windowDirectional.length)
      };
    });

    return {
      symbol: group[0].symbol,
      modelVersion: group[0].model_version,
      horizon: group[0].horizon,
      predictions: group.length,
      evaluated: evaluatedRows.length,
      pending: group.length - evaluatedRows.length,
      correct,
      directionalEvaluated: directional.length,
      accuracyPct: directional.length ? (correct / directional.length) * 100 : null,
      brierScore: brierValues.length
        ? brierValues.reduce((sum, value) => sum + value, 0) / brierValues.length
        : null,
      upPredictions: group.filter(row => row.predicted_direction === 'UP').length,
      downPredictions: group.filter(row => row.predicted_direction === 'DOWN').length,
      flatPredictions: group.filter(row => row.predicted_direction === 'FLAT').length,
      upActuals: evaluatedRows.filter(row => row.actual_direction === 'UP').length,
      downActuals: evaluatedRows.filter(row => row.actual_direction === 'DOWN').length,
      flatActuals: evaluatedRows.filter(row => row.actual_direction === 'FLAT').length,
      calibration,
      marketRegime: predictionContextValue(group[0], 'marketRegime'),
      session: predictionContextValue(group[0], 'session'),
      sampleSufficient: directional.length >= CURRENT_PAIR_MIN_SAMPLE_COUNT,
      minimumSampleCount: CURRENT_PAIR_MIN_SAMPLE_COUNT,
      accuracyConfidenceInterval95Pct: wilsonConfidenceInterval95(correct, directional.length),
      rollingWindows,
      walkForwardCohorts: []
    };
  }).sort((a, b) =>
    a.symbol.localeCompare(b.symbol) ||
    a.modelVersion.localeCompare(b.modelVersion) ||
    a.horizon.localeCompare(b.horizon)
  );

  return {
    total: rows.length,
    evaluated: rows.filter(row => row.outcome_status === 'EVALUATED').length,
    pending: rows.filter(row => row.outcome_status !== 'EVALUATED').length,
    groups: metrics,
    generatedAt: Date.now()
  };
}
