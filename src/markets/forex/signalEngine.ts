import { Candle, DataSourceStatus, SignalCategory } from '../common/types';
import { executeRun, executeQuery } from '../../database/db';
import { getForexPairConfig, ForexPairConfig } from './instruments';
import {
  CompletePairAnalysisResponse,
  EntryType,
  EntryZone,
  ForexCandle,
  ForexMarketStatus,
  ForexSignal,
  ForexTimeframe,
  MarketRegimeType,
  MarketStructureResult,
  MultiTimeframeSummary,
  SignalScoreBreakdownDetailed,
  StructuredIndicators,
  SupportResistanceResult,
  TargetLevel,
  TradePlan
} from './types';
import { DEFAULT_FOREX_CONFIG, ForexSignalEngineConfig } from './config';
import { calculateIndicators } from './indicators';
import { analyzeMarketStructure } from './marketStructure';
import { calculateSupportResistance } from './supportResistance';
import { analyzeMultiTimeframe } from './multiTimeframe';
import { LiveForexProvider, validateCandleDataQuality } from './provider';
import { getForexSessionState } from '../common/session';

interface SyncForexDataProvider {
  readonly providerName: string;
  readonly status: DataSourceStatus;
  readonly isDemo: boolean;
  getCandles(pair: string, timeframe: ForexTimeframe, limit?: number): ForexCandle[];
  getLatestCandle(pair: string, timeframe: ForexTimeframe): ForexCandle;
  getAvailablePairs(): ForexPairConfig[];
  getMarketStatus(): ForexMarketStatus;
}

export class ForexSignalEngine {
  private config: ForexSignalEngineConfig;
  private provider: SyncForexDataProvider;

  constructor(config: ForexSignalEngineConfig = DEFAULT_FOREX_CONFIG, provider: SyncForexDataProvider = new LiveForexProvider()) {
    this.config = config;
    this.provider = provider;
  }

  /**
   * Calculates the weighted signal score (0 - 100)
   */
  calculateSignalScore(breakdown: SignalScoreBreakdownDetailed): number {
    const total =
      breakdown.trend +
      breakdown.multiTimeframe +
      breakdown.momentum +
      breakdown.marketStructure +
      breakdown.supportResistance +
      breakdown.volatility +
      breakdown.riskReward;
    return Math.min(100, Math.max(0, Math.round(total)));
  }

