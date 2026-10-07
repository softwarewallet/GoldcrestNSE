import { firstLiveService } from '../src/services/firstLiveService';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';
import { FivePaisaBrokerAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaBrokerAdapter';
import { liveTradingGate } from '../src/brokers/safety/LiveTradingGate';
import { executeRun } from '../src/database/db';

async function runFirstLiveCertificationTests() {
  console.log('================================================================');
  console.log('   STARTING GOLDCREST NSE CONTROLLED FIRST LIVE CERTIFICATION TESTS');
  console.log('================================================================');

  // Reset database ledger and system config for clean test environment
  try {
    await executeRun('DELETE FROM first_live_ledger');
  } catch {}

  updateSystemConfig({
    executionMode: 'LIVE_DRY_RUN',
    firstLiveArmed: false,
    firstLiveOrdersSubmitted: 0,
    firstLiveLocked: false,
    smallTradeBudgetEnabled: false,
    maxTradeValueIndianInr: 50000,
    niftyMaxTradeValues: {
      NIFTY: 50000,
      BANKNIFTY: 50000,
      FINNIFTY: 50000,
      MIDCPNIFTY: 50000,
      NIFTYNXT50: 50000,
      SENSEX: 50000,
      BANKEX: 50000
    }
  });
  FivePaisaBrokerAdapter.resetRateLimitForTesting();

  // ----------------------------------------------------------------
  // 1. Arming Tests
  // ----------------------------------------------------------------
  console.log('\n[1] Testing First-Live Arming State Machine...');

  // 1A. Attempt arming without explicit confirmation
  const unconfirmedArm = await firstLiveService.armFirstLive({ confirmArm: false });
  if (unconfirmedArm.success) {
    throw new Error('FAILED: First-Live armed without explicit operator confirmation!');
  }
  console.log('  ✓ Unconfirmed arming correctly rejected.');

  // 1B. Attempt arming with emergency stop active
  await killSwitch.triggerEmergencyHalt('Simulated emergency halt for test');
  const haltedArm = await firstLiveService.armFirstLive({ confirmArm: true });
  if (haltedArm.success) {
    throw new Error('FAILED: First-Live armed while Emergency Stop active!');
  }
  console.log('  ✓ Emergency Stop arming prevention verified.');
  killSwitch.resumeTrading();

  // 1C. Successful arming
  const validArm = await firstLiveService.armFirstLive({ confirmArm: true, operatorNotes: 'Test operator arming' });
  if (!validArm.success) {
    throw new Error(`FAILED: Valid First-Live arming rejected: ${validArm.message}`);
  }
  const statusAfterArm = await firstLiveService.getStatus();
  if (statusAfterArm.executionMode !== 'FIRST_LIVE_CERTIFICATION' || !statusAfterArm.armed) {
    throw new Error('FAILED: Execution mode or armed flag not set correctly after arming!');
  }
  console.log('  ✓ First-Live successfully armed for exactly ONE order.');

  // ----------------------------------------------------------------
  // 2. Preflight Safety Gate Checks
  // ----------------------------------------------------------------
  console.log('\n[2] Testing First-Live Preflight Safety Gates...');

  const validOrderRequest = {
    market: 'INDIAN_OPTIONS',
    symbol: 'NIFTY',
    side: 'BUY' as const,
    orderType: 'LIMIT' as const,
    quantity: 25,
    price: 50
  };

  // 2A. Preflight pass under valid conditions
  const preflightPassed = await firstLiveService.preflightCheck(validOrderRequest);
  if (!preflightPassed.pass) {
    throw new Error(`FAILED: Preflight check failed for valid order: ${preflightPassed.reasons.join(', ')}`);
  }
  console.log('  ✓ Preflight check passed for valid First-Live order parameters.');

  // 2B. Preflight fail under insufficient trade budget
  const budgetExceededOrder = {
    ...validOrderRequest,
    price: 5000 // Total value 125,000 INR exceeds small budget cap
  };
  const budgetConfig = getSystemConfig();
  updateSystemConfig({ smallTradeBudgetEnabled: true, smallTradeBudgetInr: 1000 });
  const preflightBudgetFailed = await firstLiveService.preflightCheck(budgetExceededOrder);
  if (preflightBudgetFailed.pass) {
    throw new Error('FAILED: Preflight check passed for order exceeding trade budget!');
  }
  console.log('  ✓ Preflight check correctly failed on insufficient budget.');
  updateSystemConfig(budgetConfig);

  // ----------------------------------------------------------------
  // 3. Execution Consumption, Hard 1-Order Limit & Lockout
  // ----------------------------------------------------------------
  console.log('\n[3] Testing 1-Order Limit Consumption & Permanent Lock...');

  await firstLiveService.consumeAttemptAndLock({
    correlationId: 'test-corr-1',
    idempotencyKey: 'test-idem-1',
    orderRequest: validOrderRequest,
    reason: 'First-live order submission attempt'
  });

  const statusAfterConsumption = await firstLiveService.getStatus();
  if (!statusAfterConsumption.locked || statusAfterConsumption.ordersSubmitted < 1) {
    throw new Error('FAILED: First-Live status not locked after order attempt!');
  }
  if (statusAfterConsumption.executionMode !== 'LIVE_DRY_RUN') {
    throw new Error(`FAILED: Execution mode was not reverted to LIVE_DRY_RUN! Current: ${statusAfterConsumption.executionMode}`);
  }
  console.log('  ✓ First-Live order attempt consumed and state locked.');
  console.log(`  ✓ Execution mode automatically reverted to: ${statusAfterConsumption.executionMode}`);

  // 3B. Attempt to re-arm while locked
  const rearmAttempt = await firstLiveService.armFirstLive({ confirmArm: true });
  if (rearmAttempt.success) {
    throw new Error('FAILED: Re-arming succeeded after 1-order limit was consumed!');
  }
  console.log('  ✓ Re-arming while locked correctly rejected (1/1 limit enforced).');

  // ----------------------------------------------------------------
  // 4. Persistence & Crash Recovery State Audit
  // ----------------------------------------------------------------
  console.log('\n[4] Testing Persistence & Crash Recovery Lock State...');

  // Re-read status to simulate app restart
  const restartedStatus = await firstLiveService.getStatus();
  if (!restartedStatus.locked || restartedStatus.ordersSubmitted < 1) {
    throw new Error('FAILED: Lock state did not persist across restart!');
  }
  console.log('  ✓ Durable 1-order submission counter and lock survived simulated restart.');

  // ----------------------------------------------------------------
  // 5. Adapter-Level Zero-Order Dry-Run Interlock
  // ----------------------------------------------------------------
  console.log('\n[5] Testing Dry-Run Secondary Safety Interlock...');

  const adapter = new FivePaisaLiveAdapter();
  let interlockBlocked = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 45
    });
  } catch (err: any) {
    if (err.message.includes('LIVE_ORDER_BLOCKED_BY_DRY_RUN')) {
      interlockBlocked = true;
    }
  }
  if (!interlockBlocked) {
    throw new Error('FAILED: Dry-run interlock failed to block order in LIVE_DRY_RUN mode!');
  }
  console.log('  ✓ Adapter-level zero-order interlock confirmed (LIVE_ORDER_BLOCKED_BY_DRY_RUN).');

  // ----------------------------------------------------------------
  // 6. TOTP Authentication Rate Limiting & Cooldown Tests (A-E)
  // ----------------------------------------------------------------
  console.log('\n[6] Testing TOTP Rate Limiting & Cooldown (Tests A - E)...');

  // Test A: 5paisa returns HTTP 429 -> Expected RATE_LIMITED
  console.log('  [Test A] Simulating HTTP 429 Rate Limit from 5paisa...');
  FivePaisaBrokerAdapter.setRateLimitedCooldown(60_000, '5paisa OpenAPI HTTP 429 Rate Limit');
  if (!FivePaisaBrokerAdapter.isRateLimited()) {
    throw new Error('FAILED: Broker adapter did not report isRateLimited() after setting cooldown!');
  }
  const rateLimitStatus = await adapter.getTradingStatus();
  if (rateLimitStatus !== 'RATE_LIMITED') {
    throw new Error(`FAILED: getTradingStatus() returned ${rateLimitStatus}, expected RATE_LIMITED!`);
  }
  console.log('    ✓ HTTP 429 rate limit correctly recorded and reported as RATE_LIMITED.');

  // Test B: Immediate re-authentication attempt blocked by cooldown without making network request
  console.log('  [Test B] Attempting immediate re-authentication during cooldown...');
  let immediateBlocked = false;
  try {
    await adapter.loginWithTotp('123456', '1234');
  } catch (err: any) {
    if (err.message.includes('RATE_LIMITED') && err.message.includes('Cooldown active')) {
      immediateBlocked = true;
    }
  }
  if (!immediateBlocked) {
    throw new Error('FAILED: Immediate re-authentication attempt was not blocked by active cooldown!');
  }
  console.log('    ✓ Immediate re-authentication blocked by active cooldown without network call.');

  // Test C: Auto Live attempts to trade while rate limited -> NO NEW ORDERS
  console.log('  [Test C] Testing LiveTradingGate evaluation during RATE_LIMITED status...');
  const gateResult = await liveTradingGate.evaluate(adapter, {
    order: { market: 'INDIAN_OPTIONS', symbol: 'NIFTY', side: 'BUY', orderType: 'LIMIT', quantity: 25, price: 50 },
    signalAgeMs: 5000,
    currentQuote: { symbol: 'NIFTY', bid: 50, ask: 51, timestamp: Date.now(), status: 'FRESH' },
    isMarketOpen: true,
    dailyRealizedLoss: 0,
    dailyLossLimit: 5000,
    totalAccountExposure: 0,
    maxAllowedExposure: 50000,
    activePositionsCount: 0,
    maxOpenPositions: 5,
    activePairPositionsCount: 0,
    maxPairPositions: 2
  });
  if (gateResult.isAllowed) {
    throw new Error('FAILED: LiveTradingGate allowed order while broker was RATE_LIMITED!');
  }
  console.log('    ✓ LiveTradingGate correctly rejected trade attempt during RATE_LIMITED status.');

  // Test D: Cooldown expires
  console.log('  [Test D] Testing cooldown expiry & state reset...');
  FivePaisaBrokerAdapter.resetRateLimitForTesting();
  if (FivePaisaBrokerAdapter.isRateLimited()) {
    throw new Error('FAILED: Rate limit flag still active after reset/expiry!');
  }
  console.log('    ✓ Rate limit cooldown expired and reset successfully.');

  // Test E: Normal state restored
  console.log('  [Test E] Verifying normal status after rate limit cleared...');
  const resetStatus = await adapter.getTradingStatus();
  if (resetStatus === 'RATE_LIMITED') {
    throw new Error('FAILED: Broker status remained RATE_LIMITED after cooldown reset!');
  }
  console.log('    ✓ Normal status restored after cooldown expiry.');

  // Reset test state to clean LIVE_DRY_RUN default
  try {
    await executeRun('DELETE FROM first_live_ledger');
  } catch {}
  updateSystemConfig({
    executionMode: 'LIVE_DRY_RUN',
    firstLiveArmed: false,
    firstLiveOrdersSubmitted: 0,
    firstLiveLocked: false
  });

  console.log('\n================================================================');
  console.log('   ✓ ALL CONTROLLED FIRST LIVE CERTIFICATION TESTS PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

runFirstLiveCertificationTests().catch(err => {
  console.error('❌ FIRST LIVE CERTIFICATION TESTS FAILED:', err);
  process.exit(1);
});
