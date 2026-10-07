// ============================================================================
// TEST SCRIPT: Phase 9.2 Extended Unattended Operation & 60-Case Certification
// ============================================================================

import { Phase92Certifier } from '../src/demoExecution/phase9_2Certifier';

async function runPhase92Test() {
  console.log('================================================================');
  console.log('PHASE 9.2 — EXTENDED UNATTENDED OPERATION & RESILIENCE CERTIFICATION');
  console.log('================================================================\n');

  const audit = await Phase92Certifier.runExtendedUnattendedAudit();

  console.log(`[INFO] Release Candidate ID: ${audit.releaseCandidateId}`);
  console.log(`[INFO] Audit Version ID: ${audit.auditVersionId}`);
  console.log(`[INFO] Configuration Hash: ${audit.configurationHash}`);
  console.log(`[INFO] Model Hash: ${audit.modelHash}`);
  console.log(`[INFO] Observation Duration: ${audit.observationDurationHours} Hours`);
  console.log(`[INFO] Results: ${audit.passedTests} / ${audit.totalTests} Passed (${audit.passRate}%)\n`);

  let failedCount = 0;
  for (const r of audit.results) {
    if (r.status === 'PASSED') {
      console.log(`[PASS ${r.testId}/60] [${r.category}]: ${r.testName} (${r.durationMs}ms)`);
    } else {
      console.error(`[FAIL ${r.testId}/60] [${r.category}]: ${r.testName} - ${r.actualOutcome}`);
      failedCount++;
    }
  }

  console.log('\n================================================================');
  console.log(`FINAL STATUS: ${audit.statusStatement}`);
  console.log('================================================================');

  if (failedCount > 0 || !audit.liveAutoExecutionAllowedInvariant) {
    console.error(`\n❌ PHASE 9.2 CERTIFICATION FAILED: ${failedCount} tests failed.`);
    process.exit(1);
  } else {
    console.log('\n✅ PHASE 9.2 CERTIFICATION PASSED SUCCESSFULLY.');
    process.exit(0);
  }
}

runPhase92Test().catch(err => {
  console.error('Phase 9.2 test execution error:', err);
  process.exit(1);
});
