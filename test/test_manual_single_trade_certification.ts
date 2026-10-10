import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { manualTradeService, generateManualTradeFingerprint, MANUAL_TRADE_SMALL_BUDGET_INR, calculateTradeOutlayInr } from '../src/services/manualTradeService';
import { FXRateProvider } from '../src/accounting/fxRateProvider';
import { brokerRegistry } from '../src/brokers/registry';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import { isExecutionGateUnlocked } from '../src/brokers/safety/AutoExecutionEngine';
import { executeRun, executeQuery, getDatabase, resetDatabaseInstanceForTesting } from '../src/database/db';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';

// Force isolated test SQLite database
const TEST_DB_PATH = 'data/test_manual_trade_certification.sqlite';
process.env.GOLDCREST_DB_FILE = TEST_DB_PATH;
resetDatabaseInstanceForTesting();

// Mock fetch for broker network interactions
let networkCallsCount = 0;
let mockPlaceOrderResponse: any = {
  head: { status: '0', statusDescription: 'Success' },
  body: { Status: 0, Message: 'Order Accepted', BrokerOrderID: '5p-test-ord-99881' }
};

const originalFetch = global.fetch;
global.fetch = async (url: any, init?: any) => {
  networkCallsCount++;
  const urlStr = String(url);
  if (urlStr.includes('PlaceOrderRequest')) {
    return new Response(JSON.stringify(mockPlaceOrderResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ head: { status: '0' }, body: {} }), { status: 200 });
};

