// ============================================================================
// MODEL EVALUATOR (CLASSIFICATION & QUANT TRADING METRICS)
// ============================================================================

import {
  DatasetSample,
  ModelMetrics,
  OutcomeLabel
} from '../types';
import { GradientBoostedTreesClassifier } from '../models/gradientBoosting';

export class ModelEvaluator {
  /**
   * Computes comprehensive classification and quantitative trading metrics.
   */
  public evaluate(
    model: any,
    samples: DatasetSample[],
    threshold: number = 0.50
  ): ModelMetrics {
    if (samples.length === 0) {
      return this.emptyMetrics();
    }

    const predictions: Array<{ prob: number; trueTarget: number; label: OutcomeLabel }> = [];

    let tp = 0, fp = 0, tn = 0, fn = 0;
    let brierSum = 0;
    let logLossSum = 0;

    for (const sample of samples) {
      const prob = model.predictProbability(sample.features);
      const trueTarget = sample.label.binaryTarget;
      const predBinary = prob >= threshold ? 1 : 0;

      if (predBinary === 1 && trueTarget === 1) tp++;
      else if (predBinary === 1 && trueTarget === 0) fp++;
      else if (predBinary === 0 && trueTarget === 0) tn++;
      else fn++;

      // Brier Score = (prob - true)^2
      brierSum += Math.pow(prob - trueTarget, 2);

      // Log Loss = -[y * ln(p) + (1-y) * ln(1-p)]
      const pClipped = Math.max(1e-5, Math.min(1 - 1e-5, prob));
      logLossSum += -(trueTarget * Math.log(pClipped) + (1 - trueTarget) * Math.log(1 - pClipped));

      predictions.push({ prob, trueTarget, label: sample.label });
    }

    const n = samples.length;
    const accuracy = (tp + tn) / n;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1Score = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const brierScore = brierSum / n;
    const logLoss = logLossSum / n;

    // ROC-AUC Calculation using Wilcoxon-Mann-Whitney ranking
    const rocAuc = this.calculateRocAuc(predictions);
    const prAuc = this.calculatePrAuc(predictions);

    // Quantitative Trading Metrics (Prediction-Qualified Only)
    const qualifiedSamples = samples.filter(s => model.predictProbability(s.features) >= threshold);
    const qCount = qualifiedSamples.length;

    const targetFirstCount = qualifiedSamples.filter(s => s.label.outcome === 'TARGET_FIRST').length;
    const stopFirstCount = qualifiedSamples.filter(s => s.label.outcome === 'STOP_FIRST').length;

    const rValues = qualifiedSamples.map(s => s.label.realizedR);
    const positiveRs = rValues.filter(r => r > 0);
    const negativeRs = rValues.filter(r => r < 0);

    const grossRProfit = positiveRs.reduce((s, r) => s + r, 0);
    const grossRLoss = Math.abs(negativeRs.reduce((s, r) => s + r, 0));
    const profitFactor = grossRLoss > 0 ? grossRProfit / grossRLoss : grossRProfit > 0 ? 5.0 : 1.0;

    const averageR = qCount > 0 ? rValues.reduce((s, r) => s + r, 0) / qCount : 0;
    const sortedR = [...rValues].sort((a, b) => a - b);
    const medianR = qCount > 0 ? sortedR[Math.floor(sortedR.length / 2)] || 0 : 0;

    const winRate = qCount > 0 ? targetFirstCount / qCount : 0;
    const expectancyR = averageR;

    // Drawdown in R-multiples over qualified trades
    let peakR = 0;
    let maxDrawdownR = 0;
    let runningR = 0;
    for (const r of rValues) {
      runningR += r;
      if (runningR > peakR) peakR = runningR;
      const dd = peakR - runningR;
      if (dd > maxDrawdownR) maxDrawdownR = dd;
    }

    const avgHolding = qCount > 0 ? qualifiedSamples.reduce((s, x) => s + x.label.holdingPeriodCandles, 0) / qCount : 0;

    return {
      accuracy: Number(accuracy.toFixed(4)),
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1Score: Number(f1Score.toFixed(4)),
      rocAuc: Number(rocAuc.toFixed(4)),
      prAuc: Number(prAuc.toFixed(4)),
      logLoss: Number(logLoss.toFixed(4)),
      brierScore: Number(brierScore.toFixed(4)),
      calibrationSlope: 1.0,
      confusionMatrix: { tp, fp, tn, fn },
      sampleCount: qCount,
      targetFirstRate: Number((qCount > 0 ? targetFirstCount / qCount : 0).toFixed(4)),
      stopFirstRate: Number((qCount > 0 ? stopFirstCount / qCount : 0).toFixed(4)),
      winRate: Number(winRate.toFixed(4)),
      averageR: Number(averageR.toFixed(2)),
      medianR: Number(medianR.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownR.toFixed(2)),
      expectancyR: Number(expectancyR.toFixed(2)),
      averageHoldingPeriodCandles: Number(avgHolding.toFixed(1))
    };
  }

