import { executeQuery, executeRun } from '../database/db';

export interface ResearchFeatureRow {
  signalId: string;
  symbol: string;
  signalTimestamp: number;
  direction: string;
  score: number;
  marketRegime: string;
  session: string;
  trendDirection: string;
  trendAlignment: string;
  trend7dReturnPct: number | null;
  trend30dReturnPct: number | null;
  trend90dReturnPct: number | null;
  trend365dReturnPct: number | null;
  trend7dVolatilityPct: number | null;
  trend30dVolatilityPct: number | null;
  trend90dVolatilityPct: number | null;
  trend365dVolatilityPct: number | null;
  newsRiskLevel: string;
  newsHighImpactCount: number;
  newsActiveHighImpactCount: number;
  newsSentiment: number | null;
  quoteSpread: number | null;
  riskReward: number | null;
  stopDistance: number | null;
  targetDistance: number | null;
  realizedPnl: number | null;
  outcome: string | null;
  holdingDurationMs: number | null;
  // Optional live-only predictive features. They are absent from historical rows
  // unless explicitly materialized by a current-market feature builder.
  priceChange5mPct?: number | null;
  priceChange15mPct?: number | null;
  priceChange1hPct?: number | null;
  priceChange4hPct?: number | null;
  priceChangeDailyPct?: number | null;
  atrPct?: number | null;
  rsi?: number | null;
  macdHistogram?: number | null;
  adx?: number | null;
  trendStrength?: number | null;
  mtfAlignmentScore?: number | null;
  structureTrend?: string | null;
  structurePhase?: string | null;
  structureType?: string | null;
  breakoutStatus?: string | null;
  distanceToSupportPips?: number | null;
  distanceToResistancePips?: number | null;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJson(value: unknown): any {
  try { return value ? JSON.parse(String(value)) : null; } catch { return null; }
}

function trendAlignment(direction: string, trend: string): string {
  const d = direction.toUpperCase();
  const t = trend.toUpperCase();
  if (t === 'INSUFFICIENT_DATA') return 'INSUFFICIENT_DATA';
  if ((d.includes('BUY') && t === 'BULLISH') || (d.includes('SELL') && t === 'BEARISH')) return 'ALIGNED';
  if ((d.includes('BUY') && t === 'BEARISH') || (d.includes('SELL') && t === 'BULLISH')) return 'CONTRARY';
  return 'MIXED';
}

function extract(row: any): ResearchFeatureRow {
  const context = parseJson(row.context_json) || {};
  const trend = context.marketTrend || {};
  const news = parseJson(row.news_json) || {};
  const sentiment = news.sentimentSummary;
  const sentimentValue = typeof sentiment === 'number'
    ? sentiment
    : finite(sentiment?.score ?? sentiment?.compound);

  const entry = finite(row.entry_preferred);
  const stop = finite(row.stop_loss);
  const tp = finite(row.take_profit_1);

  return {
    signalId: String(row.signal_id),
    symbol: String(row.symbol),
    signalTimestamp: Number(row.signal_timestamp),
    direction: String(row.direction),
    score: Number(row.score || 0),
    marketRegime: String(row.market_regime || 'UNKNOWN'),
    session: String(row.session || 'UNKNOWN'),
    trendDirection: String(trend.direction || 'INSUFFICIENT_DATA'),
    trendAlignment: trendAlignment(String(row.direction), String(trend.direction || 'INSUFFICIENT_DATA')),
    trend7dReturnPct: finite(trend.horizon?.days7?.returnPct),
    trend30dReturnPct: finite(trend.horizon?.days30?.returnPct),
    trend90dReturnPct: finite(trend.horizon?.days90?.returnPct),
    trend365dReturnPct: finite(trend.horizon?.days365?.returnPct),
    trend7dVolatilityPct: finite(trend.horizon?.days7?.volatilityPct),
    trend30dVolatilityPct: finite(trend.horizon?.days30?.volatilityPct),
    trend90dVolatilityPct: finite(trend.horizon?.days90?.volatilityPct),
    trend365dVolatilityPct: finite(trend.horizon?.days365?.volatilityPct),
    newsRiskLevel: String(news.pairRisk?.riskLevel || news.riskLevel || 'UNKNOWN'),
    newsHighImpactCount: Number(news.highImpactCount || 0),
    newsActiveHighImpactCount: Number(news.activeHighImpactCount || 0),
    newsSentiment: sentimentValue,
    quoteSpread: finite(row.quote_spread),
    riskReward: finite(row.risk_reward),
    stopDistance: entry !== null && stop !== null ? Math.abs(entry - stop) : null,
    targetDistance: entry !== null && tp !== null ? Math.abs(tp - entry) : null,
    realizedPnl: finite(row.realized_pnl),
    outcome: row.outcome ? String(row.outcome) : null,
    holdingDurationMs: finite(row.holding_duration_ms)
  };
}

export async function getLiveTradeResearchFeatures(params: {
  fromTimestamp?: number;
  toTimestamp?: number;
  closedOnly?: boolean;
  limit?: number;
} = {}): Promise<ResearchFeatureRow[]> {
  const conditions = ['signal_timestamp >= ?', 'signal_timestamp <= ?'];
  const values: any[] = [
    Number(params.fromTimestamp || 0),
    Number(params.toTimestamp || Date.now())
  ];
  if (params.closedOnly !== false) conditions.push(`lifecycle_status = 'CLOSED'`);
  const limit = Math.max(1, Math.min(100000, Number(params.limit || 50000)));
  const rows = await executeQuery<any>(
    `SELECT * FROM live_trade_research
      WHERE ${conditions.join(' AND ')}
      ORDER BY signal_timestamp ASC
      LIMIT ?`,
    [...values, limit]
  );
  return rows.map(extract);
}

export async function materializeLiveTradeResearchFeatures(params: {
  fromTimestamp?: number;
  toTimestamp?: number;
} = {}): Promise<{ rowsProcessed: number; updatedAt: number }> {
  const rows = await getLiveTradeResearchFeatures({
    ...params,
    closedOnly: true,
    limit: 100000
  });
  const updatedAt = Date.now();

  await executeRun(
    `CREATE TABLE IF NOT EXISTS live_trade_research_features (
      signal_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      signal_timestamp INTEGER NOT NULL,
      direction TEXT NOT NULL,
      score REAL NOT NULL,
      market_regime TEXT NOT NULL,
      session TEXT NOT NULL,
      trend_direction TEXT NOT NULL,
      trend_alignment TEXT NOT NULL,
      trend_7d_return_pct REAL,
      trend_30d_return_pct REAL,
      trend_90d_return_pct REAL,
      trend_365d_return_pct REAL,
      trend_7d_volatility_pct REAL,
      trend_30d_volatility_pct REAL,
      trend_90d_volatility_pct REAL,
      trend_365d_volatility_pct REAL,
      news_risk_level TEXT,
      news_high_impact_count INTEGER NOT NULL,
      news_active_high_impact_count INTEGER NOT NULL,
      news_sentiment REAL,
      quote_spread REAL,
      risk_reward REAL,
      stop_distance REAL,
      target_distance REAL,
      realized_pnl REAL,
      outcome TEXT,
      holding_duration_ms REAL,
      updated_at INTEGER NOT NULL
    )`
  );

  for (const row of rows) {
    await executeRun(
      `INSERT OR REPLACE INTO live_trade_research_features
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.signalId, row.symbol, row.signalTimestamp, row.direction, row.score,
        row.marketRegime, row.session, row.trendDirection, row.trendAlignment,
        row.trend7dReturnPct, row.trend30dReturnPct, row.trend90dReturnPct, row.trend365dReturnPct,
        row.trend7dVolatilityPct, row.trend30dVolatilityPct, row.trend90dVolatilityPct, row.trend365dVolatilityPct,
        row.newsRiskLevel, row.newsHighImpactCount, row.newsActiveHighImpactCount, row.newsSentiment,
        row.quoteSpread, row.riskReward, row.stopDistance, row.targetDistance,
        row.realizedPnl, row.outcome, row.holdingDurationMs, updatedAt
      ]
    );
  }

  return { rowsProcessed: rows.length, updatedAt };
}