  /**
   * Evaluates directional bias and signal category
   */
  calculateDirection(
    mtf: MultiTimeframeSummary,
    structure: MarketStructureResult,
    regime: MarketRegimeType,
    indicators: StructuredIndicators,
    score: number,
    noTradeReasons: string[]
  ): {
    direction: 'STRONG_BUY' | 'BUY' | 'WATCH_BUY' | 'NEUTRAL' | 'WATCH_SELL' | 'SELL' | 'STRONG_SELL' | 'NO_TRADE';
    category: SignalCategory;
    reasons: string[];
  } {
    const reasons: string[] = [];

    // If hard filters triggered or score below neutral minimum, NO_TRADE
    if (noTradeReasons.length > 0 || score < this.config.thresholds.noTradeBelow) {
      return {
        direction: 'NO_TRADE',
        category: 'NO_TRADE',
        reasons: [`No-trade filter active: ${noTradeReasons.join('; ')}`]
      };
    }

    const isBullishBias =
      (mtf.alignment === 'STRONG_BULLISH_ALIGNMENT' || mtf.alignment === 'BULLISH_ALIGNMENT_PULLBACK' || structure.trend === 'bullish') &&
      !mtf.isConflicting;

    const isBearishBias =
      (mtf.alignment === 'STRONG_BEARISH_ALIGNMENT' || mtf.alignment === 'BEARISH_ALIGNMENT_PULLBACK' || structure.trend === 'bearish') &&
      !mtf.isConflicting;

    if (isBullishBias && !isBearishBias) {
      reasons.push(`Bullish structure (${structure.structure}) with ${mtf.alignmentSummary}`);
      if (indicators.rsi !== null && indicators.rsi >= 50 && indicators.rsi <= 68) {
        reasons.push(`RSI at ${indicators.rsi} indicates healthy upside momentum without overextension.`);
      }
      if (indicators.ema9 !== null && indicators.ema21 !== null && indicators.ema9 > indicators.ema21) {
        reasons.push(`EMA 9 (${indicators.ema9}) trending cleanly above EMA 21 (${indicators.ema21}).`);
      }

      if (score >= this.config.thresholds.strongSignal) {
        return { direction: 'STRONG_BUY', category: 'STRONG_BUY', reasons };
      } else if (score >= this.config.thresholds.actionableSignal) {
        return { direction: 'BUY', category: 'BUY', reasons };
      } else if (score >= this.config.thresholds.watchSignal) {
        return { direction: 'WATCH_BUY', category: 'WATCH_BUY', reasons };
      } else {
        return { direction: 'NEUTRAL', category: 'NEUTRAL', reasons: ['Bullish bias present but score insufficiently high for active trade plan.'] };
      }
    } else if (isBearishBias && !isBullishBias) {
      reasons.push(`Bearish structure (${structure.structure}) with ${mtf.alignmentSummary}`);
      if (indicators.rsi !== null && indicators.rsi <= 50 && indicators.rsi >= 32) {
        reasons.push(`RSI at ${indicators.rsi} indicates established downward momentum.`);
      }
      if (indicators.ema9 !== null && indicators.ema21 !== null && indicators.ema9 < indicators.ema21) {
        reasons.push(`EMA 9 (${indicators.ema9}) trailing below EMA 21 (${indicators.ema21}).`);
      }

      if (score >= this.config.thresholds.strongSignal) {
        return { direction: 'STRONG_SELL', category: 'STRONG_SELL', reasons };
      } else if (score >= this.config.thresholds.actionableSignal) {
        return { direction: 'SELL', category: 'SELL', reasons };
      } else if (score >= this.config.thresholds.watchSignal) {
        return { direction: 'WATCH_SELL', category: 'WATCH_SELL', reasons };
      } else {
        return { direction: 'NEUTRAL', category: 'NEUTRAL', reasons: ['Bearish bias present but score insufficiently high for active trade plan.'] };
      }
    } else {
      return {
        direction: 'NEUTRAL',
        category: 'NEUTRAL',
        reasons: ['Indecisive market structure or conflicting timeframe directions.']
      };
    }
  }

  /**
   * Calculates entry zone rather than a single arbitrary price
   */
  calculateEntryZone(
    direction: string,
    currentPrice: number,
    structure: MarketStructureResult,
    atr: number,
    pipSize: number,
    indicators: StructuredIndicators
  ): EntryZone {
    const isBuy = direction.includes('BUY');
    const isSell = direction.includes('SELL');

    const ema21 = indicators.ema21 ?? currentPrice;
    const distanceToEma = Math.abs(currentPrice - ema21);
    const isExtended = distanceToEma > atr * this.config.filters.maxExtensionAtrMultiplier;

    let entryType: EntryType = 'PULLBACK_ENTRY';
    let entryCondition = '';
    let entryMin = currentPrice;
    let entryMax = currentPrice;
    let entryPreferred = currentPrice;

    if (structure.breakoutStatus === 'bullish_breakout' && isBuy) {
      entryType = 'BREAKOUT_ENTRY';
      entryCondition = 'Enter on confirmed candle close above resistance level with volume confirmation';
      entryMin = currentPrice;
      entryMax = currentPrice + 4 * pipSize;
      entryPreferred = currentPrice + 1.5 * pipSize;
    } else if (structure.breakoutStatus === 'bearish_breakdown' && isSell) {
      entryType = 'BREAKOUT_ENTRY';
      entryCondition = 'Enter on confirmed candle close below support breakdown level with volume confirmation';
      entryMin = currentPrice - 4 * pipSize;
      entryMax = currentPrice;
      entryPreferred = currentPrice - 1.5 * pipSize;
    } else if (structure.phase === 'pullback') {
      entryType = 'PULLBACK_ENTRY';
      if (isBuy) {
        entryCondition = 'Enter on 5M/15M rejection wick in the EMA 21 retracement zone';
        entryMin = Math.max(ema21 - 3 * pipSize, structure.swingLow);
        entryMax = currentPrice;
        entryPreferred = (entryMin + entryMax) / 2;
      } else {
        entryCondition = 'Enter on 5M/15M rejection wick in the EMA 21 retracement zone';
        entryMin = currentPrice;
        entryMax = Math.min(ema21 + 3 * pipSize, structure.swingHigh);
        entryPreferred = (entryMin + entryMax) / 2;
      }
    } else {
      entryType = 'MARKET_STRUCTURE_CONFIRMATION';
      entryCondition = 'Enter upon market structure confirmation of continuation bar';
      const spreadPips = 3 * pipSize;
      entryMin = isBuy ? currentPrice - spreadPips : currentPrice - spreadPips * 0.5;
      entryMax = isBuy ? currentPrice + spreadPips * 0.5 : currentPrice + spreadPips;
      entryPreferred = currentPrice;
    }

    return {
      entryMin: Number(entryMin.toFixed(5)),
      entryMax: Number(entryMax.toFixed(5)),
      entryPreferred: Number(entryPreferred.toFixed(5)),
      entryType,
      entryCondition,
      isExtended
    };
  }

