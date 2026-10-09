import { generateCurrentPairPredictions } from './pairPredictionService';
import { evaluatePendingCurrentPairPredictions } from './currentPairPredictionOutcomeService';
import { getSystemConfig } from './configService';
import { liveRuntimeLog } from './liveRuntimeLog';

const DEFAULT_POLL_MS = 15 * 60_000;
const MIN_POLL_MS = 60_000;
const MAX_POLL_MS = 24 * 60 * 60_000;

function configuredPollMs(): number {
  const configured = Number(process.env.GOLDCREST_CURRENT_PAIR_PREDICTION_POLL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_POLL_MS;
  return Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, Math.floor(configured)));
}

type GenerateFn = typeof generateCurrentPairPredictions;
type EvaluateFn = typeof evaluatePendingCurrentPairPredictions;

let timer: NodeJS.Timeout | null = null;
let cycleInFlight = false;
let lastCycleAt: number | null = null;
let lastCompletedAt: number | null = null;
let lastGenerated = 0;
let lastEvaluated = 0;
let lastPending = 0;
let lastError: string | null = null;
let nextScheduledAt: number | null = null;

export async function runCurrentPairPredictionCollectionCycle(
  deps: {
    generate?: GenerateFn;
    evaluate?: EvaluateFn;
  } = {}
): Promise<{
  generated: number;
  evaluated: number;
  pending: number;
  completedAt: number;
}> {
  // Retired: System is configured for Indian markets only (5paisa).
  return {
    generated: 0,
    evaluated: 0,
    pending: 0,
    completedAt: Date.now()
  };
}

export function startCurrentPairPredictionCollectionScheduler(): void {
  // Retired: System is configured for Indian markets only (5paisa). Forex prediction scheduler is disabled.
  return;
}

export function stopCurrentPairPredictionCollectionScheduler(): void {
  // Retired: System is configured for Indian markets only (5paisa).
  return;
}

export function getCurrentPairPredictionCollectionStatus() {
  return {
    running: Boolean(timer),
    pollIntervalMs: configuredPollMs(),
    cycleInFlight,
    lastCycleAt,
    lastCompletedAt,
    lastGenerated,
    lastEvaluated,
    lastPending,
    lastError,
    nextScheduledAt
  };
}
