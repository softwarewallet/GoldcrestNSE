// ============================================================================
// WALK-FORWARD VALIDATION ENGINE (NO FUTURE-DATA LEAKAGE)
// ============================================================================

import {
  DatasetSample,
  WalkForwardWindow,
  ModelMetrics
} from '../types';
import { GradientBoostedTreesClassifier, GBDTConfig } from '../models/gradientBoosting';
import { ModelEvaluator } from '../metrics/modelEvaluator';

export interface WalkForwardConfig {
  windowType: 'EXPANDING' | 'ROLLING';
  trainWindowSize: number; // e.g. 50 samples
  testWindowSize: number;  // e.g. 20 samples
  stepSize: number;        // e.g. 20 samples
  modelConfig?: Partial<GBDTConfig>;
}

export class WalkForwardEngine {
  private evaluator = new ModelEvaluator();

  /**
   * Executes chronological walk-forward validation across sequential time slices.
   */
  public executeWalkForward(
    samples: DatasetSample[],
    config: WalkForwardConfig
  ): {
    windows: WalkForwardWindow[];
    aggregateMetrics: ModelMetrics;
  } {
    // Sort strictly chronologically
    const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);
    const n = sorted.length;

    const minRequired = config.trainWindowSize + config.testWindowSize;
    if (n < minRequired) {
      throw new Error(`Insufficient samples for Walk-Forward (have ${n}, required minimum ${minRequired})`);
    }

    const windows: WalkForwardWindow[] = [];
    const allOutOfSamplePredictions: Array<{ sample: DatasetSample; predProb: number }> = [];

    let currentStart = 0;
    let windowIndex = 1;

    while (currentStart + config.trainWindowSize + config.testWindowSize <= n) {
      const trainStart = config.windowType === 'EXPANDING' ? 0 : currentStart;
      const trainEnd = currentStart + config.trainWindowSize;
      const testStart = trainEnd;
      const testEnd = Math.min(n, testStart + config.testWindowSize);

      const trainSlice = sorted.slice(trainStart, trainEnd);
      const testSlice = sorted.slice(testStart, testEnd);

      if (trainSlice.length === 0 || testSlice.length === 0) break;

      // Leak integrity check
      const maxTrain = Math.max(...trainSlice.map(s => s.timestamp));
      const minTest = Math.min(...testSlice.map(s => s.timestamp));
      if (maxTrain >= minTest) {
        throw new Error(`WALK-FORWARD CRITICAL LEAK: Train max timestamp (${maxTrain}) >= Test min (${minTest}) in window ${windowIndex}`);
      }

      // Train model strictly on train slice
      const model = new GradientBoostedTreesClassifier(config.modelConfig);
      model.train(trainSlice);

      // Evaluate out-of-sample
      const windowMetrics = this.evaluator.evaluate(model, testSlice);

      for (const testSample of testSlice) {
        allOutOfSamplePredictions.push({
          sample: testSample,
          predProb: model.predictProbability(testSample.features)
        });
      }

      windows.push({
        windowIndex,
        trainRange: {
          start: trainSlice[0].timestamp,
          end: trainSlice[trainSlice.length - 1].timestamp
        },
        validationRange: {
          start: testSlice[0].timestamp,
          end: testSlice[testSlice.length - 1].timestamp
        },
        trainSamplesCount: trainSlice.length,
        valSamplesCount: testSlice.length,
        metrics: windowMetrics
      });

      windowIndex++;
      currentStart += config.stepSize;
    }

    // Build aggregate metrics over all out-of-sample test slices
    const aggModel = {
      predictProbability: (features: Record<string, number>) => {
        // Mock prediction matching stored out of sample
        const found = allOutOfSamplePredictions.find(p => p.sample.features === features);
        return found ? found.predProb : 0.5;
      }
    } as any;

    const outOfSampleSamples = allOutOfSamplePredictions.map(p => p.sample);
    const aggregateMetrics = this.evaluator.evaluate(aggModel, outOfSampleSamples);

    return {
      windows,
      aggregateMetrics
    };
  }
}

export const walkForwardEngine = new WalkForwardEngine();
