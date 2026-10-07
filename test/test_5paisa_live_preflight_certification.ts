import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';
import { OrderRequest } from '../src/brokers/types';
import { updateSystemConfig } from '../src/services/configService';
import { executeRun } from '../src/database/db';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import fs from 'fs';
import path from 'path';

async function run5PaisaPreflightCertification() {
  console.log('=== STARTING 5PAISA LIVE ZERO-ORDER PREFLIGHT CERTIFICATION ===');

  const adapter = new FivePaisaLiveAdapter({
    appName: 'GOLDCREST',
    userId: 'test-user',
    userKey: 'test-key',
    encryptionKey: 'test-enc',
    accessToken: 'mock-token',
    clientCode: 'test-client'
  });
  
  (adapter as any).status = 'CONNECTED';
  // Note: FivePaisaLiveAdapter already sets isLive = true and environment = 'LIVE'
  
  // Mock necessary methods
  adapter.getInstrument = async (symbol: string) => ({
    brokerInstrumentId: '12345',
    symbol: symbol,
    digits: 2
  } as any);

  adapter.ensureActiveSession = async () => true;

  // Set execution mode to LIVE_EXECUTION to bypass LIVE_DRY_RUN check
  updateSystemConfig({ executionMode: 'LIVE_EXECUTION' });

  const validOrderRequest: OrderRequest = {
    market: 'INDIAN_OPTIONS',
    symbol: 'NIFTY26OCT23500CE',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 25,
    price: 50
  };

  // Test 1: Successful preflight
  console.log('\n[1] Testing Successful Preflight...');
  let transmissionCount = 0;
  
  // Set up interception boundary
  (global as any).__GOLDCREST_INTERCEPT_5PAISA_ORDER = (payload: any) => {
    transmissionCount++;
    console.log('Intercepted order transmission attempt. payload=', JSON.stringify(payload));
  };
  
  // Note: placeOrder calls preflightOrder. If preflightOrder throws, it stops.
  // If preflightOrder passes, placeOrder reaches the interception hook, 
  // which logs and returns a mock object, preventing fetch.
  // The test should NOT expect an error if interception is handled.
  
  try {
    await adapter.placeOrder(validOrderRequest);
  } catch (err: any) {
    console.log('Error caught during placeOrder (expected due to mock interception):', err.message);
  }

  // transmissionCount should be 1 because interception boundary was reached
  if (transmissionCount !== 1) {
    throw new Error('FAILED: Broker order transmission was NOT intercepted!');
  }
  
  console.log('  ✓ Successful preflight passed, interception verified.');
  delete (global as any).__GOLDCREST_INTERCEPT_5PAISA_ORDER;

  // Test 2: Emergency Stop
  console.log('\n[2] Testing Emergency Stop...');
  await killSwitch.triggerEmergencyHalt('Test stop');
  try {
    await adapter.preflightOrder(validOrderRequest);
    throw new Error('FAILED: Preflight did not reject emergency stop.');
  } catch (err: any) {
    if (!err.message.includes('EMERGENCY_STOP_ACTIVE')) {
        throw err;
    }
    console.log('  ✓ Emergency Stop preflight rejection verified.');
  }
  killSwitch.resumeTrading();

  // Test 3: Connectivity Failure (Session)
  console.log('\n[3] Testing Connectivity Failure...');
  adapter.ensureActiveSession = async () => {
    throw new Error('AUTHENTICATION_FAILED');
  };
  try {
    await adapter.preflightOrder(validOrderRequest);
    throw new Error('FAILED: Preflight did not reject auth failure.');
  } catch (err: any) {
    if (err.message !== 'AUTHENTICATION_FAILED') {
        throw err;
    }
    console.log('  ✓ Authentication failure preflight rejection verified.');
  }
  adapter.ensureActiveSession = async () => true;

  console.log('\n=== 5PAISA LIVE PREFLIGHT CERTIFICATION PASSED SUCCESSFULLY ===');
}

run5PaisaPreflightCertification().catch(err => {
  console.error('❌ PREFLIGHT CERTIFICATION TESTS FAILED:', err);
  process.exit(1);
});
