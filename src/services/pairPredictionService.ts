import { ScannerService } from './scannerService';
import { LiveForexProvider } from '../markets/forex/provider';
import { ForexSignalEngine } from '../markets/forex/signalEngine';
import { getForexPairConfig } from '../markets/forex/instruments';
import type { ForexCandle } from '../markets/forex/types';

const scannerService = new ScannerService();
const liveForexProvider = new LiveForexProvider();
const forexSignalEngine = new ForexSignalEngine(undefined, liveForexProvider);
import { getSystemConfig } from './configService';
import {
  LlamaGatewayPredictionModel,
  SignalDirectionBaselineModel,
  createCurrentResearchPrediction,
  type PredictionModel,
  type ResearchPredictionDirection,
  type ResearchPredictionHorizon,
  type ResearchPredictionOutput
} from './liveTradeResearchPredictionService';
import type { ResearchFeatureRow } from './liveTradeResearchFeatureService';

export interface CurrentPairPrediction {
  predictionId: string;
  symbol: string;
  predictedAt: number;
  horizon: ResearchPredictionHorizon;
  predictedDirection: ResearchPredictionDirection;
  confidence: number;
  modelVersion: string;
  predictionSource: string;
  modelAgreement: number | null;
  reasoning: string | null;
  invalidation: string | null;
  signalId: string | null;
  signalDirection: string;
  signalScore: number;
  mlProbability: number | null;
  marketRegime: string;
  session: string;
  trendDirection: string;
  trendAlignment: string;
  bid: number | null;
  ask: number | null;
  spreadPips: number | null;
  dataStatus: string;
  strategy: string | null;
  reasons: string[];
  generatedAt: number;
}

function finite(value: unknown, fallback: number | null = null): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function lastBarChange(candles: ForexCandle[]): number | null {
  if (candles.length < 2) return null;
  return pctChange(candles[candles.length - 1].close, candles[candles.length - 2].close);
}

function periodChange(candles: ForexCandle[], barsBack: number): number | null {
  if (candles.length <= barsBack) return null;
  return pctChange(candles[candles.length - 1].close, candles[candles.length - 1 - barsBack].close);
}

function pipsBetween(a: number | null, b: number | null, pipSize: number): number | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || pipSize <= 0) return null;
  return Math.abs(a - b) / pipSize;
}

async function buildFeatureRow(item: any): Promise<ResearchFeatureRow> {
  const signal = item.signal || {};
  const direction = String(signal.direction || 'NO_TRADE');
  const signalDirection = direction.toUpperCase();

  await liveForexProvider.refreshPair(item.symbol);
  const analysis = forexSignalEngine.analyzePair(item.symbol);
  const pairConfig = getForexPairConfig(item.symbol);
  const candles5m = liveForexProvider.getCandles(item.symbol, '5M', 80);
  const candles15m = liveForexProvider.getCandles(item.symbol, '15M', 80);
  const candles1h = liveForexProvider.getCandles(item.symbol, '1H', 80);
  const candles4h = liveForexProvider.getCandles(item.symbol, '4H', 80);
  const candlesDaily = liveForexProvider.getCandles(item.symbol, 'Daily', 80);
  const indicators = analysis.indicators;
  const support = analysis.supportResistance.nearestSupport;
  const resistance = analysis.supportResistance.nearestResistance;
  const entry = finite(analysis.tradePlan?.entryMin);
  const stop = finite(analysis.tradePlan?.stopLoss);
  const target = finite(analysis.tradePlan?.takeProfit1);

  const trendDirection =
    analysis.trend.direction === 'bullish' ? 'BULLISH' :
    analysis.trend.direction === 'bearish' ? 'BEARISH' :
    'INSUFFICIENT_DATA';

  const trendAlignment =
    analysis.multiTimeframe.alignment.includes('BULLISH') && signalDirection.includes('BUY') ? 'ALIGNED' :
    analysis.multiTimeframe.alignment.includes('BEARISH') && signalDirection.includes('SELL') ? 'ALIGNED' :
    analysis.multiTimeframe.alignment === 'CONFLICTING' ? 'CONTRARY' : 'MIXED';

  return {
    signalId: String(signal.id || item.symbol + '-' + Date.now()),
    symbol: String(item.symbol),
    signalTimestamp: Number(signal.timestamp || Date.now()),
    direction,
    score: Number(signal.score || 0),
    marketRegime: String(analysis.regime || signal.marketRegime || 'UNKNOWN'),
    session: String(analysis.session || signal.session || 'UNKNOWN'),
    trendDirection,
    trendAlignment,
    trend7dReturnPct: periodChange(candlesDaily, 7),
    trend30dReturnPct: periodChange(candlesDaily, 30),
    trend90dReturnPct: null,
    trend365dReturnPct: null,
    trend7dVolatilityPct: null,
    trend30dVolatilityPct: null,
    trend90dVolatilityPct: null,
    trend365dVolatilityPct: null,
    newsRiskLevel: 'UNKNOWN',
    newsHighImpactCount: 0,
    newsActiveHighImpactCount: 0,
    newsSentiment: null,
    quoteSpread: finite(item.spreadPips),
    riskReward: finite(analysis.tradePlan?.riskReward),
    stopDistance: entry !== null && stop !== null ? Math.abs(entry - stop) : null,
    targetDistance: entry !== null && target !== null ? Math.abs(target - entry) : null,
    realizedPnl: null,
    outcome: null,
    holdingDurationMs: null,
    priceChange5mPct: lastBarChange(candles5m),
    priceChange15mPct: lastBarChange(candles15m),
    priceChange1hPct: lastBarChange(candles1h),
    priceChange4hPct: lastBarChange(candles4h),
    priceChangeDailyPct: lastBarChange(candlesDaily),
    atrPct: indicators.atr && analysis.currentPrice > 0 ? (indicators.atr / analysis.currentPrice) * 100 : null,
    rsi: indicators.rsi,
    macdHistogram: indicators.macdHistogram,
    adx: indicators.adx,
    trendStrength: analysis.trend.strength,
    mtfAlignmentScore: signal.scoreBreakdown?.multiTimeframe ?? null,
    structureTrend: analysis.trend.direction,
    structurePhase: analysis.marketStructure.phase,
    structureType: analysis.marketStructure.type,
    breakoutStatus: analysis.marketStructure.breakoutStatus,
    distanceToSupportPips: pipsBetween(analysis.currentPrice, support, pairConfig.pipSize),
    distanceToResistancePips: pipsBetween(analysis.currentPrice, resistance, pairConfig.pipSize)
  };
}
function buildFallbackFeatureRow(item: any, _error: unknown): ResearchFeatureRow {
  const signal = item.signal || {};
  const direction = String(signal.direction || 'NO_TRADE');
  const trendDirection =
    Number(signal.scoreBreakdown?.trend) > 0 ? 'BULLISH' :
    Number(signal.scoreBreakdown?.trend) < 0 ? 'BEARISH' : 'INSUFFICIENT_DATA';
  return {
    signalId: String(signal.id || item.symbol + '-' + Date.now()),
    symbol: String(item.symbol),
    signalTimestamp: Number(signal.timestamp || Date.now()),
    direction,
    score: Number(signal.score || 0),
    marketRegime: String(signal.marketRegime || 'UNKNOWN'),
    session: String(signal.session || 'UNKNOWN'),
    trendDirection,
    trendAlignment: 'MIXED',
    trend7dReturnPct: null, trend30dReturnPct: null, trend90dReturnPct: null, trend365dReturnPct: null,
    trend7dVolatilityPct: null, trend30dVolatilityPct: null, trend90dVolatilityPct: null, trend365dVolatilityPct: null,
    newsRiskLevel: 'UNKNOWN', newsHighImpactCount: 0, newsActiveHighImpactCount: 0, newsSentiment: null,
    quoteSpread: finite(item.spreadPips), riskReward: finite(signal.riskReward),
    stopDistance: null, targetDistance: null, realizedPnl: null, outcome: null, holdingDurationMs: null
  };
}