async function runManualTradeCertificationTests() {
  console.log('================================================================');
  console.log('   STARTING PHASE C MANUAL SINGLE-TRADE CERTIFICATION TESTS');
  console.log('================================================================');

  let passedTests = 0;
  const totalTests = 18;

  try {
    await getDatabase();

    updateSystemConfig({ executionMode: 'LIVE_DRY_RUN' });

    // Configure test adapter with full LIVE account and scrip resolution
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (adapter) {
      adapter.config = {
        appName: 'test-app',
        appSource: '1',
        userId: 'test-user',
        userKey: 'test-key',
        encryptionKey: 'test-enc',
        clientCode: 'test-client',
        accessToken: 'mock-token'
      };
      adapter.status = 'CONNECTED';
      adapter.testConnection = async () => ({ connected: true, status: 'CONNECTED', latencyMs: 10 });
      adapter.getAccount = async () => ({
        accountId: 'test-client',
        balance: 50000,
        equity: 50000,
        availableMargin: 50000,
        currency: 'INR',
        accountType: 'LIVE',
        isLiveAccount: true,
        permissions: ['TRADING', 'EQUITY', 'DERIVATIVES', 'NSE_FNO']
      });
      adapter.resolveAuthoritativeLiveInstrument = async (sym: string, _market: string) => ({
        symbol: sym,
        exchange: 'N',
        exchangeType: 'D',
        scripCode: '45001',
        brokerInstrumentId: '45001',
        lotSize: sym.includes('BANKNIFTY') ? 15 : 25
      });
      adapter.getInstrument = async (sym: string) => ({
        symbol: sym,
        brokerInstrumentId: '45001',
        digits: 2
      });
    }

    // -------------------------------------------------------------
    // Test 1: Account Summary & Broker Identification
    // -------------------------------------------------------------
    console.log('[TEST 1] Account Summary & Independent Gate Check...');
    const summary = await manualTradeService.getAccountSummary();
    if (!summary.broker || !summary.environment) throw new Error('Missing broker or environment');
    if (summary.environment !== 'LIVE') throw new Error('Environment must be LIVE');
    if (summary.smallTradeBudget !== 20.00) throw new Error('Small trade budget must be ₹20.00');
    if (summary.autonomousExecutionGateLocked !== true) throw new Error('Autonomous gate must report locked');
    console.log('  ✓ [1] Authoritative account summary loaded; autonomous gate reports locked.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 2: Authoritative Instruments Resolution
    // -------------------------------------------------------------
    console.log('[TEST 2] Authoritative Instruments Resolution...');
    const insts = await manualTradeService.getAuthoritativeInstruments();
    if (!Array.isArray(insts) || insts.length === 0) throw new Error('Instruments list must not be empty');
    const niftyOption = insts.find(i => i.symbol.includes('NIFTY 24000 CE'));
    if (!niftyOption) throw new Error('Authoritative NIFTY 24000 CE must be present');
    if (niftyOption.lotSize !== 25) throw new Error(`Expected lot size 25 for Nifty, got ${niftyOption.lotSize}`);
    console.log(`  ✓ [2] Authoritative instruments available with verified lot size (NIFTY lot = ${niftyOption.lotSize}).`);
    passedTests++;

    // -------------------------------------------------------------
    // Test 3: Budget Validation: Trade Exceeding ₹20 Must Be Rejected
    // -------------------------------------------------------------
    console.log('[TEST 3] Small Trade Budget: Reject Outlay > ₹20...');
    const overBudgetResult = await manualTradeService.prepareManualTrade({
      symbol: 'NIFTY 24000 CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 1.00 // 25 * 1.00 = 25.00 > ₹20.00
    });

    if (overBudgetResult.ready !== false) {
      throw new Error('Trade exceeding ₹20 budget must not be ready');
    }
    const budgetReason = overBudgetResult.rejectionReasons.find(r => r.includes('SMALL_TRADE_BUDGET_EXCEEDED'));
    if (!budgetReason) {
      throw new Error(`Expected SMALL_TRADE_BUDGET_EXCEEDED in rejection reasons: ${overBudgetResult.rejectionReasons.join(', ')}`);
    }
    console.log('  ✓ [3] Outlay exceeding ₹20 budget cleanly rejected with explicit calculation details.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 4: Derivative Lot-Size Multiple Validation
    // -------------------------------------------------------------
    console.log('[TEST 4] Derivative Non-Lot-Multiple Rejection...');
    const invalidQtyResult = await manualTradeService.prepareManualTrade({
      symbol: 'NIFTY 24000 CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 10, // Not multiple of 25
      price: 0.50
    });

    if (invalidQtyResult.ready !== false) {
      throw new Error('Non-lot multiple quantity must be rejected');
    }
    const lotReason = invalidQtyResult.rejectionReasons.find(r => r.includes('NON_LOT_MULTIPLE_QUANTITY'));
    if (!lotReason) {
      throw new Error(`Expected NON_LOT_MULTIPLE_QUANTITY, got: ${invalidQtyResult.rejectionReasons.join(', ')}`);
    }
    console.log('  ✓ [4] Non-lot multiple quantity (10 for lot 25) rejected before submission.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 5: Valid Trade Preparation within ₹20 Budget
    // -------------------------------------------------------------
    console.log('[TEST 5] Valid Trade Preparation within ₹20 Budget...');

    const validPrep = await manualTradeService.prepareManualTrade({
      symbol: 'NIFTY 24000 CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 0.50, // 25 * 0.50 = 12.50 + charges ~0.02 = 12.52 <= 20.00
      stopLoss: 0.40,
      takeProfit: 0.80
    });

    if (!validPrep.ready || !validPrep.authorizationId || !validPrep.authorizationToken || !validPrep.fingerprint) {
      throw new Error(`Valid trade preparation failed: ${validPrep.rejectionReasons.join(', ')}`);
    }
    if (!validPrep.review || validPrep.review.totalEstimatedOutlay > 20.00) {
      throw new Error('Valid review outlay must not exceed ₹20');
    }
    console.log(`  ✓ [5] Trade within ₹20 budget prepared successfully (Estimated Outlay: ₹${validPrep.review.totalEstimatedOutlay.toFixed(2)}).`);
    passedTests++;

    // -------------------------------------------------------------
    // Test 6: Auto Live Isolation: Gate Remains Locked
    // -------------------------------------------------------------
    console.log('[TEST 6] Auto Live Gate Remains Locked...');
    if (isExecutionGateUnlocked()) {
      throw new Error('Autonomous execution gate must remain locked after preparing manual trade');
    }
    console.log('  ✓ [6] Autonomous execution gate remains strictly locked; Auto Live is not armed.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 7: Tampered Confirmation (Fingerprint Mismatch) Rejection
    // -------------------------------------------------------------
    console.log('[TEST 7] Tamper Detection: Fingerprint Mismatch Rejection...');
    let tamperedErrorCaught = false;
    try {
      await manualTradeService.confirmAndExecuteManualTrade({
        authorizationId: validPrep.authorizationId,
        authorizationToken: validPrep.authorizationToken,
        confirmedTrade: {
          broker: 'FIVE_PAISA',
          symbol: 'NIFTY 24000 CE',
          side: 'BUY',
          orderType: 'LIMIT',
          quantity: 25,
          price: 0.60 // TAMPERED: 0.60 instead of 0.50!
        },
        operatorConfirmed: true
      });
    } catch (err: any) {
      tamperedErrorCaught = true;
      if (!err.message.includes('TRADE_FINGERPRINT_MISMATCH')) {
        throw new Error(`Expected TRADE_FINGERPRINT_MISMATCH, got: ${err.message}`);
      }
    }

    if (!tamperedErrorCaught) {
      throw new Error('Tampered trade parameters must be rejected by canonical fingerprint check');
    }
    console.log('  ✓ [7] Tampered trade parameters rejected by canonical cryptographic fingerprint validation.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 8: Unconfirmed Operator Rejection
    // -------------------------------------------------------------
    console.log('[TEST 8] Operator Confirmation Required...');
    let unconfirmedErrorCaught = false;
    try {
      await manualTradeService.confirmAndExecuteManualTrade({
        authorizationId: validPrep.authorizationId,
        authorizationToken: validPrep.authorizationToken,
        confirmedTrade: {
          broker: 'FIVE_PAISA',
          symbol: 'NIFTY 24000 CE',
          side: 'BUY',
          orderType: 'LIMIT',
          quantity: 25,
          price: 0.50,
          stopLoss: 0.40,
          takeProfit: 0.80
        },
        operatorConfirmed: false // Not confirmed!
      });
    } catch (err: any) {
      unconfirmedErrorCaught = true;
      if (!err.message.includes('OPERATOR_CONFIRMATION_REQUIRED')) {
        throw new Error(`Expected OPERATOR_CONFIRMATION_REQUIRED, got: ${err.message}`);
      }
    }

    if (!unconfirmedErrorCaught) {
      throw new Error('Unconfirmed operator submission must be rejected');
    }
    console.log('  ✓ [8] Submission without operator confirmation rejected.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 9: Successful Confirmation & Execution
    // -------------------------------------------------------------
    console.log('[TEST 9] Valid Confirmation & Broker Execution...');
    networkCallsCount = 0;
    const confirmResult = await manualTradeService.confirmAndExecuteManualTrade({
      authorizationId: validPrep.authorizationId,
      authorizationToken: validPrep.authorizationToken,
      confirmedTrade: {
        broker: 'FIVE_PAISA',
        symbol: 'NIFTY 24000 CE',
        side: 'BUY',
        orderType: 'LIMIT',
        quantity: 25,
        price: 0.50,
        stopLoss: 0.40,
        takeProfit: 0.80
      },
      operatorConfirmed: true
    });

    if (!confirmResult.success) {
      throw new Error(`Trade confirmation failed: ${confirmResult.message}`);
    }
    if (!confirmResult.brokerOrderId) {
      throw new Error('Missing brokerOrderId in confirmation result');
    }
    if (confirmResult.reconciled !== true) {
      throw new Error('Reconciled must be true');
    }
    console.log(`  ✓ [9] Manual trade successfully executed and reconciled (Broker Order ID: ${confirmResult.brokerOrderId}).`);
    passedTests++;

    // -------------------------------------------------------------
    // Test 10: Replay Prevention (Double Execution Rejection)
    // -------------------------------------------------------------
    console.log('[TEST 10] Replay Prevention (Reused Token Rejection)...');
    let replayErrorCaught = false;
    try {
      await manualTradeService.confirmAndExecuteManualTrade({
        authorizationId: validPrep.authorizationId,
        authorizationToken: validPrep.authorizationToken,
        confirmedTrade: {
          broker: 'FIVE_PAISA',
          symbol: 'NIFTY 24000 CE',
          side: 'BUY',
          orderType: 'LIMIT',
          quantity: 25,
          price: 0.50
        },
        operatorConfirmed: true
      });
    } catch (err: any) {
      replayErrorCaught = true;
      if (!err.message.includes('AUTHORIZATION_ALREADY_CONSUMED')) {
        throw new Error(`Expected AUTHORIZATION_ALREADY_CONSUMED, got: ${err.message}`);
      }
    }

    if (!replayErrorCaught) {
      throw new Error('Consumed authorization token must not be reusable');
    }
    console.log('  ✓ [10] Reused authorization token rejected cleanly; double-submission prevented.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 11: Emergency Kill Switch Halts Preparation
    // -------------------------------------------------------------
    console.log('[TEST 11] Kill Switch Blocks Preparation...');
    await killSwitch.triggerEmergencyHalt('MANUAL_TEST_KILL_SWITCH');

    const killSwitchPrep = await manualTradeService.prepareManualTrade({
      symbol: 'NIFTY 24000 CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 0.50
    });

    if (killSwitchPrep.ready !== false) {
      throw new Error('Preparation must be blocked when kill switch is halted');
    }
    if (!killSwitchPrep.rejectionReasons.some(r => r.includes('EMERGENCY_KILL_SWITCH_ACTIVE'))) {
      throw new Error('Expected EMERGENCY_KILL_SWITCH_ACTIVE rejection reason');
    }
    console.log('  ✓ [11] Active kill switch strictly blocks trade preparation.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 12: Emergency Kill Switch Halts Confirmation
    // -------------------------------------------------------------
    console.log('[TEST 12] Kill Switch Blocks Confirmation...');
    // Prepare while reset
    killSwitch.resumeTrading();
    const prepForKill = await manualTradeService.prepareManualTrade({
      symbol: 'NIFTY 24000 CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 0.50
    });

    // Now trigger kill switch before confirmation
    await killSwitch.triggerEmergencyHalt('PRE_CONFIRM_HALT');
    let killConfirmBlocked = false;
    try {
      await manualTradeService.confirmAndExecuteManualTrade({
        authorizationId: prepForKill.authorizationId!,
        authorizationToken: prepForKill.authorizationToken!,
        confirmedTrade: {
          broker: 'FIVE_PAISA',
          symbol: 'NIFTY 24000 CE',
          side: 'BUY',
          orderType: 'LIMIT',
          quantity: 25,
          price: 0.50
        },
        operatorConfirmed: true
      });
    } catch (err: any) {
      killConfirmBlocked = true;
      if (!err.message.includes('EMERGENCY_KILL_SWITCH_ACTIVE')) {
        throw new Error(`Expected EMERGENCY_KILL_SWITCH_ACTIVE, got: ${err.message}`);
      }
    }

    if (!killConfirmBlocked) {
      throw new Error('Kill switch must block live confirmation');
    }
    killSwitch.resumeTrading(); // restore
    console.log('  ✓ [12] Kill switch triggered prior to confirmation halts submission.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 13: Expiration (2-Minute TTL) Rejection
    // -------------------------------------------------------------
    console.log('[TEST 13] Authorization Expiration (TTL)...');
    const prepExpired = await manualTradeService.prepareManualTrade({
      symbol: 'NIFTY 24000 CE',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 25,
      price: 0.50
    });

    // Force expires_at into the past in SQLite
    await executeRun(
      'UPDATE manual_trade_authorizations SET expires_at = ? WHERE id = ?',
      [Date.now() - 5000, prepExpired.authorizationId!]
    );

    let expiredErrorCaught = false;
    try {
      await manualTradeService.confirmAndExecuteManualTrade({
        authorizationId: prepExpired.authorizationId!,
        authorizationToken: prepExpired.authorizationToken!,
        confirmedTrade: {
          broker: 'FIVE_PAISA',
          symbol: 'NIFTY 24000 CE',
          side: 'BUY',
          orderType: 'LIMIT',
          quantity: 25,
          price: 0.50
        },
        operatorConfirmed: true
      });
    } catch (err: any) {
      expiredErrorCaught = true;
      if (!err.message.includes('AUTHORIZATION_EXPIRED')) {
        throw new Error(`Expected AUTHORIZATION_EXPIRED, got: ${err.message}`);
      }
    }

    if (!expiredErrorCaught) {
      throw new Error('Expired authorization must be rejected');
    }
    console.log('  ✓ [13] Expired manual authorization (TTL elapsed) rejected before submission.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 14: Direct Adapter Placement Without Authorization Remains Blocked
    // -------------------------------------------------------------
    console.log('[TEST 14] Direct Broker Adapter Placement Without Auth...');
    let directCallBlocked = false;
    try {
      await adapter.placeOrder({
        market: 'INDIAN_OPTIONS',
        symbol: 'NIFTY 24000 CE',
        side: 'BUY',
        orderType: 'LIMIT',
        quantity: 25,
        price: 0.50
      });
    } catch (err: any) {
      directCallBlocked = true;
    }

    if (!directCallBlocked) {
      throw new Error('Direct placeOrder without authorization must remain blocked');
    }
    console.log('  ✓ [14] Direct un-authorized broker adapter call remains strictly blocked.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 15: Recent Authorizations Audit Table
    // -------------------------------------------------------------
    console.log('[TEST 15] Recent Authorizations Persistence & Query...');
    const recent = await manualTradeService.getRecentAuthorizations(10);
    if (!Array.isArray(recent) || recent.length === 0) {
      throw new Error('Recent authorizations must return records');
    }
    const hasFilledOrAccepted = recent.some(r => r.status === 'ACCEPTED' || r.status === 'FILLED');
    if (!hasFilledOrAccepted) {
      throw new Error('Recent records must include accepted or filled trade');
    }
    console.log(`  ✓ [15] SQLite persists complete authorization lifecycle (${recent.length} records retrieved).`);
    passedTests++;

    // -------------------------------------------------------------
    // Test 16: Zero Modification of Global Auto Execution Engine
    // -------------------------------------------------------------
    console.log('[TEST 16] Zero Modification of Global Auto Execution Engine...');
    if (isExecutionGateUnlocked()) {
      throw new Error('Autonomous gate must still be locked after all manual tests');
    }
    console.log('  ✓ [16] Global autonomous execution gate remained locked throughout all manual trade operations.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 17: Reference-Only FX Rate Rejection for Forex Trades
    // -------------------------------------------------------------
    console.log('[TEST 17] Reference-Only FX Rate Rejection...');
    const fxProvider = FXRateProvider.getInstance();
    fxProvider.updateRate(86.50, 'RBI Ref', 'REFERENCE', 'REFERENCE');
    const refFxResult = calculateTradeOutlayInr({
      broker: 'CTRADER',
      market: 'FOREX',
      symbol: 'USD/INR',
      side: 'BUY',
      quantity: 1,
      price: 1.0,
      quoteCurrency: 'USD'
    });
    if (!refFxResult.error || !refFxResult.error.includes('REFERENCE_FX_RATE_REJECTED')) {
      throw new Error(`Expected REFERENCE_FX_RATE_REJECTED, got error: ${refFxResult.error}`);
    }
    console.log('  ✓ [17] Reference-only FX rate cleanly rejected.');
    passedTests++;

    // -------------------------------------------------------------
    // Test 18: Stale FX Rate Rejection
    // -------------------------------------------------------------
    console.log('[TEST 18] Stale FX Rate Rejection...');
    fxProvider.invalidateRate('STALE');
    const staleFxResult = calculateTradeOutlayInr({
      broker: 'CTRADER',
      market: 'FOREX',
      symbol: 'USD/INR',
      side: 'BUY',
      quantity: 1,
      price: 1.0,
      quoteCurrency: 'USD'
    });
    if (!staleFxResult.error || (!staleFxResult.error.includes('STALE_FX_RATE') && !staleFxResult.error.includes('MISSING_FX_CONVERSION_RATE'))) {
      throw new Error(`Expected STALE_FX_RATE or MISSING_FX_CONVERSION_RATE, got error: ${staleFxResult.error}`);
    }
    fxProvider.updateRate(86.50, 'RBI Trade', 'TRADE_TIME', 'FRESH'); // restore valid rate
    console.log('  ✓ [18] Stale FX rate cleanly rejected.');
    passedTests++;

    console.log('================================================================');
    console.log(`   ✓ ALL ${passedTests}/${totalTests} PHASE C MANUAL TRADE TESTS PASSED`);
    console.log('================================================================');
  } finally {
    // Restore fetch
    global.fetch = originalFetch;

    // Cleanup test database
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    }
  }
}

runManualTradeCertificationTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
  });
