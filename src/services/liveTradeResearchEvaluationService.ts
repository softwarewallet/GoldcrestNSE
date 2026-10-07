import { executeRun, executeQuery } from '../database/db';
import { getLiveTradeResearchTrainingDataset, ResearchTrainingRow } from './liveTradeResearchTrainingService';

export interface DirectionalConfusionMatrix {
  trueUpPredictedUp: number;
  trueUpPredictedDown: number;
  trueDownPredictedUp: number;
  trueDownPredictedDown: number;
}

export interface DirectionalEvaluationMetrics {
  samples: number;
  correct: number;
  accuracyPct: number | null;
  precisionPct: number | null;
  recallPct: number | null;
  f1Pct: number | null;
  confusion: DirectionalConfusionMatrix;
  majorityClassAccuracyPct: number | null;
}

export interface ResearchEvaluationResult {
  evaluationId: string;
  modelVersion: string;
  predictionSource: string;
  horizon: '1D' | '3D' | '7D';
  totalLabeledRows: number;
  trainRows: number;
  testRows: number;
  trainFromTimestamp: number | null;
  trainToTimestamp: number | null;
  testFromTimestamp: number | null;
  testToTimestamp: number | null;
  metrics: DirectionalEvaluationMetrics;
  evaluatedAt: number;
}

function actualDirection(row: ResearchTrainingRow, horizon: '1D' | '3D' | '7D'): 'UP' | 'DOWN' | null {
  const value = horizon === '1D'
    ? row.label1dDirection
    : horizon === '3D'
      ? row.label3dDirection
      : row.label7dDirection;
  return value === 'UP' || value === 'DOWN' ? value : null;
}

function predictedDirection(row: ResearchTrainingRow): 'UP' | 'DOWN' | null {
  const direction = String(row.direction || '').toUpperCase();
  if (direction.includes('BUY')) return 'UP';
  if (direction.includes('SELL')) return 'DOWN';
  return null;
}

export function evaluateDirectionalRows(
  rows: ResearchTrainingRow[],
  horizon: '1D' | '3D' | '7D'
): DirectionalEvaluationMetrics {
  const labeled = rows
    .map(row => ({ actual: actualDirection(row, horizon), predicted: predictedDirection(row) }))
    .filter(item => item.actual !== null && item.predicted !== null) as Array<{ actual: 'UP' | 'DOWN'; predicted: 'UP' | 'DOWN' }>;

  const confusion: DirectionalConfusionMatrix = {
    trueUpPredictedUp: 0,
    trueUpPredictedDown: 0,
    trueDownPredictedUp: 0,
    trueDownPredictedDown: 0
  };

  for (const item of labeled) {
    if (item.actual === 'UP' && item.predicted === 'UP') confusion.trueUpPredictedUp += 1;
    if (item.actual === 'UP' && item.predicted === 'DOWN') confusion.trueUpPredictedDown += 1;
    if (item.actual === 'DOWN' && item.predicted === 'UP') confusion.trueDownPredictedUp += 1;
    if (item.actual === 'DOWN' && item.predicted === 'DOWN') confusion.trueDownPredictedDown += 1;
  }

  const samples = labeled.length;
  const correct = confusion.trueUpPredictedUp + confusion.trueDownPredictedDown;
  const accuracyPct = samples ? (correct / samples) * 100 : null;
  const precisionDenominator = confusion.trueUpPredictedUp + confusion.trueDownPredictedUp;
  const recallDenominator = confusion.trueUpPredictedUp + confusion.trueUpPredictedDown;
  const precision = precisionDenominator ? confusion.trueUpPredictedUp / precisionDenominator : null;
  const recall = recallDenominator ? confusion.trueUpPredictedUp / recallDenominator : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;

  const upCount = labeled.filter(item => item.actual === 'UP').length;
  const downCount = samples - upCount;
  const majority = Math.max(upCount, downCount);

  return {
    samples,
    correct,
    accuracyPct,
    precisionPct: precision === null ? null : precision * 100,
    recallPct: recall === null ? null : recall * 100,
    f1Pct: f1 === null ? null : f1 * 100,
    confusion,
    majorityClassAccuracyPct: samples ? (majority / samples) * 100 : null
  };
}

