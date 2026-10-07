import type { CurrentPairPredictionHorizon } from './currentPairPredictionOutcomeService';
import { getCurrentPairResearchValidationReport } from './currentPairResearchValidationService';
import { getCurrentPairOosDriftReport } from './currentPairOosDriftService';
import { getCurrentPairCalibrationMatrix } from './currentPairCalibrationMatrixService';
import { getCurrentPairCrossModelContextCalibration } from './currentPairCrossModelContextCalibrationService';
import { getCurrentPairCrossModelContextTemporalCalibration } from './currentPairCrossModelContextTemporalCalibrationService';

export type CurrentPairResearchLedgerStatus = 'PASS' | 'WARN' | 'INSUFFICIENT';

export interface CurrentPairResearchLedgerCheck {
  id: string;
  status: CurrentPairResearchLedgerStatus;
  title: string;
  detail: string;
}

export interface CurrentPairResearchReadinessLedger {
  scope: {
    symbol: string | null;
    horizon: CurrentPairPredictionHorizon;
    generatedAt: number;
    aiModelVersion: string;
  };
  evidence: {
    validationChecks: number;
    validationWarnings: number;
    validationInsufficient: number;
    aiDirectionalEvaluated: number;
    baselineDirectionalEvaluated: number;
    pairedEvaluated: number;
    currentOosDirectionalEvaluated: number;
    referenceOosDirectionalEvaluated: number;
    calibrationRows: number;
    sufficientCalibrationRows: number;
    contextRows: number;
    sufficientContextRows: number;
    contextTemporalWindows: number;
    sufficientContextTemporalWindows: number;
  };
  checks: CurrentPairResearchLedgerCheck[];
}

const BASELINE_MODEL = 'PAIR_FEATURE_BASELINE_V2';
const AI_MODEL = 'LLAMA_GATEWAY_QWEN_LLAMA_V1';
const MIN_SAMPLE_COUNT = 30;

