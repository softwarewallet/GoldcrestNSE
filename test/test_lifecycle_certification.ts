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
let modifyRequestsSent = 0;
let cancelRequestsSent = 0;
let mockFetchHandler: ((url: string, init?: any) => any) | null = null;

global.fetch = function (url: any, init: any) {
  fetchCallsCount++;
  const urlStr = String(url);
  if (urlStr.includes('ModifyOrderRequest')) modifyRequestsSent++;
  if (urlStr.includes('CancelOrderRequest')) cancelRequestsSent++;

  if (mockFetchHandler) {
    try {
      return mockFetchHandler(urlStr, init);
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

  // Mock successful 5paisa OpenAPI responses
  mockFetchHandler = (url, init) => {
    if (url.includes('PlaceOrderRequest')) {
      return Promise.resolve(new Response(JSON.stringify({
        head: { status: '0', statusDescription: 'Success' },
        body: { Status: 0, BrokerOrderID: '987654321', Message: 'Success' }
      })));
    }
    if (url.includes('OrderBook')) {
      let requestedId = '987654321';
      const bodyStr = init?.body && typeof init.body === 'string' ? init.body : '';
      if (bodyStr.includes('777666555') || (global as any).__lastTargetOrderId === '777666555') {
        requestedId = '777666555';
      } else if (bodyStr.includes('UNKNOWN_ORDER_999') || (global as any).__lastTargetOrderId === 'UNKNOWN_ORDER_999') {
        requestedId = 'UNKNOWN_ORDER_999';
      }
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

  // Switch mode to FIRST_LIVE_CERTIFICATION for testing
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

  // Run PRODUCTION finalization service rather than manual SQL update
  await firstLiveService.finalizeFirstLiveOrder({
    reservationToken: reservation.reservationToken,
    status: 'ACCEPTED',
    brokerOrderId: placed.brokerOrderId,
    result: placed
  });

  // Re-enable FIRST_LIVE_CERTIFICATION mode for lifecycle mutation testing (since finalizeFirstLiveOrder automatically locks mode to LIVE_DRY_RUN)
  updateSystemConfig({
    executionMode: 'FIRST_LIVE_CERTIFICATION'
  });

  // Verify production finalization populated broker_order_id in first_live_ledger
  const tokenHash = hashReservationToken(reservation.reservationToken);
  const ledgerRows = await executeQuery<any>('SELECT broker_order_id FROM first_live_ledger WHERE id = ?', [tokenHash]);
  if (ledgerRows[0]?.broker_order_id !== '987654321') {
    throw new Error(`FAILED: Production finalization did not populate broker_order_id '987654321'. Got: ${ledgerRows[0]?.broker_order_id}`);
  }
  console.log('  ✓ End-to-end First-Live ownership persistence verified (broker_order_id = 987654321).');

  // ----------------------------------------------------------------
  // POSITIVE MODIFY TEST (First-Live Ledger Ownership)
  // ----------------------------------------------------------------
  console.log('\n[Positive Modify] Testing modification of known Goldcrest First-Live order...');
  (global as any).__lastTargetOrderId = '987654321';
  const modified = await adapter.modifyOrder('987654321', { price: 55 });
  if (!modified) {
    throw new Error('FAILED: Authorized modifyOrder returned falsy result.');
  }
  console.log('  ✓ Positive modifyOrder passed successfully.');

  // ----------------------------------------------------------------
  // POSITIVE CANCEL TEST (First-Live Ledger Ownership)
  // ----------------------------------------------------------------
  console.log('\n[Positive Cancel] Testing cancellation of known Goldcrest First-Live order...');
  (global as any).__lastTargetOrderId = '987654321';
  const canceled = await adapter.cancelOrder('987654321');
  if (!canceled) {
    throw new Error('FAILED: Authorized cancelOrder returned false.');
  }
  console.log('  ✓ Positive cancelOrder passed successfully.');

  // ----------------------------------------------------------------
  // EXECUTION INTENTS OWNERSHIP TEST
  // ----------------------------------------------------------------
  console.log('\n[Execution Intent Ownership] Testing lifecycle authorization via execution_intents.broker_order_id...');
  await executeRun(
    `INSERT INTO execution_intents (idempotency_key, claim_token, broker, market, symbol, side, state, payload_json, result_json, broker_order_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['intent-idem-777', 'intent-claim-777', 'FIVE_PAISA', 'INDIAN_OPTIONS', 'NIFTY26OCT23500CE', 'BUY', 'COMPLETED', '{}', '{}', '777666555', Date.now(), Date.now()]
  );

  (global as any).__lastTargetOrderId = '777666555';
  const intentModified = await adapter.modifyOrder('777666555', { price: 52 });
  if (!intentModified) {
    throw new Error('FAILED: Modify via execution_intents ownership failed.');
  }
  console.log('  ✓ modifyOrder authorized via execution_intents.broker_order_id.');

  const intentCanceled = await adapter.cancelOrder('777666555');
  if (!intentCanceled) {
    throw new Error('FAILED: Cancel via execution_intents ownership failed.');
  }
  console.log('  ✓ cancelOrder authorized via execution_intents.broker_order_id.');

  // ----------------------------------------------------------------
  // NEGATIVE TESTS (Unknown Order ID)
  // ----------------------------------------------------------------
  console.log('\n[Negative Modify] Testing modification of unknown broker order...');
  (global as any).__lastTargetOrderId = 'UNKNOWN_ORDER_999';
  let unknownModifyCaught = false;
  try {
    await adapter.modifyOrder('UNKNOWN_ORDER_999', { price: 60 });
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') || err.code === 'FIRST_LIVE_ORDER_NOT_AUTHORIZED') {
      unknownModifyCaught = true;
    }
  }
  if (!unknownModifyCaught) {
    throw new Error('FAILED: Allowed modifyOrder on unknown order ID!');
  }
  console.log('  ✓ Negative modifyOrder correctly blocked unknown order.');

  console.log('\n[Negative Cancel] Testing cancellation of unknown broker order...');
  (global as any).__lastTargetOrderId = 'UNKNOWN_ORDER_999';
  let unknownCancelCaught = false;
  try {
    await adapter.cancelOrder('UNKNOWN_ORDER_999');
  } catch (err: any) {
    if (err.message.includes('FIRST_LIVE_ORDER_NOT_AUTHORIZED') || err.code === 'FIRST_LIVE_ORDER_NOT_AUTHORIZED') {
      unknownCancelCaught = true;
    }
  }
  if (!unknownCancelCaught) {
    throw new Error('FAILED: Allowed cancelOrder on unknown order ID!');
  }
  console.log('  ✓ Negative cancelOrder correctly blocked unknown order.');

  // ----------------------------------------------------------------
  // DATABASE ERROR HANDLING TEST
  // ----------------------------------------------------------------
  console.log('\n[Database Error Test] Testing database authorization error handling...');
  (global as any).__lastTargetOrderId = '987654321';
  const initModifyCount = modifyRequestsSent;
  const initCancelCount = cancelRequestsSent;

  // Temporarily alter query behavior or rename table to trigger DB query error
  await executeRun('ALTER TABLE execution_intents RENAME TO execution_intents_temp');

  let dbModifyErrorCaught = false;
  try {
    await adapter.modifyOrder('987654321', { price: 58 });
  } catch (err: any) {
    if (err.code === 'LIFECYCLE_AUTHORIZATION_DATABASE_ERROR' && err.message.includes('Lifecycle authorization could not be verified')) {
      dbModifyErrorCaught = true;
    } else {
      console.error('Unexpected error on DB modify test:', err);
    }
  }

  let dbCancelErrorCaught = false;
  try {
    await adapter.cancelOrder('987654321');
  } catch (err: any) {
    if (err.code === 'LIFECYCLE_AUTHORIZATION_DATABASE_ERROR' && err.message.includes('Lifecycle authorization could not be verified')) {
      dbCancelErrorCaught = true;
    } else {
      console.error('Unexpected error on DB cancel test:', err);
    }
  }

  // Restore table name
  await executeRun('ALTER TABLE execution_intents_temp RENAME TO execution_intents');

  if (!dbModifyErrorCaught) {
    throw new Error('FAILED: Database error on modifyOrder did not produce LIFECYCLE_AUTHORIZATION_DATABASE_ERROR!');
  }
  if (!dbCancelErrorCaught) {
    throw new Error('FAILED: Database error on cancelOrder did not produce LIFECYCLE_AUTHORIZATION_DATABASE_ERROR!');
  }

  const modifyNetTransmissions = modifyRequestsSent - initModifyCount;
  const cancelNetTransmissions = cancelRequestsSent - initCancelCount;

  if (modifyNetTransmissions !== 0 || cancelNetTransmissions !== 0) {
    throw new Error(`FAILED: Network transmissions occurred during database authorization error! Modify: ${modifyNetTransmissions}, Cancel: ${cancelNetTransmissions}`);
  }

  console.log('  ✓ Database authorization query error correctly failed-closed with zero network transmissions.');

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
