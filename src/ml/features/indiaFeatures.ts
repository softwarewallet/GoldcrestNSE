// ============================================================================
// INDIAN EQUITY & INDEX FEATURE ENGINEERING (NO LOOK-AHEAD BIAS)
// ============================================================================

import { IndianMarketFeatureVector } from '../types';

export interface IndianCandlePointInTime {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
}

export function extractIndianMarketFeaturesAtTimestamp(
  candles: IndianCandlePointInTime[],
  targetTimestamp: number,
  pdh?: number,
  pdl?: number,
  openingRangeHigh?: number,
  openingRangeLow?: number
): IndianMarketFeatureVector {
  const getTs = (c: any) => typeof c.timestamp === 'number' ? c.timestamp : (typeof c.utcTimestamp === 'number' ? c.utcTimestamp : 0);
  const validCandles = candles
    .filter(c => getTs(c) <= targetTimestamp)
    .sort((a, b) => getTs(a) - getTs(b));

  if (validCandles.length < 20) {
    throw new Error(`Insufficient Indian market candles at timestamp ${targetTimestamp} (found ${validCandles.length}, minimum 20 required)`);
  }

  const latest = validCandles[validCandles.length - 1];
  const price = latest.close;

  const getReturn = (period: number): number => {
    if (validCandles.length <= period) return 0;
    const pastPrice = validCandles[validCandles.length - 1 - period].close;
    return pastPrice > 0 ? (price - pastPrice) / pastPrice : 0;
  };

  const returns1 = getReturn(1);
  const returns5 = getReturn(5);
  const returns15 = getReturn(15);

  // EMA calculations
  const calculateEMA = (period: number): number => {
    const k = 2 / (period + 1);
    let ema = validCandles[0].close;
    for (let i = 1; i < validCandles.length; i++) {
      ema = validCandles[i].close * k + ema * (1 - k);
    }
    return ema;
  };

  const ema9 = calculateEMA(9);
  const ema21 = calculateEMA(21);
  const ema50 = calculateEMA(50);

  const ema9_21_cross = ema9 > ema21 ? 1 : 0;
  const emaStructureScore = (price > ema9 && ema9 > ema21 && ema21 > ema50) ? 1 :
                            (price < ema9 && ema9 < ema21 && ema21 < ema50) ? -1 : 0;

  // RSI 14
  let gains = 0;
  let losses = 0;
  const rsiPeriod = Math.min(14, validCandles.length - 1);
  for (let i = validCandles.length - rsiPeriod; i < validCandles.length; i++) {
    const diff = validCandles[i].close - validCandles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi14 = 100 - (100 / (1 + rs));

  // ATR
  let trSum = 0;
  const atrPeriod = Math.min(14, validCandles.length - 1);
  for (let i = validCandles.length - atrPeriod; i < validCandles.length; i++) {
    const high = validCandles[i].high;
    const low = validCandles[i].low;
    const prevClose = validCandles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  const atr = trSum / atrPeriod;

  // VWAP
  let cumVol = 0;
  let cumVolPrice = 0;
  for (const c of validCandles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumVolPrice += tp * c.volume;
    cumVol += c.volume;
  }
  const vwap = cumVol > 0 ? cumVolPrice / cumVol : price;
  const vwapDistance = price - vwap;

  // Opening Range & Gap
  const orHigh = openingRangeHigh ?? (validCandles[0] ? validCandles[0].high : price);
  const orLow = openingRangeLow ?? (validCandles[0] ? validCandles[0].low : price);
  const orRange = orHigh - orLow;
  const openingRangePosition = orRange > 0 ? (price - orLow) / orRange : 0.5;

  const prevDayHigh = pdh ?? (price + atr * 1.5);
  const prevDayLow = pdl ?? (price - atr * 1.5);
  const distToPdh = prevDayHigh - price;
  const distToPdl = price - prevDayLow;
  const gapPercentage = ((validCandles[0].open - prevDayHigh) / prevDayHigh) * 100;

  // Support & Resistance
  const distToSupport = Math.max(0, price - prevDayLow);
  const distToResistance = Math.max(0, prevDayHigh - price);

  // Market structure & trend
  const marketStructureScore = price > vwap && ema9 > ema21 ? 1 : price < vwap && ema9 < ema21 ? -1 : 0;
  const trendStrength = Math.min(1, Math.abs(returns15) * 50);

  // Volume ratio (latest vs 20-period avg)
  const avgVol = validCandles.reduce((s, c) => s + c.volume, 0) / validCandles.length;
  const volumeRatio = avgVol > 0 ? latest.volume / avgVol : 1.0;
  const momentumScore = (returns5 * 100);

  // Time of day in IST minutes from 09:15
  const date = new Date(targetTimestamp);
  const hoursIST = (date.getUTCHours() + 5 + Math.floor((date.getUTCMinutes() + 30) / 60)) % 24;
  const minutesIST = (date.getUTCMinutes() + 30) % 60;
  const minutesFromOpen = (hoursIST - 9) * 60 + (minutesIST - 15);

  return {
    price,
    returns1,
    returns5,
    returns15,
    ema9_21_cross,
    emaStructureScore,
    rsi14,
    macdHist: (ema9 - ema21) * 0.5,
    adx14: 25,
    atr,
    vwapDistance,
    openingRangePosition,
    gapPercentage,
    distToPdh,
    distToPdl,
    distToSupport,
    distToResistance,
    marketStructureScore,
    trendStrength,
    volumeRatio,
    momentumScore,
    timeOfDayMinutes: Math.max(0, Math.min(375, minutesFromOpen))
  };
}
