import { Candle } from '../common/types';
import { StructuredIndicators } from './types';

/**
 * Calculates Simple Moving Average (SMA)
 */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (data.length === 0 || period <= 0) return result;

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) {
      sum -= data[i - period];
    }
    if (i >= period - 1) {
      result.push(sum / period);
    } else {
      result.push(null);
    }
  }
  return result;
}

/**
 * Calculates Exponential Moving Average (EMA)
 */
export function calculateEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (data.length === 0 || period <= 0) return result;

  const multiplier = 2 / (period + 1);

  // First EMA is the SMA of the first 'period' elements if available
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      const initialSma = sum / period;
      result.push(initialSma);
    } else {
      const prevEma = result[i - 1]!;
      const currentEma = (data[i] - prevEma) * multiplier + prevEma;
      result.push(currentEma);
    }
  }
  return result;
}

/**
 * Calculates Relative Strength Index (RSI - 14) using Wilder's Smoothed Moving Average
 */
export function calculateRSI(closes: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

/**
 * Calculates Moving Average Convergence Divergence (MACD 12, 26, 9)
 */
export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
) {
  const fastEma = calculateEMA(closes, fastPeriod);
  const slowEma = calculateEMA(closes, slowPeriod);

  const macdLine: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (fastEma[i] !== null && slowEma[i] !== null) {
      macdLine.push(fastEma[i]! - slowEma[i]!);
    } else {
      macdLine.push(null);
    }
  }

  // Calculate signal line over valid macdLine values
  const validMacdIndices = macdLine
    .map((val, idx) => (val !== null ? idx : null))
    .filter((v): v is number => v !== null);

  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const histogram: (number | null)[] = new Array(closes.length).fill(null);

  if (validMacdIndices.length >= signalPeriod) {
    const validMacdValues = validMacdIndices.map(idx => macdLine[idx]!);
    const signalEma = calculateEMA(validMacdValues, signalPeriod);

    for (let k = 0; k < validMacdIndices.length; k++) {
      const originalIdx = validMacdIndices[k];
      const sigVal = signalEma[k];
      signalLine[originalIdx] = sigVal;
      if (sigVal !== null && macdLine[originalIdx] !== null) {
        histogram[originalIdx] = macdLine[originalIdx]! - sigVal;
      }
    }
  }

  return { macdLine, signalLine, histogram };
}

/**
 * Calculates Average True Range (ATR - 14)
 */
export function calculateATR(candles: Candle[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return result;

  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low);
    } else {
      const hl = candles[i].high - candles[i].low;
      const hpc = Math.abs(candles[i].high - candles[i - 1].close);
      const lpc = Math.abs(candles[i].low - candles[i - 1].close);
      tr.push(Math.max(hl, hpc, lpc));
    }
  }

  if (candles.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i];
  }
  let currentAtr = sum / period;
  result[period - 1] = currentAtr;

  // Wilder's smoothing for ATR: ATR = (prevATR * (period - 1) + currentTR) / period
  for (let i = period; i < candles.length; i++) {
    currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
    result[i] = currentAtr;
  }

  return result;
}

/**
 * Calculates Average Directional Index (ADX 14, DI+, DI-) using Wilder's directional movement
 */
