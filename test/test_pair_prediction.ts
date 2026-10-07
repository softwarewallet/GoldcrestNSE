import assert from 'node:assert/strict';
import { executeRun, executeQuery } from '../src/database/db';
import { generateCurrentPairPredictions } from '../src/services/pairPredictionService';
import { ScannerService } from '../src/services/scannerService';
import { LiveForexProvider } from '../src/markets/forex/provider';
import { ForexSignalEngine } from '../src/markets/forex/signalEngine';

const scanner = new ScannerService();
const serviceModule = await import('../src/services/pairPredictionService') as any;
void serviceModule;

const original = ScannerService.prototype.getForexScanner;
const originalRefresh = LiveForexProvider.prototype.refreshPair;
const originalGetCandles = LiveForexProvider.prototype.getCandles;
const originalAnalyze = ForexSignalEngine.prototype.analyzePair;
LiveForexProvider.prototype.refreshPair = async function () {};
LiveForexProvider.prototype.getCandles = function () { return [] as any; };
ForexSignalEngine.prototype.analyzePair = function () { return {
  pair: 'EUR/USD', status: 'LIVE', currentPrice: 1.1, pipSize: 0.0001, spreadPips: 2, session: 'LONDON', regime: 'TRENDING',
  trend: { direction: 'bullish', strength: 82 },
  marketStructure: { type: 'higher_high_higher_low', phase: 'trend_continuation', breakoutStatus: 'none' },
  multiTimeframe: { '5m': 'bullish', '15m': 'bullish', '1h': 'bullish', '4h': 'bullish', 'daily': 'bullish', alignment: 'STRONG_BULLISH_ALIGNMENT', summary: 'Strong bullish alignment' },
  indicators: { rsi: 61, macdHistogram: 0.0005, adx: 28, atr: 0.0015 },
  supportResistance: { nearestSupport: 1.098, nearestResistance: 1.11 },
  signal: { direction: 'BUY', score: 84, status: 'WAITING_FOR_ENTRY', category: 'BUY' },
  tradePlan: { entryMin: 1.1, entryMax: 1.101, stopLoss: 1.098, takeProfit1: 1.106, riskReward: 2 }, warnings: []
} as any; };
ScannerService.prototype.getForexScanner = async function () {
  return [{
    symbol: 'EUR/USD',
    bid: 1.1001,
    ask: 1.1003,
    spreadPips: 2,
    dataStatus: 'LIVE',
    signal: {
      id: 'pair-pred-test-1',
      timestamp: Date.now(),
      direction: 'BUY',
      score: 84,
      mlProbability: 0.82,
      strategy: 'TEST_STRATEGY',
      scoreBreakdown: { trend: 12 },
      entryZone: { preferred: 1.1002 },
      stopLoss: 1.0982,
      target1: 1.1042,
      riskReward: 2
    }
  }] as any;
};

try {
  await executeRun("DELETE FROM live_trade_research_predictions WHERE symbol = 'EUR/USD' AND model_version = 'PAIR_FEATURE_BASELINE_V2' AND horizon = '1D'");
  const predictions = await generateCurrentPairPredictions({
    pairs: ['EUR/USD'],
    horizon: '1D',
    model: 'BASELINE'
  });
  assert.equal(predictions.length, 1);
  assert.equal(predictions[0].symbol, 'EUR/USD');
  assert.equal(predictions[0].predictedDirection, 'UP');
  assert.equal(predictions[0].modelVersion, 'PAIR_FEATURE_BASELINE_V2');
  assert.equal(predictions[0].signalDirection, 'BUY');
  assert.equal(predictions[0].signalScore, 84);
  assert.equal(predictions[0].dataStatus, 'LIVE');
  assert.equal(predictions[0].bid, 1.1001);
  assert.equal(predictions[0].ask, 1.1003);
  assert.equal(predictions[0].mlProbability, 0.82);
  assert.ok(predictions[0].generatedAt > 0);
  const persisted = await executeQuery<any>('SELECT * FROM live_trade_research_predictions WHERE prediction_id = ? LIMIT 1', [predictions[0].predictionId]);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].outcome_status, 'PENDING');
  assert.ok(typeof persisted[0].feature_snapshot_json === 'string');
  const snapshot = JSON.parse(persisted[0].feature_snapshot_json);
  assert.equal(snapshot.symbol, 'EUR/USD');
  assert.equal(snapshot.rsi, 61);
} finally {
  await executeRun("DELETE FROM live_trade_research_predictions WHERE symbol = 'EUR/USD' AND model_version = 'PAIR_FEATURE_BASELINE_V2' AND horizon = '1D'");
  ScannerService.prototype.getForexScanner = original;
  LiveForexProvider.prototype.refreshPair = originalRefresh;
  LiveForexProvider.prototype.getCandles = originalGetCandles;
  ForexSignalEngine.prototype.analyzePair = originalAnalyze;
}

console.log('CURRENT PAIR PREDICTION TEST PASSED');
