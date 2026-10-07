import assert from 'node:assert/strict';
import { LlamaGatewayPredictionModel } from '../src/services/liveTradeResearchPredictionService';
import { saveResearchAiServerConfig } from '../src/services/researchAiServerService';
import type { ResearchFeatureRow } from '../src/services/liveTradeResearchFeatureService';

const row: ResearchFeatureRow = {
  signalId: 'gateway-contract-test',
  symbol: 'EUR/USD',
  signalTimestamp: 1700000000000,
  direction: 'BUY',
  score: 82,
  marketRegime: 'TRENDING',
  session: 'LONDON',
  trendDirection: 'BULLISH',
  trendAlignment: 'ALIGNED',
  trend7dReturnPct: 1,
  trend30dReturnPct: 2,
  trend90dReturnPct: 3,
  trend365dReturnPct: 5,
  trend7dVolatilityPct: 8,
  trend30dVolatilityPct: 9,
  trend90dVolatilityPct: 10,
  trend365dVolatilityPct: 12,
  newsRiskLevel: 'LOW',
  newsHighImpactCount: 0,
  newsActiveHighImpactCount: 0,
  newsSentiment: 0.2,
  quoteSpread: 0.0001,
  riskReward: 2,
  stopDistance: 0.001,
  targetDistance: 0.002,
  realizedPnl: 100,
  outcome: 'WIN',
  holdingDurationMs: 3600000
};

await saveResearchAiServerConfig({
  enabled: true,
  baseUrl: 'http://127.0.0.1:8124',
  llamaModel: 'llama-test',
  qwenModel: 'qwen-test',
  timeoutMs: 2000
});

const originalFetch = globalThis.fetch;

try {
  let mode: 'valid' | 'invalid-direction' | 'invalid-confidence' | 'non-json' = 'valid';

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.gateway, 'LLAMA');
    assert.equal(body.llamaModel, 'llama-test');
    assert.equal(body.qwenModel, 'qwen-test');
    assert.equal(body.payload.task, 'RESEARCH_PREDICTION');
    assert.equal(body.payload.features.realizedPnl, undefined);
    assert.equal(body.payload.features.outcome, undefined);
    assert.equal(body.payload.features.holdingDurationMs, undefined);

    if (mode === 'non-json') {
      return new Response('not-json', { status: 200 });
    }
    if (mode === 'invalid-direction') {
      return new Response(JSON.stringify({
        consensus: { direction: 'MAYBE', confidence: 82 }
      }), { status: 200 });
    }
    if (mode === 'invalid-confidence') {
      return new Response(JSON.stringify({
        consensus: { direction: 'UP', confidence: 101 }
      }), { status: 200 });
    }

    return new Response(JSON.stringify({
      consensus: {
        direction: 'UP',
        confidence: 82,
        modelAgreement: 91,
        reasoning: 'Contract test',
        invalidation: 'Contract invalidation'
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const model = new LlamaGatewayPredictionModel();
  const valid = await model.predict(row, '1D');
  assert.equal(valid.direction, 'UP');
  assert.equal(valid.confidence, 0.82);
  assert.equal(valid.modelAgreement, 0.91);

  mode = 'invalid-direction';
  await assert.rejects(() => model.predict(row, '1D'), /invalid prediction direction/);

  mode = 'invalid-confidence';
  await assert.rejects(() => model.predict(row, '1D'), /confidence outside the 0-1 range/);

  mode = 'non-json';
  await assert.rejects(() => model.predict(row, '1D'), /non-JSON response/);
} finally {
  globalThis.fetch = originalFetch;
  await saveResearchAiServerConfig({ enabled: false, baseUrl: '', authToken: '' });
}

console.log('Research AI gateway contract tests passed.');
