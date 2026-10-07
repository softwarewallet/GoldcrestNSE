import { DataSourceStatus, MarketSessionInfo, SignalCategory, SignalDirection, SignalStatus } from '../common/types';

export type ForexTimeframe = '1M' | '5M' | '15M' | '30M' | '1H' | '4H' | 'Daily';

export interface ForexCandle {
  pair: string;
  timeframe: ForexTimeframe;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bid: number;
  ask: number;
  spread: number;
  volume: number;
  tickVolume?: number;
  provider: string;
  dataStatus: DataSourceStatus;
}

export interface ForexQuote {
  pair: string;
  timestamp: number;
  bid: number;
  ask: number;
  spreadPips: number;
  digits: number;
  pipSize: number;
  changePips24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  provider: string;
  dataStatus: DataSourceStatus;
}

export interface ForexMarketStatus {
  isOpen: boolean;
  status: 'OPEN' | 'CLOSED' | 'WEEKEND' | 'HOLIDAY';
  activeSessions: string[];
  currentSession: string;
  isLondonNyOverlap: boolean;
  serverUtcTime: string;
}

export interface StructuredIndicators {
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  adx: number | null;
  diPlus: number | null;
  diMinus: number | null;
  atr: number | null;
  bollingerUpper: number | null;
  bollingerMiddle: number | null;
  bollingerLower: number | null;
  stochastic: { k: number; d: number } | null;
  roc: number | null;
  vwap?: number | null;
}

export type TrendDirection = 'bullish' | 'bearish' | 'neutral' | 'ranging';
export type StructureClassification =
  | 'higher_high_higher_low'
  | 'lower_high_lower_low'
  | 'higher_high'
  | 'lower_low'
  | 'range'
  | 'breakout'
  | 'breakdown'
  | 'choppy';

export type MarketPhase = 'pullback' | 'expansion' | 'reversal' | 'consolidation' | 'trend_continuation' | 'trend_weakening';
export type BreakoutStatus = 'none' | 'bullish_breakout' | 'bearish_breakdown' | 'failed_breakout';

export type MarketRegimeType =
  | 'TRENDING'
  | 'STRONG_TRENDING'
  | 'RANGE'
  | 'LOW_VOLATILITY'
  | 'HIGH_VOLATILITY'
  | 'BREAKOUT'
  | 'POTENTIAL_REVERSAL';

export interface MarketStructureResult {
  trend: TrendDirection;
  trendStrength: number; // 0 - 100
  structure: StructureClassification;
  phase: MarketPhase;
  breakoutStatus: BreakoutStatus;
  regime: MarketRegimeType;
  swingHigh: number;
  swingLow: number;
  lastHigherHigh?: number;
  lastHigherLow?: number;
  lastLowerHigh?: number;
  lastLowerLow?: number;
}

export interface PriceLevel {
  price: number;
  type: 'LOCAL_SUPPORT' | 'LOCAL_RESISTANCE' | 'MAJOR_SUPPORT' | 'MAJOR_RESISTANCE' | 'PDH' | 'PDL' | 'PWH' | 'PWL';
  strength: number; // 1 - 10 (touch count & volume significance)
  touches: number;
  distancePips: number;
  ageBars: number;
}

export interface SupportResistanceResult {
  currentPrice: number;
  swingHighs: number[];
  swingLows: number[];
  localSupport: PriceLevel[];
  localResistance: PriceLevel[];
  majorSupport: PriceLevel | null;
  majorResistance: PriceLevel | null;
  previousDayHigh: number;
  previousDayLow: number;
  previousWeekHigh: number;
  previousWeekLow: number;
  nearestSupport: PriceLevel | null;
  nearestResistance: PriceLevel | null;
}

export interface TimeframeAnalysis {
  timeframe: ForexTimeframe;
  trend: TrendDirection;
  trendStrength: number;
  momentum: 'bullish' | 'bearish' | 'neutral';
  structure: StructureClassification;
  phase: MarketPhase;
  rsiCondition: 'overbought' | 'bullish' | 'neutral' | 'bearish' | 'oversold';
  macdCondition: 'bullish_cross' | 'bearish_cross' | 'bullish_momentum' | 'bearish_momentum' | 'neutral';
  adxCondition: 'strong_trend' | 'developing_trend' | 'weak_or_ranging';
  priceVsEmaStructure: 'above_all' | 'above_21' | 'below_all' | 'below_21' | 'compressed';
  indicators: StructuredIndicators;
  lastClose: number;
}

export type MultiTimeframeAlignmentResult =
  | 'STRONG_BULLISH_ALIGNMENT'
  | 'BULLISH_ALIGNMENT_PULLBACK'
  | 'STRONG_BEARISH_ALIGNMENT'
  | 'BEARISH_ALIGNMENT_PULLBACK'
  | 'RANGE_BOUND'
  | 'CONFLICTING';

