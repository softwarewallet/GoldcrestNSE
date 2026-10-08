import crypto from 'crypto';
import { firstLiveService, hashReservationToken, generateFirstLiveFingerprint } from '../src/services/firstLiveService';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';
import { FivePaisaBrokerAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaBrokerAdapter';
import { liveTradingGate } from '../src/brokers/safety/LiveTradingGate';
import { brokerRegistry } from '../src/brokers/registry';
import { executeRun, executeQuery, executeTransaction, resetDatabaseInstanceForTesting } from '../src/database/db';
import fs from 'fs';
import path from 'path';

// Force isolation to test database
const TEST_DB_PATH = 'data/test_first_live_certification.sqlite';
process.env.GOLDCREST_DB_FILE = TEST_DB_PATH;
resetDatabaseInstanceForTesting();

// Global fetch mock to simulate 5paisa live broker responses and track calls
const originalFetch = global.fetch;
let fetchCallsCount = 0;
let mockFetchHandler: ((url: string, init?: any) => any) | null = null;

global.fetch = function (url: any, init: any) {
  fetchCallsCount++;
  if (mockFetchHandler) {
    try {
      return mockFetchHandler(String(url), init);
    } catch (err: any) {
      return Promise.reject(err);
    }
  }
  return Promise.resolve(new Response(JSON.stringify({})));
} as any;

function calculateFileHash(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

async function runFirstLiveCertificationTests() {
  console.log('================================================================');
  console.log('   STARTING GOLDCREST NSE CONTROLLED FIRST LIVE CERTIFICATION TESTS');
  console.log('================================================================');

  // Locate and hash production database files before running tests
  const prodDbFile = path.join(process.cwd(), 'data', 'trading_analyst.sqlite');
  const prodTmpFile = `${prodDbFile}.tmp`;
  const prodBakFile = `${prodDbFile}.bak`;

  const preProdHash = calculateFileHash(prodDbFile);
  const preTmpHash = calculateFileHash(prodTmpFile);
  const preBakHash = calculateFileHash(prodBakFile);

  console.log('[Database Isolation] Production DB Hash:', preProdHash || 'Not Exist');

  // Setup test environment
  try {
    await executeRun('DELETE FROM first_live_ledger');
  } catch {}

  await executeRun("UPDATE system_settings SET value = 'LIVE_DRY_RUN' WHERE key = 'EXECUTION_MODE'");
  await executeRun("UPDATE system_settings SET value = 'false' WHERE key = 'FIRST_LIVE_ARMED'");
  await executeRun("UPDATE system_settings SET value = '0' WHERE key = 'FIRST_LIVE_ORDERS_SUBMITTED'");
  await executeRun("UPDATE system_settings SET value = 'false' WHERE key = 'FIRST_LIVE_LOCKED'");

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
  brokerRegistry.registerAdapter(adapter);

  fetchCallsCount = 0;
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
  if (fetchCallsCount > 0) {
    throw new Error(`FAILED: Secondary interlock made broker network calls on authorization failure! Count: ${fetchCallsCount}`);
  }
  console.log('  ✓ [D] Direct placeOrder call without reservation successfully blocked with 0 broker calls.');

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
  
  // Assert reservation token is cryptographic secure (long string)
  if (reservation1.reservationToken.length < 50 || !reservation1.reservationToken.startsWith('fl-res-')) {
    throw new Error(`FAILED: Reservation token is not cryptographically secure: ${reservation1.reservationToken}`);
  }
  console.log('  ✓ [E] First-Live reservation succeeded once with cryptographic token.');

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
  // Direct Adapter Safety & Mismatch Regression Tests (Sections 4 & 12)
  // ----------------------------------------------------------------
  console.log('\n[Mismatch Regression Tests] Verifying Strong Binding & Zero Broker Calls...');

  // TEST 1 — Wrong Symbol
  fetchCallsCount = 0;
  let test1Caught = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23600CE', // Reservation symbol was NIFTY26OCT23500CE
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 50,
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('symbol mismatch')) {
      test1Caught = true;
    } else {
      console.warn('Test 1 caught unexpected error:', err.message);
    }
  }
  if (!test1Caught) throw new Error('FAILED TEST 1: Allowed placeOrder with wrong symbol!');
  if (fetchCallsCount > 0) throw new Error('FAILED TEST 1: Network call made on symbol mismatch!');
  console.log('  ✓ TEST 1: Wrong Symbol blocked cleanly with 0 broker calls.');

  // TEST 2 — Wrong Side
  fetchCallsCount = 0;
  let test2Caught = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'SELL', // Reservation side was BUY
      orderType: 'LIMIT',
      quantity: 25,
      price: 50,
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('side mismatch')) {
      test2Caught = true;
    }
  }
  if (!test2Caught) throw new Error('FAILED TEST 2: Allowed placeOrder with wrong side!');
  if (fetchCallsCount > 0) throw new Error('FAILED TEST 2: Network call made on side mismatch!');
  console.log('  ✓ TEST 2: Wrong Side blocked cleanly with 0 broker calls.');

  // TEST 3 — Wrong Quantity
  fetchCallsCount = 0;
  let test3Caught = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 50, // Reservation quantity was 25
      price: 50,
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('quantity mismatch')) {
      test3Caught = true;
    }
  }
  if (!test3Caught) throw new Error('FAILED TEST 3: Allowed placeOrder with wrong quantity!');
  if (fetchCallsCount > 0) throw new Error('FAILED TEST 3: Network call made on quantity mismatch!');
  console.log('  ✓ TEST 3: Wrong Quantity blocked cleanly with 0 broker calls.');

  // TEST 4 — Wrong Idempotency Key
  fetchCallsCount = 0;
  let test4Caught = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 50,
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-different', // Reservation key was test-idem-success
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('idempotency key mismatch')) {
      test4Caught = true;
    }
  }
  if (!test4Caught) throw new Error('FAILED TEST 4: Allowed placeOrder with wrong idempotency key!');
  if (fetchCallsCount > 0) throw new Error('FAILED TEST 4: Network call made on idempotency mismatch!');
  console.log('  ✓ TEST 4: Wrong Idempotency Key blocked cleanly with 0 broker calls.');

  // TEST 5 — Invalid/Tampered Token
  fetchCallsCount = 0;
  let test5Caught = false;
  const tamperedToken = reservation1.reservationToken.slice(0, -3) + 'XYZ';
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 50,
      firstLiveReservationToken: tamperedToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('invalid')) {
      test5Caught = true;
    }
  }
  if (!test5Caught) throw new Error('FAILED TEST 5: Allowed placeOrder with tampered token!');
  if (fetchCallsCount > 0) throw new Error('FAILED TEST 5: Network call made on tampered token!');
  console.log('  ✓ TEST 5: Invalid/Tampered Token blocked cleanly with 0 broker calls.');

  // TEST 7 — Price/Fingerprint Mismatch
  fetchCallsCount = 0;
  let test7Caught = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 100, // Reservation price was 50 (mismatch triggers fingerprint mismatch!)
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('fingerprint mismatch')) {
      test7Caught = true;
    } else {
      console.warn('Test 7 caught unexpected error:', err.message);
    }
  }
  if (!test7Caught) throw new Error('FAILED TEST 7: Allowed placeOrder with wrong price (fingerprint mismatch)!');
  if (fetchCallsCount > 0) throw new Error('FAILED TEST 7: Network call made on fingerprint mismatch!');
  console.log('  ✓ TEST 7: Fingerprint/Price Mismatch blocked cleanly with 0 broker calls.');

  // TEST 8 — Wrong Market
  fetchCallsCount = 0;
  let test8Caught = false;
  try {
    await adapter.placeOrder({
      market: 'FOREX', // Reservation market was INDIAN_OPTIONS
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 50,
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('fingerprint mismatch')) {
      test8Caught = true;
    }
  }
  if (!test8Caught) throw new Error('FAILED TEST 8: Allowed placeOrder with wrong market!');
  console.log('  ✓ TEST 8: Wrong Market blocked cleanly.');

  // TEST 9 — Wrong OrderType
  fetchCallsCount = 0;
  let test9Caught = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'MARKET', // Reservation orderType was LIMIT
      quantity: 25,
      price: 50,
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('fingerprint mismatch')) {
      test9Caught = true;
    }
  }
  if (!test9Caught) throw new Error('FAILED TEST 9: Allowed placeOrder with wrong orderType!');
  console.log('  ✓ TEST 9: Wrong OrderType blocked cleanly.');

  // TEST 10 — Wrong Correlation ID
  fetchCallsCount = 0;
  let test10Caught = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 50,
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-wrong' // Reservation correlation_id was test-corr-success
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('correlation ID mismatch')) {
      test10Caught = true;
    }
  }
  if (!test10Caught) throw new Error('FAILED TEST 10: Allowed placeOrder with wrong correlation ID!');
  console.log('  ✓ TEST 10: Wrong Correlation ID blocked cleanly.');

  // TEST 11 — Optional Field Injection (SL absent -> attacker supplies SL)
  fetchCallsCount = 0;
  let test11Caught = false;
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 50,
      stopLoss: 10, // reservation had stopLoss: undefined
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('stopLoss mismatch')) {
      test11Caught = true;
    }
  }
  if (!test11Caught) throw new Error('FAILED TEST 11: Allowed placeOrder with optional field injection!');
  console.log('  ✓ TEST 11: Optional Field Injection blocked cleanly.');

  // TEST 12 — Missing Fingerprint in Database
  fetchCallsCount = 0;
  let test12Caught = false;
  const tokenHash = hashReservationToken(reservation1.reservationToken);
  const origFingerprintRow = await executeQuery<any>("SELECT fingerprint FROM first_live_ledger WHERE id = ?", [tokenHash]);
  const originalFingerprint = origFingerprintRow[0]?.fingerprint;
  // Nullify fingerprint inside the database
  await executeRun("UPDATE first_live_ledger SET fingerprint = NULL WHERE id = ?", [tokenHash]);
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 50,
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('Fingerprint is missing')) {
      test12Caught = true;
    }
  }
  if (!test12Caught) throw new Error('FAILED TEST 12: Allowed placeOrder with missing fingerprint in DB!');
  console.log('  ✓ TEST 12: Missing Fingerprint blocked cleanly (fail-closed).');

  // TEST 13 — Malformed Fingerprint in Database
  fetchCallsCount = 0;
  let test13Caught = false;
  // Set malformed fingerprint in DB
  await executeRun("UPDATE first_live_ledger SET fingerprint = 'short-malformed' WHERE id = ?", [tokenHash]);
  try {
    await adapter.placeOrder({
      market: 'INDIAN_OPTIONS',
      symbol: 'NIFTY26OCT23500CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 50,
      firstLiveReservationToken: reservation1.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-success',
      _firstLiveCorrelationId: 'test-corr-success'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('Fingerprint is missing or malformed')) {
      test13Caught = true;
    }
  }
  if (!test13Caught) throw new Error('FAILED TEST 13: Allowed placeOrder with malformed fingerprint in DB!');
  console.log('  ✓ TEST 13: Malformed Fingerprint blocked cleanly (fail-closed).');

  // Restore the correct fingerprint for subsequent tests
  await executeRun("UPDATE first_live_ledger SET fingerprint = ? WHERE id = ?", [originalFingerprint, tokenHash]);

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
    firstLiveReservationToken: reservation1.reservationToken,
    _firstLiveIdempotencyKey: 'test-idem-success',
    _firstLiveCorrelationId: 'test-corr-success'
  };

  fetchCallsCount = 0;
  const placedOrder = await adapter.placeOrder(allowedOrder);
  if (!placedOrder || placedOrder.status !== 'ACCEPTED') {
    throw new Error(`FAILED: Legitimate reserved order failed to pass the adapter interlock! Status: ${placedOrder?.status}`);
  }
  if (fetchCallsCount === 0) {
    throw new Error('FAILED: Broker network call was not made for valid reservation!');
  }
  console.log('  ✓ [G] Legitimate reserved order with valid token successfully passed adapter interlock.');

  // Finalize reservation
  await firstLiveService.finalizeFirstLiveOrder({
    reservationToken: reservation1.reservationToken,
    status: 'FILLED',
    brokerOrderId: placedOrder.brokerOrderId
  });

  // TEST 6 — Reused Finalized Token (Section 3 & 4)
  console.log('\n[Test Replay] Testing Reused Finalized Token rejection...');
  fetchCallsCount = 0;
  let test6Caught = false;
  try {
    await adapter.placeOrder(allowedOrder); // Same correct order payload and token, but reservation is now finalized/FILLED
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('finalized/consumed')) {
      test6Caught = true;
    }
  }
  if (!test6Caught) throw new Error('FAILED TEST 6: Allowed reuse of finalized token!');
  if (fetchCallsCount > 0) throw new Error('FAILED TEST 6: Network call made during finalized token reuse!');
  console.log('  ✓ TEST 6: Reused Finalized Token rejected cleanly with 0 broker calls before network dispatch.');

  // ----------------------------------------------------------------
  // H & I. Broker Failure / Timeout Consumes Allowance
  // ----------------------------------------------------------------
  console.log('\n[H-I] Testing Broker Rejection / Failure Consumes Allowance...');

  // Reset to armed
  await executeRun("UPDATE system_settings SET value = 'FIRST_LIVE_CERTIFICATION' WHERE key = 'EXECUTION_MODE'");
  await executeRun("UPDATE system_settings SET value = 'true' WHERE key = 'FIRST_LIVE_ARMED'");
  await executeRun("UPDATE system_settings SET value = '0' WHERE key = 'FIRST_LIVE_ORDERS_SUBMITTED'");
  await executeRun("UPDATE system_settings SET value = 'false' WHERE key = 'FIRST_LIVE_LOCKED'");

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
      firstLiveReservationToken: reservationFail.reservationToken,
      _firstLiveIdempotencyKey: 'test-idem-fail',
      _firstLiveCorrelationId: 'test-corr-fail'
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
  // Optional Field Removal / Modification Tests (Section 4 & 10)
  // ----------------------------------------------------------------
  console.log('\n[SL/TP Mismatch] Testing SL/TP removal and modifications...');

  // Setup a reservation with SL/TP
  await executeRun("UPDATE system_settings SET value = 'FIRST_LIVE_CERTIFICATION' WHERE key = 'EXECUTION_MODE'");
  await executeRun("UPDATE system_settings SET value = 'true' WHERE key = 'FIRST_LIVE_ARMED'");
  await executeRun("UPDATE system_settings SET value = '0' WHERE key = 'FIRST_LIVE_ORDERS_SUBMITTED'");
  await executeRun("UPDATE system_settings SET value = 'false' WHERE key = 'FIRST_LIVE_LOCKED'");
  updateSystemConfig({
    executionMode: 'FIRST_LIVE_CERTIFICATION',
    firstLiveArmed: true,
    firstLiveOrdersSubmitted: 0,
    firstLiveLocked: false
  });
  await executeRun('DELETE FROM first_live_ledger');

  const orderWithSLTP = {
    ...validOrderRequest,
    stopLoss: 10,
    takeProfit: 20
  };

  const reservationWithSLTP = await firstLiveService.reserveFirstLiveOrder({
    correlationId: 'sltp-corr',
    idempotencyKey: 'sltp-idem',
    orderRequest: orderWithSLTP
  });

  if (!reservationWithSLTP.success || !reservationWithSLTP.reservationToken) {
    throw new Error('FAILED: Failed to create reservation with SL/TP.');
  }

  // TEST 14 — Optional Field Removal (Original SL/TP supplied -> attacker removes SL)
  fetchCallsCount = 0;
  let test14Caught = false;
  try {
    await adapter.placeOrder({
      ...validOrderRequest, // validOrderRequest does NOT have stopLoss/takeProfit
      firstLiveReservationToken: reservationWithSLTP.reservationToken,
      _firstLiveIdempotencyKey: 'sltp-idem',
      _firstLiveCorrelationId: 'sltp-corr'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('stopLoss mismatch')) {
      test14Caught = true;
    }
  }
  if (!test14Caught) throw new Error('FAILED TEST 14: Allowed placeOrder when stopLoss was removed!');
  if (fetchCallsCount > 0) throw new Error('FAILED TEST 14: Network call made on stopLoss removal!');
  console.log('  ✓ TEST 14: StopLoss Removal blocked cleanly with 0 broker calls.');

  // TEST 15 — Optional Field Modification (Original SL/TP supplied -> attacker modifies SL)
  fetchCallsCount = 0;
  let test15Caught = false;
  try {
    await adapter.placeOrder({
      ...orderWithSLTP,
      stopLoss: 15, // original SL was 10
      firstLiveReservationToken: reservationWithSLTP.reservationToken,
      _firstLiveIdempotencyKey: 'sltp-idem',
      _firstLiveCorrelationId: 'sltp-corr'
    } as any);
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') && err.message.includes('stopLoss mismatch')) {
      test15Caught = true;
    }
  }
  if (!test15Caught) throw new Error('FAILED TEST 15: Allowed placeOrder when stopLoss was modified!');
  if (fetchCallsCount > 0) throw new Error('FAILED TEST 15: Network call made on stopLoss modification!');
  console.log('  ✓ TEST 15: StopLoss Modification blocked cleanly with 0 broker calls.');

  // ----------------------------------------------------------------
  // Concurrency Certification (Section 13)
  // ----------------------------------------------------------------
  console.log('\n[Concurrency] Launching simultaneous reservation attempts...');

  // Reset to armed
  await executeRun("UPDATE system_settings SET value = 'FIRST_LIVE_CERTIFICATION' WHERE key = 'EXECUTION_MODE'");
  await executeRun("UPDATE system_settings SET value = 'true' WHERE key = 'FIRST_LIVE_ARMED'");
  await executeRun("UPDATE system_settings SET value = '0' WHERE key = 'FIRST_LIVE_ORDERS_SUBMITTED'");
  await executeRun("UPDATE system_settings SET value = 'false' WHERE key = 'FIRST_LIVE_LOCKED'");
  updateSystemConfig({
    executionMode: 'FIRST_LIVE_CERTIFICATION',
    firstLiveArmed: true,
    firstLiveOrdersSubmitted: 0,
    firstLiveLocked: false
  });
  await executeRun('DELETE FROM first_live_ledger');

  const concurrentAttempts = Array.from({ length: 10 }, (_, i) =>
    firstLiveService.reserveFirstLiveOrder({
      correlationId: `concur-corr-${i}`,
      idempotencyKey: `concur-idem-${i}`,
      orderRequest: validOrderRequest
    })
  );

  const concurResults = await Promise.all(concurrentAttempts);
  const concurSuccesses = concurResults.filter(r => r.success);
  if (concurSuccesses.length !== 1) {
    throw new Error(`FAILED CONCURRENCY: Simultaneous attempts resulted in ${concurSuccesses.length} successful reservations (expected exactly 1).`);
  }

  const concurRows = await executeQuery<any>("SELECT COUNT(*) as cnt FROM first_live_ledger WHERE status = 'RESERVED'");
  if (Number(concurRows[0]?.cnt || 0) !== 1) {
    throw new Error(`FAILED CONCURRENCY: Simultaneous attempts created ${concurRows[0]?.cnt} RESERVED ledger rows (expected exactly 1).`);
  }
  console.log('  ✓ Strengthened Concurrency verified successfully (exactly 1 reservation, exactly 1 row).');

  // ----------------------------------------------------------------
  // Rollback Certification (Section 11)
  // ----------------------------------------------------------------
  console.log('\n[Rollback] Testing genuine transaction rollback...');

  // Reset to armed
  await executeRun("UPDATE system_settings SET value = 'FIRST_LIVE_CERTIFICATION' WHERE key = 'EXECUTION_MODE'");
  await executeRun("UPDATE system_settings SET value = 'true' WHERE key = 'FIRST_LIVE_ARMED'");
  await executeRun("UPDATE system_settings SET value = '0' WHERE key = 'FIRST_LIVE_ORDERS_SUBMITTED'");
  await executeRun("UPDATE system_settings SET value = 'false' WHERE key = 'FIRST_LIVE_LOCKED'");
  updateSystemConfig({
    executionMode: 'FIRST_LIVE_CERTIFICATION',
    firstLiveArmed: true,
    firstLiveOrdersSubmitted: 0,
    firstLiveLocked: false
  });
  await executeRun('DELETE FROM first_live_ledger');

  let rollbackErrorCaught = false;
  try {
    await executeTransaction((db) => {
      // 1. Change system settings
      db.run("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)", ['FIRST_LIVE_LOCKED', 'true', Date.now()]);
      db.run("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)", ['FIRST_LIVE_ORDERS_SUBMITTED', '1', Date.now()]);

      // 2. Insert ledger row
      db.run(
        `INSERT INTO first_live_ledger (
          id, reservation_token, fingerprint, correlation_id, idempotency_key, broker, environment, execution_mode,
          symbol, side, quantity, requested_price, status, attempted_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'rollback-token-hash', 'rollback-token-hash', 'rollback-fingerprint', 'corr-rollback', 'idem-rollback',
          'FIVE_PAISA', 'LIVE', 'FIRST_LIVE_CERTIFICATION', 'NIFTY26OCT23500CE', 'BUY', 25, 50, 'RESERVED', Date.now(), '{}'
        ]
      );

      // 3. Intentionally throw error before COMMIT
      throw new Error('INTENTIONAL_ROLLBACK_FAILURE');
    });
  } catch (err: any) {
    if (err.message === 'INTENTIONAL_ROLLBACK_FAILURE') {
      rollbackErrorCaught = true;
    }
  }

  if (!rollbackErrorCaught) {
    throw new Error('FAILED ROLLBACK TEST: Intentionally failed transaction did not throw.');
  }

  // Verify state restored
  const rollbackLockedRow = await executeQuery<any>("SELECT value FROM system_settings WHERE key = 'FIRST_LIVE_LOCKED'");
  if (rollbackLockedRow[0]?.value === 'true') {
    throw new Error('FAILED ROLLBACK TEST: FIRST_LIVE_LOCKED was not rolled back (still true).');
  }

  const rollbackSubmittedRow = await executeQuery<any>("SELECT value FROM system_settings WHERE key = 'FIRST_LIVE_ORDERS_SUBMITTED'");
  if (rollbackSubmittedRow[0]?.value === '1') {
    throw new Error('FAILED ROLLBACK TEST: FIRST_LIVE_ORDERS_SUBMITTED was not rolled back (still 1).');
  }

  const rollbackLedgerCount = await executeQuery<any>("SELECT COUNT(*) as cnt FROM first_live_ledger WHERE id = 'rollback-token-hash'");
  if (Number(rollbackLedgerCount[0]?.cnt || 0) !== 0) {
    throw new Error('FAILED ROLLBACK TEST: Ledger row was not rolled back.');
  }

  console.log('  ✓ Genuine SQLite transaction rollback verified successfully.');

  // ----------------------------------------------------------------
  // Crash/Restart Certification (Section 12)
  // ----------------------------------------------------------------
  console.log('\n[Crash/Restart] Testing database crash/restart recovery...');

  // Reset to armed
  await executeRun("UPDATE system_settings SET value = 'FIRST_LIVE_CERTIFICATION' WHERE key = 'EXECUTION_MODE'");
  await executeRun("UPDATE system_settings SET value = 'true' WHERE key = 'FIRST_LIVE_ARMED'");
  await executeRun("UPDATE system_settings SET value = '0' WHERE key = 'FIRST_LIVE_ORDERS_SUBMITTED'");
  await executeRun("UPDATE system_settings SET value = 'false' WHERE key = 'FIRST_LIVE_LOCKED'");
  updateSystemConfig({
    executionMode: 'FIRST_LIVE_CERTIFICATION',
    firstLiveArmed: true,
    firstLiveOrdersSubmitted: 0,
    firstLiveLocked: false
  });
  await executeRun('DELETE FROM first_live_ledger');

  // 1. Reserve
  const crashReservation = await firstLiveService.reserveFirstLiveOrder({
    correlationId: 'crash-corr',
    idempotencyKey: 'crash-idem',
    orderRequest: validOrderRequest
  });

  if (!crashReservation.success || !crashReservation.reservationToken) {
    throw new Error('FAILED CRASH TEST: Failed to create initial reservation.');
  }

  // 2. Simulate process crash by closing and reinitializing database connection
  resetDatabaseInstanceForTesting();

  // 3. Reload service status and verify states
  const statusAfterCrash = await firstLiveService.getStatus();
  if (statusAfterCrash.ordersSubmitted !== 1 || !statusAfterCrash.locked) {
    throw new Error('FAILED CRASH TEST: System state after restart is not locked.');
  }
  if (statusAfterCrash.armed) {
    throw new Error('FAILED CRASH TEST: System re-armed automatically after restart.');
  }

  const crashTokenHash = hashReservationToken(crashReservation.reservationToken);
  const rowsAfterCrash = await executeQuery<any>("SELECT status FROM first_live_ledger WHERE id = ?", [crashTokenHash]);
  if (rowsAfterCrash[0]?.status !== 'RESERVED') {
    throw new Error('FAILED CRASH TEST: Reservation is not in RESERVED state.');
  }

  // 4. Try to duplicate the same reservation
  const duplicateReservation = await firstLiveService.reserveFirstLiveOrder({
    correlationId: 'crash-corr',
    idempotencyKey: 'crash-idem',
    orderRequest: validOrderRequest
  });
  if (duplicateReservation.success) {
    throw new Error('FAILED CRASH TEST: Allowed duplicate reservation after crash/restart.');
  }

  console.log('  ✓ Crash/restart recovery verified successfully.');

  // ----------------------------------------------------------------
  // M. Production database remains untouched
  // ----------------------------------------------------------------
  console.log('\n[M] Verifying Production Database Is Completely Untouched via SHA-256...');

  const postProdHash = calculateFileHash(prodDbFile);
  const postTmpHash = calculateFileHash(prodTmpFile);
  const postBakHash = calculateFileHash(prodBakFile);

  if (preProdHash !== postProdHash) {
    throw new Error(`FAILED: Production database file 'data/trading_analyst.sqlite' was modified during testing! Pre-hash: ${preProdHash}, Post-hash: ${postProdHash}`);
  }
  if (preTmpHash !== postTmpHash) {
    throw new Error(`FAILED: Production tmp database file 'data/trading_analyst.sqlite.tmp' was modified during testing! Pre-hash: ${preTmpHash}, Post-hash: ${postTmpHash}`);
  }
  if (preBakHash !== postBakHash) {
    throw new Error(`FAILED: Production bak database file 'data/trading_analyst.sqlite.bak' was modified during testing! Pre-hash: ${preBakHash}, Post-hash: ${postBakHash}`);
  }

  console.log('  ✓ [M] Production database hashes matched perfectly. No production files were created, modified or touched.');

  // Clean up isolated test DB files (Section 13)
  console.log('\n[Cleanup] Cleaning up isolated test database files...');
  try {
    resetDatabaseInstanceForTesting();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(`${TEST_DB_PATH}.tmp`)) fs.unlinkSync(`${TEST_DB_PATH}.tmp`);
    if (fs.existsSync(`${TEST_DB_PATH}.bak`)) fs.unlinkSync(`${TEST_DB_PATH}.bak`);
    console.log('  ✓ Test database files unlinked.');
  } catch (cleanupErr) {
    console.warn('  ⚠ Non-fatal test DB file cleanup warning:', cleanupErr);
  }

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
