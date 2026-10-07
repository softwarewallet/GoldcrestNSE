import { createHash } from 'node:crypto';
import { executeQuery, executeRun } from '../database/db';
import { getLiveTradeResearchFeatures, ResearchFeatureRow } from './liveTradeResearchFeatureService';
import { requestResearchAiPrediction } from './researchAiServerService';

export type ResearchPredictionHorizon = '1D' | '3D' | '7D';
export type ResearchPredictionDirection = 'UP' | 'DOWN' | 'FLAT';

export interface ResearchPrediction {
  predictionId: string;
  modelVersion: string;
  predictionSource: string;
  symbol: string;
  signalId: string | null;
  predictedAt: number;
  horizon: ResearchPredictionHorizon;
  predictedDirection: ResearchPredictionDirection;
  confidence: number;
  featureHash: string;
  modelAgreement: number | null;
  reasoning: string | null;
  invalidation: string | null;
}

export interface PredictionModel {
  modelVersion: string;
  predictionSource: string;
  predict(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon): ResearchPredictionOutput | Promise<ResearchPredictionOutput>;
}

export interface ResearchPredictionOutput {
  direction: ResearchPredictionDirection;
  confidence: number;
  modelAgreement?: number | null;
  reasoning?: string | null;
  invalidation?: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDirection(direction: string): ResearchPredictionDirection {
  const value = String(direction || '').toUpperCase();
  if (value.includes('BUY')) return 'UP';
  if (value.includes('SELL')) return 'DOWN';
  return 'FLAT';
}

function featureHash(row: ResearchFeatureRow): string {
  const snapshot = {
    signalId: row.signalId, symbol: row.symbol, signalTimestamp: row.signalTimestamp,
    direction: row.direction, score: row.score, marketRegime: row.marketRegime, session: row.session,
    trendDirection: row.trendDirection, trendAlignment: row.trendAlignment,
    trend7dReturnPct: row.trend7dReturnPct, trend30dReturnPct: row.trend30dReturnPct,
    trend90dReturnPct: row.trend90dReturnPct, trend365dReturnPct: row.trend365dReturnPct,
    trend7dVolatilityPct: row.trend7dVolatilityPct, trend30dVolatilityPct: row.trend30dVolatilityPct,
    trend90dVolatilityPct: row.trend90dVolatilityPct, trend365dVolatilityPct: row.trend365dVolatilityPct,
    newsRiskLevel: row.newsRiskLevel, newsHighImpactCount: row.newsHighImpactCount,
    newsActiveHighImpactCount: row.newsActiveHighImpactCount, newsSentiment: row.newsSentiment,
    quoteSpread: row.quoteSpread, riskReward: row.riskReward, stopDistance: row.stopDistance,
    targetDistance: row.targetDistance,
    priceChange5mPct: row.priceChange5mPct, priceChange15mPct: row.priceChange15mPct,
    priceChange1hPct: row.priceChange1hPct, priceChange4hPct: row.priceChange4hPct,
    priceChangeDailyPct: row.priceChangeDailyPct, atrPct: row.atrPct,
    rsi: row.rsi, macdHistogram: row.macdHistogram, adx: row.adx,
    trendStrength: row.trendStrength, mtfAlignmentScore: row.mtfAlignmentScore,
    structureTrend: row.structureTrend, structurePhase: row.structurePhase,
    structureType: row.structureType, breakoutStatus: row.breakoutStatus,
    distanceToSupportPips: row.distanceToSupportPips,
    distanceToResistancePips: row.distanceToResistancePips
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function normalizeAiProbability(value: unknown, field: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`AI gateway returned an invalid ${field}.`);
  }
  // Accept 0-1 as the canonical format and 0-100 for interoperability with
  // common model-serving payloads, then normalize internally to 0-1.
  const normalized = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  if (normalized < 0 || normalized > 1) {
    throw new Error(`AI gateway returned ${field} outside the 0-1 range.`);
  }
  return normalized;
}

function researchPredictionPayload(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon) {
  // Deliberately exclude realized P&L, outcome, and holding duration: these are
  // post-outcome fields and would leak future information into the prediction.
  return {
    task: 'RESEARCH_PREDICTION',
    horizon,
    features: {
      signalId: row.signalId,
      symbol: row.symbol,
      signalTimestamp: row.signalTimestamp,
      direction: row.direction,
      score: row.score,
      marketRegime: row.marketRegime,
      session: row.session,
      trendDirection: row.trendDirection,
      trendAlignment: row.trendAlignment,
      trend7dReturnPct: row.trend7dReturnPct,
      trend30dReturnPct: row.trend30dReturnPct,
      trend90dReturnPct: row.trend90dReturnPct,
      trend365dReturnPct: row.trend365dReturnPct,
      trend7dVolatilityPct: row.trend7dVolatilityPct,
      trend30dVolatilityPct: row.trend30dVolatilityPct,
      trend90dVolatilityPct: row.trend90dVolatilityPct,
      trend365dVolatilityPct: row.trend365dVolatilityPct,
      newsRiskLevel: row.newsRiskLevel,
      newsHighImpactCount: row.newsHighImpactCount,
      newsActiveHighImpactCount: row.newsActiveHighImpactCount,
      newsSentiment: row.newsSentiment,
      quoteSpread: row.quoteSpread,
      riskReward: row.riskReward,
      stopDistance: row.stopDistance,
      targetDistance: row.targetDistance,
      priceChange5mPct: row.priceChange5mPct,
      priceChange15mPct: row.priceChange15mPct,
      priceChange1hPct: row.priceChange1hPct,
      priceChange4hPct: row.priceChange4hPct,
      priceChangeDailyPct: row.priceChangeDailyPct,
      atrPct: row.atrPct,
      rsi: row.rsi,
      macdHistogram: row.macdHistogram,
      adx: row.adx,
      trendStrength: row.trendStrength,
      mtfAlignmentScore: row.mtfAlignmentScore,
      structureTrend: row.structureTrend,
      structurePhase: row.structurePhase,
      structureType: row.structureType,
      breakoutStatus: row.breakoutStatus,
      distanceToSupportPips: row.distanceToSupportPips,
      distanceToResistancePips: row.distanceToResistancePips
    }
  };
}

export class LlamaGatewayPredictionModel implements PredictionModel {
  readonly modelVersion = 'LLAMA_GATEWAY_QWEN_LLAMA_V1';
  readonly predictionSource = 'LLAMA_GATEWAY';

