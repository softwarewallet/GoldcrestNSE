// ============================================================================
// COMPREHENSIVE MULTI-CURRENCY ACCOUNTING & CONSOLIDATION TEST SUITE
// ============================================================================

import {
  CurrencyCode,
  FinancialRecord,
  Money,
  assertSameCurrency,
  addMoney,
  subtractMoney,
  convertMoney,
  calculateNativeNetPnL,
  round4,
  FXRateProvider,
  ConsolidationEngine,
  DrawdownRiskEngine,
  getNativeCurrencyForMarket
} from '../src/accounting';
import { operationsResearchEngine, LIVE_AUTO_EXECUTION_ALLOWED } from '../src/governance/operationsResearchEngine';

async function runMultiCurrencyTests() {
  console.log('================================================================');
  console.log('STARTING MULTI-CURRENCY ACCOUNTING & CONSOLIDATION VERIFICATION');
  console.log('================================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail || 'Assertion failed'}`);
      failedTests++;
    }
  }

  // -------------------------------------------------------------
  // TEST 1: ABSOLUTE SAFETY INVARIANT VERIFICATION
  // -------------------------------------------------------------
  try {
    assert(
      LIVE_AUTO_EXECUTION_ALLOWED === false,
      'Test 1: ABSOLUTE SAFETY INVARIANT - LIVE_AUTO_EXECUTION_ALLOWED is false',
      `Expected false, got ${LIVE_AUTO_EXECUTION_ALLOWED}`
    );
    operationsResearchEngine.verifySafetyInvariant();
    assert(true, 'Test 1.1: LiveTradingGate.verifySafetyInvariant() passed without throwing');
  } catch (err: any) {
    assert(false, 'Test 1.1: LiveTradingGate.verifySafetyInvariant() threw error', err.message);
  }

  // -------------------------------------------------------------
  // TEST 2: NATIVE CURRENCY MARKET MAPPING
  // -------------------------------------------------------------
  assert(
    getNativeCurrencyForMarket('FOREX') === 'USD',
    'Test 2.1: FOREX native currency is USD'
  );
  assert(
    getNativeCurrencyForMarket('INDIAN_EQUITY') === 'INR',
    'Test 2.2: INDIAN_EQUITY native currency is INR'
  );
  assert(
    getNativeCurrencyForMarket('INDIAN_FUTURES') === 'INR',
    'Test 2.3: INDIAN_FUTURES native currency is INR'
  );
  assert(
    getNativeCurrencyForMarket('INDIAN_OPTIONS') === 'INR',
    'Test 2.4: INDIAN_OPTIONS native currency is INR'
  );
  assert(
    getNativeCurrencyForMarket('INDIAN_INDEX') === 'INR',
    'Test 2.5: INDIAN_INDEX native currency is INR'
  );

  // -------------------------------------------------------------
  // TEST 3: STRICT CURRENCY ARITHMETIC SAFETY (FAIL-CLOSED)
  // -------------------------------------------------------------
  const usd100: Money = { amount: 100, currency: 'USD' };
  const usd50: Money = { amount: 50, currency: 'USD' };
  const inr8650: Money = { amount: 8650, currency: 'INR' };

  // 3.1 Adding same currency (USD + USD)
  try {
    const sum = addMoney(usd100, usd50);
    assert(
      sum.amount === 150 && sum.currency === 'USD',
      'Test 3.1: Same-currency addition (USD + USD = 150 USD)'
    );
  } catch (err: any) {
    assert(false, 'Test 3.1: Same-currency addition threw unexpected error', err.message);
  }

  // 3.2 Subtracting same currency (USD - USD)
  try {
    const diff = subtractMoney(usd100, usd50);
    assert(
      diff.amount === 50 && diff.currency === 'USD',
      'Test 3.2: Same-currency subtraction (USD - USD = 50 USD)'
    );
  } catch (err: any) {
    assert(false, 'Test 3.2: Same-currency subtraction threw unexpected error', err.message);
  }

  // 3.3 Attempting direct addition between USD and INR (MUST THROW)
  let threwMismatch = false;
  try {
    addMoney(usd100, inr8650);
  } catch (err: any) {
    threwMismatch = err.message.includes('CURRENCY_MISMATCH_ERROR');
  }
  assert(
    threwMismatch,
    'Test 3.3: Direct USD + INR addition is blocked (CURRENCY_MISMATCH_ERROR)'
  );

  // -------------------------------------------------------------
  // TEST 4: FX CONVERSION ENGINE & RATE PROVIDER
  // -------------------------------------------------------------
  const fxProvider = new FXRateProvider(86.50, 'RBI_BENCHMARK');

  // 4.1 Same currency identity conversion
  const identityQuery = fxProvider.getRate('USD', 'USD');
  assert(
    identityQuery.status === 'AVAILABLE' && identityQuery.rate === 1.0,
    'Test 4.1: FXRateProvider returns 1.0 rate for same-currency identity'
  );

  // 4.2 USD -> INR conversion
  const usdInrRecord = fxProvider.buildConversionRecord('USD', 'INR');
  assert(
    usdInrRecord.rate === 86.50,
    'Test 4.2: USD -> INR benchmark conversion rate is 86.50'
  );

  const convertedInr = convertMoney(usd100, usdInrRecord);
  assert(
    convertedInr.amount === 8650 && convertedInr.currency === 'INR',
    'Test 4.3: Converted $100 USD at 86.50 rate = ₹8,650 INR'
  );

  // 4.4 INR -> USD inverse conversion
  const inrUsdRecord = fxProvider.buildConversionRecord('INR', 'USD');
  const convertedUsd = convertMoney(inr8650, inrUsdRecord);
  assert(
    Math.abs(convertedUsd.amount - 100) < 0.01 && convertedUsd.currency === 'USD',
    `Test 4.4: Converted ₹8,650 INR at inverse rate = $${convertedUsd.amount} USD`
  );

  // 4.5 Rejection of invalid FX conversion rate (zero or negative)
  let threwZeroRate = false;
  try {
    convertMoney(usd100, {
      fromCurrency: 'USD',
      toCurrency: 'INR',
      rate: 0,
      effectiveAt: Date.now(),
      retrievedAt: Date.now(),
      source: 'INVALID',
      rateType: 'REFERENCE',
      methodology: 'REPORT_TIME_FX',
      conversionVersion: 'v1.2.0',
      status: 'INVALID'
    });
  } catch (err: any) {
    threwZeroRate = err.message.includes('FX_CONVERSION_ERROR');
  }
  assert(
    threwZeroRate,
    'Test 4.5: FX conversion rejects zero or negative rate (FX_CONVERSION_ERROR)'
  );

  // -------------------------------------------------------------
  // TEST 5: NATIVE P&L AND COST FORMULA INTEGRITY
  // -------------------------------------------------------------
  const nativeNet = calculateNativeNetPnL(1500.00, 50.00);
  assert(
    nativeNet === 1450.00,
    'Test 5.1: nativeNetPnL = nativeGrossPnL - nativeCosts (1500 - 50 = 1450)'
  );

  // -------------------------------------------------------------
  // TEST 6: MULTI-CURRENCY CONSOLIDATION ENGINE
  // -------------------------------------------------------------
  const sampleLedgerRecords: FinancialRecord[] = [
    // USD Native Forex Trades
    { tradeId: 'trd_01', instrument: 'EUR/USD', assetClass: 'FOREX', market: 'FOREX', nativeCurrency: 'USD', nativeGrossPnL: 2000.00, nativeCosts: 50.00, nativeNetPnL: 1950.00, timestamp: Date.now() - 1000 },
    { tradeId: 'trd_02', instrument: 'GBP/USD', assetClass: 'FOREX', market: 'FOREX', nativeCurrency: 'USD', nativeGrossPnL: -500.00, nativeCosts: 30.00, nativeNetPnL: -530.00, timestamp: Date.now() - 500 },

    // INR Native Indian Market Trades
    { tradeId: 'trd_03', instrument: 'NIFTY', assetClass: 'INDIAN_INDEX', market: 'INDIAN_INDEX', nativeCurrency: 'INR', nativeGrossPnL: 86500.00, nativeCosts: 2162.50, nativeNetPnL: 84337.50, timestamp: Date.now() - 200 }
  ];

  // Consolidated USD Report
  const consolidatedUsd = ConsolidationEngine.calculateConsolidatedPnL(sampleLedgerRecords, 'USD', 'REPORT_TIME_FX', fxProvider);

  assert(
    consolidatedUsd.nativeSubtotals.USD.netPnL === 1420.00,
    'Test 6.1: USD Native Net P&L subtotal is preserved cleanly ($1,420 USD)'
  );
  assert(
    consolidatedUsd.nativeSubtotals.INR.netPnL === 84337.50,
    'Test 6.2: INR Native Net P&L subtotal is preserved cleanly (₹84,337.50 INR)'
  );

  // Converted INR portion in USD: 84337.50 / 86.50 = 975 USD
  // Total Consolidated Net P&L in USD: 1420 + 975 = 2395 USD
  assert(
    Math.abs(consolidatedUsd.consolidatedNetPnL - 2395.00) < 0.1,
    `Test 6.3: Consolidated Net P&L in USD = $${consolidatedUsd.consolidatedNetPnL} ($1,420 USD + $975 converted INR)`
  );

  // Consolidated INR Report
  const consolidatedInr = ConsolidationEngine.calculateConsolidatedPnL(sampleLedgerRecords, 'INR', 'REPORT_TIME_FX', fxProvider);
  assert(
    consolidatedInr.reportingCurrency === 'INR',
    'Test 6.4: Consolidated report supports INR as reporting currency'
  );

  // -------------------------------------------------------------
  // TEST 7: DRAWDOWN & RISK METRICS ISOLATION
  // -------------------------------------------------------------
  const drawdowns = DrawdownRiskEngine.calculateNativeDrawdowns(sampleLedgerRecords);
  assert(
    typeof drawdowns.USD === 'number' && typeof drawdowns.INR === 'number',
    'Test 7.1: Isolated drawdowns calculated for both USD and INR streams'
  );

  // -------------------------------------------------------------
  // TEST 8: DAILY OPERATIONS SUMMARY WITH MULTI-CURRENCY REPORT
  // -------------------------------------------------------------
  const dailySummary = operationsResearchEngine.generateDailyOperationsSummary();
  assert(
    dailySummary.multiCurrencyReport !== undefined,
    'Test 8.1: Daily Operations Summary contains multiCurrencyReport'
  );
  assert(
    dailySummary.multiCurrencyReport.forexNativeUsd.netPnL > 0,
    'Test 8.2: Forex Native USD Net P&L present in Daily Summary'
  );
  assert(
    dailySummary.multiCurrencyReport.indianMarketsNativeInr.netPnL > 0,
    'Test 8.3: Indian Markets Native INR Net P&L present in Daily Summary'
  );
  assert(
    dailySummary.multiCurrencyReport.fxBenchmarkRateUsdInr === 86.50,
    'Test 8.4: Benchmark FX Rate 86.50 reported in Daily Summary'
  );

  console.log('\n================================================================');
  console.log(`MULTI-CURRENCY ACCOUNTING RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runMultiCurrencyTests().catch(err => {
  console.error('Multi-currency test runner fatal error:', err);
  process.exit(1);
});
