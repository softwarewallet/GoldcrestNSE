import { executeQuery, executeRun } from '../database/db';
import { getLiveTradeResearchTrainingDataset, ResearchTrainingRow } from './liveTradeResearchTrainingService';

export type ResearchPredictionHorizon = '1D' | '3D' | '7D';

interface PredictionRow {
  prediction_id: string;
  model_version: string;
  prediction_source: string;
  symbol: string;
  signal_id: string | null;
  predicted_at: number;
  horizon: ResearchPredictionHorizon;
  predicted_direction: 'UP' | 'DOWN' | 'FLAT';
  confidence: number;
  actual_direction: 'UP' | 'DOWN' | 'FLAT' | null;
  actual_return_pct: number | null;
  outcome_status: string;
  trend_alignment?: string | null;
  news_risk_level?: string | null;
}

export interface PredictionEvaluationResult {
  evaluated: number;
  pending: number;
  correct: number;
  directionalEvaluated: number;
  accuracyPct: number | null;
  brierScore: number | null;
  updatedAt: number;
}

export interface PredictionCalibrationBand {
  band: string;
  predictions: number;
  evaluated: number;
  correct: number;
  accuracyPct: number | null;
  averageConfidencePct: number | null;
}

export interface PredictionGroupMetrics {
  key: string;
  predictions: number;
  evaluated: number;
  correct: number;
  accuracyPct: number | null;
}

export interface PredictionAnalytics {
  modelVersion: string | null;
  horizon: ResearchPredictionHorizon | null;
  total: number;
  evaluated: number;
  pending: number;
  directionalEvaluated: number;
  correct: number;
  accuracyPct: number | null;
  brierScore: number | null;
  calibration: PredictionCalibrationBand[];
  bySymbol: PredictionGroupMetrics[];
  byTrendAlignment: PredictionGroupMetrics[];
  byNewsRisk: PredictionGroupMetrics[];
  generatedAt: number;
}

function actualLabel(row: ResearchTrainingRow, horizon: ResearchPredictionHorizon) {
  if (horizon === '1D') return { direction: row.label1dDirection, returnPct: row.label1dReturnPct };
  if (horizon === '3D') return { direction: row.label3dDirection, returnPct: row.label3dReturnPct };
  return { direction: row.label7dDirection, returnPct: row.label7dReturnPct };
}

function directionalScore(prediction: PredictionRow, actual: string | null) {
  if (!actual || actual === 'FLAT' || prediction.predicted_direction === 'FLAT') {
    return { evaluated: false, correct: false, brier: null as number | null };
  }
  const correct = prediction.predicted_direction === actual;
  const confidence = Math.max(0, Math.min(1, Number(prediction.confidence) || 0));
  const probabilityUp = prediction.predicted_direction === 'UP' ? confidence : 1 - confidence;
  const actualUp = actual === 'UP' ? 1 : 0;
  const brier = Math.pow(probabilityUp - actualUp, 2);
  return { evaluated: true, correct, brier };
}

function groupMetrics(rows: PredictionRow[], keyOf: (row: PredictionRow) => string): PredictionGroupMetrics[] {
  const groups = new Map<string, PredictionRow[]>();
  for (const row of rows) {
    const key = keyOf(row) || 'UNKNOWN';
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const evaluated = group.map(row => directionalScore(row, row.actual_direction)).filter(result => result.evaluated);
    const correct = evaluated.filter(result => result.correct).length;
    return {
      key,
      predictions: group.length,
      evaluated: evaluated.length,
      correct,
      accuracyPct: evaluated.length ? (correct / evaluated.length) * 100 : null
    };
  }).sort((a, b) => b.predictions - a.predictions || a.key.localeCompare(b.key));
}

function calibrationBand(confidence: number): string {
  if (confidence < 0.6) return '<60%';
  if (confidence < 0.7) return '60-70%';
  if (confidence < 0.8) return '70-80%';
  if (confidence < 0.9) return '80-90%';
  return '90-100%';
}

async function ensurePredictionTable(): Promise<void> {
  await executeRun(`CREATE TABLE IF NOT EXISTS live_trade_research_predictions (
    prediction_id TEXT PRIMARY KEY,
    model_version TEXT NOT NULL,
    prediction_source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    signal_id TEXT,
    predicted_at INTEGER NOT NULL,
    horizon TEXT NOT NULL,
    predicted_direction TEXT NOT NULL,
    confidence REAL NOT NULL,
    feature_hash TEXT NOT NULL,
    model_agreement REAL,
    reasoning TEXT,
    invalidation TEXT,
    actual_direction TEXT,
    actual_return_pct REAL,
    outcome_status TEXT,
    evaluated_at INTEGER,
    created_at INTEGER NOT NULL
  )`);
}

