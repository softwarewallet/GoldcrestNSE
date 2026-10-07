import { executeQuery } from '../database/db';
import type { CurrentPairPredictionHorizon } from './currentPairPredictionOutcomeService';

export interface CurrentPairCalibrationBucket {
  lowerPct: number;
  upperPct: number;
  predictions: number;
  directionalEvaluated: number;
  correct: number;
  averageConfidencePct: number | null;
  accuracyPct: number | null;
  accuracyConfidenceInterval95Pct: { lowerPct: number; upperPct: number } | null;
  calibrationGapPct: number | null;
  sampleSufficient: boolean;
}

export interface CurrentPairOosDriftWindow {
  windowDays: 30 | 90;
  predictions: number;
  evaluated: number;
  directionalEvaluated: number;
  correct: number;
  accuracyPct: number | null;
  brierScore: number | null;
  averageConfidencePct: number | null;
  calibrationGapPct: number | null;
  expectedCalibrationErrorPct: number | null;
  maximumCalibrationErrorPct: number | null;
  sampleSufficient: boolean;
  calibrationBuckets: CurrentPairCalibrationBucket[];
}

export interface CurrentPairOosBootstrapInterval {
  lower: number;
  upper: number;
  confidenceLevelPct: number;
  resamples: number;
}

export interface CurrentPairOosDriftReport {
  symbol: string | null;
  horizon: CurrentPairPredictionHorizon;
  modelVersion: string;
  generatedAt: number;
  currentWindow: CurrentPairOosDriftWindow;
  baselineWindow: CurrentPairOosDriftWindow;
  uncertainty: {
    accuracyDelta95Pct: CurrentPairOosBootstrapInterval | null;
    brierDelta95: CurrentPairOosBootstrapInterval | null;
    calibrationErrorDelta95Pct: CurrentPairOosBootstrapInterval | null;
    maximumCalibrationErrorDelta95Pct: CurrentPairOosBootstrapInterval | null;
  };
  drift: {
    accuracyDeltaPct: number | null;
    brierDelta: number | null;
    confidenceDeltaPct: number | null;
    calibrationGapDeltaPct: number | null;
    calibrationErrorDeltaPct: number | null;
    accuracyDriftFlag: boolean;
    brierDriftFlag: boolean;
    confidenceDriftFlag: boolean;
    calibrationDriftFlag: boolean;
    calibrationErrorDriftFlag: boolean;
  };
  checks: Array<{
    id: string;
    status: 'PASS' | 'WARN' | 'INSUFFICIENT';
    title: string;
    detail: string;
  }>;
}

const MIN_SAMPLE_COUNT = 30;
const BASELINE_WINDOW_DAYS = 90;
const CURRENT_WINDOW_DAYS = 30;
const ACCURACY_DRIFT_THRESHOLD_PCT = 10;
const BRIER_DRIFT_THRESHOLD = 0.1;
const CONFIDENCE_DRIFT_THRESHOLD_PCT = 10;
const CALIBRATION_GAP_THRESHOLD_PCT = 10;