  async predict(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon): Promise<ResearchPredictionOutput> {
    const response = await requestResearchAiPrediction(researchPredictionPayload(row, horizon));
    // The gateway may return a dedicated consensus object after Llama
    // orchestrates Qwen internally. Keep the legacy prediction envelope as a
    // compatible fallback, but prefer the explicit consensus result.
    const source = response.consensus && typeof response.consensus === 'object'
      ? response.consensus as Record<string, unknown>
      : response.prediction && typeof response.prediction === 'object'
        ? response.prediction as Record<string, unknown>
        : response;

    const directionValue = String(source.direction || source.predictedDirection || '').toUpperCase();
    const direction: ResearchPredictionDirection =
      directionValue === 'UP' || directionValue.includes('BUY') ? 'UP' :
      directionValue === 'DOWN' || directionValue.includes('SELL') ? 'DOWN' :
      directionValue === 'FLAT' ? 'FLAT' :
      (() => { throw new Error('AI gateway returned an invalid prediction direction.'); })();

    const confidence = normalizeAiProbability(source.confidence, 'confidence');
    const modelAgreement = source.modelAgreement === undefined || source.modelAgreement === null
      ? null
      : normalizeAiProbability(source.modelAgreement, 'modelAgreement');

    return {
      direction,
      confidence,
      modelAgreement,
      reasoning: source.reasoning === undefined || source.reasoning === null ? null : String(source.reasoning),
      invalidation: source.invalidation === undefined || source.invalidation === null ? null : String(source.invalidation)
    };
  }
}

export class SignalDirectionBaselineModel implements PredictionModel {
  readonly modelVersion = 'PAIR_FEATURE_BASELINE_V2';
  readonly predictionSource = 'LIVE_PAIR_FEATURES';

