import { executeQuery, executeRun } from '../database/db';
import { IndianNewsSnapshot } from './indianMarketNewsService';

export interface LiveTradeResearchSignal {
  signalId: string;
  symbol: string;
  timestamp: number;
  direction: string;
  signalCategory: string;
  score: number;
  scoreBreakdown: unknown;
  strategyVersion: string;
  modelVersion: string;
  marketRegime: string;
  session: string;
  dataStatus: string;
  tradePlan?: {
    entryMin?: number;
    entryMax?: number;
    entryPreferred?: number;
    entryType?: string;
    stopLoss?: number;
    takeProfit1?: number;
    takeProfit2?: number;
    takeProfit3?: number;
    riskReward?: number;
  } | null;
  reasons?: string[];
  noTradeReasons?: string[];
  quote?: {
    bid: number;
    ask: number;
    spread: number;
    timestamp: number;
    status: string;
  } | null;
  requestedRiskQuantity?: number;
  configuredQuantity?: number;
  news?: IndianNewsSnapshot | null;
  context?: Record<string, unknown>;
}

export interface LiveTradeResearchExecution {
  signalId: string;
  status: string;
  code?: string;
  reason?: string;
  brokerOrderId?: string;
  brokerPositionId?: string;
  executedEntryPrice?: number;
  executedQuantity?: number;
  commission?: number;
  brokerStatus?: string;
  executionTimestamp?: number;
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function pairNews(snapshot: IndianNewsSnapshot | null | undefined, symbol: string): unknown {
  if (!snapshot) return null;
  return {
    status: snapshot.status,
    market: snapshot.market,
    marketOpen: snapshot.marketOpen,
    fetchedAt: snapshot.fetchedAt,
    articleCount: snapshot.articleCount,
    providerStatus: snapshot.providerStatus,
    prediction: snapshot.prediction || null,
    articles: (snapshot.articles || []).slice(0, 50).map(article => ({
      title: article.title,
      url: article.url,
      source: article.source,
      provider: article.provider,
      publishedAt: article.publishedAt,
      summary: article.summary || null,
      sentimentScore: article.sentimentScore ?? null
    }))
  };
}

/**
 * Durable research ledger for live Auto Trading.
 *
 * This is intentionally observational: it records what Goldcrest knew and
 * decided at signal time, plus the eventual broker result. It does not alter
 * execution or safety decisions.
 */
export async function recordLiveTradeResearchSignal(signal: LiveTradeResearchSignal): Promise<void> {
  const plan = signal.tradePlan || {};
  const news = pairNews(signal.news, signal.symbol);

  await executeRun(
    `INSERT OR REPLACE INTO live_trade_research (
      signal_id, symbol, broker, environment, signal_timestamp, captured_at,
      direction, signal_category, score, score_breakdown_json,
      strategy_version, model_version, market_regime, session, data_status,
      entry_min, entry_max, entry_preferred, entry_type,
      stop_loss, take_profit_1, take_profit_2, take_profit_3, risk_reward,
      quote_bid, quote_ask, quote_spread, quote_timestamp, quote_status,
      requested_risk_quantity, configured_quantity,
      news_status, news_source, news_json,
      reasons_json, no_trade_reasons_json, context_json,
      lifecycle_status, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )`,
    [
      signal.signalId,
      signal.symbol,
      'FIVE_PAISA',
      'LIVE',
      signal.timestamp,
      Date.now(),
      signal.direction,
      signal.signalCategory,
      Number(signal.score),
      json(signal.scoreBreakdown),
      signal.strategyVersion,
      signal.modelVersion,
      signal.marketRegime,
      signal.session,
      signal.dataStatus,
      Number(plan.entryMin ?? 0),
      Number(plan.entryMax ?? 0),
      Number(plan.entryPreferred ?? 0),
      plan.entryType || null,
      Number(plan.stopLoss ?? 0),
      Number(plan.takeProfit1 ?? 0),
      Number(plan.takeProfit2 ?? 0),
      plan.takeProfit3 == null ? null : Number(plan.takeProfit3),
      Number(plan.riskReward ?? 0),
      signal.quote?.bid ?? null,
      signal.quote?.ask ?? null,
      signal.quote?.spread ?? null,
      signal.quote?.timestamp ?? null,
      signal.quote?.status ?? null,
      signal.requestedRiskQuantity ?? null,
      signal.configuredQuantity ?? null,
      (news as any)?.status ?? null,
      (news as any)?.source ?? null,
      json(news),
      json(signal.reasons || []),
      json(signal.noTradeReasons || []),
      json(signal.context || {}),
      'SIGNAL_EVALUATED',
      Date.now()
    ]
  );
}

export async function updateLiveTradeResearchQuote(params: {
  signalId: string;
  quote?: {
    bid: number;
    ask: number;
    spread: number;
    timestamp: number;
    status: string;
  } | null;
  requestedRiskQuantity?: number;
  configuredQuantity?: number;
  context?: Record<string, unknown>;
}): Promise<void> {
  let mergedContext: Record<string, unknown> | null = null;
  if (params.context) {
    const existing = await executeQuery<any>(
      'SELECT context_json FROM live_trade_research WHERE signal_id = ?',
      [params.signalId]
    );
    try {
      const current = existing[0]?.context_json ? JSON.parse(existing[0].context_json) : {};
      mergedContext = { ...(current && typeof current === 'object' ? current : {}), ...params.context };
    } catch {
      mergedContext = { ...params.context };
    }
  }

  await executeRun(
    `UPDATE live_trade_research
       SET quote_bid = ?,
           quote_ask = ?,
           quote_spread = ?,
           quote_timestamp = ?,
           quote_status = ?,
           requested_risk_quantity = ?,
           configured_quantity = ?,
           context_json = CASE
             WHEN ? IS NULL THEN context_json
             ELSE ?
           END,
           updated_at = ?
     WHERE signal_id = ?`,
    [
      params.quote?.bid ?? null,
      params.quote?.ask ?? null,
      params.quote?.spread ?? null,
      params.quote?.timestamp ?? null,
      params.quote?.status ?? null,
      params.requestedRiskQuantity ?? null,
      params.configuredQuantity ?? null,
      mergedContext ? json(mergedContext) : null,
      mergedContext ? json(mergedContext) : null,
      Date.now(),
      params.signalId
    ]
  );
}

export async function updateLiveTradeResearchExecution(execution: LiveTradeResearchExecution): Promise<void> {
  const status = String(execution.status || '').toUpperCase();
  const lifecycleStatus =
    status === 'FILLED' || status === 'EXECUTED'
      ? 'OPEN'
      : ['REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED', 'BLOCKED'].includes(status)
        ? 'NOT_EXECUTED'
        : 'SUBMITTED';

  await executeRun(
    `UPDATE live_trade_research
       SET lifecycle_status = ?,
           broker_position_id = COALESCE(?, broker_position_id),
           execution_status = ?,
           execution_code = ?,
           execution_reason = ?,
           broker_order_id = ?,
           executed_entry_price = ?,
           executed_quantity = ?,
           commission = ?,
           broker_status = ?,
           execution_timestamp = ?,
           updated_at = ?
     WHERE signal_id = ?`,
    [
      lifecycleStatus,
      execution.brokerPositionId || null,
      status,
      execution.code || null,
      execution.reason || null,
      execution.brokerOrderId || null,
      execution.executedEntryPrice ?? null,
      execution.executedQuantity ?? null,
      execution.commission ?? null,
      execution.brokerStatus || status,
      execution.executionTimestamp || Date.now(),
      Date.now(),
      execution.signalId
    ]
  );
}

export async function getLiveTradeResearch(signalId?: string): Promise<any[]> {
  if (signalId) {
    return executeQuery(
      'SELECT * FROM live_trade_research WHERE signal_id = ?',
      [signalId]
    );
  }
  return executeQuery(
    'SELECT * FROM live_trade_research ORDER BY signal_timestamp DESC LIMIT 500'
  );
}


export async function updateLiveTradeResearchMark(params: {
  signalId: string;
  currentPnl: number;
  observedAt?: number;
}): Promise<void> {
  const observedAt = Number(params.observedAt || Date.now());
  const currentPnl = Number(params.currentPnl);
  if (!Number.isFinite(currentPnl)) return;

  await executeRun(
    `UPDATE live_trade_research
       SET mfe_pnl = CASE
             WHEN mfe_pnl IS NULL OR ? > mfe_pnl THEN ?
             ELSE mfe_pnl
           END,
           mae_pnl = CASE
             WHEN mae_pnl IS NULL OR ? < mae_pnl THEN ?
             ELSE mae_pnl
           END,
           holding_duration_ms = CASE
             WHEN execution_timestamp IS NULL THEN holding_duration_ms
             ELSE MAX(0, ? - execution_timestamp)
           END,
           updated_at = ?
     WHERE signal_id = ? AND lifecycle_status = 'OPEN'`,
    [
      currentPnl, currentPnl,
      currentPnl, currentPnl,
      observedAt,
      observedAt,
      params.signalId
    ]
  );
}

export async function closeLiveTradeResearchOutcome(params: {
  signalId: string;
  exitPrice: number;
  exitTimestamp: number;
  realizedPnl: number;
  commission?: number;
  outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN';
}): Promise<void> {
  const realizedPnl = Number(params.realizedPnl);
  const outcome = params.outcome || (
    realizedPnl > 0 ? 'WIN' : realizedPnl < 0 ? 'LOSS' : 'BREAKEVEN'
  );
  const exitTimestamp = Number(params.exitTimestamp || Date.now());

  await executeRun(
    `UPDATE live_trade_research
       SET lifecycle_status = 'CLOSED',
           realized_pnl = ?,
           exit_price = ?,
           exit_timestamp = ?,
           outcome = ?,
           commission = CASE
             WHEN ? IS NULL THEN commission
             ELSE ?
           END,
           holding_duration_ms = CASE
             WHEN execution_timestamp IS NULL THEN holding_duration_ms
             ELSE MAX(0, ? - execution_timestamp)
           END,
           updated_at = ?
     WHERE signal_id = ? AND lifecycle_status = 'OPEN'`,
    [
      Number.isFinite(realizedPnl) ? realizedPnl : 0,
      Number(params.exitPrice || 0),
      exitTimestamp,
      outcome,
      params.commission ?? null,
      params.commission ?? null,
      exitTimestamp,
      Date.now(),
      params.signalId
    ]
  );
}
