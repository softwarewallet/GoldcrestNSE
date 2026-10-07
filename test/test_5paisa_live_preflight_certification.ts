import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';
import { OrderRequest } from '../src/brokers/types';
import { updateSystemConfig } from '../src/services/configService';
import { firstLiveService } from '../src/services/firstLiveService';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import fs from 'fs';
import path from 'path';

async function run5PaisaPreflightCertification() {
  console.log('=== STARTING 5PAISA LIVE ZERO-TRANSMISSION CERTIFICATION ===');

  const adapter = new FivePaisaLiveAdapter({
    appName: 'GOLDCREST',
    userId: 'test-user',
    userKey: 'test-key',
    encryptionKey: 'test-enc',
    accessToken: 'mock-token',
    clientCode: 'test-client'
  });
  
  (adapter as any).status = 'CONNECTED';
  
  // Mock necessary methods to isolate from real network during preflight checks
  adapter.getInstrument = async (symbol: string) => ({
    brokerInstrumentId: '12345',
    symbol: symbol,
    digits: 2
  } as any);

  adapter.ensureActiveSession = async () => true;

  const validOrderRequest: OrderRequest = {
    market: 'INDIAN_OPTIONS',
    symbol: 'NIFTY26OCT23500CE',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 25,
    price: 50
  };

  let orderBoundaryAttemptCount = 0;
  let actualOrderHttpAttemptCount = 0;
  const outboundUrls: string[] = [];

  // 1. Intercept actual HTTP transport at the lowest level
  const originalFetch = global.fetch;
  (global as any).fetch = async (input: any, _init?: any) => {
    const url = String(input);
    outboundUrls.push(url);

    if (url.includes('/PlaceOrderRequest') || url.includes('/ModifyOrderRequest') || url.includes('/CancelOrderRequest')) {
      actualOrderHttpAttemptCount++;
      throw new Error(`TEST SAFETY FAILURE: Real 5paisa order API attempted: ${url}`);
    }

    return { 
      ok: true, 
      json: async () => ({ head: { status: '0' }, body: { Status: 0, Message: 'Mock OK' } }) 
    };
  };

  // 2. Set up the internal certification boundary hook
  (global as any).__GOLDCREST_CERT_BOUNDARY_HOOK = (_payload: any) => {
    orderBoundaryAttemptCount++;
    // Terminology check: only "boundary reached"
    return { id: 'mocked-order-id', status: 'ACCEPTED' };
  };

  try {
    const initialStatus = await firstLiveService.getStatus();

    // Test 1: Successful production path exercise
    console.log('\n[1] Testing Production placeOrder() Path...');
    updateSystemConfig({ executionMode: 'LIVE_EXECUTION' });
    orderBoundaryAttemptCount = 0;
    actualOrderHttpAttemptCount = 0;

    const result = await adapter.placeOrder(validOrderRequest);
    
    if (orderBoundaryAttemptCount !== 1) {
      throw new Error(`FAILED: Expected 1 boundary attempt, got ${orderBoundaryAttemptCount}`);
    }
    if (actualOrderHttpAttemptCount !== 0) {
      throw new Error(`FAILED: Real HTTP transmission attempted! Count: ${actualOrderHttpAttemptCount}`);
    }
    if (result.status !== 'ACCEPTED') {
      throw new Error(`FAILED: Order not accepted in mock path. Status: ${result.status}`);
    }
    console.log('  ✓ Production placeOrder() path exercised successfully.');
    console.log('  ✓ Internal order boundary reached = YES');
    console.log('  ✓ Actual 5paisa HTTP transmission = 0');

    // Test 2: Emergency Stop
    console.log('\n[2] Testing Emergency Stop Blocking...');
    await killSwitch.triggerEmergencyHalt('Test stop');
    orderBoundaryAttemptCount = 0;
    actualOrderHttpAttemptCount = 0;
    try {
      await adapter.placeOrder(validOrderRequest);
      throw new Error('FAILED: placeOrder did not reject emergency stop.');
    } catch (err: any) {
      if (!err.message.includes('EMERGENCY_STOP_ACTIVE')) {
        throw err;
      }
      if (orderBoundaryAttemptCount !== 0) {
        throw new Error('FAILED: Order reached boundary during Emergency Stop!');
      }
      console.log('  ✓ Emergency Stop blocked order before boundary.');
    }
    killSwitch.resumeTrading();

    // Test 3: Authentication Failure
    console.log('\n[3] Testing Authentication Failure Blocking...');
    const originalEnsure = adapter.ensureActiveSession;
    adapter.ensureActiveSession = async () => { throw new Error('AUTHENTICATION_FAILED'); };
    orderBoundaryAttemptCount = 0;
    try {
      await adapter.placeOrder(validOrderRequest);
      throw new Error('FAILED: placeOrder did not reject auth failure.');
    } catch (err: any) {
      if (!err.message.includes('AUTHENTICATION_FAILED')) {
        throw err;
      }
      if (orderBoundaryAttemptCount !== 0) {
        throw new Error('FAILED: Order reached boundary during auth failure!');
      }
      console.log('  ✓ Authentication failure blocked order before boundary.');
    }
    adapter.ensureActiveSession = originalEnsure;

    // Test 4: Instrument Rejection
    console.log('\n[4] Testing Pre-boundary Rejection (Invalid Instrument)...');
    const originalGetInstrument = adapter.getInstrument;
    adapter.getInstrument = async () => null; // Simulate instrument not found
    orderBoundaryAttemptCount = 0;
    try {
      await adapter.placeOrder(validOrderRequest);
      throw new Error('FAILED: placeOrder did not reject invalid instrument.');
    } catch (err: any) {
      // The error message comes from FivePaisaBrokerAdapter.ts
      if (!err.message.includes('authoritative scrip code is unavailable')) {
        throw err;
      }
      if (orderBoundaryAttemptCount !== 0) {
        throw new Error('FAILED: Order reached boundary with invalid instrument!');
      }
      console.log('  ✓ Invalid instrument blocked order before boundary.');
    }
    adapter.getInstrument = originalGetInstrument;

    // Test 5: Hard Network Safety Test
    console.log('\n[5] Testing Hard Network Safety (Fetch Guard)...');
    // Disable the internal hook to let it fall through to fetch
    const hook = (global as any).__GOLDCREST_CERT_BOUNDARY_HOOK;
    delete (global as any).__GOLDCREST_CERT_BOUNDARY_HOOK;
    
    actualOrderHttpAttemptCount = 0;
    try {
      await adapter.placeOrder(validOrderRequest);
      throw new Error('FAILED: placeOrder reached real fetch without being caught by fetch guard!');
    } catch (err: any) {
      if (err.message.includes('TEST SAFETY FAILURE: Real 5paisa order API attempted')) {
        console.log('  ✓ Fetch guard correctly caught the attempt when hook was disabled.');
      } else {
        throw err;
      }
    }
    if (actualOrderHttpAttemptCount !== 1) {
       throw new Error(`FAILED: Fetch guard should have incremented attempt count. Got ${actualOrderHttpAttemptCount}`);
    }
    (global as any).__GOLDCREST_CERT_BOUNDARY_HOOK = hook;

    // Test 6: Verify First-Live State remains untouched
    console.log('\n[6] Verifying First-Live State Stability...');
    const finalStatus = await firstLiveService.getStatus();
    
    if (initialStatus.ordersSubmitted !== finalStatus.ordersSubmitted) {
      throw new Error(`FAILED: First-Live orders submitted changed from ${initialStatus.ordersSubmitted} to ${finalStatus.ordersSubmitted}`);
    }
    if (initialStatus.locked !== finalStatus.locked) {
      throw new Error('FAILED: First-Live lock state changed!');
    }
    console.log('  ✓ First-Live state remained completely untouched.');

    console.log('\n=== 5PAISA LIVE ZERO-TRANSMISSION CERTIFICATION PASSED ===');
    console.log(`
Production placeOrder() exercised = YES
Production preflight executed = YES
Internal order boundary reached = YES
Actual 5paisa PlaceOrderRequest HTTP transmission = 0
Actual modify-order HTTP transmission = 0
Actual cancel-order HTTP transmission = 0
First-Live reservation created = 0
First-Live reservation consumed = 0
    `);

  } finally {
    global.fetch = originalFetch;
    delete (global as any).__GOLDCREST_CERT_BOUNDARY_HOOK;
  }
}

run5PaisaPreflightCertification().catch(err => {
  console.error('❌ CERTIFICATION FAILED:', err);
  process.exit(1);
});
