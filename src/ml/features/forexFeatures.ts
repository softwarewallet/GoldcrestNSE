// ============================================================================
// FOREX FEATURE ENGINEERING ENGINE (NO LOOK-AHEAD BIAS)
// ============================================================================

import { Candle } from '../../markets/common/types';
import { ForexCandle, ForexTimeframe } from '../../markets/forex/types';
import { calculateIndicators } from '../../markets/forex/indicators';
import { analyzeMarketStructure } from '../../markets/forex/marketStructure';
import { calculateSupportResistance } from '../../markets/forex/supportResistance';
import { ForexFeatureVector } from '../types';

export function extractForexFeaturesAtTimestamp(
  candles: (Candle | ForexCandle)[],
  targetTimestamp: number,
  pipSize: number = 0.0001,
  mtfCandles?: Record<string, (Candle | ForexCandle)[]>,
  signalMeta?: {
    score?: number;
    riskReward?: number;
    entryDistancePips?: number;
    stopDistancePips?: number;
    targetDistancePips?: number;
  }
): ForexFeatureVector {
  // CRITICAL: Filter candles strictly <= targetTimestamp. NO FUTURE DATA ALLOWED.
  const getTs = (c: any) => typeof c.timestamp === 'number' ? c.timestamp : (typeof c.utcTimestamp === 'number' ? c.utcTimestamp : 0);
  const validCandles = candles
    .filter(c => getTs(c) <= targetTimestamp)
    .sort((a, b) => getTs(a) - getTs(b));

  if (validCandles.length < 30) {
    throw new Error(`Insufficient historical candles at timestamp ${targetTimestamp} (found ${validCandles.length}, minimum 30 required)`);
  }

  const latestCandle = validCandles[validCandles.length - 1];
  const price = latestCandle.close;

  // 1. Returns calculation
  const getReturn = (period: number): number => {
    if (validCandles.length <= period) return 0;
    const pastPrice = validCandles[validCandles.length - 1 - period].close;
    return pastPrice > 0 ? (price - pastPrice) / pastPrice : 0;
  };

  const returns1 = getReturn(1);
  const returns5 = getReturn(5);
  const returns15 = getReturn(15);

  // 2. Technical Indicators on point-in-time slice
  const indicators = calculateIndicators(validCandles);
  const structure = analyzeMarketStructure(validCandles);
  const sr = calculateSupportResistance(validCandles, pipSize);

  // ATR & ATR percentage
  const atr = indicators.atr || 0.0010;
  const atrPct = price > 0 ? (atr / price) * 100 : 0;

  // EMA Distances & Slopes (in pips / base points)
  const ema9 = indicators.ema9 || price;
  const ema21 = indicators.ema21 || price;
  const ema50 = indicators.ema50 || price;
  const ema200 = indicators.ema200 || price;

  const ema9Distance = (price - ema9) / pipSize;
  const ema21Distance = (price - ema21) / pipSize;
  const ema50Distance = (price - ema50) / pipSize;
  const ema200Distance = (price - ema200) / pipSize;

  // Slopes (change over last 3 candles)
  let ema9Slope = 0;
  let ema21Slope = 0;
  if (validCandles.length >= 4) {
    const prevSlice = validCandles.slice(0, validCandles.length - 3);
    const prevInd = calculateIndicators(prevSlice);
    ema9Slope = ((indicators.ema9 - prevInd.ema9) / 3) / pipSize;
    ema21Slope = ((indicators.ema21 - prevInd.ema21) / 3) / pipSize;
  }

  // RSI, MACD, ADX
  const rsi14 = indicators.rsi || 50;
  const macdLine = indicators.macd || 0;
  const macdSignal = indicators.macdSignal || 0;
  const macdHist = indicators.macdHistogram || 0;
  const adx14 = indicators.adx || 20;
  const diPlus = indicators.diPlus || 20;
  const diMinus = indicators.diMinus || 20;

  // Bollinger Bands
  const bbUpper = indicators.bollingerUpper || price + 2 * atr;
  const bbLower = indicators.bollingerLower || price - 2 * atr;
  const bbRange = bbUpper - bbLower;
  const bollingerPctB = bbRange > 0 ? (price - bbLower) / bbRange : 0.5;
  const bollingerBandwidth = price > 0 ? (bbRange / price) * 100 : 0;

  // Stochastic & ROC
  const stochasticK = indicators.stochastic?.k || 50;
  const stochasticD = indicators.stochastic?.d || 50;
  const roc10 = getReturn(10) * 100;

  // VWAP & S/R distances
  const vwap = indicators.vwap || price;
  const vwapDistance = (price - vwap) / pipSize;

  // Distances to nearest support / resistance
  const distToSupport = sr.nearestSupport
    ? (price - sr.nearestSupport.price) / pipSize
    : (sr.localSupport && sr.localSupport.length > 0 ? (price - sr.localSupport[0].price) / pipSize : 50);

  const distToResistance = sr.nearestResistance
    ? (sr.nearestResistance.price - price) / pipSize
    : (sr.localResistance && sr.localResistance.length > 0 ? (sr.localResistance[0].price - price) / pipSize : 50);

  // Market structure score (-1 = Bearish, 0 = Neutral/Range, +1 = Bullish)
  let marketStructureScore = 0;
  if (structure.trend === 'bullish') marketStructureScore = 1;
  else if (structure.trend === 'bearish') marketStructureScore = -1;

  const trendStrength = structure.trendStrength || (adx14 > 25 ? (adx14 - 25) / 25 : 0.2);
  const volatilityPips = atr / pipSize;
  const spreadPips = 1.2; // configured baseline spread

  // Session flags derived point-in-time from UTC timestamp
  const date = new Date(targetTimestamp);
  const utcHour = date.getUTCHours();

  const sessionTokyo = (utcHour >= 0 && utcHour < 9) ? 1 : 0;
  const sessionLondon = (utcHour >= 7 && utcHour < 16) ? 1 : 0;
  const sessionNewYork = (utcHour >= 12 && utcHour < 21) ? 1 : 0;
  const sessionOverlap = (sessionLondon === 1 && sessionNewYork === 1) ? 1 : 0;

  // Multi-Timeframe Alignment
  let mtfTrendAlignment = 0;
  let mtfConflictScore = 0;

  if (mtfCandles) {
    let alignedCount = 0;
    let totalTfs = 0;
    for (const [tf, tfArr] of Object.entries(mtfCandles)) {
      const validTfCandles = tfArr.filter(c => c.timestamp <= targetTimestamp);
      if (validTfCandles.length >= 10) {
        totalTfs++;
        const tfInd = calculateIndicators(validTfCandles);
        if (tfInd.ema9 > tfInd.ema21) alignedCount++;
        else alignedCount--;
      }
    }
    if (totalTfs > 0) {
      mtfTrendAlignment = alignedCount / totalTfs; // -1 to +1
      mtfConflictScore = 1 - Math.abs(mtfTrendAlignment); // 0 = perfectly aligned, 1 = conflict
    }
  }

  return {
    price,
    returns1,
    returns5,
    returns15,
    atr,
    atrPct,
    ema9Distance,
    ema21Distance,
    ema50Distance,
    ema200Distance,
    ema9Slope,
    ema21Slope,
    rsi14,
    macdLine,
    macdSignal,
    macdHist,
    adx14,
    diPlus,
    diMinus,
    bollingerPctB,
    bollingerBandwidth,
    stochasticK,
    stochasticD,
    roc10,
    vwapDistance,
    distToSupport,
    distToResistance,
    marketStructureScore,
    trendStrength,
    volatilityPips,
    spreadPips,
    sessionLondon,
    sessionNewYork,
    sessionTokyo,
    sessionOverlap,
    mtfTrendAlignment,
    mtfConflictScore,
    signalScore: signalMeta?.score ?? 70,
    riskRewardRatio: signalMeta?.riskReward ?? 2.0,
    entryDistancePips: signalMeta?.entryDistancePips ?? 0,
    stopDistancePips: signalMeta?.stopDistancePips ?? 25,
    targetDistancePips: signalMeta?.targetDistancePips ?? 50
  };
}