export interface MultiTimeframeSummary {
  '5m': TimeframeAnalysis;
  '15m': TimeframeAnalysis;
  '1h': TimeframeAnalysis;
  '4h': TimeframeAnalysis;
  'daily': TimeframeAnalysis;
  alignment: MultiTimeframeAlignmentResult;
  alignmentScore: number; // 0 - 20
  alignmentSummary: string;
  isConflicting: boolean;
}

export interface ScoringWeights {
  trendWeight: number; // default 20
  mtfWeight: number; // default 20
  momentumWeight: number; // default 15
  marketStructureWeight: number; // default 15
  supportResistanceWeight: number; // default 10
  volatilityWeight: number; // default 5
  riskRewardWeight: number; // default 5
  minScoreToTrade: number; // default 65 for watch, 75 for action
}

export interface SignalScoreBreakdownDetailed {
  trend: number; // 0 - 20
  multiTimeframe: number; // 0 - 20
  momentum: number; // 0 - 15
  marketStructure: number; // 0 - 15
  supportResistance: number; // 0 - 10
  volatility: number; // 0 - 5
  riskReward: number; // 0 - 5
  totalScore: number; // 0 - 100
}

export type EntryType =
  | 'BREAKOUT_ENTRY'
  | 'PULLBACK_ENTRY'
  | 'SUPPORT_ENTRY'
  | 'RESISTANCE_REJECTION'
  | 'EMA_RETRACEMENT'
  | 'MARKET_STRUCTURE_CONFIRMATION';

export interface EntryZone {
  entryMin: number;
  entryMax: number;
  entryPreferred: number;
  entryType: EntryType;
  entryCondition: string;
  isExtended: boolean;
}

export interface TargetLevel {
  targetPrice: number;
  targetReason: string;
  expectedR: number;
}

export interface TradePlan {
  entryMin: number;
  entryMax: number;
  entryPreferred: number;
  entryType: EntryType;
  entryCondition: string;
  stopLoss: number;
  stopLossReason: string;
  takeProfit1: TargetLevel;
  takeProfit2: TargetLevel;
  takeProfit3: TargetLevel;
  riskDistancePips: number;
  rewardDistancePips: number;
  riskReward: number;
  isValid: boolean;
}

export interface ForexSignal {
  id: string;
  timestamp: number;
  pair: string;
  timeframe: ForexTimeframe;
  direction: 'STRONG_BUY' | 'BUY' | 'WATCH_BUY' | 'NEUTRAL' | 'WATCH_SELL' | 'SELL' | 'STRONG_SELL' | 'NO_TRADE';
  signalCategory: SignalCategory;
  score: number;
  scoreBreakdown: SignalScoreBreakdownDetailed;
  status: 'WAITING_FOR_ENTRY' | 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'STOPPED' | 'INVALIDATED' | 'NO_TRADE';
  tradePlan: TradePlan | null;
  marketRegime: MarketRegimeType;
  session: string;
  dataStatus: DataSourceStatus;
  strategyVersion: string;
  modelVersion: string;
  mlProbability: number | null; // Strictly null in Phase 2A
  reasons: string[];
  noTradeReasons: string[];
  invalidationConditions: string[];
}

export interface CompletePairAnalysisResponse {
  pair: string;
  status: DataSourceStatus;
  currentPrice: number;
  pipSize: number;
  spreadPips: number;
  session: string;
  regime: MarketRegimeType;
  trend: {
    direction: TrendDirection;
    strength: number;
  };
  marketStructure: {
    type: StructureClassification;
    phase: MarketPhase;
    breakoutStatus: BreakoutStatus;
  };
  multiTimeframe: {
    '5m': TrendDirection;
    '15m': TrendDirection;
    '1h': TrendDirection;
    '4h': TrendDirection;
    'daily': TrendDirection;
    alignment: MultiTimeframeAlignmentResult;
    summary: string;
  };
  indicators: StructuredIndicators;
  supportResistance: {
    majorSupport: number | null;
    majorResistance: number | null;
    previousDayHigh: number;
    previousDayLow: number;
    previousWeekHigh: number;
    previousWeekLow: number;
    nearestSupport: number | null;
    nearestResistance: number | null;
  };
  signal: {
    direction: string;
    score: number;
    status: string;
    category: SignalCategory;
  };
  tradePlan: {
    entryMin: number;
    entryMax: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number;
    takeProfit3?: number;
    riskReward: number;
    stopLossReason: string;
    tp1Reason: string;
  } | null;
  warnings: string[];
}

