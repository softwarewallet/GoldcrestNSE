// ============================================================================
// OUTCOME LABELING ENGINE (TRIPLE-BARRIER / TRADE-OUTCOME TARGET)
// ============================================================================

import { OutcomeLabel, PredictionOutcomeLabel } from '../types';
import { Candle } from '../../markets/common/types';
import { ForexCandle } from '../../markets/forex/types';

export interface SignalTradeGeometry {
  signalId: string;
  predictionId?: string;
  signalTimestamp: number;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  tp1Price?: number;
  maxHoldingPeriodCandles: number;
  pipSize?: number;
}

export class OutcomeLabelEngine {
  private labels: Map<string, OutcomeLabel> = new Map();

  /**
   * Evaluates future price path strictly starting from candle AFTER signal timestamp.
   * Resolves whether Target was reached before Stop Loss, or if max holding period expired.
   */
  public generateOutcomeLabel(
    geometry: SignalTradeGeometry,
    subsequentCandles: (Candle | ForexCandle)[]
  ): OutcomeLabel {
    const pipSize = geometry.pipSize || 0.0001;
    const isBuy = geometry.direction === 'BUY';

    // Filter subsequent candles strictly after signal timestamp
    const forwardCandles = subsequentCandles
      .filter(c => c.timestamp > geometry.signalTimestamp)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, geometry.maxHoldingPeriodCandles);

    if (forwardCandles.length === 0) {
      const outcomeId = `out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const pendingLabel: OutcomeLabel = {
        outcomeId,
        signalId: geometry.signalId,
        predictionId: geometry.predictionId,
        labelVersion: 'LBL-v2.0',
        labelTimestamp: Date.now(),
        outcome: 'NO_ENTRY',
        binaryTarget: 0,
        holdingPeriodCandles: 0,
        maxFavorableExcursionPips: 0,
        maxAdverseExcursionPips: 0,
        realizedR: 0,
        exitPrice: geometry.entryPrice,
        resolvedAt: Date.now()
      };
      this.labels.set(outcomeId, pendingLabel);
      return pendingLabel;
    }

    let maxFavorablePips = 0;
    let maxAdversePips = 0;
    let finalOutcome: PredictionOutcomeLabel = 'TIME_EXIT';
    let exitPrice = forwardCandles[forwardCandles.length - 1].close;
    let holdingCandles = forwardCandles.length;
    let resolvedAt = forwardCandles[forwardCandles.length - 1].timestamp;
    let partialTargetHit = false;

    const riskPips = Math.abs(geometry.entryPrice - geometry.stopLossPrice) / pipSize;

    for (let i = 0; i < forwardCandles.length; i++) {
      const c = forwardCandles[i];

      // Calculate MFE and MAE for this candle
      if (isBuy) {
        const fav = (c.high - geometry.entryPrice) / pipSize;
        const adv = (geometry.entryPrice - c.low) / pipSize;
        if (fav > maxFavorablePips) maxFavorablePips = fav;
        if (adv > maxAdversePips) maxAdversePips = adv;

        if (geometry.tp1Price && c.high >= geometry.tp1Price) {
          partialTargetHit = true;
        }

        // Check if Stop was hit
        if (c.low <= geometry.stopLossPrice) {
          finalOutcome = 'STOP_FIRST';
          exitPrice = geometry.stopLossPrice;
          holdingCandles = i + 1;
          resolvedAt = c.timestamp;
          break;
        }

        // Check if Target was hit
        if (c.high >= geometry.takeProfitPrice) {
          finalOutcome = 'TARGET_FIRST';
          exitPrice = geometry.takeProfitPrice;
          holdingCandles = i + 1;
          resolvedAt = c.timestamp;
          break;
        }
      } else {
        // SELL
        const fav = (geometry.entryPrice - c.low) / pipSize;
        const adv = (c.high - geometry.entryPrice) / pipSize;
        if (fav > maxFavorablePips) maxFavorablePips = fav;
        if (adv > maxAdversePips) maxAdversePips = adv;

        if (geometry.tp1Price && c.low <= geometry.tp1Price) {
          partialTargetHit = true;
        }

        // Check if Stop was hit
        if (c.high >= geometry.stopLossPrice) {
          finalOutcome = 'STOP_FIRST';
          exitPrice = geometry.stopLossPrice;
          holdingCandles = i + 1;
          resolvedAt = c.timestamp;
          break;
        }

        // Check if Target was hit
        if (c.low <= geometry.takeProfitPrice) {
          finalOutcome = 'TARGET_FIRST';
          exitPrice = geometry.takeProfitPrice;
          holdingCandles = i + 1;
          resolvedAt = c.timestamp;
          break;
        }
      }
    }

    if (finalOutcome === 'TIME_EXIT' && partialTargetHit) {
      finalOutcome = 'PARTIAL_TARGET';
    }

    // Compute realized R
    const pipsGained = isBuy
      ? (exitPrice - geometry.entryPrice) / pipSize
      : (geometry.entryPrice - exitPrice) / pipSize;

    const realizedR = riskPips > 0 ? pipsGained / riskPips : 0;
    const binaryTarget = finalOutcome === 'TARGET_FIRST' ? 1 : 0;

    const outcomeId = `out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const label: OutcomeLabel = Object.freeze({
      outcomeId,
      signalId: geometry.signalId,
      predictionId: geometry.predictionId,
      labelVersion: 'LBL-v2.0',
      labelTimestamp: Date.now(),
      outcome: finalOutcome,
      binaryTarget,
      holdingPeriodCandles: holdingCandles,
      maxFavorableExcursionPips: Math.max(0, maxFavorablePips),
      maxAdverseExcursionPips: Math.max(0, maxAdversePips),
      realizedR: Number(realizedR.toFixed(2)),
      exitPrice,
      resolvedAt
    });

    this.labels.set(outcomeId, label);
    return label;
  }

  public getLabel(outcomeId: string): OutcomeLabel | undefined {
    return this.labels.get(outcomeId);
  }

  public getAllLabels(): OutcomeLabel[] {
    return Array.from(this.labels.values());
  }
}

export const outcomeLabelEngine = new OutcomeLabelEngine();