export async function getCurrentPairResearchReadinessLedger(params: {
  symbol?: string;
  horizon?: CurrentPairPredictionHorizon;
} = {}): Promise<CurrentPairResearchReadinessLedger> {
  const symbol = params.symbol?.trim().toUpperCase() || null;
  const horizon = params.horizon || '1D';

  const [validation, oosDrift, calibrationMatrix, contextCalibration, contextTemporalCalibration] = await Promise.all([
    getCurrentPairResearchValidationReport({ symbol: symbol || undefined, horizon, limit: 50000 }),
    getCurrentPairOosDriftReport({ symbol: symbol || undefined, horizon, modelVersion: AI_MODEL }),
    getCurrentPairCalibrationMatrix({ symbol: symbol || undefined, horizon, modelVersion: AI_MODEL }),
    getCurrentPairCrossModelContextCalibration({ symbol: symbol || undefined, horizon }),
    getCurrentPairCrossModelContextTemporalCalibration({ symbol: symbol || undefined, horizon })
  ]);

  const aiModel = validation.models.find(model => model.modelVersion === AI_MODEL);
  const baselineModel = validation.models.find(model => model.modelVersion === BASELINE_MODEL);
  const validationWarnings = validation.checks.filter(check => check.status === 'WARN').length;
  const validationInsufficient = validation.checks.filter(check => check.status === 'INSUFFICIENT').length;
  const sufficientCalibrationRows = calibrationMatrix.rows.filter(row => row.current.sampleSufficient && row.reference.sampleSufficient).length;
  const sufficientContextRows = contextCalibration.rows.filter(row =>
    row.baseline.metrics.sampleSufficient && row.ai.metrics.sampleSufficient
  ).length;
  const contextTemporalWindows = contextTemporalCalibration.rows.reduce((sum, row) => sum + row.windows.length, 0);
  const sufficientContextTemporalWindows = contextTemporalCalibration.rows.reduce((sum, row) => sum + row.windows.filter(window => window.baseline.sampleSufficient && window.ai.sampleSufficient).length, 0);

  const bootstrapAvailable = Boolean(
    oosDrift.uncertainty.accuracyDelta95Pct &&
    oosDrift.uncertainty.brierDelta95 &&
    oosDrift.uncertainty.calibrationErrorDelta95Pct &&
    oosDrift.uncertainty.maximumCalibrationErrorDelta95Pct
  );

  const checks: CurrentPairResearchLedgerCheck[] = [
    {
      id: 'ai-sample',
      status: aiModel?.directionalEvaluated != null && aiModel.directionalEvaluated >= MIN_SAMPLE_COUNT ? 'PASS' : 'INSUFFICIENT',
      title: 'AI directional sample',
      detail: `${aiModel?.directionalEvaluated ?? 0} evaluated directional observations; minimum is ${MIN_SAMPLE_COUNT}.`
    },
    {
      id: 'baseline-sample',
      status: baselineModel?.directionalEvaluated != null && baselineModel.directionalEvaluated >= MIN_SAMPLE_COUNT ? 'PASS' : 'INSUFFICIENT',
      title: 'Baseline directional sample',
      detail: `${baselineModel?.directionalEvaluated ?? 0} evaluated directional observations; minimum is ${MIN_SAMPLE_COUNT}.`
    },
    {
      id: 'paired-sample',
      status: validation.data.pairedEvaluated >= MIN_SAMPLE_COUNT ? 'PASS' : 'INSUFFICIENT',
      title: 'Paired evaluation sample',
      detail: `${validation.data.pairedEvaluated} jointly evaluated pairs; minimum is ${MIN_SAMPLE_COUNT}.`
    },
    {
      id: 'oos-windows',
      status: oosDrift.currentWindow.sampleSufficient && oosDrift.baselineWindow.sampleSufficient ? 'PASS' : 'INSUFFICIENT',
      title: 'Non-overlapping OOS windows',
      detail: `${oosDrift.currentWindow.directionalEvaluated} current 30D and ${oosDrift.baselineWindow.directionalEvaluated} preceding 90D directional evaluations.`
    },
    {
      id: 'bootstrap-uncertainty',
      status: bootstrapAvailable ? 'PASS' : 'INSUFFICIENT',
      title: 'Bootstrap uncertainty coverage',
      detail: bootstrapAvailable ? 'Accuracy, Brier, ECE and MCE deltas all have deterministic 95% bootstrap intervals.' : 'One or more OOS bootstrap intervals are unavailable because the required sample is insufficient.'
    },
    {
      id: 'calibration-matrix',
      status: calibrationMatrix.rows.length === 0 ? 'INSUFFICIENT' : sufficientCalibrationRows > 0 ? 'PASS' : 'WARN',
      title: 'Symbol / horizon calibration coverage',
      detail: `${sufficientCalibrationRows} of ${calibrationMatrix.rows.length} symbol/horizon rows have sufficient current and reference samples.`
    },
    {
      id: 'context-calibration',
      status: contextCalibration.rows.length === 0 ? 'INSUFFICIENT' : sufficientContextRows > 0 ? 'PASS' : 'WARN',
      title: 'Context calibration coverage',
      detail: `${sufficientContextRows} of ${contextCalibration.rows.length} regime/session rows have sufficient samples for both models in both windows.`
    },
    {
      id: 'context-temporal-calibration',
      status: contextTemporalWindows === 0 ? 'INSUFFICIENT' : sufficientContextTemporalWindows > 0 ? 'PASS' : 'WARN',
      title: 'Context temporal calibration coverage',
      detail: `${sufficientContextTemporalWindows} of ${contextTemporalWindows} regime/session temporal windows have sufficient samples for both models.`
    },
    {
      id: 'validation-quality',
      status: validationInsufficient > 0 ? 'INSUFFICIENT' : validationWarnings > 0 ? 'WARN' : 'PASS',
      title: 'Data-quality governance checks',
      detail: validationInsufficient > 0
        ? `${validationInsufficient} validation checks are insufficient; ${validationWarnings} are warnings.`
        : validationWarnings > 0
          ? `${validationWarnings} validation warning(s) require research review; no checks are insufficient.`
          : 'All unified validation checks are passing.'
    }
  ];

  return {
    scope: { symbol, horizon, generatedAt: Date.now(), aiModelVersion: AI_MODEL },
    evidence: {
      validationChecks: validation.checks.length,
      validationWarnings,
      validationInsufficient,
      aiDirectionalEvaluated: aiModel?.directionalEvaluated ?? 0,
      baselineDirectionalEvaluated: baselineModel?.directionalEvaluated ?? 0,
      pairedEvaluated: validation.data.pairedEvaluated,
      currentOosDirectionalEvaluated: oosDrift.currentWindow.directionalEvaluated,
      referenceOosDirectionalEvaluated: oosDrift.baselineWindow.directionalEvaluated,
      calibrationRows: calibrationMatrix.rows.length,
      sufficientCalibrationRows,
      contextRows: contextCalibration.rows.length,
      sufficientContextRows,
      contextTemporalWindows,
      sufficientContextTemporalWindows
    },
    checks
  };
}