  predict(row: ResearchFeatureRow): ResearchPredictionOutput {
    const sourceDirection = normalizeDirection(row.direction);
    const score = Number.isFinite(row.score) ? row.score : 0;
    const evidence: number[] = [];

    const push = (value: number | null | undefined) => {
      if (value !== null && value !== undefined && Number.isFinite(Number(value))) evidence.push(Number(value));
    };

    // Normalize independent directional evidence to -1..1. This is a deterministic
    // baseline, not a trained forecast model; its purpose is to provide a transparent
    // benchmark for later out-of-sample model evaluation.
    push(row.priceChange5mPct == null ? null : Math.tanh(row.priceChange5mPct * 20));
    push(row.priceChange15mPct == null ? null : Math.tanh(row.priceChange15mPct * 10));
    push(row.priceChange1hPct == null ? null : Math.tanh(row.priceChange1hPct * 6));
    push(row.priceChange4hPct == null ? null : Math.tanh(row.priceChange4hPct * 3));
    push(row.priceChangeDailyPct == null ? null : Math.tanh(row.priceChangeDailyPct * 2));
    push(row.structureTrend === 'bullish' ? 1 : row.structureTrend === 'bearish' ? -1 : 0);
    push(row.trendDirection === 'BULLISH' ? 1 : row.trendDirection === 'BEARISH' ? -1 : 0);
    push(row.breakoutStatus === 'bullish_breakout' ? 1 : row.breakoutStatus === 'bearish_breakdown' ? -1 : 0);
    if (row.mtfAlignmentScore != null) push((row.mtfAlignmentScore - 10) / 10);
    if (row.rsi != null) push((row.rsi - 50) / 20);
    if (row.macdHistogram != null) push(Math.tanh(row.macdHistogram * 1000));

    const meanEvidence = evidence.length ? evidence.reduce((a, b) => a + b, 0) / evidence.length : 0;
    const scoreBias = sourceDirection === 'UP' ? 0.15 : sourceDirection === 'DOWN' ? -0.15 : 0;
    const composite = Math.max(-1, Math.min(1, meanEvidence * 0.75 + scoreBias + (score - 50) / 200));
    const direction = composite > 0.12 ? 'UP' : composite < -0.12 ? 'DOWN' : 'FLAT';
    const confidence = clamp(0.5 + Math.abs(composite) * 0.45, 0.5, 0.95);

    return {
      direction,
      confidence,
      modelAgreement: evidence.length ? 1 - Math.min(1, Math.abs(meanEvidence - composite)) : 0.5,
      reasoning: 'Deterministic live-pair baseline using available momentum, multi-timeframe, trend, structure, breakout, RSI/MACD and source-score evidence. Evidence=' + evidence.length + ', composite=' + composite.toFixed(3) + '.',
      invalidation: 'Prediction is research-only; invalidate when the current feature set materially changes. Do not use as an execution instruction.'
    };
  }
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
    created_at INTEGER NOT NULL,
    feature_snapshot_json TEXT,
    prediction_context TEXT NOT NULL DEFAULT 'RESEARCH'
  )`);
  const columns = await executeQuery<{ name: string }>('PRAGMA table_info(live_trade_research_predictions)');
  if (!columns.some(column => column.name === 'feature_snapshot_json')) {
    await executeRun('ALTER TABLE live_trade_research_predictions ADD COLUMN feature_snapshot_json TEXT');
  }
  if (!columns.some(column => column.name === 'prediction_context')) {
    await executeRun("ALTER TABLE live_trade_research_predictions ADD COLUMN prediction_context TEXT NOT NULL DEFAULT 'RESEARCH'");
  }
}

async function makePrediction(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon, model: PredictionModel): Promise<ResearchPrediction> {
  const output = await model.predict(row, horizon);
  const predictedAt = Date.now();
  return {
    predictionId: 'pred-' + predictedAt + '-' + row.signalId + '-' + horizon,
    modelVersion: model.modelVersion,
    predictionSource: model.predictionSource,
    symbol: row.symbol,
    signalId: row.signalId,
    predictedAt,
    horizon,
    predictedDirection: output.direction,
    confidence: clamp(Number(output.confidence), 0, 1),
    featureHash: featureHash(row),
    modelAgreement: output.modelAgreement === undefined || output.modelAgreement === null
      ? null : clamp(Number(output.modelAgreement), 0, 1),
    reasoning: output.reasoning || null,
    invalidation: output.invalidation || null
  };
}

export async function createResearchPrediction(params: {
  row: ResearchFeatureRow;
  horizon?: ResearchPredictionHorizon;
  model?: PredictionModel;
  predictionContext?: 'RESEARCH' | 'CURRENT_PAIR';
}): Promise<ResearchPrediction> {
  const horizon = params.horizon || '1D';
  const model = params.model || new SignalDirectionBaselineModel();
  const predictionContext = params.predictionContext || 'RESEARCH';
  const prediction = await makePrediction(params.row, horizon, model);
  await ensurePredictionTable();
  await executeRun(
    `INSERT OR REPLACE INTO live_trade_research_predictions (
      prediction_id, model_version, prediction_source, symbol, signal_id,
      predicted_at, horizon, predicted_direction, confidence, feature_hash,
      model_agreement, reasoning, invalidation, actual_direction,
      actual_return_pct, outcome_status, evaluated_at, created_at, feature_snapshot_json, prediction_context
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [prediction.predictionId, prediction.modelVersion, prediction.predictionSource,
      prediction.symbol, prediction.signalId, prediction.predictedAt, prediction.horizon,
      prediction.predictedDirection, prediction.confidence, prediction.featureHash,
      prediction.modelAgreement, prediction.reasoning, prediction.invalidation,
      null, null, 'PENDING', null, prediction.predictedAt, JSON.stringify(params.row), predictionContext]
  );
  return prediction;
}


