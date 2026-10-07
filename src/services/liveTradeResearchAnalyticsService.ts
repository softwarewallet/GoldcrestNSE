import { executeQuery } from '../database/db';

export interface LiveTradeResearchAnalyticsFilters {
  fromTimestamp?: number;
  toTimestamp?: number;
  symbol?: string;
  direction?: string;
  marketRegime?: string;
  session?: string;
  minScore?: number;
  maxScore?: number;
}

export interface LiveTradeResearchPerformance {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePct: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  averagePnl: number;
  averageWin: number;
  averageLoss: number;
  averageHoldingDurationMs: number;
  averageMfePnl: number | null;
  averageMaePnl: number | null;
}

export interface LiveTradeResearchAnalytics {
  generatedAt: number;
  filters: LiveTradeResearchAnalyticsFilters;
  dataCoverage: { evaluatedSignals: number; executedTrades: number; closedTrades: number; openTrades: number; notExecuted: number };
  overall: LiveTradeResearchPerformance;
  bySymbol: Array<{ key: string; performance: LiveTradeResearchPerformance }>;
  byScoreBand: Array<{ key: string; performance: LiveTradeResearchPerformance }>;
  byMarketRegime: Array<{ key: string; performance: LiveTradeResearchPerformance }>;
  bySession: Array<{ key: string; performance: LiveTradeResearchPerformance }>;
  byNewsImpact: Array<{ key: string; performance: LiveTradeResearchPerformance }>;
  byTrendAlignment: Array<{ key: string; performance: LiveTradeResearchPerformance }>;
  byTrendHorizon: Array<{ key: string; performance: LiveTradeResearchPerformance }>;
}

function finite(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function average(values: number[]): number { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }

function performance(rows: any[]): LiveTradeResearchPerformance {
  const trades = rows.length;
  const wins = rows.filter(row => row.outcome === 'WIN').length;
  const losses = rows.filter(row => row.outcome === 'LOSS').length;
  const breakeven = rows.filter(row => row.outcome === 'BREAKEVEN').length;
  const pnls = rows.map(row => finite(row.realized_pnl));
  const winningPnls = rows.filter(row => finite(row.realized_pnl) > 0).map(row => finite(row.realized_pnl));
  const losingPnls = rows.filter(row => finite(row.realized_pnl) < 0).map(row => finite(row.realized_pnl));
  const grossProfit = winningPnls.reduce((sum, value) => sum + value, 0);
  const grossLoss = losingPnls.reduce((sum, value) => sum + value, 0);
  const holding = rows.map(row => Number(row.holding_duration_ms)).filter(Number.isFinite);
  const mfes = rows.map(row => Number(row.mfe_pnl)).filter(Number.isFinite);
  const maes = rows.map(row => Number(row.mae_pnl)).filter(Number.isFinite);
  return { trades, wins, losses, breakeven, winRatePct: trades ? wins / trades * 100 : 0, netPnl: pnls.reduce((a,b)=>a+b,0), grossProfit, grossLoss, profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null, averagePnl: average(pnls), averageWin: average(winningPnls), averageLoss: average(losingPnls), averageHoldingDurationMs: average(holding), averageMfePnl: mfes.length ? average(mfes) : null, averageMaePnl: maes.length ? average(maes) : null };
}

function scoreBand(score: number): string { if (score < 65) return '<65'; if (score <= 70) return '65-70'; if (score <= 78) return '>70-78'; if (score <= 80) return '>78-80'; return '>80'; }

function parseMarketTrend(row: any): any | null {
  try {
    const context = row.context_json ? JSON.parse(row.context_json) : null;
    return context?.marketTrend || null;
  } catch {
    return null;
  }
}

function trendAlignment(row: any): string {
  const trend = parseMarketTrend(row);
  const trendDirection = String(trend?.direction || '').toUpperCase();
  const tradeDirection = String(row.direction || '').toUpperCase();

  if (!trendDirection || trendDirection === 'INSUFFICIENT_DATA') return 'INSUFFICIENT_DATA';
  const isBuy = tradeDirection.includes('BUY');
  const isSell = tradeDirection.includes('SELL');

  if ((isBuy && trendDirection === 'BULLISH') || (isSell && trendDirection === 'BEARISH')) {
    return 'ALIGNED';
  }
  if ((isBuy && trendDirection === 'BEARISH') || (isSell && trendDirection === 'BULLISH')) {
    return 'CONTRARY';
  }
  return 'MIXED';
}

function trendHorizon(row: any): string {
  const trend = parseMarketTrend(row);
  const horizons = [
    ['7D', trend?.horizon?.days7?.returnPct],
    ['30D', trend?.horizon?.days30?.returnPct],
    ['90D', trend?.horizon?.days90?.returnPct],
    ['365D', trend?.horizon?.days365?.returnPct]
  ] as const;
  const available = horizons
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([name, value]) => ({ name, value: Number(value) }));

  if (available.length === 0) return 'NO_DATA';

  const positive = available.filter(item => item.value > 0).length;
  const negative = available.filter(item => item.value < 0).length;
  if (positive === available.length) return 'ALL_POSITIVE';
  if (negative === available.length) return 'ALL_NEGATIVE';
  if (positive > negative) return 'MOSTLY_POSITIVE';
  if (negative > positive) return 'MOSTLY_NEGATIVE';
  return 'MIXED';
}