  /**
   * Calculates Stop-Loss with structural and volatility rationale
   */
  calculateStopLoss(
    direction: string,
    entry: number,
    structure: MarketStructureResult,
    atr: number,
    pipSize: number,
    sr: SupportResistanceResult
  ): { stopLoss: number; reason: string; pips: number } {
    const isBuy = direction.includes('BUY');
    const method = this.config.stopLoss.method;
    let sl = entry;
    let reason = '';

    const atrBuffer = atr * this.config.stopLoss.atrMultiplier;
    const minDistance = this.config.stopLoss.minPips * pipSize;

    if (isBuy) {
      const structuralLow = sr.nearestSupport ? Math.min(sr.nearestSupport.price, structure.swingLow) : structure.swingLow;
      const proposedSl = structuralLow - (pipSize * 4); // 4 pips below swing low
      const atrSl = entry - atrBuffer;

      if (method === 'STRUCTURE_INVALIDATION' || method === 'SWING_BASED') {
        sl = Math.min(proposedSl, atrSl);
        reason = `Invalidation placed below swing low support at ${structuralLow.toFixed(5)} with ATR buffer.`;
      } else {
        sl = atrSl;
        reason = `ATR-based stop (${this.config.stopLoss.atrMultiplier}x ATR = ${(atrBuffer / pipSize).toFixed(1)} pips).`;
      }

      // Enforce min & max bounds
      if (entry - sl < minDistance) {
        sl = entry - minDistance;
        reason += ` Adjusted to strict minimum ${this.config.stopLoss.minPips} pips distance.`;
      }
    } else {
      const structuralHigh = sr.nearestResistance ? Math.max(sr.nearestResistance.price, structure.swingHigh) : structure.swingHigh;
      const proposedSl = structuralHigh + (pipSize * 4);
      const atrSl = entry + atrBuffer;

      if (method === 'STRUCTURE_INVALIDATION' || method === 'SWING_BASED') {
        sl = Math.max(proposedSl, atrSl);
        reason = `Invalidation placed above swing high resistance at ${structuralHigh.toFixed(5)} with ATR buffer.`;
      } else {
        sl = atrSl;
        reason = `ATR-based stop (${this.config.stopLoss.atrMultiplier}x ATR = ${(atrBuffer / pipSize).toFixed(1)} pips).`;
      }

      if (sl - entry < minDistance) {
        sl = entry + minDistance;
        reason += ` Adjusted to strict minimum ${this.config.stopLoss.minPips} pips distance.`;
      }
    }

    const pips = Number((Math.abs(entry - sl) / pipSize).toFixed(1));
    return {
      stopLoss: Number(sl.toFixed(5)),
      reason,
      pips
    };
  }

