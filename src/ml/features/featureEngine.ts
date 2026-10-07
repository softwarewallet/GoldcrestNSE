// ============================================================================
// UNIFIED FEATURE ENGINE & SNAPSHOT MANAGER
// ============================================================================

import {
  FeatureSnapshot,
  MarketType,
  EnvironmentType,
  CURRENT_FEATURE_VERSION,
  CURRENT_ANALYSIS_VERSION,
  CURRENT_STRATEGY_VERSION,
  CURRENT_DATA_PROVIDER_VERSION
} from '../types';

export class FeatureEngine {
  private snapshots: Map<string, FeatureSnapshot> = new Map();

  /**
   * Creates an immutable feature snapshot with full versioning and metadata.
   */
  public createSnapshot(
    instrument: string,
    market: MarketType,
    timeframe: string,
    timestamp: number,
    features: Record<string, number>,
    environment: EnvironmentType = 'LIVE',
    signalId?: string,
    strategyId?: string,
    dataSource: string = 'REALTIME_LIVE_PROVIDER'
  ): FeatureSnapshot {
    const featureSnapshotId = `feat_snap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Deep clone features object to guarantee immutability
    const frozenFeatures = Object.freeze({ ...features });

    const snapshot: FeatureSnapshot = Object.freeze({
      featureSnapshotId,
      timestamp,
      instrument,
      market,
      timeframe,
      features: frozenFeatures,
      featureVersion: CURRENT_FEATURE_VERSION,
      analysisVersion: CURRENT_ANALYSIS_VERSION,
      strategyVersion: CURRENT_STRATEGY_VERSION,
      dataProviderVersion: CURRENT_DATA_PROVIDER_VERSION,
      environment,
      signalId,
      strategyId,
      dataSource
    });

    this.snapshots.set(featureSnapshotId, snapshot);
    return snapshot;
  }

  public getSnapshot(id: string): FeatureSnapshot | undefined {
    return this.snapshots.get(id);
  }

  public getAllSnapshots(): FeatureSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /**
   * Normalizes feature values using standard scaling (mean/std) or min-max based on training stats.
   * Prevents look-ahead by accepting explicit scaler parameters fitted ONLY on training set.
   */
  public scaleFeatures(
    features: Record<string, number>,
    scaler: { means: Record<string, number>; stds: Record<string, number> }
  ): Record<string, number> {
    const scaled: Record<string, number> = {};
    for (const [key, val] of Object.entries(features)) {
      const mean = scaler.means[key] ?? 0;
      const std = scaler.stds[key] && scaler.stds[key] > 1e-6 ? scaler.stds[key] : 1;
      scaled[key] = (val - mean) / std;
    }
    return scaled;
  }

  /**
   * Computes scaler parameters (means and standard deviations) strictly on a training slice.
   */
  public fitScaler(featureRows: Array<Record<string, number>>): {
    means: Record<string, number>;
    stds: Record<string, number>;
  } {
    if (featureRows.length === 0) {
      return { means: {}, stds: {} };
    }

    const keys = Object.keys(featureRows[0]);
    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};

    for (const key of keys) {
      const vals = featureRows.map(r => r[key] ?? 0);
      const mean = vals.reduce((sum, v) => sum + v, 0) / vals.length;
      const variance = vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / vals.length;
      means[key] = mean;
      stds[key] = Math.sqrt(variance) || 1;
    }

    return { means, stds };
  }
}

export const featureEngine = new FeatureEngine();
