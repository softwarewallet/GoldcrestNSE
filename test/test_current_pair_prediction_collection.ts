import assert from 'node:assert/strict';
import {
  getCurrentPairPredictionCollectionStatus,
  runCurrentPairPredictionCollectionCycle
} from '../src/services/currentPairPredictionCollectionService';

let generatedOptions: any = null;
let evaluatedOptions: any = null;

const result = await runCurrentPairPredictionCollectionCycle({
  generate: async options => {
    generatedOptions = options;
    return [
      {
        predictionId: 'test-prediction',
        symbol: 'EUR/USD'
      } as any
    ];
  },
  evaluate: async options => {
    evaluatedOptions = options;
    return {
      evaluated: 2,
      pending: 3,
      correct: 1,
      directionalEvaluated: 2,
      accuracyPct: 50,
      brierScore: 0.25,
      updatedAt: Date.now()
    };
  }
});

assert.equal(result.generated, 1);
assert.equal(result.evaluated, 2);
assert.equal(result.pending, 3);
assert.equal(generatedOptions.horizon, '1D');
assert.equal(generatedOptions.model, 'BASELINE');
assert.equal(evaluatedOptions.horizon, '1D');
assert.equal(evaluatedOptions.limit, 50000);

const status = getCurrentPairPredictionCollectionStatus();
assert.equal(status.running, false);
assert.equal(status.cycleInFlight, false);
assert.equal(status.lastGenerated, 1);
assert.equal(status.lastEvaluated, 2);
assert.equal(status.lastPending, 3);
assert.equal(status.lastError, null);
assert.ok(status.lastCycleAt !== null);
assert.ok(status.lastCompletedAt !== null);
assert.equal(status.nextScheduledAt, null);

console.log('CURRENT PAIR PREDICTION COLLECTION TEST PASSED');
