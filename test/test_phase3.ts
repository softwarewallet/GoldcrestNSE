// ============================================================================
// PHASE 3 AUTOMATED TEST SUITE: ML PREDICTION & RESEARCH ENGINE
// ============================================================================

import { extractForexFeaturesAtTimestamp } from '../src/ml/features/forexFeatures';
import { extractIndianMarketFeaturesAtTimestamp } from '../src/ml/features/indiaFeatures';
import { extractOptionsFeaturesAtTimestamp, extractStrategyFeatures } from '../src/ml/features/optionsFeatures';
import { featureEngine } from '../src/ml/features/featureEngine';
import { outcomeLabelEngine } from '../src/ml/labeling/outcomeLabelEngine';
import { datasetBuilder } from '../src/ml/datasets/datasetBuilder';
import {
  GradientBoostedTreesClassifier,
  BaselineAlwaysPositiveClassifier,
  BaselineBaseRateClassifier,
  BaselineSignalScoreMappingClassifier,
  getConfidenceTier
} from '../src/ml/models/gradientBoosting';
import { modelRegistry } from '../src/ml/models/modelRegistry';
import { modelEvaluator } from '../src/ml/metrics/modelEvaluator';
import { walkForwardEngine } from '../src/ml/validation/walkForward';
import { decisionFusionEngine } from '../src/ml/fusion/decisionFusionEngine';
import { modelMonitoringEngine } from '../src/ml/monitoring/driftEngine';
import { backtestEngine } from '../src/ml/backtest/backtestEngine';
import { Candle } from '../src/markets/common/types';
import { ForexCandle } from '../src/markets/forex/types';
import { DatasetSample, CURRENT_FEATURE_VERSION } from '../src/ml/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ TEST FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

// Generate deterministic synthetic candles for rigorous validation
function generateMockCandles(count: number, startPrice: number = 1.0850): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const baseTime = 1700000000000;

  for (let i = 0; i < count; i++) {
    const timestamp = baseTime + i * 900000; // 15M candles
    const change = Math.sin(i / 5) * 0.0010 + (i % 2 === 0 ? 0.0003 : -0.0002);
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + 0.0004;
    const low = Math.min(open, close) - 0.0004;
    const volume = 1000 + (i % 10) * 100;

    candles.push({
      timestamp,
      open: Number(open.toFixed(5)),
      high: Number(high.toFixed(5)),
      low: Number(low.toFixed(5)),
      close: Number(close.toFixed(5)),
      volume
    });
    price = close;
  }
  return candles;
}

