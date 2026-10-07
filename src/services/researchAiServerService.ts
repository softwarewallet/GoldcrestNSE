import { executeQuery, executeRun } from '../database/db';

export interface ResearchAiGatewayConfig {
  enabled: boolean;
  baseUrl: string;
  llamaModel: string;
  qwenModel: string;
  healthPath: string;
  predictPath: string;
  timeoutMs: number;
  authConfigured: boolean;
  updatedAt: number | null;
}

interface StoredConfig extends Omit<ResearchAiGatewayConfig, 'authConfigured'> {
  authToken: string;
}

const CONNECTION_KEY = 'LLAMA_GATEWAY';
const DEFAULT_TIMEOUT_MS = 10000;

function clampTimeout(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TIMEOUT_MS;
  return Math.min(60000, Math.max(1000, Math.floor(numeric)));
}

async function ensureTable(): Promise<void> {
  await executeRun(`CREATE TABLE IF NOT EXISTS ai_research_server_connections (
    provider TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    base_url TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    qwen_model TEXT NOT NULL DEFAULT '',
    health_path TEXT NOT NULL DEFAULT '/health',
    predict_path TEXT NOT NULL DEFAULT '/predict',
    timeout_ms INTEGER NOT NULL DEFAULT 10000,
    auth_token TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`);
}

