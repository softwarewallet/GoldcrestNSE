import { Matrix, Vector } from '../types';

export interface LogisticRegressionConfig {
  learningRate: number;
  iterations: number;
  regularization: number; // L2 lambda
  tolerance: number;
}

export class LogisticRegression {
  private weights: number[] = [];
  private bias: number = 0;
  private config: LogisticRegressionConfig;

  constructor(config: Partial<LogisticRegressionConfig> = {}) {
    this.config = {
      learningRate: config.learningRate ?? 0.01,
      iterations: config.iterations ?? 1000,
      regularization: config.regularization ?? 0.1,
      tolerance: config.tolerance ?? 1e-6
    };
  }

  private sigmoid(z: number): number {
    return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
  }

  fit(X: number[][], y: number[]): void {
    const nSamples = X.length;
    if (nSamples === 0) return;
    const nFeatures = X[0].length;

    this.weights = new Array(nFeatures).fill(0);
    this.bias = 0;

    let prevLoss = Infinity;

    for (let i = 0; i < this.config.iterations; i++) {
      let dw = new Array(nFeatures).fill(0);
      let db = 0;
      let totalLoss = 0;

      for (let j = 0; j < nSamples; j++) {
        const linearModel = X[j].reduce((sum, val, idx) => sum + val * this.weights[idx], 0) + this.bias;
        const prediction = this.sigmoid(linearModel);
        
        const error = prediction - y[j];
        
        // Log loss calculation
        const loss = -(y[j] * Math.log(prediction + 1e-15) + (1 - y[j]) * Math.log(1 - prediction + 1e-15));
        totalLoss += loss;

        for (let k = 0; k < nFeatures; k++) {
          dw[k] += X[j][k] * error;
        }
        db += error;
      }

      // Update weights with L2 regularization
      for (let k = 0; k < nFeatures; k++) {
        const grad = (dw[k] / nSamples) + (this.config.regularization * this.weights[k] / nSamples);
        this.weights[k] -= this.config.learningRate * grad;
      }
      this.bias -= this.config.learningRate * (db / nSamples);

      const avgLoss = totalLoss / nSamples;
      if (Math.abs(prevLoss - avgLoss) < this.config.tolerance) break;
      prevLoss = avgLoss;
    }
  }

  predictProb(X: number[][]): number[] {
    return X.map(row => {
      const linearModel = row.reduce((sum, val, idx) => sum + val * this.weights[idx], 0) + this.bias;
      return this.sigmoid(linearModel);
    });
  }

  getWeights(): { weights: number[]; bias: number } {
    return { weights: [...this.weights], bias: this.bias };
  }
}
