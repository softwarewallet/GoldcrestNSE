// ============================================================================
// MODEL DRIFT & POPULATION STABILITY MONITORING ENGINE
// ============================================================================

import { ModelDriftReport } from '../types';

export class ModelMonitoringEngine {
  /**
   * Calculates Population Stability Index (PSI) between baseline and production feature distributions.
   * PSI < 0.1: Stable / No Drift
   * 0.1 <= PSI < 0.2: Moderate Drift
   * PSI >= 0.2: Significant / Severe Drift
   */
  public calculatePSI(baselineVals: number[], currentVals: number[], numBins: number = 10): number {
    if (baselineVals.length === 0 || currentVals.length === 0) return 0;

    const min = Math.min(...baselineVals, ...currentVals);
    const max = Math.max(...baselineVals, ...currentVals);
    if (min === max) return 0;

    const binWidth = (max - min) / numBins;
    let psi = 0;

    for (let i = 0; i < numBins; i++) {
      const bLow = min + i * binWidth;
      const bHigh = i === numBins - 1 ? max + 1e-6 : bLow + binWidth;

      const baseCount = baselineVals.filter(v => v >= bLow && v < bHigh).length;
      const currCount = currentVals.filter(v => v >= bLow && v < bHigh).length;

      const basePct = Math.max(1e-4, baseCount / baselineVals.length);
      const currPct = Math.max(1e-4, currCount / currentVals.length);

      // PSI component = (Actual - Expected) * ln(Actual / Expected)
      psi += (currPct - basePct) * Math.log(currPct / basePct);
    }

    return Number(psi.toFixed(4));
  }

  /**
   * Evaluates overall model health and produces drift report.
   */
  public evaluateModelDrift(
    modelId: string,
    modelVersion: string,
    baselineWinRate: number,
    baselineBrierScore: number,
    recentRealizedOutcomes: Array<{ predictedProb: number; targetFirst: boolean }>,
    featureSamples: { baseline: Record<string, number[]>; current: Record<string, number[]> }
  ): ModelDriftReport {
    const n = recentRealizedOutcomes.length;
    if (n < 10) {
      return {
        modelId,
        modelVersion,
        evaluationTimestamp: Date.now(),
        windowSamples: n,
        recentWinRate: baselineWinRate,
        expectedWinRate: baselineWinRate,
        winRateDropPct: 0,
        recentBrierScore: baselineBrierScore,
        baselineBrierScore,
        brierDegradationPct: 0,
        psiScore: 0.02,
        featureDrifts: [],
        overallStatus: 'HEALTHY',
        reasons: ['Initial observation window (monitoring active)']
      };
    }

    const wins = recentRealizedOutcomes.filter(o => o.targetFirst).length;
    const recentWinRate = Number((wins / n).toFixed(4));
    const winRateDropPct = Number((((baselineWinRate - recentWinRate) / baselineWinRate) * 100).toFixed(2));

    let brierSum = 0;
    for (const o of recentRealizedOutcomes) {
      const y = o.targetFirst ? 1 : 0;
      brierSum += Math.pow(o.predictedProb - y, 2);
    }
    const recentBrierScore = Number((brierSum / n).toFixed(4));
    const brierDegradationPct = Number((((recentBrierScore - baselineBrierScore) / baselineBrierScore) * 100).toFixed(2));

    // Compute PSI across key features
    const featureDrifts: Array<{ feature: string; psi: number; status: 'STABLE' | 'MODERATE_DRIFT' | 'SEVERE_DRIFT' }> = [];
    let maxPsi = 0;

    for (const [feat, currList] of Object.entries(featureSamples.current)) {
      const baseList = featureSamples.baseline[feat] || [];
      const psi = this.calculatePSI(baseList, currList);
      if (psi > maxPsi) maxPsi = psi;

      const status = psi < 0.10 ? 'STABLE' : psi < 0.20 ? 'MODERATE_DRIFT' : 'SEVERE_DRIFT';
      featureDrifts.push({ feature: feat, psi, status });
    }

    const reasons: string[] = [];
    let overallStatus: 'HEALTHY' | 'MONITORING_ALERT' | 'RETRAIN_RECOMMENDED' | 'DEGRADED' = 'HEALTHY';

    if (winRateDropPct > 20 || brierDegradationPct > 35 || maxPsi >= 0.25) {
      overallStatus = 'DEGRADED';
      if (winRateDropPct > 20) reasons.push(`Recent win rate (${(recentWinRate * 100).toFixed(1)}%) dropped > 20% vs baseline.`);
      if (brierDegradationPct > 35) reasons.push(`Probability calibration severely degraded (Brier: ${recentBrierScore}).`);
      if (maxPsi >= 0.25) reasons.push(`Significant feature distribution drift detected (Max PSI: ${maxPsi}).`);
    } else if (winRateDropPct > 10 || maxPsi >= 0.15) {
      overallStatus = 'RETRAIN_RECOMMENDED';
      reasons.push('Moderate performance drift observed. Model retraining recommended.');
    } else if (winRateDropPct > 5 || maxPsi >= 0.10) {
      overallStatus = 'MONITORING_ALERT';
      reasons.push('Minor statistical variance in feature distribution.');
    } else {
      reasons.push('Model outputs and feature distributions remain stable within standard error bounds.');
    }

    return {
      modelId,
      modelVersion,
      evaluationTimestamp: Date.now(),
      windowSamples: n,
      recentWinRate,
      expectedWinRate: baselineWinRate,
      winRateDropPct,
      recentBrierScore,
      baselineBrierScore,
      brierDegradationPct,
      psiScore: maxPsi,
      featureDrifts,
      overallStatus,
      reasons
    };
  }
}

export const modelMonitoringEngine = new ModelMonitoringEngine();