async function loadStored(): Promise<StoredConfig> {
  await ensureTable();
  try {
    await executeRun("ALTER TABLE ai_research_server_connections ADD COLUMN qwen_model TEXT NOT NULL DEFAULT ''");
  } catch {}
  const rows = await executeQuery<any>(
    'SELECT provider, enabled, base_url, model, qwen_model, health_path, predict_path, timeout_ms, auth_token, updated_at FROM ai_research_server_connections WHERE provider = ? LIMIT 1',
    [CONNECTION_KEY]
  );
  let row = rows[0];

  // Migrate the previous two-connection layout into the single Llama gateway
  // on first read. Qwen is an internal model behind this gateway.
  if (!row) {
    const legacyRows = await executeQuery<any>(
      'SELECT provider, enabled, base_url, model, qwen_model, health_path, predict_path, timeout_ms, auth_token, updated_at FROM ai_research_server_connections WHERE provider IN (?, ?) ORDER BY updated_at DESC',
      ['LLAMA', 'QWEN']
    );
    const llama = legacyRows.find(item => String(item.provider).toUpperCase() === 'LLAMA');
    const qwen = legacyRows.find(item => String(item.provider).toUpperCase() === 'QWEN');
    if (llama || qwen) {
      row = {
        enabled: Number(llama?.enabled ?? qwen?.enabled ?? 0),
        base_url: String(llama?.base_url ?? qwen?.base_url ?? ''),
        model: String(llama?.model || ''),
        qwen_model: String(qwen?.model || ''),
        health_path: String(llama?.health_path ?? qwen?.health_path ?? '/health'),
        predict_path: String(llama?.predict_path ?? qwen?.predict_path ?? '/predict'),
        timeout_ms: Number(llama?.timeout_ms ?? qwen?.timeout_ms ?? DEFAULT_TIMEOUT_MS),
        auth_token: String(llama?.auth_token ?? qwen?.auth_token ?? ''),
        updated_at: Number(llama?.updated_at ?? qwen?.updated_at ?? Date.now())
      };
      await executeRun(
        `INSERT OR REPLACE INTO ai_research_server_connections
          (provider, enabled, base_url, model, qwen_model, health_path, predict_path, timeout_ms, auth_token, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [CONNECTION_KEY, row.enabled, row.base_url, row.model, row.qwen_model, row.health_path, row.predict_path, row.timeout_ms, row.auth_token, row.updated_at]
      );
    }
  }

  return {
    enabled: Number(row?.enabled || 0) === 1,
    baseUrl: String(row?.base_url || ''),
    llamaModel: String(row?.model || ''),
    qwenModel: String(row?.qwen_model || ''),
    healthPath: String(row?.health_path || '/health'),
    predictPath: String(row?.predict_path || '/predict'),
    timeoutMs: clampTimeout(row?.timeout_ms),
    authToken: String(row?.auth_token || ''),
    updatedAt: row?.updated_at === undefined ? null : Number(row.updated_at)
  };
}

export async function getResearchAiServerConfig(): Promise<ResearchAiGatewayConfig> {
  const stored = await loadStored();
  return {
    enabled: stored.enabled,
    baseUrl: stored.baseUrl,
    llamaModel: stored.llamaModel,
    qwenModel: stored.qwenModel,
    healthPath: stored.healthPath,
    predictPath: stored.predictPath,
    timeoutMs: stored.timeoutMs,
    authConfigured: Boolean(stored.authToken),
    updatedAt: stored.updatedAt
  };
}

export async function saveResearchAiServerConfig(input: {
  enabled?: boolean;
  baseUrl?: string;
  llamaModel?: string;
  qwenModel?: string;
  healthPath?: string;
  predictPath?: string;
  timeoutMs?: number;
  authToken?: string;
}): Promise<ResearchAiGatewayConfig> {
  const current = await loadStored();
  const baseUrl = String(input.baseUrl ?? current.baseUrl).trim().replace(/\/$/, '');
  const llamaModel = String(input.llamaModel ?? current.llamaModel).trim();
  const qwenModel = String(input.qwenModel ?? current.qwenModel).trim();
  const healthPath = String(input.healthPath ?? current.healthPath).trim() || '/health';
  const predictPath = String(input.predictPath ?? current.predictPath).trim() || '/predict';
  const authToken = input.authToken === undefined ? current.authToken : String(input.authToken);
  const enabled = input.enabled === undefined ? current.enabled : Boolean(input.enabled);
  const timeoutMs = clampTimeout(input.timeoutMs ?? current.timeoutMs);

  if (enabled && !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('AI gateway requires an HTTP(S) base URL when enabled.');
  }

  const updatedAt = Date.now();
  await executeRun(
    `INSERT OR REPLACE INTO ai_research_server_connections
      (provider, enabled, base_url, model, qwen_model, health_path, predict_path, timeout_ms, auth_token, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [CONNECTION_KEY, enabled ? 1 : 0, baseUrl, llamaModel, qwenModel, healthPath, predictPath, timeoutMs, authToken, updatedAt]
  );

  return {
    enabled,
    baseUrl,
    llamaModel,
    qwenModel,
    healthPath,
    predictPath,
    timeoutMs,
    authConfigured: Boolean(authToken),
    updatedAt
  };
}

export async function testResearchAiServerConnection(): Promise<{
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  message: string;
}> {
  const config = await loadStored();
  if (!config.baseUrl) {
    return { ok: false, status: null, latencyMs: null, message: 'AI gateway URL is not configured.' };
  }

  const url = config.baseUrl + (config.healthPath.startsWith('/') ? config.healthPath : '/' + config.healthPath);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.authToken) headers.Authorization = `Bearer ${config.authToken}`;
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      return {
        ok: response.ok,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        message: response.ok ? 'AI gateway is reachable.' : `AI gateway returned HTTP ${response.status}.`
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}


export async function testResearchAiServerPrediction(): Promise<{
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  direction: string | null;
  confidence: number | null;
  modelAgreement: number | null;
  message: string;
}> {
  const config = await loadStored();
  if (!config.baseUrl) {
    return { ok: false, status: null, latencyMs: null, direction: null, confidence: null, modelAgreement: null, message: 'AI gateway URL is not configured.' };
  }

  const startedAt = Date.now();
  try {
    const response = await requestResearchAiPrediction({
      task: 'RESEARCH_PREDICTION',
      horizon: '1D',
      features: {
        signalId: 'gateway-connectivity-test',
        symbol: 'EUR/USD',
        signalTimestamp: Date.now(),
        direction: 'BUY',
        score: 80,
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
        newsSentiment: 0,
        quoteSpread: 0.0001,
        riskReward: 2,
        stopDistance: 0.001,
        targetDistance: 0.002
      }
    });

    const source = response.consensus && typeof response.consensus === 'object'
      ? response.consensus as Record<string, unknown>
      : response.prediction && typeof response.prediction === 'object'
        ? response.prediction as Record<string, unknown>
        : response;

    const direction = String(source.direction || source.predictedDirection || '').toUpperCase();
    if (!['UP', 'DOWN', 'FLAT'].includes(direction)) {
      throw new Error('AI gateway prediction response has an invalid direction.');
    }

    const rawConfidence = Number(source.confidence);
    const confidence = rawConfidence > 1 && rawConfidence <= 100 ? rawConfidence / 100 : rawConfidence;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error('AI gateway prediction response has invalid confidence.');
    }

    const rawAgreement = source.modelAgreement;
    let modelAgreement: number | null = null;
    if (rawAgreement !== undefined && rawAgreement !== null) {
      const numeric = Number(rawAgreement);
      modelAgreement = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
      if (!Number.isFinite(modelAgreement) || modelAgreement < 0 || modelAgreement > 1) {
        throw new Error('AI gateway prediction response has invalid model agreement.');
      }
    }

    return {
      ok: true,
      status: 200,
      latencyMs: Date.now() - startedAt,
      direction,
      confidence,
      modelAgreement,
      message: 'AI gateway prediction contract is working.'
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      direction: null,
      confidence: null,
      modelAgreement: null,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function requestResearchAiPrediction(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const config = await loadStored();
  if (!config.enabled) throw new Error('AI gateway is disabled.');
  if (!config.baseUrl) throw new Error('AI gateway URL is not configured.');

  const url = config.baseUrl + (config.predictPath.startsWith('/') ? config.predictPath : '/' + config.predictPath);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (config.authToken) headers.Authorization = `Bearer ${config.authToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        gateway: 'LLAMA',
        llamaModel: config.llamaModel || undefined,
        qwenModel: config.qwenModel || undefined,
        payload
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`AI gateway returned non-JSON response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const message = parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message?: unknown }).message)
        : `AI gateway returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('AI gateway prediction response must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}
