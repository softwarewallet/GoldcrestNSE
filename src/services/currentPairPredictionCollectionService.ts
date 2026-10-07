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
  if (cycleInFlight) {
    return {
      generated: 0,
      evaluated: 0,
      pending: lastPending,
      completedAt: lastCompletedAt || Date.now()
    };
  }

  cycleInFlight = true;
  lastCycleAt = Date.now();

  try {
    const generate = deps.generate || generateCurrentPairPredictions;
    const evaluate = deps.evaluate || evaluatePendingCurrentPairPredictions;
    const pairs = getSystemConfig().autoLiveForexPairs || [];

    const predictions = await generate({
      pairs,
      horizon: '1D',
      model: 'BASELINE'
    });

    const outcome = await evaluate({
      horizon: '1D',
      limit: 50000
    });

    lastGenerated = predictions.length;
    lastEvaluated = outcome.evaluated;
    lastPending = outcome.pending;
    lastCompletedAt = Date.now();
    lastError = null;

    liveRuntimeLog('INFO', 'CURRENT_PAIR_PREDICTION_COLLECTION_CYCLE', {
      pairs: pairs.length,
      generated: lastGenerated,
      evaluated: lastEvaluated,
      pending: lastPending,
      intervalMs: configuredPollMs()
    });

    return {
      generated: lastGenerated,
      evaluated: lastEvaluated,
      pending: lastPending,
      completedAt: lastCompletedAt
    };
  } catch (error: any) {
    lastError = error?.message || String(error);
    liveRuntimeLog('WARN', 'CURRENT_PAIR_PREDICTION_COLLECTION_FAILED', {
      error: lastError
    });
    throw error;
  } finally {
    cycleInFlight = false;
  }
}

export function startCurrentPairPredictionCollectionScheduler(): void {
  if (timer) return;

  void runCurrentPairPredictionCollectionCycle().catch(() => undefined);
  const pollMs = configuredPollMs();
  nextScheduledAt = Date.now() + pollMs;
  timer = setInterval(() => {
    nextScheduledAt = Date.now() + pollMs;
    void runCurrentPairPredictionCollectionCycle().catch(() => undefined);
  }, pollMs);
  timer.unref?.();

  liveRuntimeLog('INFO', 'CURRENT_PAIR_PREDICTION_COLLECTION_STARTED', {
    pollIntervalMs: pollMs,
    horizon: '1D',
    model: 'BASELINE'
  });
}

export function stopCurrentPairPredictionCollectionScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  nextScheduledAt = null;
  liveRuntimeLog('INFO', 'CURRENT_PAIR_PREDICTION_COLLECTION_STOPPED');
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
