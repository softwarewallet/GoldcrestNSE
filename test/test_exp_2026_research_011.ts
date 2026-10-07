import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { Exp2026Research011Engine, EXPERIMENT_ID } from '../src/ml/experiments/exp2026Research011Engine.ts';
import { LIVE_AUTO_EXECUTION_ALLOWED } from '../src/governance/operationsResearchEngine.ts';

/**
 * PHASE EXP-2026-RESEARCH-011: FEATURE AUDIT TEST SUITE
 */
export async function runExp2026Research011TestSuite() {
  console.log('RUNNING EXP-2026-RESEARCH-011 FEATURE AUDIT TEST SUITE');

  const engine = new Exp2026Research011Engine();

  // 1. Safety Invariant Check
  assert.strictEqual(LIVE_AUTO_EXECUTION_ALLOWED, false, 'CRITICAL SAFETY VIOLATION: LIVE_AUTO_EXECUTION_ALLOWED is true.');
  console.log('[PASS] Safety invariant LOCKED (false)');

  // 2. Feature Inventory Completeness
  const dataset = engine.generateHistoricalReplayDataset(10);
  const featureNames = Object.keys(dataset[0].features);
  assert.ok(featureNames.length > 20, 'Feature inventory should be comprehensive (>20 features)');
  console.log(`[PASS] Feature inventory contains ${featureNames.length} features`);

  // 3. Determinism Check
  const dataset1 = engine.generateHistoricalReplayDataset(100);
  const dataset2 = engine.generateHistoricalReplayDataset(100);
  assert.strictEqual(JSON.stringify(dataset1), JSON.stringify(dataset2), 'Dataset generation must be deterministic');
  console.log('[PASS] Deterministic dataset generation');

  // 4. Execution Check
  const result = engine.executeAudit();
  assert.strictEqual(result.experimentId, EXPERIMENT_ID);
  assert.ok(result.featureAudits.length > 0, 'Should produce feature audits');
  assert.ok(result.groupAblations.length > 0, 'Should produce group ablations');
  console.log('[PASS] Audit execution successful');

  // 5. Report Verification
  const reportPath = path.join(process.cwd(), 'PHASE_EXP_2026_RESEARCH_011_REPORT.md');
  assert.ok(fs.existsSync(reportPath), 'Report file should be generated');
  console.log('[PASS] Report generation verified');

  console.log('ALL EXP-2026-RESEARCH-011 TESTS PASSED');
}

runExp2026Research011TestSuite().catch(err => {
  console.error('Test Failure:', err);
  process.exit(1);
});
