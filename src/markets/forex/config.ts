import { ScoringWeights } from './types';

export interface ForexSignalEngineConfig {
  scoringWeights: ScoringWeights;
  thresholds: {
    strongSignal: number; // 85 - 100
    actionableSignal: number; // 75 - 84
    watchSignal: number; // 65 - 74
    neutralMin: number; // 50 - 64
    noTradeBelow: number; // < 50
  };
  riskReward: {
    minimumRatio: number; // 1.5
    preferredRatio: number; // 2.0
  };
  stopLoss: {
    method: 'ATR_BASED' | 'SWING_BASED' | 'SUPPORT_RESISTANCE_BASED' | 'STRUCTURE_INVALIDATION';
    atrMultiplier: number; // 1.5x
    minPips: number; // 12 pips
    maxPips: number; // 80 pips
  };
  takeProfit: {
    tp1Multiplier: number; // 1.8x SL
    tp2Multiplier: number; // 2.6x SL
    tp3Multiplier: number; // 3.5x SL
  };
  filters: {
    maxSpreadMultiplier: number; // Reject if spread > 2.5x typical
    maxExtensionAtrMultiplier: number; // Reject entry if > 2.5 ATR from 21 EMA
    minCandlesRequired: number; // 40
    maxNewsBlockMinutes: number; // 20 minutes before high-impact event
  };
}

export const DEFAULT_FOREX_CONFIG: ForexSignalEngineConfig = {
  scoringWeights: {
    trendWeight: 20,
    mtfWeight: 20,
    momentumWeight: 15,
    marketStructureWeight: 15,
    supportResistanceWeight: 10,
    volatilityWeight: 5,
    riskRewardWeight: 5,
    minScoreToTrade: 65
  },
  thresholds: {
    strongSignal: 85,
    actionableSignal: 75,
    watchSignal: 65,
    neutralMin: 50,
    noTradeBelow: 50
  },
  riskReward: {
    minimumRatio: 1.5,
    preferredRatio: 2.0
  },
  stopLoss: {
    method: 'STRUCTURE_INVALIDATION',
    atrMultiplier: 1.5,
    minPips: 12,
    maxPips: 80
  },
  takeProfit: {
    tp1Multiplier: 1.8,
    tp2Multiplier: 2.6,
    tp3Multiplier: 3.5
  },
  filters: {
    maxSpreadMultiplier: 2.5,
    maxExtensionAtrMultiplier: 2.5,
    minCandlesRequired: 35,
    maxNewsBlockMinutes: 20
  }
};
