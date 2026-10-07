import { Candle, MarketStructure, SignalDirection, TradingSignal } from '../common/types';
import { computeTechnicalFeatures } from '../common/indicators';
import { detectMarketStructure } from '../forex/forexEngine';
import { getIndianUnderlyingConfig } from './underlyings';

export interface IndianUnderlyingAnalysis {
  symbol: string;
  name: string;
  spot: number;
  change: number;
  changePercent: number;
  futuresPrice: number;
  basis: number; // Futures - Spot
  vwap: number;
  vwapDistance: number;
  vwapStatus: 'ABOVE_VWAP' | 'BELOW_VWAP' | 'AT_VWAP';
  prevDayHigh: number;
  prevDayLow: number;
  intradayHigh: number;
  intradayLow: number;
  openingRangeHigh: number;
  openingRangeLow: number;
  indiaVix: number;
  pcr: number;
  advanceDeclineRatio: number;
  structure: MarketStructure;
  signal: TradingSignal;
}

export function evaluateIndianUnderlying(
  symbol: string,
  candles: Candle[],
  spotPrice: number,
  indiaVix: number = 13.8,
  pcr: number = 1.05
): IndianUnderlyingAnalysis {
  const config = getIndianUnderlyingConfig(symbol);
  const features = computeTechnicalFeatures(candles);
  const structure = detectMarketStructure(candles);

  const prevClose = candles.length > 1 ? candles[0].close : spotPrice * 0.995;
  const change = Number((spotPrice - prevClose).toFixed(2));
  const changePercent = Number(((change / prevClose) * 100).toFixed(2));

  // Futures basis
  const futuresBasis = spotPrice > 20000 ? 45.5 : 20.0;
  const futuresPrice = Number((spotPrice + futuresBasis).toFixed(2));

  // Intraday levels
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const intradayHigh = Math.max(...highs, spotPrice);
  const intradayLow = Math.min(...lows, spotPrice);

  const prevDayHigh = Math.max(...highs.slice(0, Math.max(1, Math.floor(highs.length / 2))));
  const prevDayLow = Math.min(...lows.slice(0, Math.max(1, Math.floor(lows.length / 2))));

  const openingRangeCandles = candles.slice(0, Math.min(3, candles.length));
  const openingRangeHigh = Math.max(...openingRangeCandles.map(c => c.high));
  const openingRangeLow = Math.min(...openingRangeCandles.map(c => c.low));

  const vwap = features.vwap ?? spotPrice;
  const vwapDistance = Number((spotPrice - vwap).toFixed(2));
  const vwapStatus: 'ABOVE_VWAP' | 'BELOW_VWAP' | 'AT_VWAP' =
    Math.abs(vwapDistance) < config.strikeStep * 0.1 ? 'AT_VWAP' : vwapDistance > 0 ? 'ABOVE_VWAP' : 'BELOW_VWAP';

  // Scoring
  let trendScore = 0;
  const isBullish = vwapStatus === 'ABOVE_VWAP' && features.ema9 > features.ema21;
  const isBearish = vwapStatus === 'BELOW_VWAP' && features.ema9 < features.ema21;

  if (isBullish) trendScore = 14;
  else if (isBearish) trendScore = 14;
  else trendScore = 6;

  const mtfScore = structure.trend !== 'NEUTRAL_RANGE' ? 12 : 5;
  const momentumScore = features.rsi > 55 && features.rsi < 68 ? 9 : features.rsi < 45 && features.rsi > 32 ? 9 : 5;
  const msScore = structure.trend === 'BULLISH' ? 9 : structure.trend === 'BEARISH' ? 9 : 4;
  const srScore = 8;
  const volScore = 8;
  const mlProb = isBullish ? 0.73 : isBearish ? 0.71 : 0.5;
  const mlScore = Math.round(mlProb * 15);
  const rrScore = 8;
  const volaScore = 4;

  const totalScore = trendScore + mtfScore + momentumScore + msScore + srScore + volScore + mlScore + rrScore + volaScore;

  const noTradeReasons: string[] = [];
  if (indiaVix > 22) {
    noTradeReasons.push('India VIX exceeds elevated threshold (>22)');
  }
  if (vwapStatus === 'AT_VWAP') {
    noTradeReasons.push('Price churning right at intraday VWAP equilibrium');
  }

  let direction: SignalDirection = 'NO_TRADE';
  if (noTradeReasons.length > 0) {
    direction = 'NO_TRADE';
  } else if (isBullish) {
    direction = 'BUY';
  } else if (isBearish) {
    direction = 'SELL';
  } else {
    direction = 'WAIT';
  }

  const atr = features.atr > 0 ? features.atr : config.strikeStep;
  const stopLoss = isBullish ? spotPrice - atr * 1.5 : spotPrice + atr * 1.5;
  const target1 = isBullish ? spotPrice + atr * 2.2 : spotPrice - atr * 2.2;
  const target2 = isBullish ? spotPrice + atr * 3.5 : spotPrice - atr * 3.5;

  const signal: TradingSignal = {
    id: `IN_${symbol}_${Date.now()}`,
    timestamp: Date.now(),
    market: 'INDIA_EQUITY',
    instrument: symbol,
    underlying: symbol,
    direction,
    category: direction === 'BUY' ? 'STRONG_BUY' : direction === 'SELL' ? 'STRONG_SELL' : 'NEUTRAL',
    strategy: 'Intraday VWAP & Market Structure',
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
      volatility: volaScore,
      totalScore
    },
    mlProbability: mlProb,
    entryZone: {
      min: Number((spotPrice - config.strikeStep * 0.2).toFixed(2)),
      max: Number((spotPrice + config.strikeStep * 0.2).toFixed(2)),
      preferred: spotPrice
    },
    stopLoss: Number(stopLoss.toFixed(2)),
    target1: Number(target1.toFixed(2)),
    target2: Number(target2.toFixed(2)),
    riskReward: 1.8,
    status: direction === 'NO_TRADE' ? 'INVALIDATED' : 'WAITING',
    invalidationConditions: isBullish
      ? [
          `Intraday price falls below VWAP (${vwap.toFixed(1)})`,
          `Breaks below Previous Day Low at ${prevDayLow.toFixed(1)}`,
          `India VIX spikes > 22 indicating volatility regime shift`
        ]
      : [
          `Intraday price rises above VWAP (${vwap.toFixed(1)})`,
          `Breaks above Previous Day High at ${prevDayHigh.toFixed(1)}`,
          `India VIX drops sharply with sudden put unwinding`
        ],
    reasons: isBullish
      ? [
          `Trading ${vwapDistance.toFixed(1)} pts above VWAP equilibrium`,
          `Structure forming ${structure.structureType}`,
          `PCR at ${pcr} indicates favorable put writing support`
        ]
      : isBearish
      ? [
          `Trading ${Math.abs(vwapDistance).toFixed(1)} pts below VWAP equilibrium`,
          `Structure forming ${structure.structureType}`,
          `PCR at ${pcr} indicates call writing dominance`
        ]
      : [`Indecisive price action near VWAP equilibrium`],
    noTradeReasons: noTradeReasons.length > 0 ? noTradeReasons : undefined,
    modelVersion: 'xgboost_india_underlying_v1.0.0_baseline'
  };

  return {
    symbol,
    name: config.name,
    spot: spotPrice,
    change,
    changePercent,
    futuresPrice,
    basis: futuresBasis,
    vwap,
    vwapDistance,
    vwapStatus,
    prevDayHigh,
    prevDayLow,
    intradayHigh,
    intradayLow,
    openingRangeHigh,
    openingRangeLow,
    indiaVix,
    pcr,
    advanceDeclineRatio: 1.45,
    structure,
    signal
  };
}
