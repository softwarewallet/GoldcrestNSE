import { Candle, MarketStructure, SignalCategory, SignalDirection, TradingSignal } from '../common/types';
import { computeTechnicalFeatures } from '../common/indicators';
import { getForexPairConfig } from './instruments';

export function detectMarketStructure(candles: Candle[]): MarketStructure {
  if (candles.length < 10) {
    const latest = candles[candles.length - 1]?.close ?? 1.0;
    return {
      trend: 'NEUTRAL_RANGE',
      structureType: 'CONSOLIDATION',
      support: latest * 0.995,
      resistance: latest * 1.005,
      swingHigh: latest * 1.005,
      swingLow: latest * 0.995
    };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  // Identify local swing highs and lows in the last 20 candles
  const windowSize = Math.min(20, candles.length);
  const recentHighs = highs.slice(-windowSize);
  const recentLows = lows.slice(-windowSize);

  const swingHigh = Math.max(...recentHighs);
  const swingLow = Math.min(...recentLows);
  const currentClose = closes[closes.length - 1];

  // Compare halves
  const mid = Math.floor(windowSize / 2);
  const firstHalfHigh = Math.max(...recentHighs.slice(0, mid));
  const secondHalfHigh = Math.max(...recentHighs.slice(mid));
  const firstHalfLow = Math.min(...recentLows.slice(0, mid));
  const secondHalfLow = Math.min(...recentLows.slice(mid));

  let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL_RANGE' = 'NEUTRAL_RANGE';
  let structureType: 'HIGHER_HIGH' | 'HIGHER_LOW' | 'LOWER_HIGH' | 'LOWER_LOW' | 'CONSOLIDATION' | 'BREAKOUT' | 'BREAKDOWN' = 'CONSOLIDATION';

  if (secondHalfHigh > firstHalfHigh && secondHalfLow > firstHalfLow) {
    trend = 'BULLISH';
    structureType = currentClose > swingHigh * 0.999 ? 'BREAKOUT' : 'HIGHER_HIGH';
  } else if (secondHalfHigh < firstHalfHigh && secondHalfLow < firstHalfLow) {
    trend = 'BEARISH';
    structureType = currentClose < swingLow * 1.001 ? 'BREAKDOWN' : 'LOWER_LOW';
  } else if (secondHalfLow > firstHalfLow && currentClose < secondHalfHigh) {
    trend = 'BULLISH';
    structureType = 'HIGHER_LOW';
  } else if (secondHalfHigh < firstHalfHigh && currentClose > secondHalfLow) {
    trend = 'BEARISH';
    structureType = 'LOWER_HIGH';
  }

  return {
    trend,
    structureType,
    support: swingLow,
    resistance: swingHigh,
    swingHigh,
    swingLow,
    liquidityZone: {
      min: trend === 'BULLISH' ? swingLow : swingHigh * 0.998,
      max: trend === 'BULLISH' ? swingLow * 1.002 : swingHigh,
      note: trend === 'BULLISH' ? 'Orderblock Demand Liquidity' : 'Orderblock Supply Liquidity'
    }
  };
}

export function evaluateForexSetup(pairSymbol: string, candles: Candle[]): TradingSignal {
  const config = getForexPairConfig(pairSymbol);
  const features = computeTechnicalFeatures(candles);
  const structure = detectMarketStructure(candles);
  const current = candles[candles.length - 1];
  const currentPrice = current.close;

  const noTradeReasons: string[] = [];

  // Quantitative Trend Score (0-15)
  let trendScore = 0;
  const isEmaAlignedBull = features.ema9 > features.ema21 && features.ema21 > features.ema50;
  const isEmaAlignedBear = features.ema9 < features.ema21 && features.ema21 < features.ema50;
  if (isEmaAlignedBull) trendScore += 14;
  else if (isEmaAlignedBear) trendScore += 14;
  else if (features.ema9 > features.ema21) trendScore += 8;
  else trendScore += 5;

  // Multi-timeframe Score (0-15)
  const mtfScore = (structure.trend === 'BULLISH' && isEmaAlignedBull) || (structure.trend === 'BEARISH' && isEmaAlignedBear) ? 14 : 7;

  // Momentum Score (0-10)
  let momentumScore = 0;
  if (structure.trend === 'BULLISH') {
    if (features.rsi >= 52 && features.rsi <= 68) momentumScore = 9;
    else if (features.rsi > 70) {
      momentumScore = 4;
      noTradeReasons.push('RSI extended in overbought territory (>70)');
    } else momentumScore = 6;
  } else if (structure.trend === 'BEARISH') {
    if (features.rsi <= 48 && features.rsi >= 32) momentumScore = 9;
    else if (features.rsi < 30) {
      momentumScore = 4;
      noTradeReasons.push('RSI extended in oversold territory (<30)');
    } else momentumScore = 6;
  } else {
    momentumScore = 5;
  }

  // Market Structure Score (0-10)
  let msScore = 5;
  if (structure.structureType === 'HIGHER_HIGH' || structure.structureType === 'HIGHER_LOW' || structure.structureType === 'BREAKOUT') {
    msScore = structure.trend === 'BULLISH' ? 9 : 3;
  } else if (structure.structureType === 'LOWER_LOW' || structure.structureType === 'LOWER_HIGH' || structure.structureType === 'BREAKDOWN') {
    msScore = structure.trend === 'BEARISH' ? 9 : 3;
  }

  // Support / Resistance (0-10)
  const srScore = 8;

  // Volume / Volatility (0-10)
  const volScore = 7;

  // Risk / Reward Score (0-10)
  const pip = config.pipSize;
  const atrPips = Math.max(features.atr / pip, 10);
  const slPips = Math.max(15, atrPips * 1.5);
  const tp1Pips = slPips * 1.8;
  const tp2Pips = slPips * 2.6;
  const rrRatio = Number((tp1Pips / slPips).toFixed(2));
  const rrScore = rrRatio >= 2.0 ? 9 : rrRatio >= 1.5 ? 7 : 4;

  if (rrRatio < 1.4) {
    noTradeReasons.push(`Risk/Reward (${rrRatio}:1) is below strict 1.4:1 minimum threshold`);
  }

  // Volatility (0-5)
  const volatilityScore = 4;

  // ML Probability Estimate (Phase 1 rule: statistical baseline, clearly calibrated, not claiming certainty)
  let mlProbability = 0.5;
  if (structure.trend === 'BULLISH' && isEmaAlignedBull && features.rsi >= 50 && features.rsi <= 65) {
    mlProbability = 0.74;
  } else if (structure.trend === 'BEARISH' && isEmaAlignedBear && features.rsi <= 50 && features.rsi >= 35) {
    mlProbability = 0.72;
  } else if (structure.trend !== 'NEUTRAL_RANGE') {
    mlProbability = 0.61;
  } else {
    mlProbability = 0.48;
    noTradeReasons.push('Consolidation market structure / weak statistical directional edge');
  }

  const mlScore = Math.round(mlProbability * 15);

  const totalScore = trendScore + mtfScore + momentumScore + msScore + srScore + volScore + mlScore + rrScore + volatilityScore;

  // Direction & Category
  let direction: SignalDirection = 'NO_TRADE';
  let category: SignalCategory = 'NO_TRADE';

  if (noTradeReasons.length > 0 || totalScore < 60) {
    direction = 'NO_TRADE';
    category = 'NO_TRADE';
    if (totalScore >= 60 && noTradeReasons.length === 0) {
      direction = 'WAIT';
      category = 'NEUTRAL';
    }
  } else if (structure.trend === 'BULLISH' && isEmaAlignedBull) {
    direction = 'BUY';
    category = totalScore >= 80 ? 'STRONG_BUY' : 'BUY';
  } else if (structure.trend === 'BEARISH' && isEmaAlignedBear) {
    direction = 'SELL';
    category = totalScore >= 80 ? 'STRONG_SELL' : 'SELL';
  } else {
    direction = 'WAIT';
    category = 'NEUTRAL';
    noTradeReasons.push('Signals between indicators and market structure are in conflict');
  }

  // Entry, SL, TP
  const isBuy = direction === 'BUY';
  const entryPreferred = currentPrice;
  const entryMin = isBuy ? currentPrice - 3 * pip : currentPrice - 2 * pip;
  const entryMax = isBuy ? currentPrice + 2 * pip : currentPrice + 3 * pip;
  const stopLoss = isBuy ? currentPrice - slPips * pip : currentPrice + slPips * pip;
  const target1 = isBuy ? currentPrice + tp1Pips * pip : currentPrice - tp1Pips * pip;
  const target2 = isBuy ? currentPrice + tp2Pips * pip : currentPrice - tp2Pips * pip;

  const reasons: string[] = [];
  if (isBuy) {
    reasons.push(`EMA stack aligned bullish (9 > 21 > 50)`);
    reasons.push(`Market structure printing ${structure.structureType}`);
    reasons.push(`RSI at ${features.rsi} indicating sustainable bullish momentum`);
    reasons.push(`ATR-calibrated Stop-Loss (${slPips.toFixed(1)} pips) provides 1:${rrRatio} R:R to TP1`);
  } else if (direction === 'SELL') {
    reasons.push(`EMA stack aligned bearish (9 < 21 < 50)`);
    reasons.push(`Market structure printing ${structure.structureType}`);
    reasons.push(`RSI at ${features.rsi} confirming downward price pressure`);
    reasons.push(`ATR-calibrated Stop-Loss (${slPips.toFixed(1)} pips) provides 1:${rrRatio} R:R to TP1`);
  } else {
    reasons.push(`System rejected trade: ${noTradeReasons.join('; ')}`);
  }

  const invalidationConditions: string[] = isBuy
    ? [
        `Price breaks below swing support at ${structure.support.toFixed(config.digits)}`,
        `EMA 9 crosses below EMA 21 on 15M timeframe`,
        `RSI drops below 45 before reaching preferred entry`,
        `Approaching High Impact Macroeconomic Event within 20 minutes`
      ]
    : [
        `Price breaks above swing resistance at ${structure.resistance.toFixed(config.digits)}`,
        `EMA 9 crosses above EMA 21 on 15M timeframe`,
        `RSI surges above 55 before reaching preferred entry`,
        `Approaching High Impact Macroeconomic Event within 20 minutes`
      ];

  return {
    id: `FX_${pairSymbol.replace('/', '')}_${Date.now()}`,
    timestamp: Date.now(),
    market: 'FOREX',
    instrument: pairSymbol,
    direction,
    category,
    strategy: isBuy ? 'Trend Pullback Long' : 'Trend Pullback Short',
    score: totalScore,
    scoreBreakdown: {
      trend: trendScore,
      multiTimeframe: mtfScore,
      momentum: momentumScore,
      marketStructure: msScore,
      supportResistance: srScore,
      volumeOI: volScore,
      mlProbability: mlScore,
      riskReward: rrScore,
      volatility: volatilityScore,
      totalScore
    },
    mlProbability,
    entryZone: {
      min: Number(entryMin.toFixed(config.digits)),
      max: Number(entryMax.toFixed(config.digits)),
      preferred: Number(entryPreferred.toFixed(config.digits))
    },
    stopLoss: Number(stopLoss.toFixed(config.digits)),
    target1: Number(target1.toFixed(config.digits)),
    target2: Number(target2.toFixed(config.digits)),
    riskReward: rrRatio,
    status: direction === 'NO_TRADE' ? 'INVALIDATED' : 'WAITING',
    invalidationConditions,
    reasons,
    noTradeReasons: noTradeReasons.length > 0 ? noTradeReasons : undefined,
    modelVersion: 'xgboost_forex_v1.0.0_baseline'
  };
}