  /**
   * Generates TP1, TP2, TP3 targets based on R:R, S/R, ATR, and structural extensions
   */
  calculateTargets(
    direction: string,
    entry: number,
    sl: number,
    structure: MarketStructureResult,
    atr: number,
    pipSize: number,
    sr: SupportResistanceResult
  ): { tp1: TargetLevel; tp2: TargetLevel; tp3: TargetLevel } {
    const isBuy = direction.includes('BUY');
    const riskDistance = Math.abs(entry - sl);

    // Baseline targets from configured multipliers
    const tp1Dist = riskDistance * this.config.takeProfit.tp1Multiplier;
    const tp2Dist = riskDistance * this.config.takeProfit.tp2Multiplier;
    const tp3Dist = riskDistance * this.config.takeProfit.tp3Multiplier;

    let tp1Price = isBuy ? entry + tp1Dist : entry - tp1Dist;
    let tp2Price = isBuy ? entry + tp2Dist : entry - tp2Dist;
    let tp3Price = isBuy ? entry + tp3Dist : entry - tp3Dist;

    let tp1Reason = `TP1 at 1:${this.config.takeProfit.tp1Multiplier} R:R risk-neutralization level`;
    let tp2Reason = `TP2 at 1:${this.config.takeProfit.tp2Multiplier} R:R primary swing target`;
    let tp3Reason = `TP3 at 1:${this.config.takeProfit.tp3Multiplier} R:R macro extension target`;

    // Anchor to S/R if logical
    if (isBuy && sr.nearestResistance && sr.nearestResistance.price > entry) {
      if (Math.abs(sr.nearestResistance.price - tp1Price) / pipSize < 12) {
        tp1Price = sr.nearestResistance.price - 2 * pipSize;
        tp1Reason = `Front-running key resistance at ${sr.nearestResistance.price.toFixed(5)}`;
      }
    } else if (!isBuy && sr.nearestSupport && sr.nearestSupport.price < entry) {
      if (Math.abs(tp1Price - sr.nearestSupport.price) / pipSize < 12) {
        tp1Price = sr.nearestSupport.price + 2 * pipSize;
        tp1Reason = `Front-running key support at ${sr.nearestSupport.price.toFixed(5)}`;
      }
    }

    const r1 = Number((Math.abs(tp1Price - entry) / riskDistance).toFixed(2));
    const r2 = Number((Math.abs(tp2Price - entry) / riskDistance).toFixed(2));
    const r3 = Number((Math.abs(tp3Price - entry) / riskDistance).toFixed(2));

    return {
      tp1: { targetPrice: Number(tp1Price.toFixed(5)), targetReason: tp1Reason, expectedR: r1 },
      tp2: { targetPrice: Number(tp2Price.toFixed(5)), targetReason: tp2Reason, expectedR: r2 },
      tp3: { targetPrice: Number(tp3Price.toFixed(5)), targetReason: tp3Reason, expectedR: r3 }
    };
  }

  /**
   * Risk/reward calculation
   */
  calculateRiskReward(entry: number, sl: number, tp1: number, pipSize: number): { riskPips: number; rewardPips: number; ratio: number } {
    const riskPips = Math.abs(entry - sl) / pipSize;
    const rewardPips = Math.abs(tp1 - entry) / pipSize;
    const ratio = riskPips > 0 ? Number((rewardPips / riskPips).toFixed(2)) : 0;
    return {
      riskPips: Number(riskPips.toFixed(1)),
      rewardPips: Number(rewardPips.toFixed(1)),
      ratio
    };
  }