function splitWalkForward(rows: ResearchTrainingRow[]): { train: ResearchTrainingRow[]; test: ResearchTrainingRow[] } {
  const ordered = [...rows].sort((a, b) => a.signalTimestamp - b.signalTimestamp);
  if (ordered.length < 2) return { train: ordered, test: [] };
  const splitIndex = Math.max(1, Math.floor(ordered.length * 0.7));
  return { train: ordered.slice(0, splitIndex), test: ordered.slice(splitIndex) };
}

export async function evaluateLiveTradeResearch(params: {
  fromTimestamp?: number;
  toTimestamp?: number;
  horizon?: '1D' | '3D' | '7D';
  modelVersion?: string;
} = {}): Promise<ResearchEvaluationResult> {
  const horizon = params.horizon || '1D';
  const modelVersion = params.modelVersion || 'SIGNAL_DIRECTION_BASELINE';
  const rows = await getLiveTradeResearchTrainingDataset({
    fromTimestamp: params.fromTimestamp,
    toTimestamp: params.toTimestamp,
    limit: 100000
  });
  const labeledRows = rows.filter(row => actualDirection(row, horizon) !== null && predictedDirection(row) !== null);
  const split = splitWalkForward(labeledRows);
  const metrics = evaluateDirectionalRows(split.test, horizon);
  const evaluatedAt = Date.now();
  const evaluationId = `eval-${evaluatedAt}-${Math.random().toString(36).slice(2, 8)}`;

  await executeRun(`CREATE TABLE IF NOT EXISTS live_trade_research_evaluations (
    evaluation_id TEXT PRIMARY KEY,
    model_version TEXT NOT NULL,
    prediction_source TEXT NOT NULL,
    horizon TEXT NOT NULL,
    total_labeled_rows INTEGER NOT NULL,
    train_rows INTEGER NOT NULL,
    test_rows INTEGER NOT NULL,
    train_from_timestamp INTEGER,
    train_to_timestamp INTEGER,
    test_from_timestamp INTEGER,
    test_to_timestamp INTEGER,
    metrics_json TEXT NOT NULL,
    evaluated_at INTEGER NOT NULL
  )`);

  await executeRun(
    `INSERT OR REPLACE INTO live_trade_research_evaluations (
      evaluation_id, model_version, prediction_source, horizon, total_labeled_rows,
      train_rows, test_rows, train_from_timestamp, train_to_timestamp,
      test_from_timestamp, test_to_timestamp, metrics_json, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evaluationId, modelVersion, 'LIVE_SIGNAL_DIRECTION', horizon, labeledRows.length,
      split.train.length, split.test.length,
      split.train[0]?.signalTimestamp ?? null,
      split.train[split.train.length - 1]?.signalTimestamp ?? null,
      split.test[0]?.signalTimestamp ?? null,
      split.test[split.test.length - 1]?.signalTimestamp ?? null,
      JSON.stringify(metrics),
      evaluatedAt
    ]
  );

  return {
    evaluationId,
    modelVersion,
    predictionSource: 'LIVE_SIGNAL_DIRECTION',
    horizon,
    totalLabeledRows: labeledRows.length,
    trainRows: split.train.length,
    testRows: split.test.length,
    trainFromTimestamp: split.train[0]?.signalTimestamp ?? null,
    trainToTimestamp: split.train[split.train.length - 1]?.signalTimestamp ?? null,
    testFromTimestamp: split.test[0]?.signalTimestamp ?? null,
    testToTimestamp: split.test[split.test.length - 1]?.signalTimestamp ?? null,
    metrics,
    evaluatedAt
  };
}

export async function getLiveTradeResearchEvaluations(limit = 50): Promise<any[]> {
  const safeLimit = Math.max(1, Math.min(250, Math.floor(Number(limit) || 50)));
  return executeQuery<any>(
    `SELECT evaluation_id, model_version, prediction_source, horizon,
            total_labeled_rows, train_rows, test_rows,
            train_from_timestamp, train_to_timestamp,
            test_from_timestamp, test_to_timestamp,
            metrics_json, evaluated_at
       FROM live_trade_research_evaluations
      ORDER BY evaluated_at DESC
      LIMIT ?`,
    [safeLimit]
  );
}
