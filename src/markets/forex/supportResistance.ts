import { Candle } from '../common/types';
import { PriceLevel, SupportResistanceResult } from './types';
import { findSwingPoints } from './marketStructure';

/**
 * Clusters nearby price levels within a tolerance (e.g. 5-10 pips)
 */
function clusterLevels(
  rawLevels: { price: number; type: 'SUPPORT' | 'RESISTANCE'; ageBars: number }[],
  tolerance: number
): { price: number; type: 'SUPPORT' | 'RESISTANCE'; touches: number; ageBars: number }[] {
  const clusters: { price: number; type: 'SUPPORT' | 'RESISTANCE'; touches: number; ageBars: number }[] = [];

  for (const raw of rawLevels) {
    const existing = clusters.find(
      c => c.type === raw.type && Math.abs(c.price - raw.price) <= tolerance
    );
    if (existing) {
      existing.price = (existing.price * existing.touches + raw.price) / (existing.touches + 1);
      existing.touches += 1;
      existing.ageBars = Math.min(existing.ageBars, raw.ageBars);
    } else {
      clusters.push({
        price: raw.price,
        type: raw.type,
        touches: 1,
        ageBars: raw.ageBars
      });
    }
  }

  return clusters;
}

/**
 * Calculates significant Support & Resistance levels from multi-candle history
 */
export function calculateSupportResistance(
  candles: Candle[],
  pipSize: number = 0.0001
): SupportResistanceResult {
  if (candles.length === 0) {
    return {
      currentPrice: 0,
      swingHighs: [],
      swingLows: [],
      localSupport: [],
      localResistance: [],
      majorSupport: null,
      majorResistance: null,
      previousDayHigh: 0,
      previousDayLow: 0,
      previousWeekHigh: 0,
      previousWeekLow: 0,
      nearestSupport: null,
      nearestResistance: null
    };
  }

  const currentPrice = candles[candles.length - 1].close;
  const tolerance = pipSize * 8; // 8 pips cluster tolerance

  // 1. Swing points from recent history
  const { highs, lows } = findSwingPoints(candles, 2);
  const swingHighPrices = highs.map(h => h.price);
  const swingLowPrices = lows.map(l => l.price);

  // 2. Previous day high / low (approximated from bars or daily slice)
  const oneDayBars = Math.min(candles.length, 96); // 96 x 15m = 24h
  const daySlice = candles.slice(-oneDayBars);
  const previousDayHigh = Math.max(...daySlice.map(c => c.high));
  const previousDayLow = Math.min(...daySlice.map(c => c.low));

  // 3. Previous week high / low (approximated from up to 5 days bars)
  const oneWeekBars = Math.min(candles.length, 480);
  const weekSlice = candles.slice(-oneWeekBars);
  const previousWeekHigh = Math.max(...weekSlice.map(c => c.high));
  const previousWeekLow = Math.min(...weekSlice.map(c => c.low));

  // 4. Raw support & resistance candidates
  const rawResistance: { price: number; type: 'RESISTANCE'; ageBars: number }[] = [];
  const rawSupport: { price: number; type: 'SUPPORT'; ageBars: number }[] = [];

  highs.forEach(h => {
    rawResistance.push({
      price: h.price,
      type: 'RESISTANCE',
      ageBars: candles.length - 1 - h.index
    });
  });

  lows.forEach(l => {
    rawSupport.push({
      price: l.price,
      type: 'SUPPORT',
      ageBars: candles.length - 1 - l.index
    });
  });

  const clusteredRes = clusterLevels(rawResistance, tolerance);
  const clusteredSup = clusterLevels(rawSupport, tolerance);

  // Filter into local support (below current price) and local resistance (above current price)
  const localSupport: PriceLevel[] = clusteredSup
    .filter(s => s.price < currentPrice)
    .map(s => {
      const distPips = (currentPrice - s.price) / pipSize;
      const strength = Math.min(10, Math.round(s.touches * 2.5 + (s.ageBars < 30 ? 2 : 1)));
      return {
        price: Number(s.price.toFixed(5)),
        type: (strength >= 7 ? 'MAJOR_SUPPORT' : 'LOCAL_SUPPORT') as PriceLevel['type'],
        strength,
        touches: s.touches,
        distancePips: Number(distPips.toFixed(1)),
        ageBars: s.ageBars
      };
    })
    .sort((a, b) => b.price - a.price); // closest below current price first

  const localResistance: PriceLevel[] = clusteredRes
    .filter(r => r.price > currentPrice)
    .map(r => {
      const distPips = (r.price - currentPrice) / pipSize;
      const strength = Math.min(10, Math.round(r.touches * 2.5 + (r.ageBars < 30 ? 2 : 1)));
      return {
        price: Number(r.price.toFixed(5)),
        type: (strength >= 7 ? 'MAJOR_RESISTANCE' : 'LOCAL_RESISTANCE') as PriceLevel['type'],
        strength,
        touches: r.touches,
        distancePips: Number(distPips.toFixed(1)),
        ageBars: r.ageBars
      };
    })
    .sort((a, b) => a.price - b.price); // closest above current price first

  // Major support and major resistance (highest strength or key swing boundary)
  const majorSupport = localSupport.length > 0
    ? [...localSupport].sort((a, b) => b.strength - a.strength || b.touches - a.touches)[0]
    : {
        price: Number(previousDayLow.toFixed(5)),
        type: 'MAJOR_SUPPORT' as const,
        strength: 8,
        touches: 2,
        distancePips: Number(((currentPrice - previousDayLow) / pipSize).toFixed(1)),
        ageBars: 24
      };

  const majorResistance = localResistance.length > 0
    ? [...localResistance].sort((a, b) => b.strength - a.strength || b.touches - a.touches)[0]
    : {
        price: Number(previousDayHigh.toFixed(5)),
        type: 'MAJOR_RESISTANCE' as const,
        strength: 8,
        touches: 2,
        distancePips: Number(((previousDayHigh - currentPrice) / pipSize).toFixed(1)),
        ageBars: 24
      };

  const nearestSupport = localSupport[0] ?? majorSupport;
  const nearestResistance = localResistance[0] ?? majorResistance;

  return {
    currentPrice,
    swingHighs: swingHighPrices.slice(-5),
    swingLows: swingLowPrices.slice(-5),
    localSupport: localSupport.slice(0, 4),
    localResistance: localResistance.slice(0, 4),
    majorSupport,
    majorResistance,
    previousDayHigh,
    previousDayLow,
    previousWeekHigh,
    previousWeekLow,
    nearestSupport,
    nearestResistance
  };
}
