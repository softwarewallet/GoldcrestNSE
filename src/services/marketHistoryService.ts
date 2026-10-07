import { executeQuery, executeTransaction } from '../database/db';
import { FOREX_PAIRS } from '../markets/forex/instruments';
import { brokerRegistry } from '../brokers/registry';
import { liveRuntimeLog } from './liveRuntimeLog';

export type HistoricalMarketTimeframe = 'Daily' | 'Weekly' | 'Monthly';

export interface HistoricalMarketBar {
  symbol: string;
  timeframe: HistoricalMarketTimeframe;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketPeriodStats {
  symbol: string;
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ROLLING_7D' | 'ROLLING_30D' | 'ROLLING_90D' | 'ROLLING_365D';
  periodStart: number;
  periodEnd: number;
  open: number;
  high: number;
  low: number;
  close: number;
  range: number;
  rangePct: number;
  returnPct: number;
  atr14: number | null;
  volatilityPct: number | null;
  dataPoints: number;
  updatedAt: number;
}

export interface MarketHistorySyncStatus {
  symbol: string;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFullBackfillAt: number | null;
  lastIncrementalAt: number | null;
  latestDailyTimestamp: number | null;
  dailyBarsStored: number;
  status: 'IDLE' | 'RUNNING' | 'READY' | 'ERROR';
  error: string | null;
  updatedAt: number;
}

const FULL_DAILY_BARS = Math.max(365, Math.min(1000, Number(process.env.GOLDCREST_MARKET_HISTORY_DAILY_BARS || 1000)));
const FULL_WEEKLY_BARS = Math.max(52, Math.min(260, Number(process.env.GOLDCREST_MARKET_HISTORY_WEEKLY_BARS || 104)));
const FULL_MONTHLY_BARS = Math.max(12, Math.min(120, Number(process.env.GOLDCREST_MARKET_HISTORY_MONTHLY_BARS || 24)));
const INCREMENTAL_BARS = Math.max(3, Math.min(20, Number(process.env.GOLDCREST_MARKET_HISTORY_INCREMENTAL_BARS || 5)));
const SYNC_INTERVAL_MS = Math.max(
  15 * 60_000,
  Number(process.env.GOLDCREST_MARKET_HISTORY_SYNC_INTERVAL_MS || 30 * 60_000)
);
const PAIR_CONCURRENCY = Math.max(
  1,
  Math.min(3, Number(process.env.GOLDCREST_MARKET_HISTORY_PAIR_CONCURRENCY || 2))
);

let syncTimer: NodeJS.Timeout | null = null;
let syncInFlight = false;
let lastGlobalSyncAt: number | null = null;
const trendContextCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof getMarketTrendContext>> }>();

function normalizeSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase().replace(/^([A-Z]{3})([A-Z]{3})$/, '$1/$2');
}

function deterministicCandleId(symbol: string, timeframe: string, timestamp: number): string {
  return `forex:${normalizeSymbol(symbol)}:${timeframe}:${Math.floor(timestamp)}`;
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateAtr14(bars: HistoricalMarketBar[]): number | null {
  if (bars.length < 2) return null;
  const trueRanges: number[] = [];
  for (let index = 0; index < bars.length; index += 1) {
    const current = bars[index];
    const previousClose = index > 0 ? bars[index - 1].close : current.open;
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose)
    ));
  }
  if (trueRanges.length < 14) return null;
  const recent = trueRanges.slice(-14);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function calculateVolatilityPct(bars: HistoricalMarketBar[]): number | null {
  if (bars.length < 2) return null;
  const returns: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1].close;
    const current = bars[index].close;
    if (previous > 0 && current > 0) {
      returns.push((current / previous) - 1);
    }
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function calculateMarketPeriodStats(
  symbol: string,
  periodType: MarketPeriodStats['periodType'],
  bars: HistoricalMarketBar[]
): MarketPeriodStats | null {
  const ordered = bars
    .filter(bar => bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0 && bar.high >= bar.low)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (ordered.length === 0) return null;

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const high = Math.max(...ordered.map(bar => bar.high));
  const low = Math.min(...ordered.map(bar => bar.low));
  const range = high - low;
  const rangePct = first.open > 0 ? (range / first.open) * 100 : 0;
  const returnPct = first.open > 0 ? ((last.close / first.open) - 1) * 100 : 0;

  return {
    symbol: normalizeSymbol(symbol),
    periodType,
    periodStart: first.timestamp,
    periodEnd: last.timestamp,
    open: first.open,
    high,
    low,
    close: last.close,
    range,
    rangePct,
    returnPct,
    atr14: calculateAtr14(ordered),
    volatilityPct: calculateVolatilityPct(ordered),
    dataPoints: ordered.length,
    updatedAt: Date.now()
  };
}

