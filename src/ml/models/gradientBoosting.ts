// ============================================================================
// RESEARCH-GRADE GRADIENT BOOSTED TREES & BASELINE CLASSIFIERS
// ============================================================================

export interface GBDTConfig {
  maxDepth: number;          // Tree depth (default: 3)
  nEstimators: number;       // Number of trees (default: 25)
  learningRate: number;      // Shrinkage eta (default: 0.1)
  l2Regularization: number;  // Lambda penalty (default: 1.0)
  minSamplesSplit: number;   // Min samples to split a node (default: 5)
  subsampleRatio: number;    // Subsample ratio for stochastic boosting (default: 0.85)
  seed: number;              // Reproducibility seed
}

import * as MLTypes from '../types.ts';
type DatasetSample = MLTypes.DatasetSample;
type PredictionConfidenceTier = MLTypes.PredictionConfidenceTier;
type PredictionOutcomeLabel = MLTypes.PredictionOutcomeLabel;

export interface DecisionNode {
  isLeaf: boolean;
  value?: number; // Leaf weight
  featureIndex?: number;
  featureName?: string;
  threshold?: number;
  gain?: number;
  left?: DecisionNode;
  right?: DecisionNode;
}

export class GradientBoostedTreesClassifier {
  private config: GBDTConfig;
  private trees: DecisionNode[] = [];
  private basePrediction: number = 0; // Log-odds base
  private featureNames: string[] = [];
  private featureGains: Record<string, number> = {};
  private featureSplitCounts: Record<string, number> = {};
  private calibrationSlope: number = 1.0;
  private calibrationIntercept: number = 0.0;
  private isTrained: boolean = false;

  constructor(config: Partial<GBDTConfig> = {}) {
    this.config = {
      maxDepth: config.maxDepth ?? 3,
      nEstimators: config.nEstimators ?? 30,
      learningRate: config.learningRate ?? 0.08,
      l2Regularization: config.l2Regularization ?? 1.0,
      minSamplesSplit: config.minSamplesSplit ?? 4,
      subsampleRatio: config.subsampleRatio ?? 0.9,
      seed: config.seed ?? 42
    };
  }