export function calculateADX(candles: Candle[], period: number = 14) {
  const len = candles.length;
  const plusDI: (number | null)[] = new Array(len).fill(null);
  const minusDI: (number | null)[] = new Array(len).fill(null);
  const adx: (number | null)[] = new Array(len).fill(null);

  if (len <= period * 2) {
    // If not enough candles for full 2-stage smoothing, do best-effort estimation if at least period+1 candles
    if (len > period) {
      let trSum = 0;
      let plusDMSum = 0;
      let minusDMSum = 0;

      for (let i = 1; i <= period; i++) {
        const upMove = candles[i].high - candles[i - 1].high;
        const downMove = candles[i - 1].low - candles[i].low;
        const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
        const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
        const hl = candles[i].high - candles[i].low;
        const hpc = Math.abs(candles[i].high - candles[i - 1].close);
        const lpc = Math.abs(candles[i].low - candles[i - 1].close);
        const tr = Math.max(hl, hpc, lpc);

        trSum += tr;
        plusDMSum += plusDM;
        minusDMSum += minusDM;
      }

      const pDI = trSum > 0 ? (plusDMSum / trSum) * 100 : 0;
      const mDI = trSum > 0 ? (minusDMSum / trSum) * 100 : 0;
      const diSum = pDI + mDI;
      const dx = diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0;

      plusDI[len - 1] = Number(pDI.toFixed(2));
      minusDI[len - 1] = Number(mDI.toFixed(2));
      adx[len - 1] = Number(dx.toFixed(2));
    }
    return { adx, plusDI, minusDI };
  }

  // Full Wilder's calculation
  const trArr: number[] = [];
  const plusDMArr: number[] = [];
  const minusDMArr: number[] = [];

  for (let i = 1; i < len; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    plusDMArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMArr.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    trArr.push(Math.max(hl, hpc, lpc));
  }

  // Initial sums
  let smoothTR = 0;
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;

  for (let i = 0; i < period; i++) {
    smoothTR += trArr[i];
    smoothPlusDM += plusDMArr[i];
    smoothMinusDM += minusDMArr[i];
  }

  const dxValues: number[] = [];
  const dxIndices: number[] = [];

  for (let i = period; i < trArr.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trArr[i];
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMArr[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMArr[i];

    const pDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const mDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

    const candleIdx = i + 1;
    plusDI[candleIdx] = Number(pDI.toFixed(2));
    minusDI[candleIdx] = Number(mDI.toFixed(2));

    const diSum = pDI + mDI;
    const dx = diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0;
    dxValues.push(dx);
    dxIndices.push(candleIdx);
  }

  if (dxValues.length >= period) {
    let adxSum = 0;
    for (let i = 0; i < period; i++) {
      adxSum += dxValues[i];
    }
    let currentADX = adxSum / period;
    adx[dxIndices[period - 1]] = Number(currentADX.toFixed(2));

    for (let i = period; i < dxValues.length; i++) {
      currentADX = (currentADX * (period - 1) + dxValues[i]) / period;
      adx[dxIndices[i]] = Number(currentADX.toFixed(2));
    }
  }

  return { adx, plusDI, minusDI };
}

/**
 * Calculates Bollinger Bands (20, 2)
 */
export function calculateBollingerBands(closes: number[], period: number = 20, multiplier: number = 2) {
  const sma = calculateSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const percentB: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    const mean = sma[i];
    if (mean === null) {
      upper.push(null);
      lower.push(null);
      percentB.push(null);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
      const stdDev = Math.sqrt(variance);
      const up = mean + multiplier * stdDev;
      const down = mean - multiplier * stdDev;
      const pb = up === down ? 0.5 : (closes[i] - down) / (up - down);

      upper.push(up);
      lower.push(down);
      percentB.push(pb);
    }
  }

  return { upper, lower, middle: sma, percentB };
}

/**
 * Calculates Stochastic Oscillator (%K, %D with 14, 3, 3)
 */
export function calculateStochastic(candles: Candle[], kPeriod: number = 14, dPeriod: number = 3) {
  const fastK: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      fastK.push(null);
    } else {
      const slice = candles.slice(i - kPeriod + 1, i + 1);
      const lowestLow = Math.min(...slice.map(c => c.low));
      const highestHigh = Math.max(...slice.map(c => c.high));
      const close = candles[i].close;

      const denom = highestHigh - lowestLow;
      const kVal = denom === 0 ? 50 : ((close - lowestLow) / denom) * 100;
      fastK.push(kVal);
    }
  }

  // Smooth %K with 3-period SMA to get slow %K
  const slowK: (number | null)[] = [];
  for (let i = 0; i < fastK.length; i++) {
    if (i < kPeriod + 1) {
      slowK.push(null);
    } else {
      const slice = fastK.slice(i - 2, i + 1);
      if (slice.some(v => v === null)) {
        slowK.push(null);
      } else {
        const sum = (slice as number[]).reduce((a, b) => a + b, 0);
        slowK.push(sum / 3);
      }
    }
  }

  // %D is 3-period SMA of slow %K
  const d: (number | null)[] = [];
  for (let i = 0; i < slowK.length; i++) {
    if (i < kPeriod + 3) {
      d.push(null);
    } else {
      const slice = slowK.slice(i - (dPeriod - 1), i + 1);
      if (slice.some(v => v === null)) {
        d.push(null);
      } else {
        const sum = (slice as number[]).reduce((a, b) => a + b, 0);
        d.push(sum / dPeriod);
      }
    }
  }

  return { k: slowK, d };
}