async function loadPredictionRows(params: {
  modelVersion?: string;
  horizon?: ResearchPredictionHorizon;
  limit?: number;
} = {}): Promise<PredictionRow[]> {
  await ensurePredictionTable();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (params.modelVersion) {
    conditions.push('p.model_version = ?');
    values.push(params.modelVersion);
  }
  if (params.horizon) {
    conditions.push('p.horizon = ?');
    values.push(params.horizon);
  }
  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  return executeQuery<PredictionRow>(
    `SELECT p.*,
            f.trend_alignment AS trend_alignment,
            f.news_risk_level AS news_risk_level
       FROM live_trade_research_predictions p
       LEFT JOIN live_trade_research_features f ON f.signal_id = p.signal_id
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY p.predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );
}

export async function evaluatePendingResearchPredictions(params: {
  fromTimestamp?: number;
  toTimestamp?: number;
  modelVersion?: string;
  horizon?: ResearchPredictionHorizon;
} = {}): Promise<PredictionEvaluationResult> {
  const predictions = await loadPredictionRows({
    modelVersion: params.modelVersion,
    horizon: params.horizon,
    limit: 100000
  });
  const trainingRows = await getLiveTradeResearchTrainingDataset({
    fromTimestamp: params.fromTimestamp,
    toTimestamp: params.toTimestamp,
    limit: 100000
  });
  const trainingBySignal = new Map(trainingRows.map(row => [row.signalId, row]));
  let evaluated = 0;
  let pending = 0;
  let correct = 0;
  let directionalEvaluated = 0;
  let brierSum = 0;

  for (const prediction of predictions) {
    const training = prediction.signal_id ? trainingBySignal.get(prediction.signal_id) : undefined;
    const label = training ? actualLabel(training, prediction.horizon) : { direction: null, returnPct: null };
    if (label.direction === null) {
      pending++;
      continue;
    }

    const score = directionalScore(prediction, label.direction);
    await executeRun(
      `UPDATE live_trade_research_predictions
          SET actual_direction = ?, actual_return_pct = ?, outcome_status = 'EVALUATED', evaluated_at = ?
        WHERE prediction_id = ?`,
      [label.direction, label.returnPct, Date.now(), prediction.prediction_id]
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

export async function getResearchPredictionAnalytics(params: {
  modelVersion?: string;
  horizon?: ResearchPredictionHorizon;
  limit?: number;
} = {}): Promise<PredictionAnalytics> {
  const rows = await loadPredictionRows(params);
  const directional = rows.map(row => directionalScore(row, row.actual_direction)).filter(result => result.evaluated);
  const correct = directional.filter(result => result.correct).length;
  const brierValues = directional.map(result => result.brier).filter((value): value is number => value !== null);
  const calibrationGroups = new Map<string, PredictionRow[]>();

  for (const row of rows) {
    const band = calibrationBand(Math.max(0, Math.min(1, Number(row.confidence) || 0)));
    const group = calibrationGroups.get(band) || [];
    group.push(row);
    calibrationGroups.set(band, group);
  }

  const calibrationOrder = ['<60%', '60-70%', '70-80%', '80-90%', '90-100%'];
  const calibration = calibrationOrder.map(band => {
    const group = calibrationGroups.get(band) || [];
    const evaluated = group.map(row => directionalScore(row, row.actual_direction)).filter(result => result.evaluated);
    const groupCorrect = evaluated.filter(result => result.correct).length;
    const avgConfidence = group.length
      ? group.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / group.length
      : null;
    return {
      band,
      predictions: group.length,
      evaluated: evaluated.length,
      correct: groupCorrect,
      accuracyPct: evaluated.length ? (groupCorrect / evaluated.length) * 100 : null,
      averageConfidencePct: avgConfidence === null ? null : avgConfidence * 100
    };
  });

  return {
    modelVersion: params.modelVersion || null,
    horizon: params.horizon || null,
    total: rows.length,
    evaluated: rows.filter(row => row.outcome_status === 'EVALUATED').length,
    pending: rows.filter(row => row.outcome_status !== 'EVALUATED').length,
    directionalEvaluated: directional.length,
    correct,
    accuracyPct: directional.length ? (correct / directional.length) * 100 : null,
    brierScore: brierValues.length ? brierValues.reduce((sum, value) => sum + value, 0) / brierValues.length : null,
    calibration,
    bySymbol: groupMetrics(rows, row => row.symbol),
    byTrendAlignment: groupMetrics(rows, row => row.trend_alignment || 'UNKNOWN'),
    byNewsRisk: groupMetrics(rows, row => row.news_risk_level || 'UNKNOWN'),
    generatedAt: Date.now()
  };
}
