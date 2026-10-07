// ============================================================================
// PHASE 3: MACHINE LEARNING TYPES, INTERFACES & ENUMS
// ============================================================================

export type MarketType = 'FOREX' | 'INDIAN_EQUITY' | 'INDIAN_OPTIONS';
export type EnvironmentType = 'LIVE';

export const CURRENT_FEATURE_VERSION = 'FEAT-v3.1.0';
export const CURRENT_ANALYSIS_VERSION = 'ANALYSIS-v2.5.0';
export const CURRENT_STRATEGY_VERSION = 'STRAT-v2.0.0';
export const CURRENT_DATA_PROVIDER_VERSION = 'PROV-v2.0.0';

export type ModelStatus = 
  | 'DEVELOPMENT' 
  | 'TRAINING' 
  | 'VALIDATING' 
  | 'TESTING' 
  | 'CANDIDATE' 
  | 'PRODUCTION' 
  | 'RETIRED' 
  | 'FAILED';

export type PredictionOutcomeLabel = 
  | 'TARGET_FIRST'     // 1
  | 'STOP_FIRST'       // 0
  | 'TIME_EXIT'        // Max holding period elapsed
  | 'NO_ENTRY'         // Limit/trigger price never hit
  | 'INVALIDATED'      // Market structure invalidated before entry
  | 'PARTIAL_TARGET';  // Reached TP1/partial before stop

export type Matrix = number[][];
export type Vector = number[];

export type PredictionConfidenceTier =
  | 'NO_EDGE'     // < 0.50
  | 'WEAK'        // 0.50 - 0.59
  | 'MODERATE'    // 0.60 - 0.69
  | 'STRONG'      // 0.70 - 0.79
  | 'VERY_STRONG';// >= 0.80

export type FusionDecision = 
  | 'QUALIFIED_BUY'
  | 'QUALIFIED_SELL'
  | 'WATCH'
  | 'NO_TRADE'
  | 'CONFLICT';

// -------------------------------------------------------------
// FEATURE VECTOR INTERFACES
// -------------------------------------------------------------

export interface FeatureSnapshot {
  featureSnapshotId: string;
  timestamp: number;
  instrument: string;
  market: MarketType;
  timeframe: string;
  features: Record<string, number>;
  featureVersion: string;
  analysisVersion: string;
  strategyVersion: string;
  dataProviderVersion: string;
  environment: EnvironmentType;
  signalId?: string;
  strategyId?: string;
  dataSource: string;
}

export interface ForexFeatureVector {
  price: number;
  returns1: number;
  returns5: number;
  returns15: number;
  atr: number;
  atrPct: number;
  ema9Distance: number;
  ema21Distance: number;
  ema50Distance: number;
  ema200Distance: number;
  ema9Slope: number;
  ema21Slope: number;
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHist: number;
  adx14: number;
  diPlus: number;
  diMinus: number;
  bollingerPctB: number;
  bollingerBandwidth: number;
  stochasticK: number;
  stochasticD: number;
  roc10: number;
  vwapDistance: number;
  distToSupport: number;
  distToResistance: number;
  marketStructureScore: number; // -1 bearish, 0 neutral, +1 bullish
  trendStrength: number;
  volatilityPips: number;
  spreadPips: number;
  sessionLondon: number; // 0 or 1
  sessionNewYork: number; // 0 or 1
  sessionTokyo: number; // 0 or 1
  sessionOverlap: number; // 0 or 1
  mtfTrendAlignment: number; // -1 to +1
  mtfConflictScore: number; // 0 to 1
  signalScore: number;
  riskRewardRatio: number;
  entryDistancePips: number;
  stopDistancePips: number;
  targetDistancePips: number;
  [key: string]: number;
}

export interface IndianMarketFeatureVector {
  price: number;
  returns1: number;
  returns5: number;
  returns15: number;
  ema9_21_cross: number;
  emaStructureScore: number;
  rsi14: number;
  macdHist: number;
  adx14: number;
  atr: number;
  vwapDistance: number;
  openingRangePosition: number; // 0-1 within OR, >1 above, <0 below
  gapPercentage: number;
  distToPdh: number;
  distToPdl: number;
  distToSupport: number;
  distToResistance: number;
  marketStructureScore: number;
  trendStrength: number;
  volumeRatio: number;
  momentumScore: number;
  timeOfDayMinutes: number; // Minutes from 09:15
  [key: string]: number;
}

