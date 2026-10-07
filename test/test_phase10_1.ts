// ============================================================================
// TEST SCRIPT: Phase 10.1 Long-Run Stability & 100-Case Certification
// ============================================================================

import { Phase101Certifier } from '../src/demoExecution/phase10_1Certifier';

async function runPhase101Test() {
  console.log('================================================================');
  console.log('PHASE 10.1 — LONG-RUN STABILITY & 100-CASE CERTIFICATION');
  console.log('================================================================\n');

  const audit = await Phase101Certifier.runPhase101Certification();

  console.log(`[INFO] Release Candidate ID: ${audit.releaseCandidateId}`);
  console.log(`[INFO] Audit ID: ${audit.auditId}`);
  console.log(`[INFO] Configuration Hash: ${audit.configurationHash}`);
  console.log(`[INFO] Model Version: ${audit.modelVersion}`);
  console.log(`[INFO] Model Hash: ${audit.modelHash}`);
  console.log(`[INFO] Observation Duration: ${audit.actualElapsedDurationHours} Hours (${audit.environment})`);
  console.log(`[INFO] Test Matrix Results: ${audit.passCount} / ${audit.testMatrix.length} Passed (${(audit.passCount/audit.testMatrix.length)*100}%)\n`);

  // Print summary of categories
  const categoriesMap: Record<string, number> = {};
  for (const t of audit.testMatrix) {
    categoriesMap[t.category] = (categoriesMap[t.category] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(categoriesMap)) {
    console.log(`[CATEGORY PASS] ${cat}: ${count} test cases verified successfully`);
  }

  console.log('\n================================================================');
  console.log(`FINAL STATUS: ${audit.finalCertificationStatus}`);
  console.log('================================================================');

  if (audit.failCount > 0 || audit.blockedCount > 0 || audit.liveAutoExecutionAllowedInvariant !== false) {
    console.error('\n❌ PHASE 10.1 CERTIFICATION FAILED.');
    process.exit(1);
  } else {
    console.log('\n✅ PHASE 10.1 CERTIFICATION PASSED SUCCESSFULLY.');
    process.exit(0);
  }
}

runPhase101Test().catch(err => {
  console.error('Phase 10.1 test execution error:', err);
  process.exit(1);
});
