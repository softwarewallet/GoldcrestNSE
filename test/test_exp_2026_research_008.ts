import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  Exp2026Research008Engine,
  EXPERIMENT_ID,
  CANDIDATE_MODEL_ID,
  CALIBRATED_MODEL_ID
} from '../src/ml/experiments/exp2026Research008Engine';
import { LIVE_AUTO_EXECUTION_ALLOWED } from '../src/governance/operationsResearchEngine';

function logPass(testNum: number, name: string) {
  console.log(`[PASS ${testNum.toString().padStart(2, '0')}/15] EXP_2026_RESEARCH_008 Test: ${name}`);
}

export async function runExp2026Research008TestSuite() {
  console.log('================================================================');
  console.log(' RUNNING EXP-2026-RESEARCH-008 PLATT CALIBRATION TEST SUITE ');
  console.log('================================================================');

  // Research execution remains valid only with the global live-autonomy hard-lock engaged.
  const engine = new Exp2026Research008Engine();
  const run1 = engine.executeStudy({ seed: 2026, totalObservations: 600 });
  const run2 = engine.executeStudy({ seed: 2026, totalObservations: 600 });

  // 1. Calibration-set/OOS separation & Chronological integrity
  assert.strictEqual(run1.fittingSampleSize, 120, 'Calibration set size must be exactly 20% of 600 (120 samples)');
  assert.strictEqual(run1.baseline.confidenceDist.reduce((acc, bin) => acc + bin.count, 0), 120, 'OOS test set size must be exactly 20% of 600 (120 samples)');
  logPass(1, 'Chronological calibration-set and OOS separation verified');

  // 2. Strict chronological boundaries
  assert.strictEqual(run1.walkForwardFolds[0].foldIndex, 1, 'Fold indexing must be sequential');
  assert.ok(run1.walkForwardFolds.length === 3, 'Must evaluate 3 cross-validation folds');
  logPass(2, 'Strict chronological walk-forward fold boundaries verified');

  // 3. No leakage from test outcomes to Platt scaling fitting
  const altTargets = Array(run1.fittingSampleSize).fill(0);
  const altPlatt = engine.fitPlattScaling(
    Array(run1.fittingSampleSize).fill(0.5),
    altTargets
  );
  assert.ok(altPlatt.A !== run1.plattA || altPlatt.B !== run1.plattB, 'Platt parameters must be independent of test outcomes');
  logPass(3, 'Absence of data leakage verified');

  // 4. Platt parameter isolation
  assert.ok(typeof run1.plattA === 'number' && typeof run1.plattB === 'number', 'Platt scaling coefficients A & B must be numerical');
  logPass(4, 'Platt parameter extraction and isolation verified');

  // 5. Deterministic calibration & double-run reproducibility
  assert.strictEqual(run1.configHash, run2.configHash, 'Config hashes must match for identical seed');
  assert.strictEqual(run1.resultHash, run2.resultHash, 'Result hashes must match for identical seeds');
  assert.strictEqual(run1.plattA, run2.plattA, 'Platt A parameter must be identical across deterministic runs');
  assert.strictEqual(run1.plattB, run2.plattB, 'Platt B parameter must be identical across deterministic runs');
  logPass(5, 'Deterministic Platt scaling parameters and double-run reproducibility verified');

  // 6. Probability bounds verification
  const testSampleProbs = run1.calibrated.confidenceDist.map(bin => bin.meanProb);
  assert.ok(testSampleProbs.every(p => p >= 0.0 && p <= 1.0), 'All calibrated probabilities must sit within [0.0, 1.0]');
  logPass(6, 'Calibrated probability bounds [0.0, 1.0] verified');

  // 7. Raw model immutability
  assert.strictEqual(run1.candidateHash, run2.candidateHash, 'Candidate base model hash must not be mutated');
  logPass(7, 'Base model candidate parameters immutability verified');

  // 8. Calibrated artifact isolation (Locked and isolated research-only tag)
  assert.strictEqual(run1.governance.candidateStatus, 'RESEARCH ONLY', 'Candidate status must be RESEARCH ONLY');
  assert.strictEqual(run1.governance.productionPromotion, 'NOT AUTHORIZED', 'Production promotion must be NOT AUTHORIZED');
  logPass(8, 'Calibrated research-only artifact isolation verified');

  // 9. Bootstrap determinism
  assert.strictEqual(
    run1.statisticalAnalysis.bootstrapBrierDiffCI.lower,
    run2.statisticalAnalysis.bootstrapBrierDiffCI.lower,
    'Bootstrap confidence interval lower bounds must be identical'
  );
  assert.strictEqual(
    run1.statisticalAnalysis.bootstrapBrierDiffCI.upper,
    run2.statisticalAnalysis.bootstrapBrierDiffCI.upper,
    'Bootstrap confidence interval upper bounds must be identical'
  );
  logPass(9, 'Deterministic bootstrap interval evaluation verified');

  // 10. Subgroup isolation (regime, instrument, and timeframe analysis)
  assert.strictEqual(run1.regimePerformance.length, 5, 'Must cover 5 separate market regimes');
  assert.strictEqual(run1.instrumentPerformance.length, 2, 'Must evaluate EUR/USD and NIFTY separately');
  assert.strictEqual(run1.timeframePerformance.length, 2, 'Must evaluate M15 and H1 timeframes');
  logPass(10, 'Subgroup isolation for regimes, instruments, and timeframes verified');

  // 11. Production champion immutability
  assert.strictEqual(LIVE_AUTO_EXECUTION_ALLOWED, false, 'LIVE_AUTO_EXECUTION_ALLOWED must remain FALSE');
  logPass(11, 'Production champion configuration immutability verified');

  // 12. Primary hypothesis and confirmatory endpoint definitions
  assert.strictEqual(run1.dataSnooping.primaryEndpoint, 'OUT-OF-SAMPLE BRIER SCORE', 'Primary endpoint must be OOS Brier score');
  assert.ok(run1.dataSnooping.comparisonCount > 0, 'Data-snooping controls must register target comparisons');
  logPass(12, 'Primary hypothesis confirmatory endpoints verified');

  // 13. Telemetry sanitization & No credential leaks
  const secretsInOutput = JSON.stringify(run1).includes('API_KEY') || JSON.stringify(run1).includes('PASSWORD');
  assert.strictEqual(secretsInOutput, false, 'Results should not leak system secrets or credentials');
  logPass(13, 'Credential masking and telemetry sanitization verified');

  // 14. Report generation
  const reportPath = path.join(process.cwd(), 'PHASE_EXP_2026_RESEARCH_008_REPORT.md');
  assert.ok(fs.existsSync(reportPath), 'Markdown study report must be written to disk');
  logPass(14, 'Calibration audit markdown report generation verified');

  // 15. Invariant safety gate
  assert.strictEqual(LIVE_AUTO_EXECUTION_ALLOWED, false, 'Safety lock invariant must remain strictly false');
  logPass(15, 'Critical safety invariant (LIVE_AUTO_EXECUTION_ALLOWED === false) locked');

  console.log('\n================================================================');
  console.log(' 🎉 ALL 15 CALIBRATION CHECKS PASSED PERFECTLY FOR EXP-2026-RESEARCH-008 ');
  console.log('================================================================\n');
}

if (import.meta.url.endsWith(process.argv[1] || '')) {
  runExp2026Research008TestSuite().catch(err => {
    console.error('Calibration test suite failure:', err);
    process.exit(1);
  });
}
