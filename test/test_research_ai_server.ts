import assert from 'node:assert/strict';
import { getDatabase, executeRun } from '../src/database/db';
import {
  getResearchAiServerConfig,
  saveResearchAiServerConfig,
  testResearchAiServerConnection,
  testResearchAiServerPrediction
} from '../src/services/researchAiServerService';

await getDatabase();
await executeRun('DELETE FROM ai_research_server_connections');

const initial = await getResearchAiServerConfig();
assert.equal(initial.enabled, false);
assert.equal(initial.baseUrl, '');
assert.equal(initial.authConfigured, false);

const saved = await saveResearchAiServerConfig({
  enabled: true,
  baseUrl: 'http://127.0.0.1:8123/',
  llamaModel: 'llama3.3',
  qwenModel: 'qwen3',
  healthPath: '/health',
  predictPath: '/predict',
  timeoutMs: 5000,
  authToken: 'test-secret-token'
});

assert.equal(saved.enabled, true);
assert.equal(saved.baseUrl, 'http://127.0.0.1:8123');
assert.equal(saved.llamaModel, 'llama3.3');
assert.equal(saved.qwenModel, 'qwen3');
assert.equal(saved.authConfigured, true);
assert.equal(saved.timeoutMs, 5000);

const loaded = await getResearchAiServerConfig();
assert.equal(loaded.llamaModel, 'llama3.3');
assert.equal(loaded.qwenModel, 'qwen3');
assert.equal((loaded as any).authToken, undefined);

const disconnected = await testResearchAiServerConnection();
assert.equal(disconnected.ok, false);
assert.notEqual(disconnected.message, 'AI gateway URL is not configured.');

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.gateway, 'LLAMA');
    assert.equal(body.payload.task, 'RESEARCH_PREDICTION');
    return new Response(JSON.stringify({
      consensus: {
        direction: 'UP',
        confidence: 82,
        modelAgreement: 91
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const predictionTest = await testResearchAiServerPrediction();
  assert.equal(predictionTest.ok, true);
  assert.equal(predictionTest.direction, 'UP');
  assert.equal(predictionTest.confidence, 0.82);
  assert.equal(predictionTest.modelAgreement, 0.91);
} finally {
  globalThis.fetch = originalFetch;
}

await executeRun('DELETE FROM ai_research_server_connections');
console.log('RESEARCH AI SERVER CONNECTOR TEST PASSED');
