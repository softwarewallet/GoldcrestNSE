import { Candle } from '../common/types';
import { MarketStructureResult, MarketRegimeType, StructureClassification, MarketPhase, BreakoutStatus, TrendDirection } from './types';
import { calculateATR, calculateBollingerBands, calculateEMA, calculateSMA } from './indicators';

interface SwingPoint {
  index: number;
  price: number;
  type: 'HIGH' | 'LOW';
  timestamp: number;
}

/**
 * Finds local swing highs and lows using a fractal window
 */
export function findSwingPoints(candles: Candle[], lookback: number = 3): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  if (candles.length < lookback * 2 + 1) return { highs, lows };

  for (let i = lookback; i < candles.length - lookback; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;

    let isHigh = true;
    let isLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= currentHigh) isHigh = false;
      if (candles[j].low <= currentLow) isLow = false;
    }

    if (isHigh) {
      highs.push({ index: i, price: currentHigh, type: 'HIGH', timestamp: candles[i].timestamp });
    }
    if (isLow) {
      lows.push({ index: i, price: currentLow, type: 'LOW', timestamp: candles[i].timestamp });
    }
  }

  return { highs, lows };
}

/**
 * Detects Market Structure and Regime from raw OHLC candles
 */
export function analyzeMarketStructure(candles: Candle[]): MarketStructureResult {
  if (candles.length < 15) {
    const lastPrice = candles[candles.length - 1]?.close ?? 1.0;
    return {
      trend: 'ranging',
      trendStrength: 30,
      structure: 'range',
      phase: 'consolidation',
      breakoutStatus: 'none',
      regime: 'RANGE',
      swingHigh: lastPrice * 1.002,
      swingLow: lastPrice * 0.998
    };
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const { highs, lows } = findSwingPoints(candles, 2);

  // Fallback if swing points are scarce
  const recentWindow = candles.slice(-20);
  const fallbackHigh = Math.max(...recentWindow.map(c => c.high));
  const fallbackLow = Math.min(...recentWindow.map(c => c.low));

  const lastHigh = highs.length > 0 ? highs[highs.length - 1].price : fallbackHigh;
  const prevHigh = highs.length > 1 ? highs[highs.length - 2].price : fallbackHigh;

  const lastLow = lows.length > 0 ? lows[lows.length - 1].price : fallbackLow;
  const prevLow = lows.length > 1 ? lows[lows.length - 2].price : fallbackLow;

  const ema21Arr = calculateEMA(closes, 21);
  const ema50Arr = calculateEMA(closes, 50);
  const ema200Arr = calculateEMA(closes, 200);
  const lastEma21 = ema21Arr[ema21Arr.length - 1] ?? currentPrice;
  const lastEma50 = ema50Arr[ema50Arr.length - 1] ?? currentPrice;
  const lastEma200 = ema200Arr[ema200Arr.length - 1] ?? currentPrice;

  const atrArr = calculateATR(candles, 14);
  const currentAtr = atrArr[atrArr.length - 1] ?? (candles[0].close * 0.0015);
  const avgAtr = atrArr.slice(-30).reduce((acc, val) => acc + (val ?? currentAtr), 0) / Math.max(1, atrArr.slice(-30).length);

  const bb = calculateBollingerBands(closes, 20, 2);
  const lastUpper = bb.upper[bb.upper.length - 1] ?? currentPrice * 1.01;
  const lastLower = bb.lower[bb.lower.length - 1] ?? currentPrice * 0.99;
  const bbWidth = (lastUpper - lastLower) / currentPrice;

  // 1. Structure Classification
  let structure: StructureClassification = 'range';
  let trend: TrendDirection = 'ranging';
  let phase: MarketPhase = 'consolidation';
  let breakoutStatus: BreakoutStatus = 'none';

  const isHigherHigh = lastHigh > prevHigh;
  const isHigherLow = lastLow > prevLow;
  const isLowerHigh = lastHigh < prevHigh;
  const isLowerLow = lastLow < prevLow;

  if (isHigherHigh && isHigherLow) {
    structure = 'higher_high_higher_low';
    trend = 'bullish';
  } else if (isLowerHigh && isLowerLow) {
    structure = 'lower_high_lower_low';
    trend = 'bearish';
  } else if (isHigherHigh && !isHigherLow) {
    structure = 'higher_high';
    trend = currentPrice > lastEma50 ? 'bullish' : 'ranging';
  } else if (isLowerLow && !isLowerHigh) {
    structure = 'lower_low';
    trend = currentPrice < lastEma50 ? 'bearish' : 'ranging';
  } else {
    structure = 'range';
    trend = 'ranging';
  }

  // 2. Breakout and Breakdown detection
  const resistanceZone = Math.max(lastHigh, prevHigh);
  const supportZone = Math.min(lastLow, prevLow);

  if (currentPrice > resistanceZone && closes[closes.length - 2] <= resistanceZone) {
    breakoutStatus = 'bullish_breakout';
    phase = 'expansion';
  } else if (currentPrice < supportZone && closes[closes.length - 2] >= supportZone) {
    breakoutStatus = 'bearish_breakdown';
    phase = 'expansion';
  } else if (currentPrice > resistanceZone) {
    breakoutStatus = 'bullish_breakout';
  } else if (currentPrice < supportZone) {
    breakoutStatus = 'bearish_breakdown';
  }

  // 3. Market Phase Detection
  if (breakoutStatus !== 'none') {
    phase = 'expansion';
  } else if (trend === 'bullish') {
    if (currentPrice < lastHigh && currentPrice >= lastEma21) {
      phase = 'pullback';
    } else if (currentPrice < lastEma21 && currentPrice < lastLow) {
      phase = 'reversal';
    } else if (currentPrice > lastHigh * 0.999) {
      phase = 'trend_continuation';
    } else {
      phase = 'trend_weakening';
    }
  } else if (trend === 'bearish') {
    if (currentPrice > lastLow && currentPrice <= lastEma21) {
      phase = 'pullback';
    } else if (currentPrice > lastEma21 && currentPrice > lastHigh) {
      phase = 'reversal';
    } else if (currentPrice < lastLow * 1.001) {
      phase = 'trend_continuation';
    } else {
      phase = 'trend_weakening';
    }
  } else {
    phase = 'consolidation';
  }

  // 4. Trend Strength (0 - 100)
  let trendStrength = 40;
  if (trend === 'bullish') {
    let score = 50;
    if (isHigherHigh) score += 15;
    if (isHigherLow) score += 15;
    if (currentPrice > lastEma21) score += 10;
    if (lastEma21 > lastEma50) score += 10;
    trendStrength = Math.min(95, score);
  } else if (trend === 'bearish') {
    let score = 50;
    if (isLowerLow) score += 15;
    if (isLowerHigh) score += 15;
    if (currentPrice < lastEma21) score += 10;
    if (lastEma21 < lastEma50) score += 10;
    trendStrength = Math.min(95, score);
  } else {
    trendStrength = 35;
  }

  // 5. Market Regime Detection
  let regime: MarketRegimeType = 'RANGE';

  const isHighVol = currentAtr > avgAtr * 1.4;
  const isLowVol = currentAtr < avgAtr * 0.7;

  if (breakoutStatus !== 'none') {
    regime = 'BREAKOUT';
  } else if (phase === 'reversal') {
    regime = 'POTENTIAL_REVERSAL';
  } else if (trendStrength >= 75 && (isHigherHigh || isLowerLow)) {
    regime = 'STRONG_TRENDING';
  } else if (trendStrength >= 55 && trend !== 'ranging') {
    regime = 'TRENDING';
  } else if (isHighVol) {
    regime = 'HIGH_VOLATILITY';
  } else if (isLowVol) {
    regime = 'LOW_VOLATILITY';
  } else {
    regime = 'RANGE';
  }

  return {
    trend,
    trendStrength,
    structure,
    phase,
    breakoutStatus,
    regime,
    swingHigh: lastHigh,
    swingLow: lastLow,
    lastHigherHigh: isHigherHigh ? lastHigh : undefined,
    lastHigherLow: isHigherLow ? lastLow : undefined,
    lastLowerHigh: isLowerHigh ? lastHigh : undefined,
    lastLowerLow: isLowerLow ? lastLow : undefined
  };
}
