import { Candle } from '../common/types';
import {
  ForexTimeframe,
  MultiTimeframeAlignmentResult,
  MultiTimeframeSummary,
  TimeframeAnalysis
} from './types';
import { calculateIndicators } from './indicators';
import { analyzeMarketStructure } from './marketStructure';

/**
 * Evaluates a single timeframe's technical state
 */
export function analyzeSingleTimeframe(
  timeframe: ForexTimeframe,
  candles: Candle[]
): TimeframeAnalysis {
  const structure = analyzeMarketStructure(candles);
  const indicators = calculateIndicators(candles);
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;

  // RSI Condition
  const rsi = indicators.rsi ?? 50;
  let rsiCondition: TimeframeAnalysis['rsiCondition'] = 'neutral';
  if (rsi >= 70) rsiCondition = 'overbought';
  else if (rsi >= 54) rsiCondition = 'bullish';
  else if (rsi <= 30) rsiCondition = 'oversold';
  else if (rsi <= 46) rsiCondition = 'bearish';

  // MACD Condition
  const macd = indicators.macd ?? 0;
  const signal = indicators.macdSignal ?? 0;
  const hist = indicators.macdHistogram ?? 0;
  let macdCondition: TimeframeAnalysis['macdCondition'] = 'neutral';
  if (macd > signal && hist > 0) {
    macdCondition = macd > 0 ? 'bullish_momentum' : 'bullish_cross';
  } else if (macd < signal && hist < 0) {
    macdCondition = macd < 0 ? 'bearish_momentum' : 'bearish_cross';
  }

  // ADX Condition
  const adx = indicators.adx ?? 20;
  let adxCondition: TimeframeAnalysis['adxCondition'] = 'weak_or_ranging';
  if (adx >= 25) adxCondition = 'strong_trend';
  else if (adx >= 20) adxCondition = 'developing_trend';

  // Momentum synthesis
  let momentum: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if ((rsiCondition === 'bullish' || rsiCondition === 'overbought') && (macdCondition === 'bullish_momentum' || macdCondition === 'bullish_cross')) {
    momentum = 'bullish';
  } else if ((rsiCondition === 'bearish' || rsiCondition === 'oversold') && (macdCondition === 'bearish_momentum' || macdCondition === 'bearish_cross')) {
    momentum = 'bearish';
  }

  // Price vs EMA Structure
  const e21 = indicators.ema21 ?? lastClose;
  const e50 = indicators.ema50 ?? lastClose;
  const e200 = indicators.ema200 ?? lastClose;

  let priceVsEma: TimeframeAnalysis['priceVsEmaStructure'] = 'compressed';
  if (lastClose > e21 && e21 > e50 && e50 > e200) {
    priceVsEma = 'above_all';
  } else if (lastClose < e21 && e21 < e50 && e50 < e200) {
    priceVsEma = 'below_all';
  } else if (lastClose > e21) {
    priceVsEma = 'above_21';
  } else if (lastClose < e21) {
    priceVsEma = 'below_21';
  }

  return {
    timeframe,
    trend: structure.trend,
    trendStrength: structure.trendStrength,
    momentum,
    structure: structure.structure,
    phase: structure.phase,
    rsiCondition,
    macdCondition,
    adxCondition,
    priceVsEmaStructure: priceVsEma,
    indicators,
    lastClose
  };
}

/**
 * Synthesizes multi-timeframe analysis across 5M, 15M, 1H, 4H, and Daily
 */
export function analyzeMultiTimeframe(
  candlesByTimeframe: Record<ForexTimeframe, Candle[]>
): MultiTimeframeSummary {
  const tf5m = analyzeSingleTimeframe('5M', candlesByTimeframe['5M'] || []);
  const tf15m = analyzeSingleTimeframe('15M', candlesByTimeframe['15M'] || []);
  const tf1h = analyzeSingleTimeframe('1H', candlesByTimeframe['1H'] || []);
  const tf4h = analyzeSingleTimeframe('4H', candlesByTimeframe['4H'] || []);
  const tfDaily = analyzeSingleTimeframe('Daily', candlesByTimeframe['Daily'] || []);

  const higherTfBullish = (tf4h.trend === 'bullish' ? 1 : 0) + (tf1h.trend === 'bullish' ? 1 : 0) + (tfDaily.trend === 'bullish' ? 1 : 0);
  const higherTfBearish = (tf4h.trend === 'bearish' ? 1 : 0) + (tf1h.trend === 'bearish' ? 1 : 0) + (tfDaily.trend === 'bearish' ? 1 : 0);

  const lowerTfBullish = (tf15m.trend === 'bullish' ? 1 : 0) + (tf5m.trend === 'bullish' ? 1 : 0);
  const lowerTfBearish = (tf15m.trend === 'bearish' ? 1 : 0) + (tf5m.trend === 'bearish' ? 1 : 0);

  let alignment: MultiTimeframeAlignmentResult = 'CONFLICTING';
  let alignmentScore = 8;
  let alignmentSummary = '';
  let isConflicting = false;

  // Bullish alignment cases
  if (higherTfBullish >= 2 && lowerTfBullish === 2) {
    alignment = 'STRONG_BULLISH_ALIGNMENT';
    alignmentScore = 19;
    alignmentSummary = 'Full bullish alignment across Daily, 4H, 1H, and lower execution timeframes.';
  } else if (higherTfBullish >= 2 && tf15m.trend === 'bullish' && tf5m.phase === 'pullback') {
    alignment = 'BULLISH_ALIGNMENT_PULLBACK';
    alignmentScore = 18;
    alignmentSummary = 'Bullish macro trend alignment with healthy lower-timeframe (5M) pullback entry.';
  }
  // Bearish alignment cases
  else if (higherTfBearish >= 2 && lowerTfBearish === 2) {
    alignment = 'STRONG_BEARISH_ALIGNMENT';
    alignmentScore = 19;
    alignmentSummary = 'Full bearish alignment across Daily, 4H, 1H, and lower execution timeframes.';
  } else if (higherTfBearish >= 2 && tf15m.trend === 'bearish' && tf5m.phase === 'pullback') {
    alignment = 'BEARISH_ALIGNMENT_PULLBACK';
    alignmentScore = 18;
    alignmentSummary = 'Bearish macro trend alignment with healthy lower-timeframe (5M) retracement to resistance.';
  }
  // Conflicting cases (e.g. 4H bullish, 1H/15M bearish)
  else if ((higherTfBullish >= 2 && lowerTfBearish >= 1) || (higherTfBearish >= 2 && lowerTfBullish >= 1)) {
    alignment = 'CONFLICTING';
    alignmentScore = 6;
    isConflicting = true;
    alignmentSummary = `Conflicting timeframes: Higher timeframes (${higherTfBullish >= 2 ? 'Bullish' : 'Bearish'}) oppose lower execution timeframes. Directional risk elevated.`;
  } else {
    alignment = 'RANGE_BOUND';
    alignmentScore = 9;
    alignmentSummary = 'Timeframes show mixed or consolidating directional structure without persistent trend alignment.';
  }

  return {
    '5m': tf5m,
    '15m': tf15m,
    '1h': tf1h,
    '4h': tf4h,
    'daily': tfDaily,
    alignment,
    alignmentScore,
    alignmentSummary,
    isConflicting
  };
}
