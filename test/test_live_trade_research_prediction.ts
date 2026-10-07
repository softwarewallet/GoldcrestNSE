import assert from 'node:assert/strict';
import {
  SignalDirectionBaselineModel, LlamaGatewayPredictionModel, createResearchPrediction, type PredictionModel
} from '../src/services/liveTradeResearchPredictionService';
import type { ResearchFeatureRow } from '../src/services/liveTradeResearchFeatureService';
import { saveResearchAiServerConfig } from '../src/services/researchAiServerService';

function row(direction: string, score: number): ResearchFeatureRow {
  return {
    signalId: 'signal-test-001', symbol: 'EUR/USD', signalTimestamp: 1700000000000,
    direction, score, marketRegime: 'TRENDING', session: 'LONDON',
    trendDirection: 'BULLISH', trendAlignment: 'ALIGNED',
    trend7dReturnPct: 1, trend30dReturnPct: 2, trend90dReturnPct: 3, trend365dReturnPct: 5,
    trend7dVolatilityPct: 8, trend30dVolatilityPct: 9, trend90dVolatilityPct: 10, trend365dVolatilityPct: 12,
    newsRiskLevel: 'LOW', newsHighImpactCount: 0, newsActiveHighImpactCount: 0, newsSentiment: 0.2,
    quoteSpread: 0.0001, riskReward: 2, stopDistance: 0.001, targetDistance: 0.002,
    realizedPnl: 10, outcome: 'WIN', holdingDurationMs: 3600000
  };
}
const model = new SignalDirectionBaselineModel();
const buy = model.predict(row('BUY', 78), '1D');
assert.equal(buy.direction, 'UP'); assert.ok(buy.confidence > 0.7 && buy.confidence < 1); assert.ok(buy.modelAgreement !== null && buy.modelAgreement >= 0 && buy.modelAgreement <= 1);
const sellRow = { ...row('SELL', 60), trendDirection: 'BEARISH', structureTrend: 'bearish', trend7dReturnPct: -1, trend30dReturnPct: -2, trend90dReturnPct: -3, trend365dReturnPct: -5 };
const sell = model.predict(sellRow, '3D');
assert.equal(sell.direction, 'DOWN'); assert.ok(sell.confidence >= 0.5 && sell.confidence <= 0.95);
const flatRow = { ...row('UNKNOWN', 50), trendDirection: 'NEUTRAL', structureTrend: 'neutral', trend7dReturnPct: 0, trend30dReturnPct: 0, trend90dReturnPct: 0, trend365dReturnPct: 0 };
const flat = model.predict(flatRow, '7D');
assert.equal(flat.direction, 'FLAT'); assert.equal(flat.confidence, 0.5);
const prediction = await createResearchPrediction({ row: row('BUY', 80), horizon: '1D', model });
assert.equal(prediction.predictedDirection, 'UP'); assert.equal(prediction.modelVersion, 'PAIR_FEATURE_BASELINE_V2');
assert.equal(prediction.predictionSource, 'LIVE_PAIR_FEATURES'); assert.equal(prediction.symbol, 'EUR/USD');
assert.equal(prediction.signalId, 'signal-test-001'); assert.match(prediction.featureHash, /^[a-f0-9]{64}$/);
assert.match(prediction.predictionId, /^pred-.*-signal-test-001-1D$/); assert.equal(prediction.horizon, '1D');
assert.ok(prediction.confidence >= 0 && prediction.confidence <= 1);
const customModel: PredictionModel = {
  modelVersion: 'TEST_MODEL_V1', predictionSource: 'DETERMINISTIC_TEST',
  predict: () => ({ direction: 'DOWN', confidence: 0.87, modelAgreement: 0.5, reasoning: 'Test prediction', invalidation: 'Test invalidation' })
};
const custom = await createResearchPrediction({ row: row('BUY', 80), horizon: '7D', model: customModel });
assert.equal(custom.modelVersion, 'TEST_MODEL_V1'); assert.equal(custom.predictedDirection, 'DOWN');
assert.equal(custom.confidence, 0.87); assert.equal(custom.modelAgreement, 0.5); assert.equal(custom.reasoning, 'Test prediction');
await saveResearchAiServerConfig({
  enabled: true,
  baseUrl: 'http://127.0.0.1:8124',
  llamaModel: 'llama-test',
  qwenModel: 'qwen-test',
  predictPath: '/predict',
  timeoutMs: 2000
});

const originalFetch = globalThis.fetch;
let gatewayRequest: any = null;
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  gatewayRequest = init?.body ? JSON.parse(String(init.body)) : null;
  return new Response(JSON.stringify({
    consensus: {
      direction: 'UP',
      confidence: 82,
      modelAgreement: 0.91,
      reasoning: 'Llama/Qwen consensus test prediction.',
      invalidation: 'Consensus test invalidation.'
    },
    qwen: { direction: 'UP', confidence: 0.84 },
    llama: { direction: 'UP', confidence: 0.80 }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

try {
  const aiPrediction = await createResearchPrediction({
    row: row('BUY', 82),
    horizon: '3D',
    model: new LlamaGatewayPredictionModel()
  });
  assert.equal(aiPrediction.modelVersion, 'LLAMA_GATEWAY_QWEN_LLAMA_V1');
  assert.equal(aiPrediction.predictionSource, 'LLAMA_GATEWAY');
  assert.equal(aiPrediction.predictedDirection, 'UP');
  assert.equal(aiPrediction.confidence, 0.82);
  assert.equal(aiPrediction.modelAgreement, 0.91);
  assert.equal(aiPrediction.reasoning, 'Llama/Qwen consensus test prediction.');
  assert.equal(gatewayRequest.gateway, 'LLAMA');
  assert.equal(gatewayRequest.llamaModel, 'llama-test');
  assert.equal(gatewayRequest.qwenModel, 'qwen-test');
  assert.equal(gatewayRequest.payload.task, 'RESEARCH_PREDICTION');
  assert.equal(gatewayRequest.payload.horizon, '3D');
  assert.equal(gatewayRequest.payload.features.symbol, 'EUR/USD');
  assert.equal(gatewayRequest.payload.features.realizedPnl, undefined);
  assert.equal(gatewayRequest.payload.features.outcome, undefined);
  assert.equal(gatewayRequest.payload.features.holdingDurationMs, undefined);
} finally {
  globalThis.fetch = originalFetch;
  await saveResearchAiServerConfig({ enabled: false, baseUrl: '', authToken: '' });
}

console.log('Live trade research prediction tests passed.');