function buildCalendarPeriodStats(symbol: string, bars: HistoricalMarketBar[], periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY'): MarketPeriodStats[] {
  const groups = new Map<string, HistoricalMarketBar[]>();

  for (const bar of bars) {
    const date = new Date(bar.timestamp);
    let key: string;
    if (periodType === 'DAILY') {
      key = date.toISOString().slice(0, 10);
    } else if (periodType === 'WEEKLY') {
      const day = date.getUTCDay();
      const daysFromMonday = day === 0 ? 6 : day - 1;
      const monday = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() - daysFromMonday
      ));
      key = monday.toISOString().slice(0, 10);
    } else {
      key = date.toISOString().slice(0, 7);
    }
    const group = groups.get(key) || [];
    group.push(bar);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([_, group]) => calculateMarketPeriodStats(symbol, periodType, group))
    .filter((row): row is MarketPeriodStats => Boolean(row));
}

async function upsertBars(symbol: string, timeframe: HistoricalMarketTimeframe, bars: any[]): Promise<number> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const validBars: HistoricalMarketBar[] = bars
    .map(bar => ({
      symbol: normalizedSymbol,
      timeframe,
      timestamp: safeNumber(bar?.timestamp),
      open: safeNumber(bar?.open),
      high: safeNumber(bar?.high),
      low: safeNumber(bar?.low),
      close: safeNumber(bar?.close),
      volume: safeNumber(bar?.volume)
    }))
    .filter(bar =>
      bar.timestamp > 0 &&
      bar.open > 0 &&
      bar.high >= bar.low &&
      bar.low > 0 &&
      bar.close > 0
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  if (validBars.length === 0) return 0;

  await executeTransaction(db => {
    for (const bar of validBars) {
      db.run(
        `INSERT OR REPLACE INTO candles
          (id, symbol, timeframe, timestamp, open, high, low, close, volume, oi, vwap)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          deterministicCandleId(normalizedSymbol, timeframe, bar.timestamp),
          normalizedSymbol,
          timeframe,
          bar.timestamp,
          bar.open,
          bar.high,
          bar.low,
          bar.close,
          bar.volume
        ]
      );
    }
  });

  return validBars.length;
}

async function getStoredDailyBars(symbol: string, limit = 1000): Promise<HistoricalMarketBar[]> {
  const rows = await executeQuery<any>(
    `SELECT symbol, timeframe, timestamp, open, high, low, close, volume
     FROM candles
     WHERE symbol = ? AND timeframe = 'Daily'
     ORDER BY timestamp ASC
     LIMIT ?`,
    [normalizeSymbol(symbol), limit]
  );

  return rows.map(row => ({
    symbol: normalizeSymbol(row.symbol),
    timeframe: 'Daily',
    timestamp: safeNumber(row.timestamp),
    open: safeNumber(row.open),
    high: safeNumber(row.high),
    low: safeNumber(row.low),
    close: safeNumber(row.close),
    volume: safeNumber(row.volume)
  }));
}

async function persistPeriodStats(symbol: string, dailyBars: HistoricalMarketBar[]): Promise<void> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const now = Date.now();

  const periodRows: MarketPeriodStats[] = [];
  const dailyCalendar = buildCalendarPeriodStats(normalizedSymbol, dailyBars, 'DAILY');
  const weeklyCalendar = buildCalendarPeriodStats(normalizedSymbol, dailyBars, 'WEEKLY');
  const monthlyCalendar = buildCalendarPeriodStats(normalizedSymbol, dailyBars, 'MONTHLY');

  periodRows.push(...dailyCalendar, ...weeklyCalendar, ...monthlyCalendar);

  for (const [periodType, days] of [
    ['ROLLING_7D', 7],
    ['ROLLING_30D', 30],
    ['ROLLING_90D', 90],
    ['ROLLING_365D', 365]
  ] as const) {
    periodRows.push(
      calculateMarketPeriodStats(
        normalizedSymbol,
        periodType,
        dailyBars.slice(-days)
      ) as MarketPeriodStats
    );
  }

  const validRows = periodRows.filter(Boolean);

  await executeTransaction(db => {
    for (const row of validRows) {
      const periodKey = row.periodType === 'ROLLING_7D'
        || row.periodType === 'ROLLING_30D'
        || row.periodType === 'ROLLING_90D'
        || row.periodType === 'ROLLING_365D'
        ? `${normalizedSymbol}:${row.periodType}:${dayKey(now)}`
        : `${normalizedSymbol}:${row.periodType}:${row.periodStart}`;

      db.run(
        `INSERT OR REPLACE INTO market_period_stats
          (id, symbol, period_type, period_start, period_end, open, high, low, close,
           range, range_pct, return_pct, atr14, volatility_pct, data_points, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          periodKey,
          row.symbol,
          row.periodType,
          row.periodStart,
          row.periodEnd,
          row.open,
          row.high,
          row.low,
          row.close,
          row.range,
          row.rangePct,
          row.returnPct,
          row.atr14,
          row.volatilityPct,
          row.dataPoints,
          row.updatedAt
        ]
      );
    }
  });
}