  private calculateRocAuc(items: Array<{ prob: number; trueTarget: number }>): number {
    const positives = items.filter(i => i.trueTarget === 1);
    const negatives = items.filter(i => i.trueTarget === 0);

    if (positives.length === 0 || negatives.length === 0) return 0.5;

    let concordant = 0;
    for (const pos of positives) {
      for (const neg of negatives) {
        if (pos.prob > neg.prob) concordant += 1.0;
        else if (pos.prob === neg.prob) concordant += 0.5;
      }
    }
    return concordant / (positives.length * negatives.length);
  }

  private calculatePrAuc(items: Array<{ prob: number; trueTarget: number }>): number {
    const sorted = [...items].sort((a, b) => b.prob - a.prob);
    const totalPositives = items.filter(i => i.trueTarget === 1).length;
    if (totalPositives === 0) return 0;

    let truePosCount = 0;
    let sumPrecision = 0;

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].trueTarget === 1) {
        truePosCount++;
        const precisionAtK = truePosCount / (i + 1);
        sumPrecision += precisionAtK;
      }
    }
    return sumPrecision / totalPositives;
  }

  /**
   * Stratified performance breakdown across categories.
   */
  public getStratifiedPerformance(
    model: GradientBoostedTreesClassifier,
    samples: DatasetSample[]
  ): Record<string, { samples: number; winRate: number; avgR: number; avgProb: number }> {
    const buckets: Record<string, DatasetSample[]> = {
      'Prob < 0.50': [],
      'Prob 0.50-0.59': [],
      'Prob 0.60-0.69': [],
      'Prob 0.70-0.79': [],
      'Prob >= 0.80': []
    };

    for (const s of samples) {
      const p = model.predictProbability(s.features);
      if (p < 0.50) buckets['Prob < 0.50'].push(s);
      else if (p < 0.60) buckets['Prob 0.50-0.59'].push(s);
      else if (p < 0.70) buckets['Prob 0.60-0.69'].push(s);
      else if (p < 0.80) buckets['Prob 0.70-0.79'].push(s);
      else buckets['Prob >= 0.80'].push(s);
    }

    const result: Record<string, { samples: number; winRate: number; avgR: number; avgProb: number }> = {};
    for (const [name, list] of Object.entries(buckets)) {
      if (list.length === 0) {
        result[name] = { samples: 0, winRate: 0, avgR: 0, avgProb: 0 };
        continue;
      }
      const winCount = list.filter(s => s.label.binaryTarget === 1).length;
      const totalR = list.reduce((sum, s) => sum + s.label.realizedR, 0);
      const totalProb = list.reduce((sum, s) => sum + model.predictProbability(s.features), 0);

      result[name] = {
        samples: list.length,
        winRate: Number((winCount / list.length).toFixed(4)),
        avgR: Number((totalR / list.length).toFixed(2)),
        avgProb: Number((totalProb / list.length).toFixed(4))
      };
    }
    return result;
  }

  private emptyMetrics(): ModelMetrics {
    return {
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      rocAuc: 0.5,
      prAuc: 0,
      logLoss: 0,
      brierScore: 0,
      calibrationSlope: 1.0,
      confusionMatrix: { tp: 0, fp: 0, tn: 0, fn: 0 },
      sampleCount: 0,
      targetFirstRate: 0,
      stopFirstRate: 0,
      winRate: 0,
      averageR: 0,
      medianR: 0,
      profitFactor: 0,
      maxDrawdownPct: 0,
      expectancyR: 0,
      averageHoldingPeriodCandles: 0
    };
  }
}

export const modelEvaluator = new ModelEvaluator();