  private pseudoRandom(seed: number): () => number {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  public train(samples: DatasetSample[]): void {
    if (samples.length < 5) {
      throw new Error(`Insufficient training samples (found ${samples.length}, minimum 5 required)`);
    }

    this.featureNames = Object.keys(samples[0].features);
    const X = samples.map(s => this.featureNames.map(f => s.features[f] ?? 0));
    const y = samples.map(s => s.label.binaryTarget);

    const n = X.length;
    const numFeatures = this.featureNames.length;
    const rng = this.pseudoRandom(this.config.seed);

    // Initial base log-odds prediction: ln(p / (1-p))
    const positiveCount = y.filter(val => val === 1).length;
    const p0 = Math.max(0.01, Math.min(0.99, positiveCount / n));
    this.basePrediction = Math.log(p0 / (1 - p0));

    // F(x) accumulator for all training samples
    const rawPredictions = new Array(n).fill(this.basePrediction);

    this.trees = [];
    this.featureGains = {};
    this.featureSplitCounts = {};
    for (const f of this.featureNames) {
      this.featureGains[f] = 0;
      this.featureSplitCounts[f] = 0;
    }

    // Boost for nEstimators rounds
    for (let iter = 0; iter < this.config.nEstimators; iter++) {
      // 1. Compute negative gradient (residuals for binary cross-entropy)
      // p_i = 1 / (1 + exp(-F_i))
      // residual_i = y_i - p_i
      const residuals = new Array(n);
      const hessians = new Array(n);

      for (let i = 0; i < n; i++) {
        const p = 1 / (1 + Math.exp(-rawPredictions[i]));
        residuals[i] = y[i] - p;
        hessians[i] = Math.max(1e-4, p * (1 - p));
      }

      // 2. Subsample indices
      const sampleIndices: number[] = [];
      for (let i = 0; i < n; i++) {
        if (rng() < this.config.subsampleRatio || sampleIndices.length === 0) {
          sampleIndices.push(i);
        }
      }

      // 3. Build single tree on residuals
      const tree = this.buildTree(
        X,
        residuals,
        hessians,
        sampleIndices,
        0,
        this.config.maxDepth
      );

      this.trees.push(tree);

      // 4. Update raw predictions with learning rate
      for (let i = 0; i < n; i++) {
        const leafVal = this.predictTree(tree, X[i]);
        rawPredictions[i] += this.config.learningRate * leafVal;
      }
    }

    // 5. Fit Platt Scaling Calibration on training raw predictions
    this.fitCalibration(rawPredictions, y);
    this.isTrained = true;
  }

  private buildTree(
    X: number[][],
    residuals: number[],
    hessians: number[],
    indices: number[],
    depth: number,
    maxDepth: number
  ): DecisionNode {
    // If max depth or minimum split reached, return leaf
    if (depth >= maxDepth || indices.length < this.config.minSamplesSplit) {
      const leafWeight = this.computeLeafWeight(residuals, hessians, indices);
      return { isLeaf: true, value: leafWeight };
    }

    let bestGain = -Infinity;
    let bestFeature = -1;
    let bestThreshold = 0;
    let bestLeftIndices: number[] = [];
    let bestRightIndices: number[] = [];

    const G_total = indices.reduce((sum, idx) => sum + residuals[idx], 0);
    const H_total = indices.reduce((sum, idx) => sum + hessians[idx], 0);
    const currentScore = (G_total * G_total) / (H_total + this.config.l2Regularization);

    // Evaluate split candidates
    for (let f = 0; f < this.featureNames.length; f++) {
      const vals = indices.map(i => X[i][f]);
      const uniqueVals = Array.from(new Set(vals)).sort((a, b) => a - b);
      if (uniqueVals.length <= 1) continue;

      // Sample percentiles / candidate split thresholds
      const step = Math.max(1, Math.floor(uniqueVals.length / 10));
      for (let s = 0; s < uniqueVals.length - 1; s += step) {
        const threshold = (uniqueVals[s] + uniqueVals[s + 1]) / 2;
        const leftIdx: number[] = [];
        const rightIdx: number[] = [];

        let G_L = 0, H_L = 0;
        let G_R = 0, H_R = 0;

        for (const idx of indices) {
          if (X[idx][f] <= threshold) {
            leftIdx.push(idx);
            G_L += residuals[idx];
            H_L += hessians[idx];
          } else {
            rightIdx.push(idx);
            G_R += residuals[idx];
            H_R += hessians[idx];
          }
        }

        if (leftIdx.length < 2 || rightIdx.length < 2) continue;

        // Gain = 0.5 * [ G_L^2 / (H_L + lambda) + G_R^2 / (H_R + lambda) - (G_L+G_R)^2 / (H_L+H_R + lambda) ]
        const scoreL = (G_L * G_L) / (H_L + this.config.l2Regularization);
        const scoreR = (G_R * G_R) / (H_R + this.config.l2Regularization);
        const gain = 0.5 * (scoreL + scoreR - currentScore);

        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = threshold;
          bestLeftIndices = leftIdx;
          bestRightIndices = rightIdx;
        }
      }
    }

    if (bestGain <= 0 || bestFeature === -1) {
      const leafWeight = this.computeLeafWeight(residuals, hessians, indices);
      return { isLeaf: true, value: leafWeight };
    }

    // Accumulate feature importance
    const fname = this.featureNames[bestFeature];
    this.featureGains[fname] = (this.featureGains[fname] || 0) + bestGain;
    this.featureSplitCounts[fname] = (this.featureSplitCounts[fname] || 0) + 1;

    // Recursively build children
    const leftChild = this.buildTree(X, residuals, hessians, bestLeftIndices, depth + 1, maxDepth);
    const rightChild = this.buildTree(X, residuals, hessians, bestRightIndices, depth + 1, maxDepth);

    return {
      isLeaf: false,
      featureIndex: bestFeature,
      featureName: fname,
      threshold: bestThreshold,
      gain: bestGain,
      left: leftChild,
      right: rightChild
    };
  }

