import assert from 'assert';
import { BrokerExecutionCertifier, CertificationSummary } from '../src/demoExecution/brokerExecutionCertifier';
import { demoExecutionEngine } from '../src/demoExecution/demoExecutionEngine';
import { LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT } from '../src/demoExecution/types';
import { PaperBrokerAdapter } from '../src/brokers/adapters/PaperBrokerAdapter';
import { CTraderDemoAdapter } from '../src/brokers/adapters/cTrader/CTraderDemoAdapter';
import { FivePaisaDemoAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaDemoAdapter';
import { reconciliationService } from '../src/services/reconciliationService';
import { PositionReconciliationEngine } from '../src/governance/reconciliationEngine';
import { firestoreTradeTraceService } from '../src/services/firestoreTradeTraceService';

export async function runPhase8_5TestSuite() {
  console.log('================================================================');
  console.log(' PHASE 8.5 — CONTROLLED BROKER EXECUTION, ORDER LIFECYCLE & RECONCILIATION CERTIFICATION');
  console.log('================================================================\n');

  console.log('[INIT] Executing 40 deep certification and failure-injection scenarios...');
  const summary: CertificationSummary = await BrokerExecutionCertifier.runAll40CertificationScenarios();

  console.log(`[INFO] Certification completed in ${summary.durationMs}ms`);
  console.log(`[INFO] Results: ${summary.passedTests} / ${summary.totalTests} Passed (${summary.passRate}%)\n`);

  let index = 0;
  for (const res of summary.results) {
    index++;
    assert.strictEqual(
      res.status,
      'PASSED',
      `Test ${res.testId} (${res.testName}) failed: ${res.details}`
    );
    console.log(`[PASS ${index}/${summary.totalTests}] Phase 8.5 Test ${res.testId} [${res.group}]: ${res.testName} (${res.durationMs}ms)`);
  }

  // High-Level Invariant Assertions
  assert.strictEqual(summary.totalTests, 40, 'Must contain exactly 40 certification scenarios');
  assert.strictEqual(summary.passedTests, 40, 'All 40 scenarios must pass');
  assert.strictEqual(summary.failedTests, 0, 'Zero failures allowed');
  assert.strictEqual(summary.liveAutoExecutionAllowedInvariant, false, 'LIVE_AUTO_EXECUTION_ALLOWED must remain false');
  assert.strictEqual(summary.zeroLiveOrdersConfirmed, true, 'Must confirm zero live money orders');
  assert.strictEqual(summary.zeroCredentialLeaksConfirmed, true, 'Must confirm zero credential leaks');
  assert.strictEqual(summary.reconciliationIntegrityConfirmed, true, 'Must confirm 3-way reconciliation integrity');

  // Verify group counts
  const groupCounts: Record<string, number> = {};
  for (const r of summary.results) {
    groupCounts[r.group] = (groupCounts[r.group] || 0) + 1;
  }
  assert.strictEqual(groupCounts['PRE_ORDER_SAFETY'], 8, 'Group 1 must contain 8 tests');
  assert.strictEqual(groupCounts['EXECUTION_LIFECYCLE'], 8, 'Group 2 must contain 8 tests');
  assert.strictEqual(groupCounts['POSITION_AND_EXITS'], 8, 'Group 3 must contain 8 tests');
  assert.strictEqual(groupCounts['RECONCILIATION'], 8, 'Group 4 must contain 8 tests');
  assert.strictEqual(groupCounts['FAILURE_AND_ISOLATION'], 8, 'Group 5 must contain 8 tests');

  console.log('\n================================================================');
  console.log(' ALL 40/40 PHASE 8.5 CERTIFICATION TESTS PASSED SUCCESSFULLY');
  console.log(' - Invariant LIVE_AUTO_EXECUTION_ALLOWED === false certified');
  console.log(' - PAPER, cTrader DEMO & 5paisa SANDBOX execution certified');
  console.log(' - 3-Way Reconciliation & Firebase Lineage certified');
  console.log('================================================================\n');
}

// Auto-run if executed directly via tsx
runPhase8_5TestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Phase 8.5 Test Suite Failure:', err);
  process.exit(1);
});