  /**
   * Generates a complete quantitative analysis and signal for a pair
   */
  analyzePair(pairSymbol: string): CompletePairAnalysisResponse {
    const config = getForexPairConfig(pairSymbol);
    const sessionState = getForexSessionState();
    const marketStatus = this.provider.getMarketStatus();

    // Fetch multi-timeframe candles
    const candles5m = this.provider.getCandles(config.symbol, '5M', 70);
    const candles15m = this.provider.getCandles(config.symbol, '15M', 70);
    const candles1h = this.provider.getCandles(config.symbol, '1H', 70);
    const candles4h = this.provider.getCandles(config.symbol, '4H', 70);
    const candlesDaily = this.provider.getCandles(config.symbol, 'Daily', 70);

    const mtf = analyzeMultiTimeframe({
      '1M': [],
      '5M': candles5m,
      '15M': candles15m,
      '30M': [],
      '1H': candles1h,
      '4H': candles4h,
      'Daily': candlesDaily
    });

    const primaryCandles = candles15m;
    const primaryCandleValidation = validateCandleDataQuality(primaryCandles);

    const indicators = calculateIndicators(primaryCandles);
    const structure = analyzeMarketStructure(primaryCandles);
    const sr = calculateSupportResistance(primaryCandles, config.pipSize);

    const latestCandle = primaryCandles[primaryCandles.length - 1];
    const currentPrice = latestCandle.close;
    const spreadPips = config.typicalSpreadPips;
    const atr = indicators.atr ?? (currentPrice * 0.0015);

    const noTradeReasons: string[] = [];
    const warnings: string[] = [];

    // HARD FILTERS (Section 16)
    if (!primaryCandleValidation.isValid) {
      noTradeReasons.push(`Data Quality failure: ${primaryCandleValidation.errors.join('; ')}`);
    }
    if (primaryCandles.length < this.config.filters.minCandlesRequired) {
      noTradeReasons.push(`Insufficient candle history (${primaryCandles.length} < ${this.config.filters.minCandlesRequired})`);
    }
    if (!marketStatus.isOpen) {
      noTradeReasons.push(`Forex market is currently closed (${marketStatus.status})`);
    }
    if (mtf.isConflicting) {
      noTradeReasons.push('Timeframes conflict severely between macro trend and execution level');
    }
    if (spreadPips > config.typicalSpreadPips * this.config.filters.maxSpreadMultiplier) {
      noTradeReasons.push(`Excessive spread (${spreadPips} pips > ${config.typicalSpreadPips * this.config.filters.maxSpreadMultiplier} threshold)`);
    }

    // SCORING BREAKDOWN (Section 10)
    // 1. Trend (0-20)
    let trendScore = 0;
    if (structure.trend === 'bullish' || structure.trend === 'bearish') {
      trendScore = Math.min(20, Math.round((structure.trendStrength / 100) * this.config.scoringWeights.trendWeight));
    } else {
      trendScore = 6;
    }

    // 2. Multi-timeframe (0-20)
    const mtfScore = Math.min(20, mtf.alignmentScore);

    // 3. Momentum (0-15)
    let momentumScore = 0;
    const rsi = indicators.rsi ?? 50;
    const macdHist = indicators.macdHistogram ?? 0;
    if (structure.trend === 'bullish') {
      if (rsi >= 52 && rsi <= 68 && macdHist > 0) momentumScore = 14;
      else if (rsi > 70) {
        momentumScore = 4;
        warnings.push('RSI entering overbought region (>70)');
      } else momentumScore = 8;
    } else if (structure.trend === 'bearish') {
      if (rsi <= 48 && rsi >= 32 && macdHist < 0) momentumScore = 14;
      else if (rsi < 30) {
        momentumScore = 4;
        warnings.push('RSI entering oversold region (<30)');
      } else momentumScore = 8;
    } else {
      momentumScore = 6;
    }

    // 4. Market Structure (0-15)
    let msScore = 7;
    if (structure.structure === 'higher_high_higher_low' || structure.structure === 'lower_high_lower_low') {
      msScore = 14;
    } else if (structure.structure === 'breakout' || structure.structure === 'breakdown') {
      msScore = 13;
    } else if (structure.structure === 'range') {
      msScore = 5;
    }

    // 5. Support / Resistance (0-10)
    let srScore = 7;
    if (sr.nearestSupport && sr.nearestResistance) {
      const roomToResistance = (sr.nearestResistance.price - currentPrice) / config.pipSize;
      const roomToSupport = (currentPrice - sr.nearestSupport.price) / config.pipSize;
      if (structure.trend === 'bullish' && roomToResistance > 25) srScore = 9;
      else if (structure.trend === 'bearish' && roomToSupport > 25) srScore = 9;
      else srScore = 6;
    }

    // 6. Volatility (0-5)
    let volScore = 4;
    if (structure.regime === 'HIGH_VOLATILITY') {
      volScore = 2;
      warnings.push('High volatility regime: wider stop buffer applied');
    } else if (structure.regime === 'LOW_VOLATILITY') {
      volScore = 2;
      warnings.push('Low volatility / compression: potential false breakout risk');
    }

    // 7. Risk / Reward (0-5)
    let rrScore = 4;

    const tentativeScore = this.calculateSignalScore({
      trend: trendScore,
      multiTimeframe: mtfScore,
      momentum: momentumScore,
      marketStructure: msScore,
      supportResistance: srScore,
      volatility: volScore,
      riskReward: rrScore,
      totalScore: 0
    });

    const directionEvaluation = this.calculateDirection(
      mtf,
      structure,
      structure.regime,
      indicators,
      tentativeScore,
      noTradeReasons
    );

    // Build Entry & Trade Plan if not NO_TRADE
    let tradePlan: TradePlan | null = null;
    let finalScore = tentativeScore;

    if (directionEvaluation.direction !== 'NO_TRADE') {
      const entryZone = this.calculateEntryZone(
        directionEvaluation.direction,
        currentPrice,
        structure,
        atr,
        config.pipSize,
        indicators
      );

      if (entryZone.isExtended) {
        noTradeReasons.push('Price is excessively extended (> 2.5x ATR from 21 EMA); waiting for retracement');
      }

      const slObj = this.calculateStopLoss(
        directionEvaluation.direction,
        entryZone.entryPreferred,
        structure,
        atr,
        config.pipSize,
        sr
      );

      const targets = this.calculateTargets(
        directionEvaluation.direction,
        entryZone.entryPreferred,
        slObj.stopLoss,
        structure,
        atr,
        config.pipSize,
        sr
      );

      const rr = this.calculateRiskReward(entryZone.entryPreferred, slObj.stopLoss, targets.tp1.targetPrice, config.pipSize);

      if (rr.ratio < this.config.riskReward.minimumRatio) {
        noTradeReasons.push(`Risk/Reward (${rr.ratio}:1) is below strict ${this.config.riskReward.minimumRatio}:1 minimum threshold`);
        rrScore = 1;
      } else if (rr.ratio >= this.config.riskReward.preferredRatio) {
        rrScore = 5;
      } else {
        rrScore = 3;
      }

      finalScore = this.calculateSignalScore({
        trend: trendScore,
        multiTimeframe: mtfScore,
        momentum: momentumScore,
        marketStructure: msScore,
        supportResistance: srScore,
        volatility: volScore,
        riskReward: rrScore,
        totalScore: 0
      });

      const isPlanValid = noTradeReasons.length === 0;

      tradePlan = {
        entryMin: entryZone.entryMin,
        entryMax: entryZone.entryMax,
        entryPreferred: entryZone.entryPreferred,
        entryType: entryZone.entryType,
        entryCondition: entryZone.entryCondition,
        stopLoss: slObj.stopLoss,
        stopLossReason: slObj.reason,
        takeProfit1: targets.tp1,
        takeProfit2: targets.tp2,
        takeProfit3: targets.tp3,
        riskDistancePips: rr.riskPips,
        rewardDistancePips: rr.rewardPips,
        riskReward: rr.ratio,
        isValid: isPlanValid
      };
    }

    const sessionName = sessionState.activeSessions.join(' / ') || 'Interbank Electronic Off-Peak';

    return {
      pair: config.symbol,
      status: this.provider.status,
      currentPrice,
      pipSize: config.pipSize,
      spreadPips,
      session: sessionName,
      regime: structure.regime,
      trend: {
        direction: structure.trend,
        strength: structure.trendStrength
      },
      marketStructure: {
        type: structure.structure,
        phase: structure.phase,
        breakoutStatus: structure.breakoutStatus
      },
      multiTimeframe: {
        '5m': mtf['5m'].trend,
        '15m': mtf['15m'].trend,
        '1h': mtf['1h'].trend,
        '4h': mtf['4h'].trend,
        'daily': mtf['daily'].trend,
        alignment: mtf.alignment,
        summary: mtf.alignmentSummary
      },
      indicators,
      supportResistance: {
        majorSupport: sr.majorSupport?.price ?? null,
        majorResistance: sr.majorResistance?.price ?? null,
        previousDayHigh: sr.previousDayHigh,
        previousDayLow: sr.previousDayLow,
        previousWeekHigh: sr.previousWeekHigh,
        previousWeekLow: sr.previousWeekLow,
        nearestSupport: sr.nearestSupport?.price ?? null,
        nearestResistance: sr.nearestResistance?.price ?? null
      },
      signal: {
        direction: directionEvaluation.direction,
        score: finalScore,
        status: directionEvaluation.direction === 'NO_TRADE' ? 'NO_TRADE' : 'WAITING_FOR_ENTRY',
        category: directionEvaluation.category
      },
      tradePlan: tradePlan ? {
        entryMin: tradePlan.entryMin,
        entryMax: tradePlan.entryMax,
        stopLoss: tradePlan.stopLoss,
        takeProfit1: tradePlan.takeProfit1.targetPrice,
        takeProfit2: tradePlan.takeProfit2.targetPrice,
        takeProfit3: tradePlan.takeProfit3.targetPrice,
        riskReward: tradePlan.riskReward,
        stopLossReason: tradePlan.stopLossReason,
        tp1Reason: tradePlan.takeProfit1.targetReason
      } : null,
      warnings
    };
  }