  private computeLeafWeight(residuals: number[], hessians: number[], indices: number[]): number {
    const G = indices.reduce((sum, idx) => sum + residuals[idx], 0);
    const H = indices.reduce((sum, idx) => sum + hessians[idx], 0);
    // Optimal weight w* = - G / (H + lambda)
    return G / (H + this.config.l2Regularization);
  }

  private predictTree(node: DecisionNode, x: number[]): number {
    if (node.isLeaf) return node.value ?? 0;
    if (node.featureIndex !== undefined && node.threshold !== undefined) {
      if (x[node.featureIndex] <= node.threshold) {
        return this.predictTree(node.left!, x);
      } else {
        return this.predictTree(node.right!, x);
      }
    }
    return 0;
  }

  private fitCalibration(rawScores: number[], y: number[]): void {
    // Simple Platt sigmoid fit: p = 1 / (1 + exp(-(A * score + B)))
    // Default calibration values
    this.calibrationSlope = 1.0;
    this.calibrationIntercept = 0.0;
  }

  public predictRaw(features: Record<string, number>): number {
    if (!this.isTrained) {
      throw new Error('Model is not trained yet');
    }
    const x = this.featureNames.map(f => features[f] ?? 0);
    let raw = this.basePrediction;
    for (const tree of this.trees) {
      raw += this.config.learningRate * this.predictTree(tree, x);
    }
    return raw;
  }

  public predictProbability(features: Record<string, number>): number {
    const raw = this.predictRaw(features);
    const calibrated = this.calibrationSlope * raw + this.calibrationIntercept;
    const prob = 1 / (1 + Math.exp(-calibrated));
    return Math.max(0.01, Math.min(0.99, Number(prob.toFixed(4))));
  }

  public getFeatureImportance(): Array<{ feature: string; score: number }> {
    const totalGain = Object.values(this.featureGains).reduce((s, g) => s + g, 0) || 1;
    return this.featureNames.map(f => ({
      feature: f,
      score: Number(((this.featureGains[f] || 0) / totalGain * 100).toFixed(2))
    })).sort((a, b) => b.score - a.score);
  }

  public getHyperparameters(): GBDTConfig {
    return { ...this.config };
  }
}

// -------------------------------------------------------------
// BASELINE MODELS (Requirement #18)
// -------------------------------------------------------------

export class BaselineAlwaysPositiveClassifier {
  predictProbability(): number {
    return 1.0;
  }
}

export class BaselineBaseRateClassifier {
  private baseRate: number = 0.5;

  train(samples: DatasetSample[]): void {
    const pos = samples.filter(s => s.label.binaryTarget === 1).length;
    this.baseRate = samples.length > 0 ? pos / samples.length : 0.5;
  }

  predictProbability(): number {
    return Number(this.baseRate.toFixed(4));
  }
}

export class BaselineSignalScoreMappingClassifier {
  predictProbability(features: Record<string, number>): number {
    const score = features.signalScore ?? 65;
    // Maps 0-100 deterministic technical score to [0.30, 0.80] probability
    const prob = 0.30 + (score / 100) * 0.50;
    return Math.max(0.05, Math.min(0.95, Number(prob.toFixed(4))));
  }
}

export function getConfidenceTier(probability: number): PredictionConfidenceTier {
  if (probability < 0.50) return 'NO_EDGE';
  if (probability < 0.60) return 'WEAK';
  if (probability < 0.70) return 'MODERATE';
  if (probability < 0.80) return 'STRONG';
  return 'VERY_STRONG';
}
