import { firstLiveService } from '../src/services/firstLiveService';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';
import { FivePaisaBrokerAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaBrokerAdapter';
import { liveTradingGate } from '../src/brokers/safety/LiveTradingGate';
import { executeRun, executeQuery, resetDatabaseInstanceForTesting, getDatabaseFilePaths } from '../src/database/db';
import fs from 'fs';
import path from 'path';

// Force isolation to test database
process.env.GOLDCREST_DB_FILE = 'data/test_first_live_certification.sqlite';
resetDatabaseInstanceForTesting();

// Global fetch mock to simulate 5paisa live broker responses
const originalFetch = global.fetch;
let mockFetchHandler: ((url: string, init?: any) => any) | null = null;

global.fetch = function (url: any, init: any) {
  if (mockFetchHandler) {
    try {
      return mockFetchHandler(String(url), init);
    } catch (err: any) {
      return Promise.reject(err);
    }
  }
  return Promise.resolve(new Response(JSON.stringify({})));
} as any;

async function runFirstLiveCertificationTests() {
  console.log('================================================================');
  console.log('   STARTING GOLDCREST NSE CONTROLLED FIRST LIVE CERTIFICATION TESTS');
  console.log('================================================================');

  // Verify production database is untouched
  const prodDbFile = path.join(process.cwd(), 'data', 'trading_analyst.sqlite');
  let originalProdSize = 0;
  if (fs.existsSync(prodDbFile)) {
    originalProdSize = fs.statSync(prodDbFile).size;
  }

  // Setup test environment
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

  const validOrderRequest = {
    market: 'INDIAN_OPTIONS',
    symbol: 'NIFTY26OCT23500CE',
    side: 'BUY' as const,
    orderType: 'LIMIT' as const,
    quantity: 25,
    price: 50
  };

  // ----------------------------------------------------------------
  // A & B & C. Arming Tests
  // ----------------------------------------------------------------
  console.log('\n[A-C] Testing Arming States & Safe Gating...');

  // A. Cannot arm without explicit confirmation
  const unconfirmedArm = await firstLiveService.armFirstLive({ confirmArm: false });
  if (unconfirmedArm.success) {
    throw new Error('FAILED: First-Live armed without explicit operator confirmation!');
  }
  console.log('  ✓ [A] Unconfirmed arming correctly rejected.');

  // B. Cannot arm during emergency stop
  await killSwitch.triggerEmergencyHalt('Simulated emergency halt for test');
  const haltedArm = await firstLiveService.armFirstLive({ confirmArm: true });
  if (haltedArm.success) {
    throw new Error('FAILED: First-Live armed while Emergency Stop active!');
  }
  console.log('  ✓ [B] Emergency Stop arming prevention verified.');
  killSwitch.resumeTrading();

  // C. Can arm exactly once
  const validArm = await firstLiveService.armFirstLive({ confirmArm: true, operatorNotes: 'Test operator arming' });
  if (!validArm.success) {
    throw new Error(`FAILED: Valid First-Live arming rejected: ${validArm.message}`);
  }
  const statusAfterArm = await firstLiveService.getStatus();
  if (statusAfterArm.executionMode !== 'FIRST_LIVE_CERTIFICATION' || !statusAfterArm.armed) {
    throw new Error('FAILED: Execution mode or armed flag not set correctly after arming!');
  }
  console.log('  ✓ [C] First-Live armed successfully.');

  // ----------------------------------------------------------------
  // D. Direct adapter call WITHOUT reservation while FIRST_LIVE_CERTIFICATION is active
  // ----------------------------------------------------------------
  console.log('\n[D] Testing Direct Adapter Placement Without Reservation...');
  const adapter = new FivePaisaLiveAdapter();
  adapter.getInstrument = async () => ({
    brokerInstrumentId: '12345',
    symbol: 'NIFTY26OCT23500CE',
    digits: 2
  } as any);
  
  // Set adapter credentials for mock connection
  (adapter as any).config = {
    appName: 'test-app',
    userId: 'test-user',
    userKey: 'test-key',
    encryptionKey: 'test-enc',
    accessToken: 'mock-token'
  };
  (adapter as any).status = 'CONNECTED';

  let directBypassCaught = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 50
    });
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED')) {
      directBypassCaught = true;
    }
  }

  if (!directBypassCaught) {
    throw new Error('FAILED: Direct placeOrder call WITHOUT reservation was not blocked by secondary interlock!');
  }
  console.log('  ✓ [D] Direct placeOrder call without reservation successfully blocked with FIRST_LIVE_ORDER_NOT_AUTHORIZED.');

  // ----------------------------------------------------------------
  // E & F. First-Live Reservation & Concurrent Safety
  // ----------------------------------------------------------------
  console.log('\n[E-F] Testing Reservation & Atomic Concurrency...');

  // E. First-Live reservation succeeds once
  const reservation1 = await firstLiveService.reserveFirstLiveOrder({
    correlationId: 'test-corr-success',
    idempotencyKey: 'test-idem-success',
    orderRequest: validOrderRequest
  });

  if (!reservation1.success || !reservation1.reservationToken) {
    throw new Error(`FAILED: Legitimate reservation failed: ${reservation1.message}`);
  }
  console.log('  ✓ [E] First-Live reservation succeeded once.');

  // F. Second concurrent reservation fails
  const reservation2 = await firstLiveService.reserveFirstLiveOrder({
    correlationId: 'test-corr-concurrent',
    idempotencyKey: 'test-idem-concurrent',
    orderRequest: validOrderRequest
  });

  if (reservation2.success) {
    throw new Error('FAILED: Second concurrent reservation succeeded! Concurrency leak detected.');
  }
  console.log('  ✓ [F] Second concurrent reservation rejected successfully (atomic reservation lock).');

  // ----------------------------------------------------------------
  // G. Reserved order passes adapter interlock
  // ----------------------------------------------------------------
  console.log('\n[G] Testing Reserved Order Adapter Interlock Verification...');

  // Set mock handler for successful place order HTTP call
  mockFetchHandler = (url, init) => {
    if (url.includes('PlaceOrderRequest')) {
      return Promise.resolve(new Response(JSON.stringify({
        head: { status: '0', statusDescription: 'Success' },
        body: { Status: 0, BrokerOrderID: '10000001', Message: 'Success' }
      })));
    }
    return Promise.resolve(new Response(JSON.stringify({})));
  };

  const allowedOrder = {
    ...validOrderRequest,
    firstLiveReservationToken: reservation1.reservationToken
  };

  const placedOrder = await adapter.placeOrder(allowedOrder);
  if (!placedOrder || placedOrder.status !== 'ACCEPTED') {
    throw new Error(`FAILED: Legitimate reserved order failed to pass the adapter interlock! Status: ${placedOrder?.status}`);
  }
  console.log('  ✓ [G] Legitimate reserved order with valid token successfully passed adapter interlock.');

  // Finalize reservation
  await firstLiveService.finalizeFirstLiveOrder({
    reservationToken: reservation1.reservationToken,
    status: 'FILLED',
    brokerOrderId: placedOrder.brokerOrderId
  });

  // ----------------------------------------------------------------
  // H & I. Broker Failure / Timeout Consumes Allowance
  // ----------------------------------------------------------------
  console.log('\n[H-I] Testing Broker Rejection / Failure Consumes Allowance...');

  // Reset to armed
  updateSystemConfig({
    executionMode: 'FIRST_LIVE_CERTIFICATION',
    firstLiveArmed: true,
    firstLiveOrdersSubmitted: 0,
    firstLiveLocked: false
  });
  await executeRun('DELETE FROM first_live_ledger');

  const reservationFail = await firstLiveService.reserveFirstLiveOrder({
    correlationId: 'test-corr-fail',
    idempotencyKey: 'test-idem-fail',
    orderRequest: validOrderRequest
  });

  if (!reservationFail.success || !reservationFail.reservationToken) {
    throw new Error('FAILED: Failed to arm/reserve for broker failure test.');
  }

  // Simulate broker HTTP exception / rejection
  mockFetchHandler = (url, init) => {
    throw new Error('Network timeout/Internal error');
  };

  let submissionErrorCaught = false;
  try {
    await adapter.placeOrder({
      ...validOrderRequest,
      firstLiveReservationToken: reservationFail.reservationToken
    });
  } catch (err) {
    submissionErrorCaught = true;
  }

  if (!submissionErrorCaught) {
    throw new Error('FAILED: Broker placement exception was not thrown.');
  }

  // Finalize as REJECTED/FAILED
  await firstLiveService.finalizeFirstLiveOrder({
    reservationToken: reservationFail.reservationToken,
    status: 'FAILED',
    error: 'Simulated broker connection failure'
  });

  // Re-read status to verify locked even on failure
  const statusAfterFail = await firstLiveService.getStatus();
  if (!statusAfterFail.locked || statusAfterFail.ordersSubmitted < 1) {
    throw new Error('FAILED: Allowance was not consumed upon broker submission failure!');
  }
  console.log('  ✓ [H-I] Broker timeout / failure correctly consumes the one allowance.');

  // ----------------------------------------------------------------
  // J. Post-Finalization Lock States
  // ----------------------------------------------------------------
  console.log('\n[J] Testing Post-Finalization Configuration Lock...');
  if (statusAfterFail.executionMode !== 'LIVE_DRY_RUN' || statusAfterFail.armed || !statusAfterFail.locked || statusAfterFail.ordersSubmitted !== 1) {
    throw new Error(`FAILED: Lock state post-finalization is incorrect: ${JSON.stringify(statusAfterFail)}`);
  }
  console.log('  ✓ [J] executionMode = LIVE_DRY_RUN, firstLiveArmed = false, firstLiveLocked = true, firstLiveOrdersSubmitted = 1 verified.');

  // ----------------------------------------------------------------
  // K. Second order attempt is rejected
  // ----------------------------------------------------------------
  console.log('\n[K] Testing Second Order Attempt Rejection...');
  const secondReservationAttempt = await firstLiveService.reserveFirstLiveOrder({
    correlationId: 'test-corr-second',
    idempotencyKey: 'test-idem-second',
    orderRequest: validOrderRequest
  });
  if (secondReservationAttempt.success) {
    throw new Error('FAILED: Able to obtain a second reservation when locked!');
  }
  console.log('  ✓ [K] Second order reservation correctly rejected while locked.');

  // ----------------------------------------------------------------
  // L. Restart/re-read preserves state
  // ----------------------------------------------------------------
  console.log('\n[L] Testing Lock State Persistence Across Re-read...');
  resetDatabaseInstanceForTesting();
  const reReadStatus = await firstLiveService.getStatus();
  if (!reReadStatus.locked || reReadStatus.ordersSubmitted !== 1) {
    throw new Error('FAILED: Lock state was not preserved across database reset/re-read.');
  }
  console.log('  ✓ [L] Persistent lock state correctly verified across re-read.');

  // ----------------------------------------------------------------
  // M. Production database remains untouched
  // ----------------------------------------------------------------
  console.log('\n[M] Verifying Production Database Is Completely Untouched...');
  if (fs.existsSync(prodDbFile)) {
    const finalProdSize = fs.statSync(prodDbFile).size;
    if (finalProdSize !== originalProdSize) {
      throw new Error(`FAILED: Production database file size changed during certification tests! Previous: ${originalProdSize}, New: ${finalProdSize}`);
    }
  }
  console.log('  ✓ [M] Production database remained pristine and completely untouched.');

  // Reset global fetch to normal
  global.fetch = originalFetch;

  console.log('\n================================================================');
  console.log('   ✓ ALL CONTROLLED FIRST LIVE CERTIFICATION TESTS PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

runFirstLiveCertificationTests().catch(err => {
  console.error('❌ FIRST LIVE CERTIFICATION TESTS FAILED:', err);
  process.exit(1);
});
