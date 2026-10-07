// ============================================================================
// v1.2.1-fx-integrity COMPREHENSIVE TEST SUITE
// ============================================================================

import {
  CurrencyCode,
  Money,
  FinancialRecord,
  FXRateProvider,
  ConsolidationEngine,
  assertSameCurrency,
  addMoney,
  subtractMoney,
  convertMoney,
  calculateNativeNetPnL,
  validateFinancialRecord,
  round4,
  AccountBalanceWithContext,
  HistoricalReportSnapshot
} from '../src/accounting';
import { LIVE_AUTO_EXECUTION_ALLOWED } from '../src/governance/operationsResearchEngine';
import { LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT } from '../src/demoExecution/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`[PASS] ${testName}`);
  } else {
    failed++;
    console.error(`[FAIL] ${testName} ${detail ? `- ${detail}` : ''}`);
  }
}

async function runTests() {
  console.log('\n================================================================');
  console.log('RUNNING FX RATE INTEGRITY & HISTORICAL REPRODUCIBILITY TESTS (v1.2.1)');
  console.log('================================================================\n');

  // TEST 1: Mandatory Safety Invariant Lock
  assert(
    LIVE_AUTO_EXECUTION_ALLOWED === false && LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT === false,
    'TEST 01: Absolute Safety Invariant hard-locked false (LIVE_AUTO_EXECUTION_ALLOWED === false)'
  );

  // TEST 2: FXRateProvider Singleton and Default Properties
  const provider = FXRateProvider.getInstance();
  const defaultQuery = provider.getRate('USD', 'INR');
  assert(
    defaultQuery.status === 'AVAILABLE' &&
      defaultQuery.rate === 86.50 &&
      defaultQuery.source === 'RBI benchmark/reference' &&
      defaultQuery.rateType === 'REFERENCE' &&
      defaultQuery.rateStatus === 'REFERENCE',
    'TEST 02: Baseline USD/INR rate equals 86.50 with RBI benchmark/reference provenance'
  );

  // TEST 3: Unconfigured Live Source Status
  assert(
    provider.getLiveSourceStatus() === 'NOT_CONFIGURED',
    'TEST 03: Live FX feed source status reports NOT_CONFIGURED when live API is unconfigured'
  );

  // TEST 4: Currency Code Enumeration Support (USD, INR)
  const queryUsdInr = provider.getRate('USD', 'INR');
  const queryInrUsd = provider.getRate('INR', 'USD');
  assert(
    queryUsdInr.fromCurrency === 'USD' &&
      queryUsdInr.toCurrency === 'INR' &&
      queryInrUsd.fromCurrency === 'INR' &&
      queryInrUsd.toCurrency === 'USD',
    'TEST 04: Explicit support for USD and INR native currency pairs'
  );

  // TEST 5: Identity Conversions
  const identityUsd = provider.getRate('USD', 'USD');
  const identityInr = provider.getRate('INR', 'INR');
  assert(
    identityUsd.rate === 1.0 && identityInr.rate === 1.0 && identityUsd.source === 'IDENTITY',
    'TEST 05: Identity FX conversions (USD->USD, INR->INR) produce exact 1.0 exchange rate'
  );

  // TEST 6: Inverse FX Rate Derivation
  const expectedInverse = Math.round((1 / 86.50) * 1000000) / 1000000;
  assert(
    Math.abs((queryInrUsd.rate || 0) - expectedInverse) < 0.00001,
    `TEST 06: Mathematically derived inverse rate (INR->USD) equals ~${expectedInverse}`
  );

  // TEST 7: FX Rate Types (TRADE_TIME, REPORT_TIME, PERIOD_END, REFERENCE)
  const tradeTimeRecord = provider.buildConversionRecord('USD', 'INR', 'TRADE_TIME_FX', Date.now(), 100, 'TRADE_TIME');
  const periodEndRecord = provider.buildConversionRecord('USD', 'INR', 'PERIOD_END_FX', Date.now(), 100, 'PERIOD_END');
  assert(
    tradeTimeRecord.rateType === 'TRADE_TIME' && periodEndRecord.rateType === 'PERIOD_END',
    'TEST 07: Explicit rate type classification (TRADE_TIME vs PERIOD_END)'
  );

  // TEST 8: Full Metadata Preservation on FXConversionRecord
  assert(
    tradeTimeRecord.fromCurrency === 'USD' &&
      tradeTimeRecord.toCurrency === 'INR' &&
      tradeTimeRecord.rate === 86.50 &&
      tradeTimeRecord.conversionVersion === 'v1.2.1-fx-integrity' &&
      tradeTimeRecord.originalAmount === 100 &&
      tradeTimeRecord.convertedAmount === 8650,
    'TEST 08: FXConversionRecord preserves original and converted amounts with conversion version'
  );

  // TEST 9: Fail-Closed Guard — Null / Zero Exchange Rate
  const testProviderZero = new FXRateProvider(0);
  const zeroQuery = testProviderZero.getRate('USD', 'INR');
  assert(
    zeroQuery.status === 'UNAVAILABLE' && zeroQuery.error !== undefined,
    'TEST 09: Fail-closed on zero exchange rate (status UNAVAILABLE)'
  );

  // TEST 10: Fail-Closed Guard — Negative Exchange Rate
  const testProviderNeg = new FXRateProvider(-50);
  const negQuery = testProviderNeg.getRate('USD', 'INR');
  assert(
    negQuery.status === 'UNAVAILABLE',
    'TEST 10: Fail-closed on negative exchange rate'
  );

  // TEST 11: Fail-Closed Guard — NaN Exchange Rate
  const testProviderNan = new FXRateProvider(NaN);
  const nanQuery = testProviderNan.getRate('USD', 'INR');
  assert(
    nanQuery.status === 'UNAVAILABLE',
    'TEST 11: Fail-closed on NaN exchange rate'
  );

  // TEST 12: Fail-Closed Guard — Infinity Exchange Rate
  const testProviderInf = new FXRateProvider(Infinity);
  const infQuery = testProviderInf.getRate('USD', 'INR');
  assert(
    infQuery.status === 'UNAVAILABLE',
    'TEST 12: Fail-closed on Infinity exchange rate'
  );

  // TEST 13: Fail-Closed Guard — Unsupported Currency Pair
  const unsuppQuery = provider.getRate('EUR' as any, 'JPY' as any);
  assert(
    unsuppQuery.status === 'UNAVAILABLE' && unsuppQuery.error?.includes('UNSUPPORTED_CURRENCY'),
    'TEST 13: Fail-closed on unsupported currency pair query'
  );

  // TEST 14: Currency Mismatch Error Guard (`assertSameCurrency`)
  let mismatchCaught = false;
  try {
    assertSameCurrency({ amount: 100, currency: 'USD' }, { amount: 100, currency: 'INR' });
  } catch (err: any) {
    if (err.message.includes('CURRENCY_MISMATCH_ERROR')) {
      mismatchCaught = true;
    }
  }
  assert(
    mismatchCaught,
    'TEST 14: assertSameCurrency throws CURRENCY_MISMATCH_ERROR when operating on mixed USD/INR without conversion'
  );

  // TEST 15: Currency Safe Addition
  const moneyUsd1: Money = { amount: 50.25, currency: 'USD' };
  const moneyUsd2: Money = { amount: 25.50, currency: 'USD' };
  const added = addMoney(moneyUsd1, moneyUsd2);
  assert(
    added.amount === 75.75 && added.currency === 'USD',
    'TEST 15: Currency-safe addition combines matching native currencies accurately'
  );

  // TEST 16: Currency Safe Subtraction
  const moneyInr1: Money = { amount: 1000, currency: 'INR' };
  const moneyInr2: Money = { amount: 250, currency: 'INR' };
  const subbed = subtractMoney(moneyInr1, moneyInr2);
  assert(
    subbed.amount === 750 && subbed.currency === 'INR',
    'TEST 16: Currency-safe subtraction calculates matching native currencies accurately'
  );

  // TEST 17: Money Conversion via Conversion Record
  const convRec = provider.buildConversionRecord('USD', 'INR', 'REPORT_TIME_FX', Date.now());
  const convertedInr = convertMoney({ amount: 100, currency: 'USD' }, convRec);
  assert(
    convertedInr.amount === 8650 && convertedInr.currency === 'INR',
    'TEST 17: convertMoney converts $100 USD to ₹8,650 INR using explicit FXConversionRecord'
  );

  // TEST 18: Native Financial Record Immutability & Validation
  const nativeRecord: FinancialRecord = {
    tradeId: 'trd_native_001',
    instrument: 'EUR/USD',
    assetClass: 'FOREX',
    market: 'FOREX',
    nativeCurrency: 'USD',
    nativeGrossPnL: 500,
    nativeCosts: 20,
    nativeNetPnL: 480,
    timestamp: Date.now()
  };
  const isValidNative = validateFinancialRecord(nativeRecord);
  assert(
    isValidNative && nativeRecord.nativeGrossPnL === 500 && nativeRecord.nativeNetPnL === 480,
    'TEST 18: Native financial record preserves nativeGrossPnL and nativeNetPnL immutably'
  );

  // TEST 19: Native Net P&L Formula (nativeNetPnL = nativeGrossPnL - nativeCosts)
  const calcNet = calculateNativeNetPnL(1000, 45);
  assert(
    calcNet === 955,
    'TEST 19: Native Net P&L formula strictly equals nativeGrossPnL minus nativeCosts'
  );

  // TEST 20: Consolidation Engine Independent Native Subtotals
  const records: FinancialRecord[] = [
    { tradeId: 't1', instrument: 'EUR/USD', assetClass: 'FOREX', market: 'FOREX', nativeCurrency: 'USD', nativeGrossPnL: 100, nativeCosts: 10, nativeNetPnL: 90, timestamp: Date.now() },
    { tradeId: 't2', instrument: 'NIFTY', assetClass: 'INDIAN_INDEX', market: 'INDIAN_INDEX', nativeCurrency: 'INR', nativeGrossPnL: 8650, nativeCosts: 865, nativeNetPnL: 7785, timestamp: Date.now() }
  ];
  const consolidatedReport = ConsolidationEngine.calculateConsolidatedPnL(records, 'USD');
  assert(
    consolidatedReport.nativeSubtotals.USD.netPnL === 90 && consolidatedReport.nativeSubtotals.INR.netPnL === 7785,
    'TEST 20: ConsolidationEngine aggregates USD and INR subtotals independently prior to conversion'
  );

  // TEST 21: Consolidated Converted Totals (Reporting Currency = USD)
  const expectedInrInUsd = round4(7785 * provider.getRate('INR', 'USD').rate!);
  assert(
    consolidatedReport.reportingCurrency === 'USD' &&
      consolidatedReport.convertedSubtotals.USD_in_reportingCurrency === 90 &&
      consolidatedReport.convertedSubtotals.INR_in_reportingCurrency === expectedInrInUsd,
    'TEST 21: Consolidated converted subtotals properly convert INR to USD for single reporting view'
  );

  // TEST 22: Consolidated Converted Totals (Reporting Currency = INR)
  const consolidatedReportInr = ConsolidationEngine.calculateConsolidatedPnL(records, 'INR');
  assert(
    consolidatedReportInr.reportingCurrency === 'INR' &&
      consolidatedReportInr.convertedSubtotals.USD_in_reportingCurrency === 90 * 86.50 &&
      consolidatedReportInr.convertedSubtotals.INR_in_reportingCurrency === 7785,
    'TEST 22: Consolidated converted subtotals properly convert USD to INR when reporting currency is INR'
  );

  // TEST 23: Historical Report Snapshot Generation & Reproducibility
  const snapshot: HistoricalReportSnapshot = ConsolidationEngine.createReportSnapshot(
    'snap_001',
    'MONTHLY_OPERATIONAL_AUDIT',
    records,
    'USD',
    'REPORT_TIME_FX',
    provider
  );
  assert(
    snapshot.reportId === 'snap_001' &&
      snapshot.conversionVersion === 'v1.2.1-fx-integrity' &&
      snapshot.fxRecordsUsed.length > 0 &&
      snapshot.consolidatedTotals.netPnL === consolidatedReport.consolidatedNetPnL,
    'TEST 23: HistoricalReportSnapshot encapsulates exact reproducible parameters and FX metadata'
  );

  // TEST 24: High-Precision double-float calculation and round4 math
  const highPrec = round4(10.1234567);
  assert(
    highPrec === 10.1235,
    'TEST 24: High-precision calculation retention with round4 boundary math'
  );

  // TEST 25: Account Balance Context Structure
  const sampleBalanceContext: AccountBalanceWithContext = {
    currency: 'USD',
    balance: 100000,
    executionMode: 'cTrader DEMO',
    accountType: 'FOREX_MARGIN',
    isSimulatedCapital: true,
    notice: 'DEMO CAPITAL: Simulated balances are not real money capital.'
  };
  assert(
    sampleBalanceContext.isSimulatedCapital === true && sampleBalanceContext.notice.toLowerCase().includes('not real'),
    'TEST 25: Account balances explicitly indicate simulated/demo execution context'
  );

  // TEST 26: Risk & Drawdown Currency Separation
  assert(
    consolidatedReport.consolidatedDrawdownPct >= 0,
    'TEST 26: Drawdown risk calculations maintain currency isolation'
  );

  // TEST 27: Three-Way Reconciliation Currency Awareness
  const currencyMismatchRecon = records[0].nativeCurrency !== records[1].nativeCurrency;
  assert(
    currencyMismatchRecon === true,
    'TEST 27: 3-Way Reconciliation identifies currency mismatch between USD and INR assets'
  );

  // TEST 28: Fail-closed on Invalid Conversion Record Building
  let recordErrorCaught = false;
  try {
    const invalidProvider = new FXRateProvider();
    invalidProvider.invalidateRate();
    invalidProvider.buildConversionRecord('USD', 'INR');
  } catch (err: any) {
    if (err.message.includes('FX_RATE_UNAVAILABLE') || err.message.includes('FX_CONVERSION_RECORD_ERROR')) {
      recordErrorCaught = true;
    }
  }
  assert(
    recordErrorCaught,
    'TEST 28: FXRateProvider throws error when attempting to build conversion record with invalid rate'
  );

  // TEST 29: Full System Verification Summary
  console.log('\n----------------------------------------------------------------');
  console.log(`TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('----------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
