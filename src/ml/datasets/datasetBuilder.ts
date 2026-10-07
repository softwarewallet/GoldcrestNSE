// ============================================================================
// DATASET BUILDER & CHRONOLOGICAL TIME-SERIES SPLITTER (NO DATA LEAKAGE)
// ============================================================================

import {
  DatasetSample,
  SplitDataset,
  MarketType,
  EnvironmentType
} from '../types';

export interface DatasetFilterOptions {
  market?: MarketType;
  instrument?: string;
  environments?: EnvironmentType[];
  startDate?: number;
  endDate?: number;
  minHoldingPeriod?: number;
}

export interface SplitRatios {
  trainRatio: number; // e.g., 0.60
  valRatio: number;   // e.g., 0.20
  testRatio: number;  // e.g., 0.20
}

export class DatasetBuilder {
  private samples: DatasetSample[] = [];

  public addSample(sample: DatasetSample): void {
    this.samples.push(sample);
  }

  public addSamples(samples: DatasetSample[]): void {
    this.samples.push(...samples);
  }

  public getSamplesCount(): number {
    return this.samples.length;
  }

  public getAllSamples(): DatasetSample[] {
    return [...this.samples];
  }

  /**
   * Filters dataset by market, instrument, environment, date range.
   */
  public filterSamples(options: DatasetFilterOptions = {}): DatasetSample[] {
    return this.samples.filter(s => {
      if (options.market && s.market !== options.market) return false;
      if (options.instrument && s.instrument !== options.instrument) return false;
      if (options.environments && !options.environments.includes(s.environment)) return false;
      if (options.startDate && s.timestamp < options.startDate) return false;
      if (options.endDate && s.timestamp > options.endDate) return false;
      return true;
    });
  }

  /**
   * Builds chronologically split Train, Validation, and Test datasets.
   * Strictly enforces: Max(Train.timestamp) < Min(Val.timestamp) < Min(Test.timestamp).
   */
  public buildChronologicalSplit(
    options: DatasetFilterOptions = {},
    ratios: SplitRatios = { trainRatio: 0.60, valRatio: 0.20, testRatio: 0.20 }
  ): SplitDataset {
    const filtered = this.filterSamples(options);

    // Sort strictly chronologically
    const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);

    const n = sorted.length;
    if (n === 0) {
      return {
        train: [],
        validation: [],
        test: [],
        trainPeriod: { start: 0, end: 0 },
        validationPeriod: { start: 0, end: 0 },
        testPeriod: { start: 0, end: 0 },
        featureNames: []
      };
    }

    const trainEndIdx = Math.floor(n * ratios.trainRatio);
    const valEndIdx = Math.floor(n * (ratios.trainRatio + ratios.valRatio));

    const train = sorted.slice(0, trainEndIdx);
    const validation = sorted.slice(trainEndIdx, valEndIdx);
    const test = sorted.slice(valEndIdx);

    // Strict leak validation
    if (train.length > 0 && validation.length > 0) {
      const maxTrainTime = Math.max(...train.map(t => t.timestamp));
      const minValTime = Math.min(...validation.map(v => v.timestamp));
      if (maxTrainTime >= minValTime) {
        throw new Error(`CRITICAL LEAK ERROR: Train max timestamp (${maxTrainTime}) >= Validation min timestamp (${minValTime})`);
      }
    }

    if (validation.length > 0 && test.length > 0) {
      const maxValTime = Math.max(...validation.map(v => v.timestamp));
      const minTestTime = Math.min(...test.map(t => t.timestamp));
      if (maxValTime >= minTestTime) {
        throw new Error(`CRITICAL LEAK ERROR: Validation max timestamp (${maxValTime}) >= Test min timestamp (${minTestTime})`);
      }
    }

    const featureNames = sorted.length > 0 ? Object.keys(sorted[0].features) : [];

    return {
      train,
      validation,
      test,
      trainPeriod: {
        start: train.length > 0 ? train[0].timestamp : 0,
        end: train.length > 0 ? train[train.length - 1].timestamp : 0
      },
      validationPeriod: {
        start: validation.length > 0 ? validation[0].timestamp : 0,
        end: validation.length > 0 ? validation[validation.length - 1].timestamp : 0
      },
      testPeriod: {
        start: test.length > 0 ? test[0].timestamp : 0,
        end: test.length > 0 ? test[test.length - 1].timestamp : 0
      },
      featureNames
    };
  }
}

export const datasetBuilder = new DatasetBuilder();
