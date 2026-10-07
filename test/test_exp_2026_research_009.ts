import assert from 'assert';
import { Exp2026Research009Engine } from '../src/ml/experiments/exp2026Research009Engine.ts';
import { LIVE_AUTO_EXECUTION_ALLOWED } from '../src/governance/operationsResearchEngine.ts';

export async function runExp2026Research009TestSuite() {
  console.log('RUNNING EXP-2026-RESEARCH-009 CALIBRATION TRADING IMPACT TEST SUITE');

  const engine = new Exp2026Research009Engine();
  
  // Test 1: Monotonicity Audit
  // Realistic A/B values (A must be > 0 for monotonic increasing)
  const A = 1.25;
  const B = -0.15;
  const isMonotonic = engine.verifyMonotonicity(A, B);
  assert.strictEqual(isMonotonic, true, 'Platt transformation MUST be monotonic increasing');
  console.log('[PASS] Monotonicity audit');

  // Test 2: Probability Bounds
  const pCalibrated = engine.applyPlattScaling(0.5, A, B);
  assert.ok(pCalibrated >= 0.0 && pCalibrated <= 1.0, 'Calibrated probability must be in [0, 1]');
  console.log('[PASS] Probability bounds audit');

  // Test 3: Safety Invariant
  assert.strictEqual(LIVE_AUTO_EXECUTION_ALLOWED, false, 'Safety invariant violation');
  console.log('[PASS] Safety invariant locked');
  
  console.log('ALL EXP-2026-RESEARCH-009 TESTS PASSED');
}

runExp2026Research009TestSuite().catch(err => {
    console.error('Test failure:', err);
    process.exit(1);
});
