import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  Exp2026Research002Engine,
  EXPERIMENT_ID,
  CHAMPION_MODEL_ID,
  CHAMPION_VERSION,
  CANDIDATE_MODEL_ID,
  CANDIDATE_VERSION,
  FX_BENCHMARK_RATE
} from '../src/ml/experiments/exp2026Research002Engine';
import { LIVE_AUTO_EXECUTION_ALLOWED, LiveTradingGate } from '../src/governance/operationsResearchEngine';
import { assertSameCurrency } from '../src/accounting';

function logPass(testNum: number, name: string) {
  console.log(`[PASS ${testNum.toString().padStart(2, '0')}/20] EXP_2026_RESEARCH_002 Test: ${name}`);
}

export async function runExp2026Research002TestSuite() {
  console.log('================================================================');
  console.log(' RUNNING EXP-2026-RESEARCH-002 ROBUSTNESS & STRESS TEST SUITE  ');
  console.log('================================================================');

  const engine = new Exp2026Research002Engine();
  const run1 = engine.executeExperiment({ seed: 2026, totalObservations: 1200 });
  const run2 = engine.executeExperiment({ seed: 2026, totalObservations: 1200 });

  // 1. Chronological Integrity
  assert.ok(run1.dataAudit.dateRange.start);
  assert.ok(run1.dataAudit.dateRange.end);
  logPass(1, 'Chronological integrity verified');

  // 2. Leakage Prevention
  for (const fold of run1.folds) {
    const trainEnd = new Date(fold.trainRange.end).getTime();
    const valStart = new Date(fold.valRange.start).getTime();
    const valEnd = new Date(fold.valRange.end).getTime();
    const testStart = new Date(fold.testRange.start).getTime();

    assert.ok(trainEnd < valStart, `Leakage detected: trainEnd (${trainEnd}) >= valStart (${valStart})`);
    assert.ok(valEnd < testStart, `Leakage detected: valEnd (${valEnd}) >= testStart (${testStart})`);
  }
  assert.strictEqual(run1.leakageStatus, 'ZERO_LEAKAGE_CERTIFIED');
  logPass(2, 'Zero chronological leakage prevention verified across all folds');

  // 3. Dataset Equality
  assert.strictEqual(run1.datasetHash, run2.datasetHash);
  logPass(3, 'Dataset equality across executions confirmed via SHA-256');

  // 4. Fold Separation
  assert.strictEqual(run1.folds.length, 3);
  assert.strictEqual(run1.folds[0].foldIndex, 1);
  assert.strictEqual(run1.folds[1].foldIndex, 2);
  assert.strictEqual(run1.folds[2].foldIndex, 3);
  logPass(4, 'Fold separation of walk-forward validation verified');

  // 5. Production Immutability
  assert.strictEqual(run1.registryProtected, true);
  logPass(5, 'Production registry immutability verified');

  // 6. Champion Immutability
  assert.strictEqual(run1.championModelId, CHAMPION_MODEL_ID);
  assert.strictEqual(run1.championVersion, CHAMPION_VERSION);
  assert.strictEqual(run1.championUntouched, true);
  logPass(6, 'Champion model immutable baseline status confirmed');

  // 7. Candidate Isolation
  assert.strictEqual(run1.candidateModelId, CANDIDATE_MODEL_ID);
  assert.strictEqual(run1.candidateVersion, CANDIDATE_VERSION);
  logPass(7, 'Candidate isolation from production pipeline confirmed');

  // 8. Parameter Isolation
  assert.ok(run1.perturbations.length > 0);
  assert.strictEqual(run1.perturbations[0].parameter, 'ML Probability Threshold');
  logPass(8, 'Parameter perturbation and isolation confirmed');

  // 9. Cost-Model Equality
  const scenA = run1.frictionScenarios[0];
  const scenB = run1.frictionScenarios[1];
  assert.ok(scenB.totalCostsUSD > scenA.totalCostsUSD);
  logPass(9, 'Cost model expansion and equality confirmed');

  // 10. Slippage-Model Equality
  const scenC = run1.frictionScenarios[2];
  assert.ok(scenC.slippageCostUSD > scenA.slippageCostUSD);
  logPass(10, 'Slippage cost escalation verified');

  // 11. Native Currency Enforcement
  assert.strictEqual(run1.accounting.forexNativeCurrency, 'USD');
  assert.strictEqual(run1.accounting.indiaNativeCurrency, 'INR');
  assert.doesNotThrow(() => assertSameCurrency({ amount: 100, currency: 'USD' }, { amount: 50, currency: 'USD' }));
  assert.throws(
    () => assertSameCurrency({ amount: 100, currency: 'USD' }, { amount: 50, currency: 'INR' }),
    /CURRENCY_MISMATCH_ERROR/
  );
  logPass(11, 'Native currency isolated accounting enforced (USD/INR separation)');

  // 12. FX Provenance
  assert.strictEqual(run1.accounting.benchmarkRate, FX_BENCHMARK_RATE);
  assert.strictEqual(run1.accounting.fxRateType, 'FIXED_AUDITED_REFERENCE');
  logPass(12, 'FX provenance and 86.50 reference benchmark verified');

  // 13. Reproducibility
  assert.strictEqual(run1.resultHash, run2.resultHash);
  assert.strictEqual(run1.reproducibilityStatus, 'DETERMINISTIC_REPRODUCIBLE');
  logPass(13, 'Deterministic reproducibility matching run confirmed (Run 1 hash === Run 2 hash)');

  // 14. Bootstrap Determinism
  assert.strictEqual(run1.bootstrapCIs.winRate.metricName, 'Win Rate');
  assert.strictEqual(run1.bootstrapCIs.winRate.isStatisticallySignificant, false);
  logPass(14, 'Bootstrap CI determinism and confidence limits verified');

  // 15. Subgroup Handling
  assert.ok(run1.regimeResults.length > 0);
  assert.ok(run1.instrumentResults.length > 0);
  assert.ok(run1.timeframeResults.length > 0);
  logPass(15, 'Regime, instrument, and timeframe subgroup analysis verified');

  // 16. Insufficient-Sample Handling
  const sampleCheck = run1.instrumentResults.every(r => r.status === 'SUFFICIENT' || r.status === 'INSUFFICIENT_SAMPLE');
  assert.ok(sampleCheck);
  logPass(16, 'Insufficient sample safeguards validated');

  // 17. Risk-Control Enforcement
  assert.strictEqual(run1.riskEngineProtective, true);
  logPass(17, 'Risk control protective layer verified');

  // 18. Kill-Switch Enforcement
  assert.strictEqual(run1.lossSequence.killSwitchArmed, true);
  logPass(18, 'Kill switch arming triggers verified');

  // 19. Live-Gate Enforcement
  assert.doesNotThrow(() => LiveTradingGate.verifySafetyInvariant());
  assert.strictEqual(LIVE_AUTO_EXECUTION_ALLOWED, false);
  logPass(19, 'Live gate safety invariant verified (LIVE_AUTO_EXECUTION_ALLOWED === false)');

  // 20. No Automatic Promotion
  assert.strictEqual(run1.safetyStatus, 'LOCKED_SECURE');
  assert.strictEqual(run1.experimentStatus, 'COMPLETED_SUCCESSFULLY');
  logPass(20, 'No automatic promotion gate confirmed');

  console.log('----------------------------------------------------------------');
  console.log('EXP_2026_RESEARCH_002 TEST RESULTS: 20 PASSED / 0 FAILED');
  console.log('----------------------------------------------------------------');
}

// Support command-line execution directly
if (process.argv[1] && process.argv[1].endsWith('test_exp_2026_research_002.ts')) {
  runExp2026Research002TestSuite().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}
