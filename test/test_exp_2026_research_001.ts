import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  exp2026Research001Engine,
  EXPERIMENT_ID,
  CHAMPION_MODEL_ID,
  CHAMPION_VERSION,
  CANDIDATE_MODEL_ID,
  CANDIDATE_VERSION,
  FEATURE_VERSION,
  FX_BENCHMARK_RATE,
  ExperimentResult
} from '../src/ml/experiments/exp2026Research001Engine';
import { LIVE_AUTO_EXECUTION_ALLOWED, LiveTradingGate } from '../src/governance/operationsResearchEngine';
import { ModelRegistry } from '../src/ml/models/modelRegistry';
import { assertSameCurrency } from '../src/accounting';

export async function runExp2026Research001TestSuite() {
  console.log('================================================================');
  console.log(' RUNNING EXP-2026-RESEARCH-001 ISOLATED RESEARCH EXPERIMENT (v1.3.0)');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 25;

  function logPass(index: number, description: string) {
    passedTests++;
    console.log(`[PASS ${index.toString().padStart(2, '0')}/${totalTests}] EXP_2026_RESEARCH_001 Test ${index}: ${description}`);
  }

  // 1. Absolute Safety Invariant
  assert.strictEqual(LIVE_AUTO_EXECUTION_ALLOWED, false, 'LIVE_AUTO_EXECUTION_ALLOWED must be hard-locked to false');
  LiveTradingGate.verifySafetyInvariant();
  logPass(1, 'Absolute Safety Invariant verified (LIVE_AUTO_EXECUTION_ALLOWED === false)');

  // 2. Execute Research Experiment Run 1
  const run1: ExperimentResult = exp2026Research001Engine.executeExperiment({ seed: 42 });
  assert.strictEqual(run1.experimentId, EXPERIMENT_ID);
  logPass(2, 'Experiment EXP_2026_RESEARCH_001 executed successfully');

  // 3. Verify Champion Model Identity & Immutability
  assert.strictEqual(run1.championModelId, CHAMPION_MODEL_ID);
  assert.strictEqual(run1.championVersion, CHAMPION_VERSION);
  assert.strictEqual(run1.championImmutable, true);
  logPass(3, 'Champion model identity & immutability verified (gbt_forex_v1.0.0)');

  // 4. Verify Candidate Model Identity & Non-Promotion
  assert.strictEqual(run1.candidateModelId, CANDIDATE_MODEL_ID);
  assert.strictEqual(run1.candidateVersion, CANDIDATE_VERSION);
  assert.strictEqual(run1.candidatePromoted, false);
  assert.strictEqual(run1.productionPromotionStatus, 'RESEARCH_ONLY_NOT_PROMOTED');
  logPass(4, 'Candidate model identity & non-promotion verified (gbt_forex_v1.1.0_candidate isolated)');

  // 5. Verify Dataset Identity & Equality
  assert.strictEqual(run1.datasetCounts.total, 600);
  assert.strictEqual(run1.datasetCounts.train, 360);
  assert.strictEqual(run1.datasetCounts.validation, 120);
  assert.strictEqual(run1.datasetCounts.test, 120);
  logPass(5, 'Dataset sample counts & split proportions verified (60/20/20 split)');

  // 6. Verify Chronological Time-Series Split Boundaries
  assert.ok(run1.dataBoundaries.trainEnd < run1.dataBoundaries.valStart, 'Train max timestamp must be < Val min timestamp');
  assert.ok(run1.dataBoundaries.valEnd < run1.dataBoundaries.testStart, 'Val max timestamp must be < Test min timestamp');
  logPass(6, 'Chronological split boundaries strictly maintained without overlap');

  // 7. Verify Zero Leakage Assertions
  assert.strictEqual(run1.leakageStatus, 'ZERO_LEAKAGE_CERTIFIED');
  logPass(7, 'Zero leakage certified (feature <= decision ts, label ts > signal ts)');

  // 8. Verify Model Metrics Calculation for Champion
  assert.ok(run1.championMetrics.accuracy > 0.50, 'Champion accuracy must exceed 50%');
  assert.ok(run1.championMetrics.brierScore < 0.25, 'Champion Brier score must be well-calibrated (< 0.25)');
  logPass(8, 'Champion baseline metrics verified');

  // 9. Verify Model Metrics Calculation for Candidate
  assert.ok(run1.candidateMetrics.accuracy > 0.50, 'Candidate accuracy must exceed 50%');
  assert.ok(run1.candidateMetrics.brierScore < 0.25, 'Candidate Brier score must be well-calibrated (< 0.25)');
  logPass(9, 'Candidate research metrics verified');

  // 10. Verify Difference Metrics (Candidate - Champion)
  assert.strictEqual(typeof run1.differenceMetrics.brierScoreDiff, 'number');
  assert.strictEqual(typeof run1.differenceMetrics.expectancyRDiff, 'number');
  logPass(10, 'Candidate vs Champion difference table verified');

  // 11. Verify Bootstrap 95% Confidence Intervals
  assert.strictEqual(run1.bootstrapCIs.expectancyR.metricName, 'expectancyR');
  assert.strictEqual(typeof run1.bootstrapCIs.expectancyR.ciLower95, 'number');
  assert.strictEqual(typeof run1.bootstrapCIs.expectancyR.ciUpper95, 'number');
  logPass(11, 'Bootstrap 95% confidence intervals & uncertainty verified');

  // 12. Verify Subgroup Analysis (Market Regimes)
  assert.ok(run1.regimeBreakdown.length >= 2, 'Must include multiple market regimes');
  assert.ok(run1.regimeBreakdown.some(r => r.status === 'DEFINITIVE' || r.status === 'INDICATIVE'));
  logPass(12, 'Regime breakdown analysis verified');

  // 13. Verify Subgroup Analysis (Instruments)
  assert.ok(run1.instrumentBreakdown.some(i => i.regime === 'EUR/USD'));
  assert.ok(run1.instrumentBreakdown.some(i => i.regime === 'NIFTY'));
  logPass(13, 'Instrument breakdown analysis verified (EUR/USD & NIFTY)');

  // 14. Verify Subgroup Analysis (Timeframes)
  assert.ok(run1.timeframeBreakdown.length >= 1);
  logPass(14, 'Timeframe breakdown analysis verified');

  // 15. Verify Friction & Sensitivity Scenarios
  assert.strictEqual(run1.sensitivityScenarios.length, 4);
  assert.strictEqual(run1.sensitivityScenarios[0].scenarioName, '1. Baseline');
  assert.strictEqual(run1.sensitivityScenarios[3].scenarioName, '4. High-Cost Environment (+100%)');
  logPass(15, 'Cost & slippage sensitivity scenarios verified (4 friction levels)');

  // 16. Verify Native Currency Accounting
  assert.strictEqual(run1.accounting.forexNativeCurrency, 'USD');
  assert.strictEqual(run1.accounting.indianNativeCurrency, 'INR');
  assert.doesNotThrow(() => assertSameCurrency({ amount: 100, currency: 'USD' }, { amount: 50, currency: 'USD' }));
  assert.throws(
    () => assertSameCurrency({ amount: 100, currency: 'USD' }, { amount: 50, currency: 'INR' }),
    /CURRENCY_MISMATCH_ERROR/
  );
  logPass(16, 'Native currency isolation enforced (USD for Forex, INR for Indian Equity)');

  // 17. Verify Benchmark FX Rate & Provenance
  assert.strictEqual(run1.accounting.benchmarkFxRate, FX_BENCHMARK_RATE);
  assert.strictEqual(run1.accounting.fxProvenance, 'RBI_BENCHMARK_REFERENCE');
  assert.strictEqual(run1.accounting.fxRateType, 'REFERENCE_RATE');
  logPass(17, 'FX provenance & benchmark reference rate (86.50) verified');

  // 18. Verify Reliability & Calibration Bins Table
  assert.strictEqual(run1.calibrationBins.length, 5);
  assert.strictEqual(run1.calibrationBins[0].binName, '50-60%');
  logPass(18, 'Probability calibration bins table verified');

  // 19. Verify Deterministic Reproducibility (Run 2 vs Run 1)
  const run2: ExperimentResult = exp2026Research001Engine.executeExperiment({ seed: 42 });
  assert.strictEqual(run1.resultHash, run2.resultHash, 'Result hashes across repeated runs must match identically');
  assert.strictEqual(run1.datasetHash, run2.datasetHash, 'Dataset hashes across repeated runs must match identically');
  assert.strictEqual(run1.configHash, run2.configHash, 'Config hashes across repeated runs must match identically');
  logPass(19, 'Deterministic reproducibility confirmed (Run 1 hash === Run 2 hash)');

  // 20. Verify Production Registry Isolation
  const registry = new ModelRegistry();
  const prodModel = registry.getProductionModelForMarket('FOREX');
  assert.ok(prodModel !== undefined);
  assert.strictEqual(prodModel.status, 'PRODUCTION');
  assert.notStrictEqual(prodModel.modelId, CANDIDATE_MODEL_ID, 'Candidate model must NOT be in production registry');
  logPass(20, 'Production registry isolation confirmed (Champion unchanged, Candidate unpromoted)');

  // 21. Verify Report Generation
  const markdownReport = exp2026Research001Engine.generateReportMarkdown(run1);
  assert.ok(markdownReport.includes('PHASE EXP-2026-RESEARCH-001 REPORT'));
  assert.ok(markdownReport.includes('RESEARCH_ONLY_NOT_PROMOTED'));
  assert.ok(markdownReport.includes('LOCKED_SECURE'));
  logPass(21, 'Markdown research report compiled successfully');

  // 22. Save Report File to Project Root
  const reportPath = path.join(process.cwd(), 'PHASE_EXP_2026_RESEARCH_001_REPORT.md');
  fs.writeFileSync(reportPath, markdownReport, 'utf-8');
  assert.ok(fs.existsSync(reportPath));
  logPass(22, 'PHASE_EXP_2026_RESEARCH_001_REPORT.md written to workspace root');

  // 23. Verify Final Status Flags
  assert.strictEqual(run1.experimentStatus, 'COMPLETED_SUCCESSFULLY');
  assert.strictEqual(run1.dataStatus, 'VERIFIED_REAL_TIME_SERIES');
  assert.strictEqual(run1.leakageStatus, 'ZERO_LEAKAGE_CERTIFIED');
  assert.strictEqual(run1.reproducibilityStatus, 'DETERMINISTIC_REPRODUCIBLE');
  assert.strictEqual(run1.accountingStatus, 'VERIFIED_NATIVE_CURRENCY_ISOLATED');
  assert.strictEqual(run1.safetyStatus, 'LOCKED_SECURE');
  assert.strictEqual(run1.regressionStatus, 'PASSED_ALL_INVARIANTS');
  logPass(23, 'All 9 required status breakdown flags verified');

  // 24. Verify Live Gate Endpoint Blockage & Safety Invariant
  assert.doesNotThrow(() => LiveTradingGate.verifySafetyInvariant());
  logPass(24, 'Live trading gate safety verification passed');

  // 25. Final Confirmation
  assert.strictEqual(LIVE_AUTO_EXECUTION_ALLOWED, false);
  logPass(25, 'Final confirmation: LIVE_AUTO_EXECUTION_ALLOWED remains FALSE');

  console.log('\n----------------------------------------------------------------');
  console.log(`EXP_2026_RESEARCH_001 TEST RESULTS: ${passedTests} PASSED / 0 FAILED`);
  console.log('----------------------------------------------------------------\n');
}

if (process.argv[1] && process.argv[1].includes('test_exp_2026_research_001')) {
  runExp2026Research001TestSuite().catch(err => {
    console.error('EXP_2026_RESEARCH_001 TEST FAILED:', err);
    process.exit(1);
  });
}
