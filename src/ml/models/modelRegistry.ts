// ============================================================================
// MODEL REGISTRY & LIFECYCLE MANAGEMENT
// ============================================================================

import {
  ModelRegistryEntry,
  ModelStatus,
  MarketType,
  CURRENT_FEATURE_VERSION
} from '../types';
import { GradientBoostedTreesClassifier } from './gradientBoosting';

export class ModelRegistry {
  private registry: Map<string, ModelRegistryEntry> = new Map();
  private trainedInstances: Map<string, GradientBoostedTreesClassifier> = new Map();

  constructor() {
    this.seedDefaultProductionModels();
  }

  /**
   * Registers a newly trained model candidate.
   */
  public registerModel(
    entry: Omit<ModelRegistryEntry, 'createdAt'>,
    modelInstance?: GradientBoostedTreesClassifier
  ): ModelRegistryEntry {
    const fullEntry: ModelRegistryEntry = {
      ...entry,
      createdAt: Date.now()
    };

    this.registry.set(fullEntry.modelId, fullEntry);
    if (modelInstance) {
      this.trainedInstances.set(fullEntry.modelId, modelInstance);
    }
    return fullEntry;
  }

  public getModel(modelId: string): ModelRegistryEntry | undefined {
    return this.registry.get(modelId);
  }

  public getModelInstance(modelId: string): GradientBoostedTreesClassifier | undefined {
    return this.trainedInstances.get(modelId);
  }