export async function createCurrentResearchPrediction(params: {
  row: ResearchFeatureRow;
  horizon?: ResearchPredictionHorizon;
  model?: PredictionModel;
  dedupeWindowMs?: number;
}): Promise<ResearchPrediction> {
  const horizon = params.horizon || '1D';
  const model = params.model || new SignalDirectionBaselineModel();
  const dedupeWindowMs = Math.max(0, Math.floor(Number(params.dedupeWindowMs ?? 5 * 60_000)));
  await ensurePredictionTable();

  if (dedupeWindowMs > 0) {
    const cutoff = Date.now() - dedupeWindowMs;
    const existing = await executeQuery<any>(
      `SELECT * FROM live_trade_research_predictions
        WHERE symbol = ? AND model_version = ? AND horizon = ? AND prediction_context = 'CURRENT_PAIR' AND predicted_at >= ?
        ORDER BY predicted_at DESC LIMIT 1`,
      [params.row.symbol, model.modelVersion, horizon, cutoff]
    );
    if (existing[0]) {
      const row = existing[0];
      return {
        predictionId: String(row.prediction_id),
        modelVersion: String(row.model_version),
        predictionSource: String(row.prediction_source),
        symbol: String(row.symbol),
        signalId: row.signal_id == null ? null : String(row.signal_id),
        predictedAt: Number(row.predicted_at),
        horizon: row.horizon as ResearchPredictionHorizon,
        predictedDirection: row.predicted_direction as ResearchPredictionDirection,
        confidence: Number(row.confidence),
        featureHash: String(row.feature_hash),
        modelAgreement: row.model_agreement == null ? null : Number(row.model_agreement),
        reasoning: row.reasoning == null ? null : String(row.reasoning),
        invalidation: row.invalidation == null ? null : String(row.invalidation)
      };
    }
  }

  return createResearchPrediction({ row: params.row, horizon, model, predictionContext: 'CURRENT_PAIR' });
}

export async function generateResearchPredictions(params: {
  fromTimestamp?: number; toTimestamp?: number; horizon?: ResearchPredictionHorizon;
  limit?: number; model?: PredictionModel;
} = {}): Promise<ResearchPrediction[]> {
  const rows = await getLiveTradeResearchFeatures({
    fromTimestamp: params.fromTimestamp, toTimestamp: params.toTimestamp,
    closedOnly: true, limit: params.limit || 50000
  });
  const model = params.model || new SignalDirectionBaselineModel();
  const predictions: ResearchPrediction[] = [];
  for (const row of rows) {
    predictions.push(await createResearchPrediction({ row, horizon: params.horizon || '1D', model }));
  }
  return predictions;
}

export async function getLiveTradeResearchPredictions(params: {
  limit?: number; symbol?: string; modelVersion?: string;
} = {}): Promise<any[]> {
  await ensurePredictionTable();
  const conditions: string[] = [];
  const values: any[] = [];
  if (params.symbol) { conditions.push('symbol = ?'); values.push(params.symbol); }
  if (params.modelVersion) { conditions.push('model_version = ?'); values.push(params.modelVersion); }
  const limit = Math.max(1, Math.min(250, Math.floor(Number(params.limit) || 50)));
  return executeQuery<any>(
    `SELECT * FROM live_trade_research_predictions
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY predicted_at DESC LIMIT ?`,
    [...values, limit]
  );
}

export async function getCurrentPairPredictions(params: {
  limit?: number;
  symbol?: string;
  modelVersion?: string;
  horizon?: ResearchPredictionHorizon;
} = {}): Promise<any[]> {
  await ensurePredictionTable();
  const conditions = ["prediction_context = 'CURRENT_PAIR'"];
  const values: any[] = [];
  if (params.symbol) { conditions.push('symbol = ?'); values.push(params.symbol); }
  if (params.modelVersion) { conditions.push('model_version = ?'); values.push(params.modelVersion); }
  if (params.horizon) { conditions.push('horizon = ?'); values.push(params.horizon); }
  const limit = Math.max(1, Math.min(250, Math.floor(Number(params.limit) || 50)));
  return executeQuery<any>(
    `SELECT prediction_id AS predictionId, model_version AS modelVersion,
      prediction_source AS predictionSource, symbol, signal_id AS signalId,
      predicted_at AS predictedAt, horizon, predicted_direction AS predictedDirection,
      confidence, feature_hash AS featureHash, model_agreement AS modelAgreement,
      reasoning, invalidation, actual_direction AS actualDirection,
      actual_return_pct AS actualReturnPct, outcome_status AS outcomeStatus,
      evaluated_at AS evaluatedAt, created_at AS createdAt
      FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at DESC LIMIT ?`,
    [...values, limit]
  );
}

export async function getResearchPrediction(predictionId: string): Promise<any | null> {
  await ensurePredictionTable();
  const rows = await executeQuery<any>(
    'SELECT * FROM live_trade_research_predictions WHERE prediction_id = ? LIMIT 1', [predictionId]
  );
  return rows[0] || null;
}