async function markSyncStatus(
  symbol: string,
  updates: Partial<MarketHistorySyncStatus> & { status: MarketHistorySyncStatus['status'] }
): Promise<void> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const current = (await executeQuery<any>(
    'SELECT * FROM market_history_sync WHERE symbol = ?',
    [normalizedSymbol]
  ))[0];

  const next = {
    symbol: normalizedSymbol,
    lastAttemptAt: updates.lastAttemptAt ?? (safeNumber(current?.last_attempt_at) || null),
    lastSuccessAt: updates.lastSuccessAt ?? (safeNumber(current?.last_success_at) || null),
    lastFullBackfillAt: updates.lastFullBackfillAt ?? (safeNumber(current?.last_full_backfill_at) || null),
    lastIncrementalAt: updates.lastIncrementalAt ?? (safeNumber(current?.last_incremental_at) || null),
    latestDailyTimestamp: updates.latestDailyTimestamp ?? (safeNumber(current?.latest_daily_timestamp) || null),
    dailyBarsStored: updates.dailyBarsStored ?? safeNumber(current?.daily_bars_stored),
    status: updates.status,
    error: updates.error ?? current?.error ?? null,
    updatedAt: Date.now()
  };

  await executeTransaction(db => {
    db.run(
      `INSERT OR REPLACE INTO market_history_sync
        (symbol, last_attempt_at, last_success_at, last_full_backfill_at, last_incremental_at,
         latest_daily_timestamp, daily_bars_stored, status, error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        next.symbol,
        next.lastAttemptAt,
        next.lastSuccessAt,
        next.lastFullBackfillAt,
        next.lastIncrementalAt,
        next.latestDailyTimestamp,
        next.dailyBarsStored,
        next.status,
        next.error,
        next.updatedAt
      ]
    );
  });
}

async function syncPair(symbol: string, forceFull = false): Promise<MarketHistorySyncStatus> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const existing = (await executeQuery<any>(
    'SELECT * FROM market_history_sync WHERE symbol = ?',
    [normalizedSymbol]
  ))[0];

  const storedDailyCount = Number((await executeQuery<any>(
    "SELECT COUNT(*) AS count FROM candles WHERE symbol = ? AND timeframe = 'Daily'",
    [normalizedSymbol]
  ))[0]?.count || 0);

  const needsFull = forceFull || storedDailyCount < FULL_DAILY_BARS;
  const now = Date.now();

  await markSyncStatus(normalizedSymbol, {
    status: 'RUNNING',
    lastAttemptAt: now,
    error: null
  });

  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE');
    if (!adapter.getHistoricalCandles) {
      throw new Error('Authoritative cTrader historical market-data capability is unavailable.');
    }

    const dailyBars = await adapter.getHistoricalCandles(
      normalizedSymbol,
      'Daily',
      needsFull ? FULL_DAILY_BARS : INCREMENTAL_BARS
    );

    await upsertBars(normalizedSymbol, 'Daily', dailyBars);

    // Weekly/monthly bars are stored as first-class source observations too.
    // They make future long-horizon analysis faster and preserve broker-native
    // period boundaries rather than reconstructing them from local calendars.
    if (needsFull) {
      try {
        const weeklyBars = await adapter.getHistoricalCandles(normalizedSymbol, 'Weekly', FULL_WEEKLY_BARS);
        await upsertBars(normalizedSymbol, 'Weekly', weeklyBars);
      } catch (error: any) {
        liveRuntimeLog('WARN', 'MARKET_HISTORY_WEEKLY_SYNC_FAILED', {
          symbol: normalizedSymbol,
          error: error?.message || String(error)
        });
      }

      try {
        const monthlyBars = await adapter.getHistoricalCandles(normalizedSymbol, 'Monthly', FULL_MONTHLY_BARS);
        await upsertBars(normalizedSymbol, 'Monthly', monthlyBars);
      } catch (error: any) {
        liveRuntimeLog('WARN', 'MARKET_HISTORY_MONTHLY_SYNC_FAILED', {
          symbol: normalizedSymbol,
          error: error?.message || String(error)
        });
      }
    }

    const storedBars = await getStoredDailyBars(normalizedSymbol, FULL_DAILY_BARS);
    if (storedBars.length === 0) throw new Error(`cTrader returned no valid daily history for ${normalizedSymbol}.`);

    await persistPeriodStats(normalizedSymbol, storedBars);

    const latest = storedBars[storedBars.length - 1];
    const count = storedBars.length;
    const successAt = Date.now();
    await markSyncStatus(normalizedSymbol, {
      status: 'READY',
      lastAttemptAt: now,
      lastSuccessAt: successAt,
      lastFullBackfillAt: needsFull ? successAt : undefined,
      lastIncrementalAt: needsFull ? undefined : successAt,
      latestDailyTimestamp: latest.timestamp,
      dailyBarsStored: count,
      error: null
    });

    liveRuntimeLog('INFO', 'MARKET_HISTORY_SYNC_COMPLETED', {
      symbol: normalizedSymbol,
      mode: needsFull ? 'FULL_BACKFILL' : 'INCREMENTAL',
      dailyBars: count,
      latestDailyTimestamp: latest.timestamp
    });

    return {
      symbol: normalizedSymbol,
      lastAttemptAt: now,
      lastSuccessAt: successAt,
      lastFullBackfillAt: needsFull ? successAt : safeNumber(existing?.last_full_backfill_at) || null,
      lastIncrementalAt: needsFull ? safeNumber(existing?.last_incremental_at) || null : successAt,
      latestDailyTimestamp: latest.timestamp,
      dailyBarsStored: count,
      status: 'READY',
      error: null,
      updatedAt: Date.now()
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    const status: MarketHistorySyncStatus = {
      symbol: normalizedSymbol,
      lastAttemptAt: now,
      lastSuccessAt: safeNumber(existing?.last_success_at) || null,
      lastFullBackfillAt: safeNumber(existing?.last_full_backfill_at) || null,
      lastIncrementalAt: safeNumber(existing?.last_incremental_at) || null,
      latestDailyTimestamp: safeNumber(existing?.latest_daily_timestamp) || null,
      dailyBarsStored: storedDailyCount,
      status: 'ERROR',
      error: message,
      updatedAt: Date.now()
    };
    await markSyncStatus(normalizedSymbol, status);
    liveRuntimeLog('ERROR', 'MARKET_HISTORY_SYNC_FAILED', {
      symbol: normalizedSymbol,
      error: message
    });
    return status;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker()
  ));
  return results;
}

export async function syncMarketHistory(options: { forceFull?: boolean; symbols?: string[] } = {}): Promise<MarketHistorySyncStatus[]> {
  if (syncInFlight) {
    return getMarketHistorySyncStatus();
  }

  syncInFlight = true;
  const symbols = (options.symbols?.length ? options.symbols : FOREX_PAIRS.map(pair => pair.symbol))
    .map(normalizeSymbol)
    .filter((symbol, index, list) => list.indexOf(symbol) === index);

  try {
    const results = await mapWithConcurrency(
      symbols,
      PAIR_CONCURRENCY,
      symbol => syncPair(symbol, Boolean(options.forceFull))
    );
    lastGlobalSyncAt = Date.now();
    return results;
  } finally {
    syncInFlight = false;
  }
}

export async function getMarketHistorySyncStatus(): Promise<MarketHistorySyncStatus[]> {
  const rows = await executeQuery<any>(
    'SELECT * FROM market_history_sync ORDER BY symbol ASC'
  );
  return rows.map(row => ({
    symbol: normalizeSymbol(row.symbol),
    lastAttemptAt: safeNumber(row.last_attempt_at) || null,
    lastSuccessAt: safeNumber(row.last_success_at) || null,
    lastFullBackfillAt: safeNumber(row.last_full_backfill_at) || null,
    lastIncrementalAt: safeNumber(row.last_incremental_at) || null,
    latestDailyTimestamp: safeNumber(row.latest_daily_timestamp) || null,
    dailyBarsStored: safeNumber(row.daily_bars_stored),
    status: row.status,
    error: row.error || null,
    updatedAt: safeNumber(row.updated_at)
  }));
}

export async function getMarketHistorySummary(symbol: string): Promise<{
  symbol: string;
  latestDaily: HistoricalMarketBar | null;
  rolling: MarketPeriodStats[];
  daily: MarketPeriodStats[];
  weekly: MarketPeriodStats[];
  monthly: MarketPeriodStats[];
}> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const [dailyRows, statsRows] = await Promise.all([
    executeQuery<any>(
      `SELECT symbol, timeframe, timestamp, open, high, low, close, volume
       FROM candles
       WHERE symbol = ? AND timeframe = 'Daily'
       ORDER BY timestamp DESC
       LIMIT ?`,
      [normalizedSymbol, FULL_DAILY_BARS]
    ),
    executeQuery<any>(
      `SELECT id, symbol, period_type, period_start, period_end, open, high, low, close,
              range, range_pct, return_pct, atr14, volatility_pct, data_points, updated_at
       FROM market_period_stats
       WHERE symbol = ?
       ORDER BY period_end DESC`,
      [normalizedSymbol]
    )
  ]);

  const dailyBars = dailyRows.reverse().map(row => ({
    symbol: normalizedSymbol,
    timeframe: 'Daily' as const,
    timestamp: safeNumber(row.timestamp),
    open: safeNumber(row.open),
    high: safeNumber(row.high),
    low: safeNumber(row.low),
    close: safeNumber(row.close),
    volume: safeNumber(row.volume)
  }));

  const mapStat = (row: any): MarketPeriodStats => ({
    symbol: normalizedSymbol,
    periodType: row.period_type,
    periodStart: safeNumber(row.period_start),
    periodEnd: safeNumber(row.period_end),
    open: safeNumber(row.open),
    high: safeNumber(row.high),
    low: safeNumber(row.low),
    close: safeNumber(row.close),
    range: safeNumber(row.range),
    rangePct: safeNumber(row.range_pct),
    returnPct: safeNumber(row.return_pct),
    atr14: row.atr14 === null ? null : safeNumber(row.atr14),
    volatilityPct: row.volatility_pct === null ? null : safeNumber(row.volatility_pct),
    dataPoints: safeNumber(row.data_points),
    updatedAt: safeNumber(row.updated_at)
  });

  return {
    symbol: normalizedSymbol,
    latestDaily: dailyBars[dailyBars.length - 1] || null,
    rolling: statsRows
      .filter(row => String(row.period_type).startsWith('ROLLING_'))
      .map(mapStat),
    daily: statsRows.filter(row => row.period_type === 'DAILY').slice(0, 90).map(mapStat),
    weekly: statsRows.filter(row => row.period_type === 'WEEKLY').slice(0, 52).map(mapStat),
    monthly: statsRows.filter(row => row.period_type === 'MONTHLY').slice(0, 24).map(mapStat)
  };
}

export async function getMarketTrendContext(symbol: string): Promise<{
  symbol: string;
  currentClose: number | null;
  direction: 'BULLISH' | 'BEARISH' | 'MIXED' | 'INSUFFICIENT_DATA';
  horizon: {
    days7: { returnPct: number | null; volatilityPct: number | null; high: number | null; low: number | null };
    days30: { returnPct: number | null; volatilityPct: number | null; high: number | null; low: number | null };
    days90: { returnPct: number | null; volatilityPct: number | null; high: number | null; low: number | null };
    days365: { returnPct: number | null; volatilityPct: number | null; high: number | null; low: number | null };
  };
  observation: string;
}> {
  const cacheKey = normalizeSymbol(symbol);
  const cached = trendContextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const summary = await getMarketHistorySummary(symbol);
  const rolling = new Map(summary.rolling.map(stat => [stat.periodType, stat]));
  const get = (periodType: MarketPeriodStats['periodType']) => {
    const stat = rolling.get(periodType);
    return {
      returnPct: stat?.returnPct ?? null,
      volatilityPct: stat?.volatilityPct ?? null,
      high: stat?.high ?? null,
      low: stat?.low ?? null
    };
  };

  const rollingPeriods: Array<MarketPeriodStats['periodType']> = [
    'ROLLING_7D',
    'ROLLING_30D',
    'ROLLING_90D',
    'ROLLING_365D'
  ];
  const returns = rollingPeriods
    .map(key => rolling.get(key)?.returnPct)
    .filter((value): value is number => Number.isFinite(value));

  let direction: 'BULLISH' | 'BEARISH' | 'MIXED' | 'INSUFFICIENT_DATA' = 'INSUFFICIENT_DATA';
  if (returns.length >= 2) {
    const positive = returns.filter(value => value > 0).length;
    const negative = returns.filter(value => value < 0).length;
    direction = positive === returns.length
      ? 'BULLISH'
      : negative === returns.length
        ? 'BEARISH'
        : 'MIXED';
  }

  const latestClose = summary.latestDaily?.close ?? null;
  const observation = direction === 'INSUFFICIENT_DATA'
    ? 'Insufficient long-horizon market history for a directional trend classification.'
    : `Long-horizon returns are ${direction.toLowerCase()} across the available rolling periods.`;

  const result = {
    symbol: summary.symbol,
    currentClose: latestClose,
    direction,
    horizon: {
      days7: get('ROLLING_7D'),
      days30: get('ROLLING_30D'),
      days90: get('ROLLING_90D'),
      days365: get('ROLLING_365D')
    },
    observation
  };
  trendContextCache.set(cacheKey, { expiresAt: Date.now() + 60_000, value: result });
  return result;
}

export function startMarketHistoryScheduler(): void {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    void syncMarketHistory();
  }, SYNC_INTERVAL_MS);
  syncTimer.unref?.();
}

export function stopMarketHistoryScheduler(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

export function getMarketHistorySchedulerStatus() {
  return {
    running: Boolean(syncTimer),
    syncInFlight,
    lastGlobalSyncAt,
    intervalMs: SYNC_INTERVAL_MS,
    dailyBackfillBars: FULL_DAILY_BARS,
    weeklyBackfillBars: FULL_WEEKLY_BARS,
    monthlyBackfillBars: FULL_MONTHLY_BARS,
    pairConcurrency: PAIR_CONCURRENCY
  };
}