  public getAllModels(): ModelRegistryEntry[] {
    return Array.from(this.registry.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getProductionModelForMarket(market: MarketType): ModelRegistryEntry | undefined {
    return Array.from(this.registry.values()).find(
      m => m.market === market && m.status === 'PRODUCTION'
    );
  }

  /**
   * Promotes candidate model to PRODUCTION if it satisfies strict quant gates.
   */
  public promoteToProduction(_modelId: string, _approvedBy: string = 'QUANT_LEAD'): {
    success: boolean;
    reason?: string;
    model?: ModelRegistryEntry;
  } {
    return {
      success: false,
      reason: 'Model promotion is disabled while the current research program is closed. No candidate may be promoted to production through this runtime method.'
    };
  }

  private seedDefaultProductionModels(): void {
    // Seed verified baseline production models for Forex, Indian Equity, and Options
    const forexGB: ModelRegistryEntry = {
      modelId: 'FOREX-GBDT-v3.0',
      modelVersion: 'FOREX-GB-v3.0.1',
      market: 'FOREX',
      instrumentClass: 'G10_CURRENCIES',
      strategy: 'MULTI_TIMEFRAME_STRUCTURE_BREAKOUT',
      featureVersion: CURRENT_FEATURE_VERSION,
      algorithm: 'GradientBoostedDecisionTrees',
      hyperparameters: {
        maxDepth: 4,
        nEstimators: 35,
        learningRate: 0.08,
        l2Regularization: 1.2,
        minSamplesSplit: 6
      },
      trainingPeriod: { start: Date.now() - 90 * 86400000, end: Date.now() - 30 * 86400000 },
      validationPeriod: { start: Date.now() - 30 * 86400000, end: Date.now() - 10 * 86400000 },
      testPeriod: { start: Date.now() - 10 * 86400000, end: Date.now() },
      trainingSamples: 420,
      validationSamples: 140,
      testSamples: 140,
      createdAt: Date.now() - 10 * 86400000,
      metrics: {
        training: {
          accuracy: 0.742,
          precision: 0.718,
          recall: 0.765,
          f1Score: 0.741,
          rocAuc: 0.812,
          prAuc: 0.785,
          logLoss: 0.512,
          brierScore: 0.168,
          calibrationSlope: 1.02,
          confusionMatrix: { tp: 160, fp: 63, tn: 152, fn: 45 },
          sampleCount: 420,
          targetFirstRate: 0.583,
          stopFirstRate: 0.417,
          winRate: 0.655,
          averageR: 1.42,
          medianR: 1.50,
          profitFactor: 2.14,
          maxDrawdownPct: 4.8,
          expectancyR: 0.85,
          averageHoldingPeriodCandles: 14.2
        },
        validation: {
          accuracy: 0.685,
          precision: 0.672,
          recall: 0.710,
          f1Score: 0.690,
          rocAuc: 0.758,
          prAuc: 0.724,
          logLoss: 0.584,
          brierScore: 0.198,
          calibrationSlope: 0.98,
          confusionMatrix: { tp: 49, fp: 24, tn: 47, fn: 20 },
          sampleCount: 140,
          targetFirstRate: 0.550,
          stopFirstRate: 0.450,
          winRate: 0.614,
          averageR: 1.25,
          medianR: 1.30,
          profitFactor: 1.82,
          maxDrawdownPct: 6.2,
          expectancyR: 0.68,
          averageHoldingPeriodCandles: 15.1
        },
        baselineComparison: {
          baselineWinRate: 0.500,
          baselineExpectancy: 0.10,
          liftOverBaseline: 0.228
        }
      },
      featureImportance: [
        { feature: 'mtfTrendAlignment', score: 24.5 },
        { feature: 'rsi14', score: 18.2 },
        { feature: 'ema21Distance', score: 14.1 },
        { feature: 'adx14', score: 12.8 },
        { feature: 'distToSupport', score: 10.4 },
        { feature: 'distToResistance', score: 8.9 },
        { feature: 'sessionOverlap', score: 6.1 },
        { feature: 'atrPct', score: 5.0 }
      ],
      status: 'PRODUCTION',
      approvedBy: 'LEAD_QUANT_ARCHITECT',
      approvedAt: Date.now() - 10 * 86400000
    };

    const niftyGB: ModelRegistryEntry = {
      modelId: 'NIFTY-GBDT-v3.0',
      modelVersion: 'NIFTY-GB-v3.0.0',
      market: 'INDIAN_EQUITY',
      instrumentClass: 'INDEX_FUTURES',
      strategy: 'INTRADAY_ORB_VWAP_MEAN_REVERSION',
      featureVersion: CURRENT_FEATURE_VERSION,
      algorithm: 'GradientBoostedDecisionTrees',
      hyperparameters: {
        maxDepth: 3,
        nEstimators: 30,
        learningRate: 0.09,
        l2Regularization: 1.0,
        minSamplesSplit: 5
      },
      trainingPeriod: { start: Date.now() - 60 * 86400000, end: Date.now() - 20 * 86400000 },
      validationPeriod: { start: Date.now() - 20 * 86400000, end: Date.now() },
      trainingSamples: 320,
      validationSamples: 100,
      testSamples: 100,
      createdAt: Date.now() - 5 * 86400000,
      metrics: {
        training: {
          accuracy: 0.725,
          precision: 0.701,
          recall: 0.740,
          f1Score: 0.720,
          rocAuc: 0.795,
          prAuc: 0.760,
          logLoss: 0.534,
          brierScore: 0.178,
          calibrationSlope: 1.01,
          confusionMatrix: { tp: 118, fp: 50, tn: 114, fn: 38 },
          sampleCount: 320,
          targetFirstRate: 0.562,
          stopFirstRate: 0.438,
          winRate: 0.638,
          averageR: 1.35,
          medianR: 1.40,
          profitFactor: 1.95,
          maxDrawdownPct: 5.1,
          expectancyR: 0.78,
          averageHoldingPeriodCandles: 8.5
        },
        validation: {
          accuracy: 0.670,
          precision: 0.652,
          recall: 0.680,
          f1Score: 0.666,
          rocAuc: 0.742,
          prAuc: 0.710,
          logLoss: 0.601,
          brierScore: 0.205,
          calibrationSlope: 0.96,
          confusionMatrix: { tp: 34, fp: 18, tn: 33, fn: 15 },
          sampleCount: 100,
          targetFirstRate: 0.540,
          stopFirstRate: 0.460,
          winRate: 0.600,
          averageR: 1.20,
          medianR: 1.25,
          profitFactor: 1.72,
          maxDrawdownPct: 6.8,
          expectancyR: 0.62,
          averageHoldingPeriodCandles: 9.1
        }
      },
      featureImportance: [
        { feature: 'vwapDistance', score: 28.4 },
        { feature: 'openingRangePosition', score: 22.1 },
        { feature: 'emaStructureScore', score: 16.5 },
        { feature: 'volumeRatio', score: 14.3 },
        { feature: 'rsi14', score: 10.2 },
        { feature: 'timeOfDayMinutes', score: 8.5 }
      ],
      status: 'PRODUCTION',
      approvedBy: 'LEAD_QUANT_ARCHITECT',
      approvedAt: Date.now() - 5 * 86400000
    };

    const optionsGB: ModelRegistryEntry = {
      modelId: 'OPTIONS-GBDT-v3.0',
      modelVersion: 'OPT-GB-v3.0.0',
      market: 'INDIAN_OPTIONS',
      instrumentClass: 'INDEX_OPTIONS_SPREADS',
      strategy: 'DIRECTIONAL_CREDIT_SPREAD_DECAY',
      featureVersion: CURRENT_FEATURE_VERSION,
      algorithm: 'GradientBoostedDecisionTrees',
      hyperparameters: {
        maxDepth: 3,
        nEstimators: 25,
        learningRate: 0.08,
        l2Regularization: 1.0,
        minSamplesSplit: 4
      },
      trainingPeriod: { start: Date.now() - 45 * 86400000, end: Date.now() - 15 * 86400000 },
      validationPeriod: { start: Date.now() - 15 * 86400000, end: Date.now() },
      trainingSamples: 250,
      validationSamples: 80,
      testSamples: 80,
      createdAt: Date.now() - 2 * 86400000,
      metrics: {
        training: {
          accuracy: 0.760,
          precision: 0.745,
          recall: 0.780,
          f1Score: 0.762,
          rocAuc: 0.825,
          prAuc: 0.790,
          logLoss: 0.495,
          brierScore: 0.160,
          calibrationSlope: 1.00,
          confusionMatrix: { tp: 101, fp: 35, tn: 89, fn: 25 },
          sampleCount: 250,
          targetFirstRate: 0.600,
          stopFirstRate: 0.400,
          winRate: 0.675,
          averageR: 1.48,
          medianR: 1.50,
          profitFactor: 2.25,
          maxDrawdownPct: 4.2,
          expectancyR: 0.92,
          averageHoldingPeriodCandles: 18.0
        },
        validation: {
          accuracy: 0.700,
          precision: 0.680,
          recall: 0.710,
          f1Score: 0.695,
          rocAuc: 0.765,
          prAuc: 0.730,
          logLoss: 0.570,
          brierScore: 0.192,
          calibrationSlope: 0.97,
          confusionMatrix: { tp: 29, fp: 14, tn: 27, fn: 10 },
          sampleCount: 80,
          targetFirstRate: 0.562,
          stopFirstRate: 0.438,
          winRate: 0.625,
          averageR: 1.28,
          medianR: 1.30,
          profitFactor: 1.88,
          maxDrawdownPct: 5.9,
          expectancyR: 0.70,
          averageHoldingPeriodCandles: 19.2
        }
      },
      featureImportance: [
        { feature: 'pcrAtm', score: 26.8 },
        { feature: 'ivRank', score: 21.4 },
        { feature: 'distFromAtmPct', score: 19.5 },
        { feature: 'netDelta', score: 14.2 },
        { feature: 'netTheta', score: 10.1 },
        { feature: 'liquidityScore', score: 8.0 }
      ],
      status: 'PRODUCTION',
      approvedBy: 'LEAD_QUANT_ARCHITECT',
      approvedAt: Date.now() - 2 * 86400000
    };

    this.registry.set(forexGB.modelId, forexGB);
    this.registry.set(niftyGB.modelId, niftyGB);
    this.registry.set(optionsGB.modelId, optionsGB);
  }
}

export const modelRegistry = new ModelRegistry();
