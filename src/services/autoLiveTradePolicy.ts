/**
 * Deterministic Auto Live orchestration policy.
 *
 * These functions contain no broker access and no side effects so the
 * execution policy can be certified independently from live submission.
 */

export const AUTO_LIVE_SCORE_THRESHOLDS = Object.freeze({
  ONE_TRADE_MIN_SCORE: 65,
  TWO_TRADE_MIN_SCORE: 70,
  FIVE_TRADE_MIN_SCORE: 78
});

export const AUTO_LIVE_POSITION_CAPACITY_POLL_MS = 10_000;
export const AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS = 10_000;
export const AUTO_LIVE_RUNTIME_RECOVERY_POLL_MS = 10_000;
export const AUTO_LIVE_XAU_VOLUME_DIVISOR = 1_000;
export const AUTO_LIVE_TRAILING_STOP_LOSS_REQUIRED = true;

export type AutoLiveScoreTier = 'BELOW_65' | '1_TRADE' | '2_TRADES' | '5_TRADES';

export interface AutoLiveParallelTradePolicy {
  maxTradesPerPair: number;
  tier: AutoLiveScoreTier;
}

/**
 * Score ladder used by Auto Live:
 *   score < 65  -> no parallel-trade allowance
 *   65 < score <= 70 -> 1
 *   70 < score <= 78  -> 2
 *   score > 78 -> 5
 *
 * Boundary values are intentionally explicit because 65/70/78 are not
 * interchangeable with strict-greater-than comparisons.
 */
export function getAutoLiveParallelTradePolicy(scoreInput: number): AutoLiveParallelTradePolicy {
  const score = Number(scoreInput);

  if (!Number.isFinite(score) || score <= AUTO_LIVE_SCORE_THRESHOLDS.ONE_TRADE_MIN_SCORE) {
    return { maxTradesPerPair: 0, tier: 'BELOW_65' };
  }

  if (score > AUTO_LIVE_SCORE_THRESHOLDS.FIVE_TRADE_MIN_SCORE) {
    return { maxTradesPerPair: 5, tier: '5_TRADES' };
  }

  if (score > AUTO_LIVE_SCORE_THRESHOLDS.TWO_TRADE_MIN_SCORE) {
    return { maxTradesPerPair: 2, tier: '2_TRADES' };
  }

  return { maxTradesPerPair: 1, tier: '1_TRADE' };
}

export function hasSystemPositionCapacity(activePositions: number, maxOpenPositions: number): boolean {
  const active = Number(activePositions);
  const maximum = Number(maxOpenPositions);
  return Number.isFinite(active) && Number.isFinite(maximum)
    && active >= 0 && maximum >= 1
    && active < maximum;
}

export function hasPairPositionCapacity(activePairPositions: number, maxTradesPerPair: number): boolean {
  const active = Number(activePairPositions);
  const maximum = Number(maxTradesPerPair);
  return Number.isFinite(active) && Number.isFinite(maximum)
    && active >= 0 && maximum > 0
    && active < maximum;
}

export function isVisibleAutoLiveSignal(direction: unknown): boolean {
  return String(direction || '').toUpperCase() !== 'NO_TRADE';
}
