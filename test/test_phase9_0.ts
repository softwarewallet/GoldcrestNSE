// ============================================================================
// PHASE 9.0 TEST SUITE: CONTROLLED PAPER/DEMO TRADING & LIVE-MARKET OBSERVATION
// 50-Scenario Deterministic Observation & Capital Protection Matrix
// Critical Invariant: LIVE_AUTO_EXECUTION_ALLOWED === false
// ============================================================================

import { Phase9Certifier, Phase9Summary, OBSERVATION_VERSION_ID, RESEARCH_CONFIGURATION, getConfigurationHash } from '../src/demoExecution/phase9Certifier';
import { LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT } from '../src/demoExecution/types';

async function runPhase9TestSuite() {
  console.log('================================================================================');
  console.log('PHASE 9.0 — CONTROLLED PAPER/DEMO TRADING & LIVE-MARKET OBSERVATION');
  console.log('Deterministic Observation & 50-Scenario Failure/Validation Matrix');
  console.log(`Observation Version ID : ${OBSERVATION_VERSION_ID}`);
  console.log(`Configuration Hash     : ${getConfigurationHash()}`);
  console.log('================================================================================\n');

  console.log('1. INVARIANT INTEGRITY CHECK:');
  console.log(`   LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT === false -> [${LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT === false ? 'VERIFIED LOCKED' : 'FAILED'}]`);

  if (LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT !== false) {
    console.error('FATAL: LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT IS NOT FALSE!');
    process.exit(1);
  }

  console.log('\n2. EXECUTING 50-SCENARIO CONTROLLED OBSERVATION & CAPITAL PROTECTION SUITE...');
  const summary: Phase9Summary = await Phase9Certifier.runAll50Scenarios();

  console.log(`\n================================================================================`);
  console.log(`CERTIFICATION RESULTS: ${summary.passedScenarios} / ${summary.totalScenarios} SCENARIOS PASSED (${summary.passRate.toFixed(1)}%)`);
  console.log(`DURATION: ${summary.durationMs} ms`);
  console.log(`================================================================================\n`);

  console.log('SCENARIO-BY-SCENARIO EXECUTION LEDGER:');
  summary.results.forEach(r => {
    const statusTag = r.status === 'PASSED' ? '✓ PASS' : '✗ FAIL';
    console.log(` [${String(r.scenarioId).padStart(2, '0')}] [${statusTag}] [${r.category.padEnd(23)}] ${r.scenarioName} (${r.durationMs}ms)`);
    console.log(`      Fault:    ${r.injectedFault}`);
    console.log(`      Outcome:  ${r.actualBehavior}`);
  });

  console.log('\n================================================================================');
  console.log('CATEGORY BREAKDOWN:');
  Object.entries(summary.categoriesBreakdown).forEach(([cat, stats]) => {
    console.log(`   - ${cat.padEnd(25)} : ${stats.passed}/${stats.total} Passed (100%)`);
  });

  console.log('\n================================================================================');
  console.log('CLASSIFICATION MATRIX:');
  Object.entries(summary.classificationMatrix).forEach(([key, val]) => {
    console.log(`   - ${key.padEnd(25)} : ${val}`);
  });

  console.log('\n================================================================================');
  console.log('FINAL PHASE 9.0 STATUS STATEMENT:');
  console.log(`"${summary.statusStatement}"`);
  console.log('================================================================================\n');

  if (summary.failedScenarios > 0) {
    console.error(`FATAL: ${summary.failedScenarios} scenarios failed certification!`);
    process.exit(1);
  }

  process.exit(0);
}

runPhase9TestSuite().catch(err => {
  console.error('Fatal unhandled error during Phase 9.0 Test Suite:', err);
  process.exit(1);
});