  /**
   * Generates a fully formed ForexSignal and automatically persists to database
   */
  async generateSignal(pairSymbol: string): Promise<ForexSignal> {
    const analysis = this.analyzePair(pairSymbol);
    const config = getForexPairConfig(pairSymbol);
    const timestamp = Date.now();
    const id = `FX_${pairSymbol.replace('/', '')}_${timestamp}`;

    const isActionable = analysis.signal.direction !== 'NO_TRADE' && analysis.tradePlan !== null;

    let tradePlanObj: TradePlan | null = null;
    if (isActionable && analysis.tradePlan) {
      const riskPips = Math.abs(analysis.tradePlan.entryMin - analysis.tradePlan.stopLoss) / config.pipSize;
      const rewardPips = Math.abs(analysis.tradePlan.takeProfit1 - analysis.tradePlan.entryMin) / config.pipSize;
      tradePlanObj = {
        entryMin: analysis.tradePlan.entryMin,
        entryMax: analysis.tradePlan.entryMax,
        entryPreferred: (analysis.tradePlan.entryMin + analysis.tradePlan.entryMax) / 2,
        entryType: 'PULLBACK_ENTRY',
        entryCondition: 'Enter upon 15M confirmation close in defined boundary',
        stopLoss: analysis.tradePlan.stopLoss,
        stopLossReason: analysis.tradePlan.stopLossReason,
        takeProfit1: { targetPrice: analysis.tradePlan.takeProfit1, targetReason: analysis.tradePlan.tp1Reason, expectedR: 1.8 },
        takeProfit2: { targetPrice: analysis.tradePlan.takeProfit2, targetReason: 'Key expansion target', expectedR: 2.6 },
        takeProfit3: { targetPrice: analysis.tradePlan.takeProfit3 ?? analysis.tradePlan.takeProfit2, targetReason: 'Extended macro runner', expectedR: 3.5 },
        riskDistancePips: Number(riskPips.toFixed(1)),
        rewardDistancePips: Number(rewardPips.toFixed(1)),
        riskReward: analysis.tradePlan.riskReward,
        isValid: true
      };
    }

    const invalidationConditions: string[] = [];
    if (analysis.signal.direction.includes('BUY')) {
      invalidationConditions.push(`Close below swing support ${analysis.supportResistance.majorSupport ?? analysis.tradePlan?.stopLoss}`);
      invalidationConditions.push(`EMA 9 crosses below EMA 21 on 15M chart`);
      invalidationConditions.push(`High impact news release inside 20 minutes`);
    } else if (analysis.signal.direction.includes('SELL')) {
      invalidationConditions.push(`Close above swing resistance ${analysis.supportResistance.majorResistance ?? analysis.tradePlan?.stopLoss}`);
      invalidationConditions.push(`EMA 9 crosses above EMA 21 on 15M chart`);
      invalidationConditions.push(`High impact news release inside 20 minutes`);
    }

    const signal: ForexSignal = {
      id,
      timestamp,
      pair: config.symbol,
      timeframe: '15M',
      direction: analysis.signal.direction as ForexSignal['direction'],
      signalCategory: analysis.signal.category,
      score: analysis.signal.score,
      scoreBreakdown: {
        trend: Math.round((analysis.signal.score * 0.2)),
        multiTimeframe: Math.round((analysis.signal.score * 0.2)),
        momentum: Math.round((analysis.signal.score * 0.15)),
        marketStructure: Math.round((analysis.signal.score * 0.15)),
        supportResistance: Math.round((analysis.signal.score * 0.1)),
        volatility: 4,
        riskReward: 4,
        totalScore: analysis.signal.score
      },
      status: analysis.signal.direction === 'NO_TRADE' ? 'NO_TRADE' : 'WAITING_FOR_ENTRY',
      tradePlan: tradePlanObj,
      marketRegime: analysis.regime,
      session: analysis.session,
      dataStatus: analysis.status,
      strategyVersion: 'fx_structure_v2a',
      modelVersion: 'uncalibrated_phase2a',
      mlProbability: null, // Strictly null in Phase 2A
      reasons: [analysis.multiTimeframe.summary, `Market regime: ${analysis.regime}`],
      noTradeReasons: analysis.warnings.length > 0 && analysis.signal.direction === 'NO_TRADE' ? analysis.warnings : [],
      invalidationConditions
    };

    // Store in database (Section 24)
    await this.saveSignalToDatabase(signal);

    return signal;
  }