export interface OptionsFeatureVector {
  underlyingPrice: number;
  strike: number;
  distFromAtmPct: number;
  moneyness: number;
  dte: number;
  isCall: number; // 1 = Call, 0 = Put
  premium: number;
  bidAskSpreadPct: number;
  volume: number;
  oi: number;
  oiChangePct: number;
  pcrAtm: number;
  pcrTotal: number;
  iv: number;
  ivChange: number;
  ivRank: number;
  ivPercentile: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  liquidityScore: number;
  underlyingTrendScore: number;
  underlyingMomentum: number;
  underlyingVolatility: number;
  [key: string]: number;
}

export interface StrategyFeatureVector {
  strategyTypeNum: number; // mapped enum
  legsCount: number;
  netPremium: number;
  maxProfit: number;
  maxLoss: number;
  riskReward: number;
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  ivExposure: number;
  dte: number;
  liquidityScore: number;
  signalScore: number;
  [key: string]: number;
}

// -------------------------------------------------------------
// LABELS & OUTCOMES
// -------------------------------------------------------------

export interface OutcomeLabel {
  outcomeId: string;
  signalId: string;
  predictionId?: string;
  labelVersion: string;
  labelTimestamp: number;
  outcome: PredictionOutcomeLabel;
  binaryTarget: number; // 1 = TARGET_FIRST, 0 = STOP_FIRST/OTHER
  holdingPeriodCandles: number;
  maxFavorableExcursionPips: number;
  maxAdverseExcursionPips: number;
  realizedR: number;
  exitPrice: number;
  resolvedAt: number;
}

// -------------------------------------------------------------
// DATASETS & SPLITTING
// -------------------------------------------------------------

export interface DatasetSample {
  id: string;
  timestamp: number;
  instrument: string;
  market: MarketType;
  features: Record<string, number>;
  label: OutcomeLabel;
  environment: EnvironmentType;
}

export interface SplitDataset {
  train: DatasetSample[];
  validation: DatasetSample[];
  test: DatasetSample[];
  trainPeriod: { start: number; end: number };
  validationPeriod: { start: number; end: number };
  testPeriod: { start: number; end: number };
  featureNames: string[];
}

export interface WalkForwardWindow {
  windowIndex: number;
  trainRange: { start: number; end: number };
  validationRange: { start: number; end: number };
  trainSamplesCount: number;
  valSamplesCount: number;
  metrics?: ModelMetrics;
}

// -------------------------------------------------------------
// PREDICTIONS
// -------------------------------------------------------------

export interface MLPrediction {
  predictionId: string;
  timestamp: number;
  market: MarketType;
  instrument: string;
  timeframe: string;
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  probabilityTargetBeforeStop: number; // 0.00 - 1.00
  probabilityStopBeforeTarget: number; // 0.00 - 1.00
  expectedOutcome: PredictionOutcomeLabel;
  confidenceTier: PredictionConfidenceTier;
  predictionHorizonCandles: number;
  modelId: string;
  modelVersion: string;
  featureVersion: string;
  strategyVersion: string;
  signalId?: string;
  featureSnapshotId: string;
  marketRegime: string;
  entry: number;
  stop: number;
  target: number;
  riskReward: number;
  topContributingFeatures: Array<{ feature: string; importance: number; direction: string }>;
  conflictingFactors: string[];
  environment: EnvironmentType;
  dataSource: string;
}

// -------------------------------------------------------------
// DECISION FUSION
// -------------------------------------------------------------

export interface FusedDecision {
  decisionId: string;
  timestamp: number;
  instrument: string;
  market: MarketType;
  deterministicSignal: {
    direction: 'BUY' | 'SELL' | 'NEUTRAL';
    score: number;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    riskReward: number;
  };
  mlPrediction: {
    probabilityTarget: number;
    confidenceTier: PredictionConfidenceTier;
    modelVersion: string;
  };
  marketRegime: string;
  liquidityOk: boolean;
  dataQualityOk: boolean;
  finalDecision: FusionDecision;
  rationale: string;
  tradeAllowed: boolean;
}

