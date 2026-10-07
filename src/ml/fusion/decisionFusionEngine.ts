// ============================================================================
// DECISION FUSION ENGINE (DETERMINISTIC QUANT + ML PREDICTION FUSION)
// ============================================================================

import {
  FusedDecision,
  FusionDecision,
  MLPrediction,
  MarketType
} from '../types';

export interface DeterministicSignalInput {
  instrument: string;
  market: MarketType;
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  score: number; // 0 - 100
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  marketRegime?: string;
  liquidityOk?: boolean;
  dataQualityOk?: boolean;
}

export class DecisionFusionEngine {
  /**
   * Combines deterministic technical parameters with ML outcome probability.
   * STRICT SAFETY GUARANTEE: Never alters calculated entry/stop/target/RR numbers.
   */
  public fuse(
    signal: DeterministicSignalInput,
    mlPrediction: MLPrediction
  ): FusedDecision {
    const decisionId = `fuse_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const probTarget = mlPrediction.probabilityTargetBeforeStop;
    const isDirectionAligned = signal.direction === mlPrediction.direction;
    const liquidityOk = signal.liquidityOk ?? true;
    const dataQualityOk = signal.dataQualityOk ?? true;
    const regime = signal.marketRegime || mlPrediction.marketRegime || 'NORMAL';

    let finalDecision: FusionDecision = 'NO_TRADE';
    let rationale = '';
    let tradeAllowed = false;

    if (!dataQualityOk) {
      finalDecision = 'NO_TRADE';
      rationale = 'Data quality check failed (stale or incomplete market feed). Trading halted.';
    } else if (!liquidityOk) {
      finalDecision = 'NO_TRADE';
      rationale = 'Insufficient instrument liquidity / excessive bid-ask spread.';
    } else if (signal.direction === 'NEUTRAL') {
      finalDecision = 'NO_TRADE';
      rationale = 'Deterministic quantitative engine indicates NO trade setup (neutral market structure).';
    } else if (!isDirectionAligned || probTarget < 0.45) {
      // Conflict between quantitative signal and ML model
      finalDecision = 'CONFLICT';
      rationale = `Directional conflict: Deterministic engine suggests ${signal.direction} (Score: ${signal.score}), but ML model assigns only ${(probTarget * 100).toFixed(1)}% target probability. Trade vetoed.`;
    } else if (probTarget >= 0.60 && signal.score >= 60) {
      // High confluence
      finalDecision = signal.direction === 'BUY' ? 'QUALIFIED_BUY' : 'QUALIFIED_SELL';
      tradeAllowed = true;
      rationale = `High Confluence: Deterministic score (${signal.score}/100) verified by ML Target probability of ${(probTarget * 100).toFixed(1)}% [${mlPrediction.confidenceTier}]. Execution qualified under risk limits.`;
    } else if (probTarget >= 0.50 && signal.score >= 50) {
      finalDecision = 'WATCH';
      tradeAllowed = false;
      rationale = `Moderate Setup: ML probability ${(probTarget * 100).toFixed(1)}% [${mlPrediction.confidenceTier}] meets baseline but does not exceed high-conviction threshold (60%). Placed on Watch list.`;
    } else {
      finalDecision = 'NO_TRADE';
      rationale = `Insufficient statistical edge: ML target probability ${(probTarget * 100).toFixed(1)}% is below actionable threshold.`;
    }

    return {
      decisionId,
      timestamp: Date.now(),
      instrument: signal.instrument,
      market: signal.market,
      deterministicSignal: {
        direction: signal.direction,
        score: signal.score,
        entry: signal.entry,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskReward: signal.riskReward
      },
      mlPrediction: {
        probabilityTarget: probTarget,
        confidenceTier: mlPrediction.confidenceTier,
        modelVersion: mlPrediction.modelVersion
      },
      marketRegime: regime,
      liquidityOk,
      dataQualityOk,
      finalDecision,
      rationale,
      tradeAllowed
    };
  }
}

export const decisionFusionEngine = new DecisionFusionEngine();