function horizonMs(horizon: CurrentPairPredictionHorizon): number {
  if (horizon === '1D') return 24 * 60 * 60 * 1000;
  if (horizon === '3D') return 3 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function clampConfidence(value: unknown): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

const BOOTSTRAP_RESAMPLES = 2000;

function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function percentile(sorted: number[], probability: number): number | null {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
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

function bootstrapDifferenceInterval(
  currentValues: number[],
  baselineValues: number[],
  seed: number,
  resamples = BOOTSTRAP_RESAMPLES
): CurrentPairOosBootstrapInterval | null {
  if (currentValues.length < MIN_SAMPLE_COUNT || baselineValues.length < MIN_SAMPLE_COUNT) return null;
  const rng = createDeterministicRng(seed);
  const differences: number[] = new Array(resamples);
  for (let sample = 0; sample < resamples; sample++) {
    let currentSum = 0;
    let baselineSum = 0;
    for (let i = 0; i < currentValues.length; i++) currentSum += currentValues[Math.floor(rng() * currentValues.length)];
    for (let i = 0; i < baselineValues.length; i++) baselineSum += baselineValues[Math.floor(rng() * baselineValues.length)];
    differences[sample] = currentSum / currentValues.length - baselineSum / baselineValues.length;
  }
  differences.sort((a, b) => a - b);
  const lower = percentile(differences, 0.025);
  const upper = percentile(differences, 0.975);
  return lower == null || upper == null ? null : { lower, upper, confidenceLevelPct: 95, resamples };
}

function bootstrapCalibrationMetricInterval(
  currentRows: any[],
  baselineRows: any[],
  maturityCutoff: number,
  metric: 'ECE' | 'MCE',
  seed: number,
  resamples = BOOTSTRAP_RESAMPLES
): CurrentPairOosBootstrapInterval | null {
  const currentDirectional = getDirectionalAccuracySamples(currentRows, maturityCutoff);
  const baselineDirectional = getDirectionalAccuracySamples(baselineRows, maturityCutoff);
  if (currentDirectional.length < MIN_SAMPLE_COUNT || baselineDirectional.length < MIN_SAMPLE_COUNT) return null;

  const rng = createDeterministicRng(seed);
  const differences: number[] = new Array(resamples);
  const sampleMetric = (sourceRows: any[], sampleSize: number): number | null => {
    const sampledRows: any[] = new Array(sampleSize);
    for (let i = 0; i < sampleSize; i++) {
      sampledRows[i] = sourceRows[Math.floor(rng() * sourceRows.length)];
    }
    const buckets = buildCalibrationBuckets(sampledRows, maturityCutoff);
    const aggregate = aggregateCalibrationMetrics(buckets);
    return metric === 'ECE' ? aggregate.expectedCalibrationErrorPct : aggregate.maximumCalibrationErrorPct;
  };

  for (let sample = 0; sample < resamples; sample++) {
    const currentValue = sampleMetric(currentRows, currentRows.length);
    const baselineValue = sampleMetric(baselineRows, baselineRows.length);
    differences[sample] = currentValue == null || baselineValue == null ? 0 : currentValue - baselineValue;
  }

  differences.sort((a, b) => a - b);
  const lower = percentile(differences, 0.025);
  const upper = percentile(differences, 0.975);
  return lower == null || upper == null ? null : { lower, upper, confidenceLevelPct: 95, resamples };
}

function getDirectionalAccuracySamples(rows: any[], maturityCutoff: number): number[] {
  const samples: number[] = [];
  for (const row of rows) {
    if (Number(row.predicted_at) > maturityCutoff || row.outcome_status !== 'EVALUATED' || !row.actual_direction) continue;
    if (row.predicted_direction === 'FLAT' || row.actual_direction === 'FLAT') continue;
    samples.push(row.predicted_direction === row.actual_direction ? 1 : 0);
  }
  return samples;
}

function getBrierSamples(rows: any[], maturityCutoff: number): number[] {
  const samples: number[] = [];
  for (const row of rows) {
    if (Number(row.predicted_at) > maturityCutoff || row.outcome_status !== 'EVALUATED' || !row.actual_direction) continue;
    if (row.predicted_direction === 'FLAT' || row.actual_direction === 'FLAT') continue;
    const confidence = clampConfidence(row.confidence);
    const probabilityUp = row.predicted_direction === 'UP' ? confidence : 1 - confidence;
    const actualUp = row.actual_direction === 'UP' ? 1 : 0;
    samples.push(Math.pow(probabilityUp - actualUp, 2));
  }
  return samples;
}

function emptyCalibrationBucket(lowerPct: number, upperPct: number): CurrentPairCalibrationBucket {
  return {
    lowerPct,
    upperPct,
    predictions: 0,
    directionalEvaluated: 0,
    correct: 0,
    averageConfidencePct: null,
    accuracyPct: null,
    accuracyConfidenceInterval95Pct: null,
    calibrationGapPct: null,
    sampleSufficient: false
  };
}

function buildCalibrationBuckets(rows: any[], maturityCutoff: number): CurrentPairCalibrationBucket[] {
  return Array.from({ length: 5 }, (_, index) => {
    const lower = index * 20;
    const upper = index === 4 ? 100 : lower + 20;
    const bucket = emptyCalibrationBucket(lower, upper);
    const bucketRows = rows.filter(row => {
      const confidencePct = clampConfidence(row.confidence) * 100;
      return confidencePct >= lower && (index === 4 ? confidencePct <= upper : confidencePct < upper);
    });
    bucket.predictions = bucketRows.length;
    let confidenceSum = 0;
    for (const row of bucketRows) {
      const confidence = clampConfidence(row.confidence);
      confidenceSum += confidence;
      if (Number(row.predicted_at) > maturityCutoff || row.outcome_status !== 'EVALUATED' || !row.actual_direction) continue;
      if (row.predicted_direction === 'FLAT' || row.actual_direction === 'FLAT') continue;
      bucket.directionalEvaluated++;
      if (row.predicted_direction === row.actual_direction) bucket.correct++;
    }
    bucket.averageConfidencePct = bucketRows.length ? (confidenceSum / bucketRows.length) * 100 : null;
    bucket.accuracyPct = bucket.directionalEvaluated ? (bucket.correct / bucket.directionalEvaluated) * 100 : null;
    bucket.accuracyConfidenceInterval95Pct = wilsonConfidenceInterval95(bucket.correct, bucket.directionalEvaluated);
    bucket.calibrationGapPct = bucket.accuracyPct != null && bucket.averageConfidencePct != null
      ? Math.abs(bucket.averageConfidencePct - bucket.accuracyPct)
      : null;
    bucket.sampleSufficient = bucket.directionalEvaluated >= MIN_SAMPLE_COUNT;
    return bucket;
  });
}

function aggregateCalibrationMetrics(buckets: CurrentPairCalibrationBucket[]): { expectedCalibrationErrorPct: number | null; maximumCalibrationErrorPct: number | null } {
  const evaluatedBuckets = buckets.filter(bucket => bucket.directionalEvaluated > 0 && bucket.calibrationGapPct != null);
  const totalDirectional = evaluatedBuckets.reduce((sum, bucket) => sum + bucket.directionalEvaluated, 0);
  const expectedCalibrationErrorPct = totalDirectional > 0
    ? evaluatedBuckets.reduce((sum, bucket) => sum + (bucket.calibrationGapPct as number) * (bucket.directionalEvaluated / totalDirectional), 0)
    : null;
  const sufficientBuckets = buckets.filter(bucket => bucket.sampleSufficient && bucket.calibrationGapPct != null);
  const maximumCalibrationErrorPct = sufficientBuckets.length
    ? Math.max(...sufficientBuckets.map(bucket => bucket.calibrationGapPct as number))
    : null;
  return { expectedCalibrationErrorPct, maximumCalibrationErrorPct };
}

function emptyWindow(windowDays: 30 | 90): CurrentPairOosDriftWindow {
  return {
    windowDays,
    predictions: 0,
    evaluated: 0,
    directionalEvaluated: 0,
    correct: 0,
    accuracyPct: null,
    brierScore: null,
    averageConfidencePct: null,
    calibrationGapPct: null,
    expectedCalibrationErrorPct: null,
    maximumCalibrationErrorPct: null,
    sampleSufficient: false,
    calibrationBuckets: []
  };
}

export async function getCurrentPairOosDriftReport(params: {
  symbol?: string;
  horizon?: CurrentPairPredictionHorizon;
  modelVersion: string;
  now?: number;
}): Promise<CurrentPairOosDriftReport> {
  const symbol = params.symbol?.trim().toUpperCase() || null;
  const horizon = params.horizon || '1D';
  const now = Number(params.now) || Date.now();
  const currentCutoff = now - CURRENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const baselineStart = now - (CURRENT_WINDOW_DAYS + BASELINE_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const maturityCutoff = now - horizonMs(horizon);

  const conditions = [
    "prediction_context = 'CURRENT_PAIR'",
    'model_version = ?',
    'horizon = ?',
    'predicted_at >= ?',
    'predicted_at <= ?'
  ];
  const values: unknown[] = [params.modelVersion, horizon, baselineStart, now];
  if (symbol) {
    conditions.push('symbol = ?');
    values.push(symbol);
  }

  const rows = await executeQuery<any>(
    `SELECT predicted_at, predicted_direction, confidence, actual_direction, actual_return_pct,
            outcome_status
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC`,
    values
  );

  const buildWindow = (windowDays: 30 | 90, cutoff: number): CurrentPairOosDriftWindow => {
    const windowRows = rows.filter(row => Number(row.predicted_at) >= cutoff);
    const result = emptyWindow(windowDays);
    result.predictions = windowRows.length;

    let confidenceSum = 0;
    let confidenceCount = 0;
    let brierSum = 0;
    let brierCount = 0;

    for (const row of windowRows) {
      const confidence = clampConfidence(row.confidence);
      confidenceSum += confidence;
      confidenceCount++;

      if (Number(row.predicted_at) > maturityCutoff || row.outcome_status !== 'EVALUATED' || !row.actual_direction) continue;
      result.evaluated++;

      if (row.predicted_direction === 'FLAT' || row.actual_direction === 'FLAT') continue;
      result.directionalEvaluated++;

      const correct = row.predicted_direction === row.actual_direction;
      if (correct) result.correct++;

      const probabilityUp = row.predicted_direction === 'UP' ? confidence : 1 - confidence;
      const actualUp = row.actual_direction === 'UP' ? 1 : 0;
      brierSum += Math.pow(probabilityUp - actualUp, 2);
      brierCount++;
    }

    result.accuracyPct = result.directionalEvaluated
      ? (result.correct / result.directionalEvaluated) * 100
      : null;
    result.brierScore = brierCount ? brierSum / brierCount : null;
    result.averageConfidencePct = confidenceCount ? (confidenceSum / confidenceCount) * 100 : null;
    result.calibrationGapPct = result.accuracyPct != null && result.averageConfidencePct != null
      ? Math.abs(result.averageConfidencePct - result.accuracyPct)
      : null;
    result.sampleSufficient = result.directionalEvaluated >= MIN_SAMPLE_COUNT;
    result.calibrationBuckets = buildCalibrationBuckets(windowRows, maturityCutoff);
    const aggregateCalibration = aggregateCalibrationMetrics(result.calibrationBuckets);
    result.expectedCalibrationErrorPct = aggregateCalibration.expectedCalibrationErrorPct;
    result.maximumCalibrationErrorPct = aggregateCalibration.maximumCalibrationErrorPct;
    return result;
  };

  const currentWindow = buildWindow(30, currentCutoff);
  const baselineRows = rows.filter(row => Number(row.predicted_at) < currentCutoff);
  const buildPriorWindow = (): CurrentPairOosDriftWindow => {
    const result = emptyWindow(90);
    const windowRows = baselineRows;
    result.predictions = windowRows.length;
    let confidenceSum = 0;
    let confidenceCount = 0;
    let brierSum = 0;
    let brierCount = 0;
    for (const row of windowRows) {
      const confidence = clampConfidence(row.confidence);
      confidenceSum += confidence;
      confidenceCount++;
      if (Number(row.predicted_at) > maturityCutoff || row.outcome_status !== 'EVALUATED' || !row.actual_direction) continue;
      result.evaluated++;
      if (row.predicted_direction === 'FLAT' || row.actual_direction === 'FLAT') continue;
      result.directionalEvaluated++;
      if (row.predicted_direction === row.actual_direction) result.correct++;
      const probabilityUp = row.predicted_direction === 'UP' ? confidence : 1 - confidence;
      const actualUp = row.actual_direction === 'UP' ? 1 : 0;
      brierSum += Math.pow(probabilityUp - actualUp, 2);
      brierCount++;
    }
    result.accuracyPct = result.directionalEvaluated ? (result.correct / result.directionalEvaluated) * 100 : null;
    result.brierScore = brierCount ? brierSum / brierCount : null;
    result.averageConfidencePct = confidenceCount ? (confidenceSum / confidenceCount) * 100 : null;
    result.calibrationGapPct = result.accuracyPct != null && result.averageConfidencePct != null ? Math.abs(result.averageConfidencePct - result.accuracyPct) : null;
    result.sampleSufficient = result.directionalEvaluated >= MIN_SAMPLE_COUNT;
    result.calibrationBuckets = buildCalibrationBuckets(windowRows, maturityCutoff);
    const aggregateCalibration = aggregateCalibrationMetrics(result.calibrationBuckets);
    result.expectedCalibrationErrorPct = aggregateCalibration.expectedCalibrationErrorPct;
    result.maximumCalibrationErrorPct = aggregateCalibration.maximumCalibrationErrorPct;
    return result;
  };
  const baselineWindow = buildPriorWindow();

  const delta = (current: number | null, baseline: number | null) =>
    current == null || baseline == null ? null : current - baseline;

  const accuracyDeltaPct = delta(currentWindow.accuracyPct, baselineWindow.accuracyPct);
  const brierDelta = delta(currentWindow.brierScore, baselineWindow.brierScore);
  const confidenceDeltaPct = delta(currentWindow.averageConfidencePct, baselineWindow.averageConfidencePct);
  const calibrationGapDeltaPct = delta(currentWindow.calibrationGapPct, baselineWindow.calibrationGapPct);
  const calibrationErrorDeltaPct = delta(currentWindow.expectedCalibrationErrorPct, baselineWindow.expectedCalibrationErrorPct);

  const currentRows = rows.filter(row => Number(row.predicted_at) >= currentCutoff);
  const baselineRowsForBootstrap = rows.filter(row => Number(row.predicted_at) < currentCutoff);
  const currentAccuracySamples = getDirectionalAccuracySamples(currentRows, maturityCutoff);
  const baselineAccuracySamples = getDirectionalAccuracySamples(baselineRowsForBootstrap, maturityCutoff);
  const currentBrierSamples = getBrierSamples(currentRows, maturityCutoff);
  const baselineBrierSamples = getBrierSamples(baselineRowsForBootstrap, maturityCutoff);
  const uncertainty = {
    accuracyDelta95Pct: bootstrapDifferenceInterval(currentAccuracySamples, baselineAccuracySamples, 0xA11CE),
    brierDelta95: bootstrapDifferenceInterval(currentBrierSamples, baselineBrierSamples, 0xB11E7),
    calibrationErrorDelta95Pct: bootstrapCalibrationMetricInterval(currentRows, baselineRowsForBootstrap, maturityCutoff, 'ECE', 0xECE01),
    maximumCalibrationErrorDelta95Pct: bootstrapCalibrationMetricInterval(currentRows, baselineRowsForBootstrap, maturityCutoff, 'MCE', 0x0CE01)
  };

  const checks = [
    {
      id: 'current-sample',
      status: currentWindow.sampleSufficient ? 'PASS' as const : 'INSUFFICIENT' as const,
      title: 'Current OOS sample',
      detail: `${currentWindow.directionalEvaluated} evaluated directional observations in the latest 30 days; minimum is ${MIN_SAMPLE_COUNT}.`
    },
    {
      id: 'baseline-sample',
      status: baselineWindow.sampleSufficient ? 'PASS' as const : 'INSUFFICIENT' as const,
      title: 'Reference OOS sample',
      detail: `${baselineWindow.directionalEvaluated} evaluated directional observations in the latest 90 days; minimum is ${MIN_SAMPLE_COUNT}.`
    },
    {
      id: 'accuracy-drift',
      status: accuracyDeltaPct == null ? 'INSUFFICIENT' as const : Math.abs(accuracyDeltaPct) >= ACCURACY_DRIFT_THRESHOLD_PCT ? 'WARN' as const : 'PASS' as const,
      title: 'Accuracy drift',
      detail: accuracyDeltaPct == null ? 'Insufficient evaluated data for comparison.' : `30-day minus 90-day accuracy is ${accuracyDeltaPct.toFixed(2)} percentage points.`
    },
    {
      id: 'brier-drift',
      status: brierDelta == null ? 'INSUFFICIENT' as const : Math.abs(brierDelta) >= BRIER_DRIFT_THRESHOLD ? 'WARN' as const : 'PASS' as const,
      title: 'Brier drift',
      detail: brierDelta == null ? 'Insufficient evaluated data for comparison.' : `30-day minus 90-day Brier score is ${brierDelta.toFixed(4)}.`
    },
    {
      id: 'confidence-drift',
      status: confidenceDeltaPct == null ? 'INSUFFICIENT' as const : Math.abs(confidenceDeltaPct) >= CONFIDENCE_DRIFT_THRESHOLD_PCT ? 'WARN' as const : 'PASS' as const,
      title: 'Confidence drift',
      detail: confidenceDeltaPct == null ? 'Insufficient prediction data for comparison.' : `30-day minus 90-day average confidence is ${confidenceDeltaPct.toFixed(2)} percentage points.`
    },
    {
      id: 'calibration-drift',
      status: calibrationGapDeltaPct == null ? 'INSUFFICIENT' as const : Math.abs(calibrationGapDeltaPct) >= CALIBRATION_GAP_THRESHOLD_PCT ? 'WARN' as const : 'PASS' as const,
      title: 'Calibration-gap drift',
      detail: calibrationGapDeltaPct == null ? 'Insufficient evaluated data for comparison.' : `30-day minus 90-day confidence/accuracy gap is ${calibrationGapDeltaPct.toFixed(2)} percentage points.`
    },
    {
      id: 'aggregate-calibration-error',
      status: calibrationErrorDeltaPct == null ? 'INSUFFICIENT' as const : Math.abs(calibrationErrorDeltaPct) >= CALIBRATION_GAP_THRESHOLD_PCT ? 'WARN' as const : 'PASS' as const,
      title: 'Expected calibration error stability',
      detail: calibrationErrorDeltaPct == null ? 'Insufficient evaluated data for aggregate calibration comparison.' : `30-day minus 90-day expected calibration error is ${calibrationErrorDeltaPct.toFixed(2)} percentage points.`
    }
  ];

  return {
    symbol,
    horizon,
    modelVersion: params.modelVersion,
    generatedAt: now,
    currentWindow,
    baselineWindow,
    uncertainty,
    drift: {
      accuracyDeltaPct,
      brierDelta,
      confidenceDeltaPct,
      calibrationGapDeltaPct,
      calibrationErrorDeltaPct,
      accuracyDriftFlag: accuracyDeltaPct != null && Math.abs(accuracyDeltaPct) >= ACCURACY_DRIFT_THRESHOLD_PCT,
      brierDriftFlag: brierDelta != null && Math.abs(brierDelta) >= BRIER_DRIFT_THRESHOLD,
      confidenceDriftFlag: confidenceDeltaPct != null && Math.abs(confidenceDeltaPct) >= CONFIDENCE_DRIFT_THRESHOLD_PCT,
      calibrationDriftFlag: calibrationGapDeltaPct != null && Math.abs(calibrationGapDeltaPct) >= CALIBRATION_GAP_THRESHOLD_PCT,
      calibrationErrorDriftFlag: calibrationErrorDeltaPct != null && Math.abs(calibrationErrorDeltaPct) >= CALIBRATION_GAP_THRESHOLD_PCT
    },
    checks
  };
}