/**
 * Calculates Rate of Change (ROC - 12)
 */
export function calculateROC(closes: number[], period: number = 12): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      result.push(null);
    } else {
      const prev = closes[i - period];
      if (prev === 0) {
        result.push(0);
      } else {
        const roc = ((closes[i] - prev) / prev) * 100;
        result.push(roc);
      }
    }
  }
  return result;
}

/**
 * Calculates Volume Weighted Average Price (VWAP)
 */
export function calculateVWAP(candles: Candle[]): (number | null)[] {
  let cumulativeTPV = 0;
  let cumulativeVol = 0;
  const vwap: (number | null)[] = [];

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume > 0 ? c.volume : 1;
    cumulativeTPV += typicalPrice * vol;
    cumulativeVol += vol;
    vwap.push(cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : c.close);
  }

  return vwap;
}

/**
 * Reusable Indicator Service:
 * calculateIndicators(candles)
 * Returns structured data for the latest bar, handling insufficient historical data gracefully.
 */
export function calculateIndicators(candles: Candle[]): StructuredIndicators {
  if (!candles || candles.length === 0) {
    return {
      ema9: null,
      ema21: null,
      ema50: null,
      ema100: null,
      ema200: null,
      sma50: null,
      sma200: null,
      rsi: null,
      macd: null,
      macdSignal: null,
      macdHistogram: null,
      adx: null,
      diPlus: null,
      diMinus: null,
      atr: null,
      bollingerUpper: null,
      bollingerMiddle: null,
      bollingerLower: null,
      stochastic: null,
      roc: null,
      vwap: null
    };
  }

  const closes = candles.map(c => c.close);
  const lastIdx = candles.length - 1;

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema100 = calculateEMA(closes, 100);
  const ema200 = calculateEMA(closes, 200);

  const sma50 = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, 200);

  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const adxResult = calculateADX(candles, 14);
  const atr = calculateATR(candles, 14);
  const bb = calculateBollingerBands(closes, 20, 2);
  const stoch = calculateStochastic(candles, 14, 3);
  const roc = calculateROC(closes, 12);
  const vwap = calculateVWAP(candles);

  const formatNum = (val: number | null, decimals: number = 4): number | null => {
    return val !== null && Number.isFinite(val) ? Number(val.toFixed(decimals)) : null;
  };

  const lastK = stoch.k[lastIdx];
  const lastD = stoch.d[lastIdx];
  const stochasticObj =
    lastK !== null && lastD !== null
      ? { k: Number(lastK.toFixed(2)), d: Number(lastD.toFixed(2)) }
      : null;

  return {
    ema9: formatNum(ema9[lastIdx], 5),
    ema21: formatNum(ema21[lastIdx], 5),
    ema50: formatNum(ema50[lastIdx], 5),
    ema100: formatNum(ema100[lastIdx], 5),
    ema200: formatNum(ema200[lastIdx], 5),
    sma50: formatNum(sma50[lastIdx], 5),
    sma200: formatNum(sma200[lastIdx], 5),
    rsi: formatNum(rsi[lastIdx], 2),
    macd: formatNum(macd.macdLine[lastIdx], 5),
    macdSignal: formatNum(macd.signalLine[lastIdx], 5),
    macdHistogram: formatNum(macd.histogram[lastIdx], 5),
    adx: formatNum(adxResult.adx[lastIdx], 2),
    diPlus: formatNum(adxResult.plusDI[lastIdx], 2),
    diMinus: formatNum(adxResult.minusDI[lastIdx], 2),
    atr: formatNum(atr[lastIdx], 5),
    bollingerUpper: formatNum(bb.upper[lastIdx], 5),
    bollingerMiddle: formatNum(bb.middle[lastIdx], 5),
    bollingerLower: formatNum(bb.lower[lastIdx], 5),
    stochastic: stochasticObj,
    roc: formatNum(roc[lastIdx], 2),
    vwap: formatNum(vwap[lastIdx], 5)
  };
}
