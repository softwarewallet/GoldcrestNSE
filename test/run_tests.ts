import { calculateEMA, calculateRSI, calculateSMA, calculateVWAP } from '../src/markets/common/indicators';
import { getForexSessionState, getIndianSessionState } from '../src/markets/common/session';
import { calculatePipDistance, getForexPairConfig, FOREX_PAIRS } from '../src/markets/forex/instruments';
import { INDIAN_UNDERLYINGS, getIndianUnderlyingConfig } from '../src/markets/india_equity/underlyings';
import { calculateBlackScholesGreeks } from '../src/markets/india_options/greeks';
import { calculateStrategyPayoff } from '../src/markets/india_options/strategySkeleton';
import { getDatabase, executeQuery } from '../src/database/db';
import { evaluateForexSetup } from '../src/markets/forex/forexEngine';
import { generateDemoCandles } from '../src/services/providers';
import { brokerRegistry } from '../src/brokers/registry';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING AI TRADING ANALYST (PHASE 1) TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  console.log('[Test Suite 1: Quantitative Indicators]');
  const testCloses = [10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const sma5 = calculateSMA(testCloses, 5);
  assert(sma5[4] === 12, 'SMA 5 correctly computes initial average (10+11+12+13+14)/5 = 12');

  const ema5 = calculateEMA(testCloses, 5);
  assert(ema5.length === testCloses.length, 'EMA returns matching length array');

  const rsi = calculateRSI(testCloses, 14);
  const lastRsi = rsi[rsi.length - 1];
  assert(lastRsi > 50 && lastRsi <= 100, `RSI correctly reflects bullish run (${lastRsi})`);

  const mockCandles = [
    { timestamp: 1, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
    { timestamp: 2, open: 102, high: 108, low: 101, close: 106, volume: 2000 }
  ];
  const vwap = calculateVWAP(mockCandles);
  assert(vwap.length === 2 && vwap[1] > 100, 'VWAP correctly weighs typical price with volume');

  console.log('\n[Test Suite 2: Forex Instruments & Sessions]');
  assert(FOREX_PAIRS.length >= 13, `Forex pairs configured (${FOREX_PAIRS.length} pairs, exceeding 13 required)`);

  const eurUsd = getForexPairConfig('EUR/USD');
  assert(eurUsd.pipSize === 0.0001, 'EUR/USD pip size is 0.0001');

  const usdjpy = getForexPairConfig('USD/JPY');
  assert(usdjpy.pipSize === 0.01, 'USD/JPY pip size is 0.01');

  const pipDist = calculatePipDistance(1.0850, 1.0800, 0.0001);
  assert(Math.round(pipDist) === 50, 'Pip distance calculation (1.0850 - 1.0800) = 50 pips');

  const fxSessions = getForexSessionState(new Date('2026-09-15T14:30:00Z'));
  assert(fxSessions.isLondonNyOverlap === true, 'Forex session correctly detects London/NY Overlap at 14:30 UTC');

  console.log('\n[Test Suite 3: Indian Equity Underlyings & Sessions]');
  assert(INDIAN_UNDERLYINGS.length === 5, 'Underlyings include NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX');

  const niftyConfig = getIndianUnderlyingConfig('NIFTY');
  assert(niftyConfig.strikeStep === 50, 'NIFTY strike step is 50');
  assert(niftyConfig.lotSize > 0, `NIFTY lot size is dynamic (${niftyConfig.lotSize})`);

  const bankNiftyConfig = getIndianUnderlyingConfig('BANKNIFTY');
  assert(bankNiftyConfig.strikeStep === 100, 'BANKNIFTY strike step is 100');

  const istMarketOpenDate = new Date('2026-09-15T04:30:00Z');
  const indianSession = getIndianSessionState(istMarketOpenDate);
  assert(indianSession.isOpen === true, 'Indian market correctly recognized as OPEN at 10:00 AM IST');

  console.log('\n[Test Suite 4: Options Greeks Engine]');
  const bsCall = calculateBlackScholesGreeks(25000, 25000, 7 / 365, 0.068, 0.14, 'CALL');
  assert(bsCall.greeks.delta >= 0.45 && bsCall.greeks.delta <= 0.58, `ATM Call delta is ~0.50 (${bsCall.greeks.delta})`);
  assert(bsCall.greeks.gamma > 0, `Call gamma is strictly positive (${bsCall.greeks.gamma})`);
  assert(bsCall.greeks.theta < 0, `Call theta exhibits time decay (${bsCall.greeks.theta})`);
  assert(bsCall.greeks.modelDerived === true, 'Greeks are strictly tagged modelDerived: true');

  const bsPut = calculateBlackScholesGreeks(25000, 25000, 7 / 365, 0.068, 0.14, 'PUT');
  assert(bsPut.greeks.delta <= -0.42 && bsPut.greeks.delta >= -0.58, `ATM Put delta is ~ -0.50 (${bsPut.greeks.delta})`);

  console.log('\n[Test Suite 5: Strategy Payoff Calculations]');
  const bullCallSpread = calculateStrategyPayoff({
    strategyType: 'BULL_CALL_SPREAD',
    underlying: 'NIFTY',
    spotPrice: 25000,
    strike1: 25000,
    premium1: 180,
    strike2: 25100,
    premium2: 120,
    contractsCount: 1
  });
  assert(bullCallSpread.maxLoss === 1500, `Bull Call Spread Max Loss correctly computed (${bullCallSpread.maxLoss})`);
  assert(bullCallSpread.maxProfit === 1000, `Bull Call Spread Max Profit correctly computed (${bullCallSpread.maxProfit})`);
  assert(bullCallSpread.breakeven[0] === 25060, `Bull Call Spread Breakeven correctly computed (${bullCallSpread.breakeven[0]})`);

  console.log('\n[Test Suite 6: Signal Engine & No-Trade Filtering]');
  const flatCandles = generateDemoCandles(1.0850, 40, 0.0001, 0.0);
  const flatSignal = evaluateForexSetup('EUR/USD', flatCandles);
  assert(
    flatSignal.direction === 'NO_TRADE' || flatSignal.direction === 'WAIT',
    `System does NOT force a trade signal in flat/indecisive conditions (got ${flatSignal.direction})`
  );

  console.log('\n[Test Suite 7: SQLite Database Layer]');
  const db = await getDatabase();
  assert(db !== null, 'SQLite database initialized with WebAssembly engine');

  const markets = await executeQuery('SELECT * FROM markets');
  assert(markets.length >= 3, `Database contains seeded markets (${markets.length} found)`);

  const settings = await executeQuery('SELECT * FROM system_settings WHERE key = "TRADING_MODE"');
  assert(settings[0]?.value === 'LIVE_ONLY', 'Trading mode is persisted as LIVE_ONLY');

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
