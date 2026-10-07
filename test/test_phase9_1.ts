// ============================================================================
// PHASE 9.1 TEST SUITE: INDEPENDENT PERFORMANCE VALIDATION & AUDIT
// 30 Adversarial Tests & Evidence Reconciliation Verification
// Critical Invariant: LIVE_AUTO_EXECUTION_ALLOWED === false
// ============================================================================

import { Phase91Certifier, Phase91AuditSummary } from '../src/demoExecution/phase9_1Certifier';
import { LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT } from '../src/demoExecution/types';

async function runPhase91TestSuite() {
  console.log('================================================================================');
  console.log('PHASE 9.1 — INDEPENDENT PERFORMANCE VALIDATION, MODEL GOVERNANCE & AUDIT');
  console.log('30-Case Adversarial Matrix & Independent Evidence Reconciliation');
  console.log('================================================================================\n');

  console.log('1. ABSOLUTE SAFETY INVARIANT CHECK:');
  console.log(`   LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT === false -> [${LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT === false ? 'VERIFIED LOCKED' : 'FAILED'}]`);

  if (LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT !== false) {
    console.error('FATAL: LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT IS NOT FALSE!');
    process.exit(1);
  }

  console.log('\n2. EXECUTING 30-CASE ADVERSARIAL AUDIT & RECONCILIATION SUITE...');
  const summary: Phase91AuditSummary = await Phase91Certifier.runIndependentAudit();

  console.log(`\n================================================================================`);
  console.log(`AUDIT RESULTS: ${summary.passedTests} / ${summary.totalTests} ADVERSARIAL TESTS PASSED (${summary.passRate.toFixed(1)}%)`);
  console.log(`DURATION: ${summary.durationMs} ms`);
  console.log(`================================================================================\n`);

  console.log('RECONCILIATION AUDIT SUMMARY:');
  console.log(` - Evaluated Signals : ${summary.reconciliationAudit.evaluatedSignals}`);
  console.log(` - Qualified Signals : ${summary.reconciliationAudit.qualifiedSignals}`);
  console.log(` - Rejected Signals  : ${summary.reconciliationAudit.rejectedSignals}`);
  console.log(` - Total Trades      : ${summary.reconciliationAudit.totalTrades}`);
  console.log(` - Gross P&L         : +$${summary.reconciliationAudit.grossPnl.toFixed(2)}`);
  console.log(` - Total Costs       : -$${summary.reconciliationAudit.totalCosts.toFixed(2)}`);
  console.log(` - Net P&L           : +$${summary.reconciliationAudit.netPnl.toFixed(2)}`);
  console.log(` - Win Rate          : ${summary.reconciliationAudit.winRatePct}%`);
  console.log(` - Profit Factor     : ${summary.reconciliationAudit.profitFactor}`);
  console.log(` - Expectancy        : $${summary.reconciliationAudit.expectancyUsd.toFixed(2)} / trade`);
  console.log(` - Max Drawdown      : ${summary.reconciliationAudit.maxDrawdownPct}%`);
  console.log(` - Reconciliation    : ${summary.reconciliationAudit.reconciliationMatchPct}% Match`);

  console.log('\nADVERSARIAL TEST LEDGER:');
  summary.results.forEach(r => {
    const statusTag = r.status === 'PASSED' ? '✓ PASS' : '✗ FAIL';
    console.log(` [${String(r.testId).padStart(2, '0')}] [${statusTag}] [${r.category.padEnd(26)}] ${r.testName} (${r.durationMs}ms)`);
    console.log(`      Anomaly:  ${r.injectedAnomaly}`);
    console.log(`      Outcome:  ${r.actualOutcome}`);
  });

  console.log('\n================================================================================');
  console.log('CLASSIFICATION MATRIX:');
  Object.entries(summary.classificationMatrix).forEach(([key, val]) => {
    console.log(`   - ${key.padEnd(28)} : ${val}`);
  });

  console.log('\n================================================================================');
  console.log('FINAL PHASE 9.1 STATUS STATEMENT:');
  console.log(`"${summary.statusStatement}"`);
  console.log('================================================================================\n');

  if (summary.failedTests > 0) {
    console.error(`FATAL: ${summary.failedTests} audit tests failed!`);
    process.exit(1);
  }

  process.exit(0);
}

runPhase91TestSuite().catch(err => {
  console.error('Fatal unhandled error during Phase 9.1 Test Suite:', err);
  process.exit(1);
});