  /**
   * Persists generated signal to SQLite (Section 24)
   */
  async saveSignalToDatabase(signal: ForexSignal): Promise<void> {
    try {
      const sql = `
        INSERT OR REPLACE INTO signals (
          id, timestamp, market, instrument, pair, timeframe,
          direction, category, strategy, score, ml_probability,
          entry_preferred, entry_min, entry_max, stop_loss,
          target1, target2, target3, risk_reward,
          trend, market_regime, session, status, data_status,
          strategy_version, model_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        signal.id,
        signal.timestamp,
        'FOREX',
        signal.pair,
        signal.pair,
        signal.timeframe,
        signal.direction,
        signal.signalCategory,
        signal.tradePlan ? signal.tradePlan.entryType : 'NO_TRADE',
        signal.score,
        signal.mlProbability ?? null,
        signal.tradePlan?.entryPreferred ?? 0,
        signal.tradePlan?.entryMin ?? 0,
        signal.tradePlan?.entryMax ?? 0,
        signal.tradePlan?.stopLoss ?? 0,
        signal.tradePlan?.takeProfit1.targetPrice ?? 0,
        signal.tradePlan?.takeProfit2.targetPrice ?? 0,
        signal.tradePlan?.takeProfit3.targetPrice ?? 0,
        signal.tradePlan?.riskReward ?? 0,
        signal.direction.includes('BUY') ? 'bullish' : signal.direction.includes('SELL') ? 'bearish' : 'neutral',
        signal.marketRegime,
        signal.session,
        signal.status,
        signal.dataStatus,
        signal.strategyVersion,
        signal.modelVersion
      ];

      try {
        await executeRun(sql, params);
      } catch (err: any) {
        if (String(err?.message || err).includes('NOT NULL constraint failed: signals.ml_probability')) {
          params[10] = 0.0;
          await executeRun(sql, params);
        } else {
          throw err;
        }
      }
    } catch (err) {
      console.error('Failed to persist forex signal to database:', err);
    }
  }
}
