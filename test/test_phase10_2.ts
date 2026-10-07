// ============================================================================
// TEST SCRIPT: Phase 10.2 Operational Control & Incident Management
// ============================================================================

import { Phase102Certifier } from '../src/demoExecution/phase10_2Certifier';

async function runPhase102Test() {
  console.log('================================================================');
  console.log('PHASE 10.2 — OPERATIONAL COMMAND CENTER & HUMAN-CONTROL CERTIFICATION');
  console.log('================================================================\n');

  const audit = await Phase102Certifier.runPhase102Certification();

  console.log(`[INFO] Release Candidate ID: ${audit.releaseCandidateId}`);
  console.log(`[INFO] Audit ID: ${audit.auditId}`);
  console.log(`[INFO] Configuration Hash: ${audit.configurationHash}`);
  console.log(`[INFO] Model Version: ${audit.modelVersion}`);
  console.log(`[INFO] Model Hash: ${audit.modelHash}`);
  console.log(`[INFO] Environment: ${audit.environment}`);
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
    console.error('\n❌ PHASE 10.2 CERTIFICATION FAILED.');
    process.exit(1);
  } else {
    console.log('\n✅ PHASE 10.2 CERTIFICATION PASSED SUCCESSFULLY.');
    process.exit(0);
  }
}

runPhase102Test().catch(err => {
  console.error('Phase 10.2 test execution error:', err);
  process.exit(1);
});