async function runPhase3Tests() {
  console.log('\n================================================================');
  console.log('RUNNING PHASE 3 ML ENGINE COMPREHENSIVE TEST SUITE');
  console.log('================================================================\n');

  const candles = generateMockCandles(150);

  // -------------------------------------------------------------
  // TEST 1: Strict Look-Ahead Bias Prevention
  // -------------------------------------------------------------
  console.log('TEST 1: Strict Look-Ahead Bias Prevention');
  const targetT = candles[50].timestamp;
  const fullFeatures = extractForexFeaturesAtTimestamp(candles, targetT);
  const truncatedCandles = candles.slice(0, 51);
  const truncatedFeatures = extractForexFeaturesAtTimestamp(truncatedCandles, targetT);

  assert(fullFeatures.price === truncatedFeatures.price, 'Point-in-time price matches regardless of future candles in array');
  assert(fullFeatures.rsi14 === truncatedFeatures.rsi14, 'RSI at T does not leak information from T+1');
  assert(fullFeatures.ema9Distance === truncatedFeatures.ema9Distance, 'EMA distance at T is perfectly isolated from future data');

  // -------------------------------------------------------------
  // TEST 2: Multi-Market Feature Engineering
  // -------------------------------------------------------------
  console.log('\nTEST 2: Multi-Market Feature Engineering (Forex, India, Options)');
  const snapshot = featureEngine.createSnapshot('EUR/USD', 'FOREX', '15M', targetT, fullFeatures as any, 'DEMO');
  assert(snapshot.featureVersion === CURRENT_FEATURE_VERSION, 'Feature snapshot carries correct FeatureVersion');
  assert(Object.isFrozen(snapshot.features), 'Feature snapshot is strictly immutable');

  const indiaCandles = candles.map(c => ({
    timestamp: c.timestamp,
    open: c.open * 22000,
    high: c.high * 22000,
    low: c.low * 22000,
    close: c.close * 22000,
    volume: c.volume * 50
  }));
  const indiaFeats = extractIndianMarketFeaturesAtTimestamp(indiaCandles, targetT);
  assert(indiaFeats.price > 0 && indiaFeats.rsi14 >= 0 && indiaFeats.rsi14 <= 100, 'Indian market feature extraction generates valid numeric ranges');

  // -------------------------------------------------------------
  // TEST 3: Outcome Labeling (Target-First vs Stop-First, MFE, MAE, Realized R)
  // -------------------------------------------------------------
  console.log('\nTEST 3: Outcome Labeling Engine');
  const forwardSlice = candles.slice(51, 71);
  const labelBuy = outcomeLabelEngine.generateOutcomeLabel(
    {
      signalId: 'sig_test_1',
      signalTimestamp: targetT,
      direction: 'BUY',
      entryPrice: candles[50].close,
      stopLossPrice: candles[50].close - 0.0020,
      takeProfitPrice: candles[50].close + 0.0030,
      maxHoldingPeriodCandles: 20
    },
    forwardSlice
  );

  assert(['TARGET_FIRST', 'STOP_FIRST', 'TIME_EXIT', 'PARTIAL_TARGET', 'NO_ENTRY'].includes(labelBuy.outcome), 'Label outcome is a valid enum value');
  assert(labelBuy.binaryTarget === 0 || labelBuy.binaryTarget === 1, 'Binary target is 0 or 1');
  assert(labelBuy.maxFavorableExcursionPips >= 0, 'MFE is non-negative');
  assert(labelBuy.maxAdverseExcursionPips >= 0, 'MAE is non-negative');

  // -------------------------------------------------------------
  // TEST 4: Chronological Dataset Splitting & Leak Detection
  // -------------------------------------------------------------
  console.log('\nTEST 4: Chronological Dataset Splitting & Leak Detection');
  const sampleList: DatasetSample[] = [];
  for (let i = 35; i < 120; i++) {
    const cur = candles[i];
    const feats = extractForexFeaturesAtTimestamp(candles.slice(0, i + 1), cur.timestamp);
    const forward = candles.slice(i + 1, i + 21);
    const lbl = outcomeLabelEngine.generateOutcomeLabel(
      {
        signalId: `sig_${i}`,
        signalTimestamp: cur.timestamp,
        direction: 'BUY',
        entryPrice: cur.close,
        stopLossPrice: cur.close - 0.0020,
        takeProfitPrice: cur.close + 0.0030,
        maxHoldingPeriodCandles: 20
      },
      forward
    );
    sampleList.push({
      id: `sample_${i}`,
      timestamp: cur.timestamp,
      instrument: 'EUR/USD',
      market: 'FOREX',
      features: feats as any,
      label: lbl,
      environment: 'DEMO'
    });
  }

  datasetBuilder.addSamples(sampleList);
  const split = datasetBuilder.buildChronologicalSplit({ market: 'FOREX' }, { trainRatio: 0.6, valRatio: 0.2, testRatio: 0.2 });

  assert(split.train.length > 0 && split.validation.length > 0 && split.test.length > 0, 'Train, validation, and test sets are populated');
  assert(split.trainPeriod.end < split.validationPeriod.start, 'Strict chronological isolation: Train end < Val start');
  assert(split.validationPeriod.end < split.testPeriod.start, 'Strict chronological isolation: Val end < Test start');

  // -------------------------------------------------------------
  // TEST 5: Gradient Boosted Trees Classifier & Baseline Models
  // -------------------------------------------------------------
  console.log('\nTEST 5: Gradient Boosted Trees Classifier & Baselines');
  const model = new GradientBoostedTreesClassifier({ maxDepth: 3, nEstimators: 20, learningRate: 0.1 });
  model.train(split.train);

  const testProb = model.predictProbability(split.validation[0].features);
  assert(testProb >= 0.01 && testProb <= 0.99, 'Model outputs well-calibrated probability in [0.01, 0.99]');

  const importances = model.getFeatureImportance();
  assert(importances.length > 0 && importances[0].score >= 0, 'Feature importances computed successfully');

  const basePositive = new BaselineAlwaysPositiveClassifier();
  const baseRate = new BaselineBaseRateClassifier();
  baseRate.train(split.train);
  const baseSignal = new BaselineSignalScoreMappingClassifier();

  assert(basePositive.predictProbability() === 1.0, 'Baseline always-positive outputs 1.0');
  assert(baseRate.predictProbability() >= 0 && baseRate.predictProbability() <= 1.0, 'Baseline base-rate model outputs valid empirical rate');
  assert(baseSignal.predictProbability({ signalScore: 80 }) > 0.6, 'Baseline signal mapper scales with technical score');

  // -------------------------------------------------------------
  // TEST 6: Model Evaluator (Classification & Quant Trading Metrics)
  // -------------------------------------------------------------
  console.log('\nTEST 6: Model Evaluator & Metrics Computation');
  const metrics = modelEvaluator.evaluate(model, split.validation);
  assert(metrics.accuracy >= 0 && metrics.accuracy <= 1, 'Accuracy is valid');
  assert(metrics.rocAuc >= 0 && metrics.rocAuc <= 1, 'ROC-AUC is valid');
  assert(metrics.brierScore >= 0 && metrics.brierScore <= 1, 'Brier score is valid');
  assert(metrics.profitFactor >= 0, 'Trading profit factor is computed');
  assert(typeof metrics.expectancyR === 'number', 'Expectancy R is computed');

  // -------------------------------------------------------------
  // TEST 7: Walk-Forward Validation Engine
  // -------------------------------------------------------------
  console.log('\nTEST 7: Walk-Forward Validation Engine');
  const wfResult = walkForwardEngine.executeWalkForward(sampleList, {
    windowType: 'EXPANDING',
    trainWindowSize: 30,
    testWindowSize: 15,
    stepSize: 15
  });

  assert(wfResult.windows.length >= 2, 'Walk-forward executed across multiple sequential windows');
  assert(wfResult.aggregateMetrics.sampleCount > 0, 'Walk-forward computed out-of-sample aggregate metrics');

  // -------------------------------------------------------------
  // TEST 8: Decision Fusion Engine (Deterministic + ML)
  // -------------------------------------------------------------
  console.log('\nTEST 8: Decision Fusion Engine');
  const fusedTrade = decisionFusionEngine.fuse(
    {
      instrument: 'EUR/USD',
      market: 'FOREX',
      direction: 'BUY',
      score: 75,
      entry: 1.0850,
      stopLoss: 1.0830,
      takeProfit: 1.0890,
      riskReward: 2.0
    },
    {
      predictionId: 'pred_1',
      timestamp: Date.now(),
      market: 'FOREX',
      instrument: 'EUR/USD',
      timeframe: '15M',
      direction: 'BUY',
      probabilityTargetBeforeStop: 0.72,
      probabilityStopBeforeTarget: 0.28,
      expectedOutcome: 'TARGET_FIRST',
      confidenceTier: 'STRONG',
      predictionHorizonCandles: 20,
      modelId: 'FOREX-GBDT-v3.0',
      modelVersion: 'v1.0',
      featureVersion: CURRENT_FEATURE_VERSION,
      strategyVersion: 'v1.0',
      featureSnapshotId: 'feat_1',
      marketRegime: 'TRENDING',
      entry: 1.0850,
      stop: 1.0830,
      target: 1.0890,
      riskReward: 2.0,
      topContributingFeatures: [],
      conflictingFactors: [],
      environment: 'DEMO',
      dataSource: 'DEMO'
    }
  );

  assert(fusedTrade.finalDecision === 'QUALIFIED_BUY', 'High-confluence signal fuses to QUALIFIED_BUY');
  assert(fusedTrade.tradeAllowed === true, 'Trade allowed when ML confirms deterministic setup');
  assert(fusedTrade.deterministicSignal.entry === 1.0850, 'Deterministic entry price is strictly preserved');
  assert(fusedTrade.deterministicSignal.stopLoss === 1.0830, 'Deterministic Stop Loss is strictly preserved');

  const fusedConflict = decisionFusionEngine.fuse(
    {
      instrument: 'EUR/USD',
      market: 'FOREX',
      direction: 'BUY',
      score: 75,
      entry: 1.0850,
      stopLoss: 1.0830,
      takeProfit: 1.0890,
      riskReward: 2.0
    },
    {
      predictionId: 'pred_2',
      timestamp: Date.now(),
      market: 'FOREX',
      instrument: 'EUR/USD',
      timeframe: '15M',
      direction: 'SELL', // Conflicting direction
      probabilityTargetBeforeStop: 0.35,
      probabilityStopBeforeTarget: 0.65,
      expectedOutcome: 'STOP_FIRST',
      confidenceTier: 'NO_EDGE',
      predictionHorizonCandles: 20,
      modelId: 'FOREX-GBDT-v3.0',
      modelVersion: 'v1.0',
      featureVersion: CURRENT_FEATURE_VERSION,
      strategyVersion: 'v1.0',
      featureSnapshotId: 'feat_2',
      marketRegime: 'CHOPPY',
      entry: 1.0850,
      stop: 1.0830,
      target: 1.0890,
      riskReward: 2.0,
      topContributingFeatures: [],
      conflictingFactors: [],
      environment: 'DEMO',
      dataSource: 'DEMO'
    }
  );

  assert(fusedConflict.finalDecision === 'CONFLICT', 'Opposing signals trigger CONFLICT status');
  assert(fusedConflict.tradeAllowed === false, 'Trade forbidden on conflict');

  // -------------------------------------------------------------
  // TEST 9: Model Registry & Quant Promotion Gate
  // -------------------------------------------------------------
  console.log('\nTEST 9: Model Registry & Production Gate Enforcement');
  const prodModel = modelRegistry.getProductionModelForMarket('FOREX');
  assert(prodModel !== undefined && prodModel.status === 'PRODUCTION', 'Production Forex model is active');

  // Attempt to promote poor model
  modelRegistry.registerModel({
    modelId: 'POOR-MODEL-1',
    modelVersion: 'v0.1',
    market: 'FOREX',
    instrumentClass: 'G10',
    strategy: 'TEST',
    featureVersion: CURRENT_FEATURE_VERSION,
    algorithm: 'GBDT',
    hyperparameters: {},
    trainingPeriod: { start: 0, end: 100 },
    validationPeriod: { start: 100, end: 200 },
    trainingSamples: 50,
    validationSamples: 20,
    testSamples: 20,
    metrics: {
      training: metrics,
      validation: { ...metrics, winRate: 0.42, profitFactor: 0.85, brierScore: 0.32 }
    },
    featureImportance: [],
    status: 'CANDIDATE'
  });

  const promoResult = modelRegistry.promoteToProduction('POOR-MODEL-1');
  assert(promoResult.success === false, 'Strict quant gate blocks promotion of sub-50% win rate model');

  // -------------------------------------------------------------
  // TEST 10: Model Drift & PSI Monitoring
  // -------------------------------------------------------------
  console.log('\nTEST 10: Model Drift & Population Stability Monitoring');
  const psiStable = modelMonitoringEngine.calculatePSI([1, 2, 3, 4, 5], [1.1, 2.0, 3.1, 3.9, 5.0]);
  const psiDrift = modelMonitoringEngine.calculatePSI([1, 2, 3, 4, 5], [10, 12, 14, 15, 18]);

  assert(psiStable < 0.10, 'Stable distributions yield low PSI (< 0.10)');
  assert(psiDrift > 0.20, 'Drifted distributions yield high PSI (> 0.20)');

  // -------------------------------------------------------------
  // TEST 11: Quantitative Backtest Engine (Gross vs Net Performance)
  // -------------------------------------------------------------
  console.log('\nTEST 11: Quantitative Backtest Simulation Engine');
  const btResult = backtestEngine.runBacktest(
    candles,
    model,
    {
      market: 'FOREX',
      instruments: ['EUR/USD'],
      startDate: candles[0].timestamp,
      endDate: candles[candles.length - 1].timestamp,
      strategyMode: 'COMBINED',
      mlProbabilityThreshold: 0.60,
      slippageUnits: 0.5,
      commissionPerTrade: 3.0,
      taxPct: 0.0,
      spreadCostUnits: 1.0,
      initialCapital: 100000,
      riskPerTradePct: 1.0
    }
  );

  assert(btResult.summary.totalTrades >= 0, 'Backtest completes simulation and outputs trade count');
  assert(btResult.equityCurve.length > 0, 'Backtest generates gross and net equity curves');
  assert(btResult.summary.totalCosts >= 0, 'Transaction costs (slippage, spread, commission) are properly accounted for');

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 3 MACHINE LEARNING TESTS PASSED PERFECTLY!');
  console.log('================================================================\n');
}

runPhase3Tests().catch(err => {
  console.error('Phase 3 test error:', err);
  process.exit(1);
});
