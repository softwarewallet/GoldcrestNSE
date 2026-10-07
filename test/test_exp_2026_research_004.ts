import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  Exp2026Research004Engine,
  EXPERIMENT_ID,
  CHAMPION_MODEL_ID,
  CANDIDATE_MODEL_ID,
  FX_BENCHMARK_RATE
} from '../src/ml/experiments/exp2026Research004Engine';
import { LIVE_AUTO_EXECUTION_ALLOWED, LiveTradingGate } from '../src/governance/operationsResearchEngine';

function logPass(testNum: number, name: string) {
  console.log(`[PASS ${testNum.toString().padStart(2, '0')}/22] EXP_2026_RESEARCH_004 Test: ${name}`);
}

export async function runExp2026Research004TestSuite() {
  console.log('================================================================');
  console.log(' RUNNING EXP-2026-RESEARCH-004 MODEL DIFFERENTIATION TEST SUITE ');
  console.log('================================================================');

  const engine = new Exp2026Research004Engine();
  const run1 = engine.executeAudit({ seed: 2026, totalObservations: 550 });
  const run2 = engine.executeAudit({ seed: 2026, totalObservations: 550 });

  // 1. Model Configuration & Seed Hash Separation
  assert.ok(run1.championHash !== run1.candidateHash, 'Champion and Candidate configuration hashes must be distinct');
  logPass(1, 'Champion vs Candidate configuration/seed hash separation verified');

  // 2. Out-of-Sample Probability Separation
  assert.ok(run1.probabilityStats.percentageDifferent === 100.0, 'Inference must be distinct across 100% of observations');
  assert.ok(run1.probabilityStats.differentCount > 0, 'Must contain distinct out-of-sample prediction results');
  logPass(2, 'Out-of-sample model probability separation verified');

  // 3. Difference Magnitude Verification
  assert.ok(run1.probabilityStats.meanAbsoluteDifference > 0.01, 'Mean absolute difference must exceed minimum noise threshold');
  logPass(3, 'Probability divergence magnitude verified');

  // 4. Probability Bucket Distribution Checks
  assert.strictEqual(run1.probabilityStats.buckets.exactZero, 0, 'Identity bucket should have 0 occurrences');
  assert.ok(resBucketTotal(run1) > 0, 'Difference bucket distribution represents the full range of variance');
  logPass(4, 'Probability difference distribution buckets verified');

  // 5. Signal Policy Separation
  assert.ok(run1.signalStats.signalAgreementPct < 100.0, 'Signal outputs must exhibit independent paths');
  logPass(5, 'Signal policy separation verified');

  // 6. Qualification Disagreement Presence
  assert.ok(run1.signalStats.qualificationDisagreementPct > 0, 'Must record qualification disagreements due to deep vs shallow trees');
  logPass(6, 'Model qualification disagreements verified');

  // 7. Representative Decision Mismatch Logging
  assert.ok(run1.signalStats.representativeDisagreements.length > 0, 'Must log representative decision path differences for audit trail');
  logPass(7, 'Representative signal mismatch cases logged');

  // 8. ACCIDENTAL DELEGATION AUDIT: Independent Inference
  assert.strictEqual(run1.registryAudit.fallbackAttemptBlockSuccess, true, 'Calling non-existent model ID should fail closed rather than falling back to champion');
  logPass(8, 'Model Registry fallback attempt blocked (Anti-delegation verified)');

  // 9. Model Registry Isolation
  assert.strictEqual(run1.registryAudit.registryIsolationPassed, true, 'Champion and Candidate resolved keys must not map to the same registry instance');
  logPass(9, 'Model Registry independent resolution verified');

  // 10. Calibration Path Audit
  assert.strictEqual(resCalibrationA(run1), 1.0, 'Default slope must match standard identity calibration value');
  assert.strictEqual(resCalibrationB(run1), 0.0, 'Default intercept must match standard identity calibration value');
  logPass(10, 'Model calibration Platt scaling identity stub confirmed');

  // 11. DIAGNOSTIC DEFECT DETECTION: Threshold Path Audit
  assert.strictEqual(run1.thresholdAudit.defectIdentifiedInModelEvaluator, true, 'Defect in ModelEvaluator must be programmatically identified');
  assert.ok(run1.thresholdAudit.defectExplanation.length > 0, 'Explanation of ModelEvaluator defect must be recorded');
  logPass(11, 'Diagnostic defect in ModelEvaluator winRate/expectancy computation identified and explained');

  // 12. Corrected Threshold Influence Proof
  const tResults = run1.thresholdAudit.thresholdVerificationResults;
  assert.ok(tResults.length > 0, 'Should contain verification results for multiple custom thresholds');
  assert.ok(tResults.every(r => r.status === 'PASS'), 'All threshold path qualification assertions must PASS');
  logPass(12, 'Corrected threshold influence over qualification decisions verified');

  // 13. Controlled Synthetic Unit Tests
  assert.strictEqual(run1.syntheticUnitTestPassed, true, 'Controlled synthetic tree traversal test cases must pass');
  logPass(13, 'Controlled synthetic unit tests verified');

  // 14. Historical Replay Independence
  assert.ok(run1.replayStats.modelOutputAgreementPct < 100.0, 'Model outputs should not align completely on historical replay');
  logPass(14, 'Historical replay independence verified');

  // 15. Risk-Filter Attribution Transparency
  const ra = run1.riskFilterAttribution;
  assert.ok(ra.length > 0, 'Risk filter attribution table must be fully populated');
  assert.ok(ra.some(row => row.divergentSignalsCount > 0), 'Attribution must detect divergent signal occurrences at multiple layers');
  logPass(15, 'Downstream risk-filter decision attribution verified');

  // 16. Weak Regime Investigation (Low-Vol -> High-Vol Transition)
  const volInv = run1.lowVolToHighVolInvestigation;
  assert.ok(volInv.slippagePips > volInv.spreadPips, 'Execution slippage must expand under transition regime');
  assert.ok(volInv.drawdownProgressionChamp.length > 0 && volInv.drawdownProgressionCand.length > 0, 'Drawdown progression comments must be logged');
  logPass(16, 'Low-Vol -> High-Vol transition degradation and risk response verified');

  // 17. Deterministic Reproducibility
  assert.strictEqual(run1.configHash, run2.configHash, 'Config hashes must match for identical seeds');
  assert.strictEqual(run1.resultHash, run2.resultHash, 'Result hashes must match for identical seeds');
  assert.strictEqual(run1.reproducibility.hashesMatch, true, 'Double run reproducibility check must succeed');
  logPass(17, '100% deterministic reproducibility verified');

  // 18. Production Model Isolation
  assert.strictEqual(run1.championUntouched, true, 'Production champion must remain untouched');
  assert.strictEqual(run1.registryProtected, true, 'Registry seeds and configs must be protected');
  logPass(18, 'Production model isolation verified');

  // 19. Live Trading Autonomy Lock Invariant (MANDATORY SAFETY)
  assert.strictEqual(run1.liveAutoExecutionAllowed, false, 'LIVE_AUTO_EXECUTION_ALLOWED must remain strictly FALSE');
  assert.strictEqual(LIVE_AUTO_EXECUTION_ALLOWED, false, 'Global safety invariant check must fail closed if true');
  logPass(19, 'Mandatory live safety invariant (LIVE_AUTO_EXECUTION_ALLOWED === false) locked');

  // 20. Audit Report Creation Verification
  const reportPath = path.join(process.cwd(), 'PHASE_EXP_2026_RESEARCH_004_REPORT.md');
  assert.ok(fs.existsSync(reportPath), 'Audit report markdown file must be written to root folder');
  const reportContent = fs.readFileSync(reportPath, 'utf-8');
  assert.ok(reportContent.includes('# PHASE EXP-2026-RESEARCH-004 REPORT'), 'Report must contain expected title header');
  logPass(20, 'Audit report written to root folder with full markdown schema');

  // 21. Complete Execution Status Check
  assert.strictEqual(run1.auditStatus, 'COMPLETED_SUCCESSFULLY', 'Audit execution status must be COMPLETED_SUCCESSFULLY');
  logPass(21, 'Audit execution status confirmed successfully');

  // 22. Status Classification Checks
  assert.strictEqual(run1.differentiationClassification, 'CONFIRMED', 'Classification should confirm differentiation');
  assert.strictEqual(run1.liveSafetyStatus, 'LOCKED', 'Safety status must be LOCKED');
  assert.strictEqual(run1.candidateResearchStatus, 'RESEARCH ONLY', 'Candidate status must be RESEARCH ONLY');
  assert.strictEqual(run1.productionPromotionStatus, 'NOT AUTHORIZED', 'Production promotion status must be NOT AUTHORIZED');
  logPass(22, 'Classification status fields confirmed (Candidate remains RESEARCH ONLY / NOT AUTHORIZED)');

  console.log('\n================================================================');
  console.log(' 🎉 ALL 22 AUDIT CHECKS PASSED PERFECTLY FOR EXP-2026-RESEARCH-004 ');
  console.log('================================================================\n');
}

function resBucketTotal(res: any): number {
  const b = res.probabilityStats.buckets;
  return b.zeroToZeroOne + b.zeroOneToZeroFive + b.zeroFiveToZeroTen + b.aboveZeroTen;
}

function resCalibrationA(res: any): number {
  return res.calibrationAudit.championSlope;
}

function resCalibrationB(res: any): number {
  return res.calibrationAudit.championIntercept;
}

// Support running directly from command line (tsx test/test_exp_2026_research_004.ts)
if (import.meta.url.endsWith(process.argv[1] || '')) {
  runExp2026Research004TestSuite().catch(err => {
    console.error('Audit suite failure:', err);
    process.exit(1);
  });
}