function normalizeOutput(output: ResearchPredictionOutput) {
  return {
    predictedDirection: output.direction,
    confidence: Math.max(0, Math.min(1, Number(output.confidence) || 0)),
    modelAgreement: output.modelAgreement == null ? null : Math.max(0, Math.min(1, Number(output.modelAgreement))),
    reasoning: output.reasoning || null,
    invalidation: output.invalidation || null
  };
}

export async function generateCurrentPairPredictions(params: {
  pairs?: string[];
  horizon?: ResearchPredictionHorizon;
  model?: 'BASELINE' | 'AI_GATEWAY';
} = {}): Promise<CurrentPairPrediction[]> {
  const configuredPairs = params.pairs?.length ? params.pairs : getSystemConfig().autoLiveForexPairs;
  const horizon = params.horizon || '1D';
  const model: PredictionModel =
    params.model === 'AI_GATEWAY'
      ? new LlamaGatewayPredictionModel()
      : new SignalDirectionBaselineModel();

  const scan = await scannerService.getForexScanner(configuredPairs);
  const generatedAt = Date.now();

  return Promise.all(scan.map(async item => {
    let row: ResearchFeatureRow;
    try {
      row = await buildFeatureRow(item);
    } catch (error: any) {
      row = buildFallbackFeatureRow(item, error);
    }
    let output: ResearchPredictionOutput;
    let persistedPredictionId = 'current-' + generatedAt + '-' + row.signalId + '-' + horizon;
    try {
      const persisted = await createCurrentResearchPrediction({ row, horizon, model });
      persistedPredictionId = persisted.predictionId;
      output = {
        direction: persisted.predictedDirection,
        confidence: persisted.confidence,
        modelAgreement: persisted.modelAgreement,
        reasoning: persisted.reasoning,
        invalidation: persisted.invalidation
      };
    } catch (error: any) {
      output = {
        direction: 'FLAT',
        confidence: 0,
        modelAgreement: null,
        reasoning: 'Prediction unavailable for this pair: ' + (error?.message || String(error)),
        invalidation: 'No prediction should be used when authoritative pair data or the prediction model is unavailable.'
      };
    }

    const normalized = normalizeOutput(output);
    return {
      predictionId: persistedPredictionId,
      symbol: row.symbol,
      predictedAt: generatedAt,
      horizon,
      predictedDirection: normalized.predictedDirection,
      confidence: normalized.confidence,
      modelVersion: model.modelVersion,
      predictionSource: model.predictionSource,
      modelAgreement: normalized.modelAgreement,
      reasoning: normalized.reasoning,
      invalidation: normalized.invalidation,
      signalId: row.signalId || null,
      signalDirection: row.direction,
      signalScore: row.score,
      mlProbability: finite(item.signal?.mlProbability),
      marketRegime: row.marketRegime,
      session: row.session,
      trendDirection: row.trendDirection,
      trendAlignment: row.trendAlignment,
      bid: finite(item.bid),
      ask: finite(item.ask),
      spreadPips: finite(item.spreadPips),
      dataStatus: String(item.dataStatus || 'UNKNOWN'),
      strategy: item.signal?.strategy || null,
      reasons: Array.isArray(item.signal?.reasons) ? item.signal.reasons : [],
      generatedAt
    };
  }));
}