function newsImpact(row: any): string {
  try {
    const parsed = row.news_json ? JSON.parse(row.news_json) : null;
    if (Number(parsed?.activeHighImpactCount || 0) > 0) return 'ACTIVE_HIGH_IMPACT';
    if (Number(parsed?.highImpactCount || 0) > 0) return 'HIGH_IMPACT_PRESENT';
    const risk = String(parsed?.pairRisk?.riskLevel || parsed?.riskLevel || '').toUpperCase();
    if (risk === 'HIGH' || risk === 'ELEVATED') return 'ELEVATED_RISK';
    if (String(parsed?.status || row.news_status || '').toUpperCase() === 'UNAVAILABLE') return 'UNAVAILABLE';
    return 'NO_HIGH_IMPACT';
  } catch { return String(row.news_status || 'UNKNOWN').toUpperCase() || 'UNKNOWN'; }
}

function groupBy(rows: any[], keyFn: (row: any) => string) {
  const groups = new Map<string, any[]>();
  for (const row of rows) { const key = keyFn(row) || 'UNKNOWN'; const group = groups.get(key) || []; group.push(row); groups.set(key, group); }
  return Array.from(groups.entries()).sort((a,b) => b[1].length - a[1].length).map(([key, group]) => ({ key, performance: performance(group) }));
}

export async function getLiveTradeResearchAnalytics(filters: LiveTradeResearchAnalyticsFilters = {}): Promise<LiveTradeResearchAnalytics> {
  const conditions = ['signal_timestamp >= ?', 'signal_timestamp <= ?'];
  const params: any[] = [Number(filters.fromTimestamp || 0), Number(filters.toTimestamp || Date.now())];
  if (filters.symbol) { conditions.push('symbol = ?'); params.push(filters.symbol.toUpperCase()); }
  if (filters.direction) { conditions.push('direction = ?'); params.push(filters.direction.toUpperCase()); }
  if (filters.marketRegime) { conditions.push('market_regime = ?'); params.push(filters.marketRegime); }
  if (filters.session) { conditions.push('session = ?'); params.push(filters.session); }
  if (Number.isFinite(filters.minScore)) { conditions.push('score >= ?'); params.push(Number(filters.minScore)); }
  if (Number.isFinite(filters.maxScore)) { conditions.push('score <= ?'); params.push(Number(filters.maxScore)); }
  const rows = await executeQuery<any>('SELECT * FROM live_trade_research WHERE ' + conditions.join(' AND ') + ' ORDER BY signal_timestamp ASC LIMIT 50000', params);
  const closed = rows.filter(row => row.lifecycle_status === 'CLOSED');
  return { generatedAt: Date.now(), filters, dataCoverage: { evaluatedSignals: rows.length, executedTrades: rows.filter(row => ['OPEN','CLOSED'].includes(String(row.lifecycle_status))).length, closedTrades: closed.length, openTrades: rows.filter(row => row.lifecycle_status === 'OPEN').length, notExecuted: rows.filter(row => row.lifecycle_status === 'NOT_EXECUTED').length }, overall: performance(closed), bySymbol: groupBy(closed, row => String(row.symbol || 'UNKNOWN')), byScoreBand: groupBy(closed, row => scoreBand(finite(row.score))), byMarketRegime: groupBy(closed, row => String(row.market_regime || 'UNKNOWN')), bySession: groupBy(closed, row => String(row.session || 'UNKNOWN')), byNewsImpact: groupBy(closed, newsImpact), byTrendAlignment: groupBy(closed, trendAlignment), byTrendHorizon: groupBy(closed, trendHorizon) };
}