// -------------------------------------------------------------
// MODEL REGISTRY & METRICS
// -------------------------------------------------------------

export interface ModelMetrics {
  // Classification metrics
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  rocAuc: number;
  prAuc: number;
  logLoss: number;
  brierScore: number;
  calibrationSlope: number;
  confusionMatrix: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  };
  // Trading-specific metrics
  sampleCount: number;
  targetFirstRate: number;
  stopFirstRate: number;
  winRate: number;
  averageR: number;
  medianR: number;
  profitFactor: number;
  maxDrawdownPct: number;
  expectancyR: number;
  averageHoldingPeriodCandles: number;
}

export interface ModelRegistryEntry {
  modelId: string;
  modelVersion: string;
  market: MarketType;
  instrumentClass: string;
  strategy: string;
  featureVersion: string;
  algorithm: string;
  hyperparameters: Record<string, any>;
  trainingPeriod: { start: number; end: number };
  validationPeriod: { start: number; end: number };
  testPeriod?: { start: number; end: number };
  trainingSamples: number;
  validationSamples: number;
  testSamples: number;
  createdAt: number;
  metrics: {
    training: ModelMetrics;
    validation: ModelMetrics;
    test?: ModelMetrics;
    baselineComparison?: {
      baselineWinRate: number;
      baselineExpectancy: number;
      liftOverBaseline: number;
    };
  };
  featureImportance: Array<{ feature: string; score: number }>;
  status: ModelStatus;
  approvedBy?: string;
  approvedAt?: number;
}

// -------------------------------------------------------------
// DRIFT & MONITORING
// -------------------------------------------------------------

export interface ModelDriftReport {
  modelId: string;
  modelVersion: string;
  evaluationTimestamp: number;
  windowSamples: number;
  recentWinRate: number;
  expectedWinRate: number;
  winRateDropPct: number;
  recentBrierScore: number;
  baselineBrierScore: number;
  brierDegradationPct: number;
  psiScore: number; // Population Stability Index
  featureDrifts: Array<{ feature: string; psi: number; status: 'STABLE' | 'MODERATE_DRIFT' | 'SEVERE_DRIFT' }>;
  overallStatus: 'HEALTHY' | 'MONITORING_ALERT' | 'RETRAIN_RECOMMENDED' | 'DEGRADED';
  reasons: string[];
}

// -------------------------------------------------------------
// BACKTEST ENGINE
// -------------------------------------------------------------

export interface BacktestConfig {
  market: MarketType;
  instruments: string[];
  startDate: number;
  endDate: number;
  strategyMode: 'DETERMINISTIC_ONLY' | 'ML_ONLY' | 'COMBINED';
  mlProbabilityThreshold: number;
  slippageUnits: number; // Pips for forex, points for Indian equity/options
  commissionPerTrade: number;
  taxPct: number;
  spreadCostUnits: number;
  initialCapital: number;
  riskPerTradePct: number;
}

export interface BacktestTrade {
  tradeId: string;
  instrument: string;
  direction: 'BUY' | 'SELL';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  slippageCost: number;
  commissionCost: number;
  spreadCost: number;
  taxCost: number;
  netPnl: number;
  realizedR: number;
  outcome: PredictionOutcomeLabel;
  mlProbability?: number;
  decision: FusionDecision;
}

export interface BacktestResult {
  backtestId: string;
  timestamp: number;
  config: BacktestConfig;
  summary: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    grossProfit: number;
    grossLoss: number;
    totalCosts: number;
    grossReturnPct: number;
    netProfit: number;
    netReturnPct: number;
    profitFactorGross: number;
    profitFactorNet: number;
    winRate: number;
    expectancyR: number;
    averageR: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
  };
  equityCurve: Array<{ timestamp: number; grossEquity: number; netEquity: number; drawdownPct: number }>;
  trades: BacktestTrade[];
}
