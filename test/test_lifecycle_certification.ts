// ============================================================================
// 5PAISA LIFECYCLE AUTHORIZATION & POSITIVE MUTATION CERTIFICATION SUITE
// ============================================================================

import crypto from 'crypto';
import { firstLiveService, hashReservationToken, generateFirstLiveFingerprint } from '../src/services/firstLiveService';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';
import { brokerRegistry } from '../src/brokers/registry';
import { executeRun, executeQuery, resetDatabaseInstanceForTesting } from '../src/database/db';
import fs from 'fs';

const TEST_DB_PATH = 'data/test_lifecycle_certification.sqlite';
process.env.GOLDCREST_DB_FILE = TEST_DB_PATH;
resetDatabaseInstanceForTesting();

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

async function runLifecycleCertification() {
  console.log('================================================================');
  console.log(' STARTING 5PAISA LIFECYCLE & POSITIVE MUTATION CERTIFICATION');
  console.log('================================================================');

  await executeRun('DELETE FROM first_live_ledger');
  await executeRun('DELETE FROM execution_intents');

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

  const adapter = new FivePaisaLiveAdapter();
  adapter.getInstrument = async () => ({
    brokerInstrumentId: '12345',
    symbol: 'NIFTY26OCT23500CE',
    digits: 2
  } as any);

  (adapter as any).config = {
    appName: 'test-app',
    userId: 'test-user',
    userKey: 'test-key',
    encryptionKey: 'test-enc',
    accessToken: 'mock-token'
  };
  (adapter as any).status = 'CONNECTED';
  brokerRegistry.registerAdapter(adapter);

  const validOrderRequest = {
    market: 'INDIAN_OPTIONS',
    symbol: 'NIFTY26OCT23500CE',
    side: 'BUY' as const,
    orderType: 'LIMIT' as const,
    quantity: 25,
    price: 50
  };

  // 1. Reserve First-Live Order
  const reservation = await firstLiveService.reserveFirstLiveOrder({
    correlationId: 'life-corr-1',
    idempotencyKey: 'life-idem-1',
    orderRequest: validOrderRequest
  });

  if (!reservation.success || !reservation.reservationToken) {
    throw new Error(`FAILED: Reservation failed: ${reservation.message}`);
  }
  console.log('  ✓ First-Live reservation succeeded.');

  // Mock successful PlaceOrderRequest returning BrokerOrderID '987654321'
  mockFetchHandler = (url, init) => {
    if (url.includes('PlaceOrderRequest')) {
      return Promise.resolve(new Response(JSON.stringify({
        head: { status: '0', statusDescription: 'Success' },
        body: { Status: 0, BrokerOrderID: '987654321', Message: 'Success' }
      })));
    }
    if (url.includes('OrderBook')) {
      const isUnknown = (init?.body && typeof init.body === 'string' && init.body.includes('UNKNOWN_ORDER_999')) || (global as any).__lastCancelledOrderId === 'UNKNOWN_ORDER_999';
      const requestedId = isUnknown ? 'UNKNOWN_ORDER_999' : '987654321';
      return Promise.resolve(new Response(JSON.stringify({
        head: { status: '0', statusDescription: 'Success' },
        body: {
          Status: 0,
          OrderBookDetail: [
            {
              ExchOrderID: requestedId,
              BrokerOrderID: requestedId,
              Symbol: 'NIFTY26OCT23500CE',
              BuySell: 'BUY',
              Qty: 25,
              Rate: 50,
              OrderStatus: 'Pending'
            }
          ]
        }
      })));
    }
    if (url.includes('CancelOrderRequest')) {
      try {
        const parsed = JSON.parse(init?.body || '{}');
        (global as any).__lastCancelledOrderId = parsed.ExchOrderID;
      } catch {}
      return Promise.resolve(new Response(JSON.stringify({
        head: { status: '0', statusDescription: 'Success' },
        body: { Status: 0, Message: 'Success' }
      })));
    }
    if (url.includes('ModifyOrderRequest')) {
      return Promise.resolve(new Response(JSON.stringify({
        head: { status: '0', statusDescription: 'Success' },
        body: { Status: 0, Message: 'Success' }
      })));
    }
    if (url.includes('CancelOrderRequest')) {
      return Promise.resolve(new Response(JSON.stringify({
        head: { status: '0', statusDescription: 'Success' },
        body: { Status: 0, Message: 'Success' }
      })));
    }
    return Promise.resolve(new Response(JSON.stringify({})));
  };

  const allowedOrder = {
    ...validOrderRequest,
    firstLiveReservationToken: reservation.reservationToken,
    _firstLiveIdempotencyKey: 'life-idem-1',
    _firstLiveCorrelationId: 'life-corr-1'
  };

  // Switch mode to FIRST_LIVE_CERTIFICATION for modify/cancel lifecycle testing
  await executeRun("UPDATE system_settings SET value = 'FIRST_LIVE_CERTIFICATION' WHERE key = 'EXECUTION_MODE'");
  updateSystemConfig({
    executionMode: 'FIRST_LIVE_CERTIFICATION',
    firstLiveArmed: false,
    firstLiveLocked: true
  });
  (adapter as any).isLive = true;

  const placed = await adapter.placeOrder(allowedOrder);
  if (!placed || placed.brokerOrderId !== '987654321') {
    throw new Error('FAILED: Placing reserved order did not yield expected brokerOrderId.');
  }
  console.log('  ✓ Placed order successfully with brokerOrderId 987654321.');

  // Store brokerOrderId in first_live_ledger for ownership lookup
  const tokenHash = hashReservationToken(reservation.reservationToken);
  await executeRun("UPDATE first_live_ledger SET broker_order_id = ? WHERE id = ?", ['987654321', tokenHash]);

  // ----------------------------------------------------------------
  // POSITIVE MODIFY TEST
  // ----------------------------------------------------------------
  console.log('\n[Positive Modify] Testing modification of known Goldcrest order...');
  fetchCallsCount = 0;
  const modified = await adapter.modifyOrder('987654321', { price: 55 });
  if (!modified) {
    throw new Error('FAILED: Authorized modifyOrder returned falsy result.');
  }
  console.log('  ✓ Positive modifyOrder passed successfully.');

  // ----------------------------------------------------------------
  // NEGATIVE MODIFY TEST (Unknown Order ID)
  // ----------------------------------------------------------------
  console.log('\n[Negative Modify] Testing modification of unknown broker order...');
  fetchCallsCount = 0;
  let unknownModifyCaught = false;
  try {
    await adapter.modifyOrder('UNKNOWN_ORDER_999', { price: 60 });
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') || err.message.includes('not contain')) {
      unknownModifyCaught = true;
    }
  }
  if (!unknownModifyCaught) {
    throw new Error('FAILED: Allowed modifyOrder on unknown order ID!');
  }
  console.log('  ✓ Negative modifyOrder correctly blocked unknown order.');

  // ----------------------------------------------------------------
  // POSITIVE CANCEL TEST
  // ----------------------------------------------------------------
  console.log('\n[Positive Cancel] Testing cancellation of known Goldcrest order...');
  fetchCallsCount = 0;
  const canceled = await adapter.cancelOrder('987654321');
  if (!canceled) {
    throw new Error('FAILED: Authorized cancelOrder returned false.');
  }
  console.log('  ✓ Positive cancelOrder passed successfully.');

  // ----------------------------------------------------------------
  // NEGATIVE CANCEL TEST (Unknown Order ID)
  // ----------------------------------------------------------------
  console.log('\n[Negative Cancel] Testing cancellation of unknown broker order...');
  (global as any).__lastCancelledOrderId = 'UNKNOWN_ORDER_999';
  fetchCallsCount = 0;
  let unknownCancelCaught = false;
  try {
    await adapter.cancelOrder('UNKNOWN_ORDER_999');
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED')) {
      unknownCancelCaught = true;
    }
  }
  if (!unknownCancelCaught) {
    throw new Error('FAILED: Allowed cancelOrder on unknown order ID!');
  }
  console.log('  ✓ Negative cancelOrder correctly blocked unknown order.');

  // Clean up
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(`${TEST_DB_PATH}.tmp`)) fs.unlinkSync(`${TEST_DB_PATH}.tmp`);
    if (fs.existsSync(`${TEST_DB_PATH}.bak`)) fs.unlinkSync(`${TEST_DB_PATH}.bak`);
  } catch {}

  global.fetch = originalFetch;

  console.log('\n================================================================');
  console.log('   ✓ ALL LIFECYCLE CERTIFICATION TESTS PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

runLifecycleCertification().catch(err => {
  console.error('❌ LIFECYCLE CERTIFICATION FAILED:', err);
  process.exit(1);
});
