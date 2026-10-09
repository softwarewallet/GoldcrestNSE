import { Router, Request, Response } from 'express';
import { brokerRegistry } from './registry';
import { killSwitch } from './safety/KillSwitch';
import { liveTradingGate } from './safety/LiveTradingGate';
import { autoExecutionEngine } from './safety/AutoExecutionEngine';
import { getAuditLogs, logBrokerAction, maskIdentifier } from './auditLog';
import { BrokerAdapter, BrokerType, NormalizedPosition, NormalizedQuote, TradingEnvironment, OrderRequest } from './types';
import { normalizeBrokerError } from './errors';
import { reconciliationService } from '../services/reconciliationService';
import { getForexSessionState, getIndianSessionState } from '../markets/common/session';
import { claimExecutionIntent, completeExecutionIntent, failExecutionIntent, markExecutionIntentInFlight, getExecutionIntent, resumeExecutionIntentReconciliation } from '../services/executionIntentService';
import { reconcileExecutionIntent } from '../services/executionReconciliationService';
import { getSystemConfig } from '../services/configService';
import { executeQuery, executeRun } from '../database/db';
import { calculateForexPipTargets, normalizePriceToThreeDigits, normalizePriceToInstrumentDigits, sizeForexOrderToMaxTradeValue } from './safety/TradeSizing';
import { liveRuntimeLog } from '../services/liveRuntimeLog';
import { autoTradingService } from '../services/autoTradingService';
import { firstLiveService } from '../services/firstLiveService';

import { FivePaisaBrokerAdapter } from './adapters/fivepaisa/FivePaisaBrokerAdapter';

export const brokerRouter = Router();

const LIVE_BROKERS: BrokerType[] = ['FIVE_PAISA'];

// Several terminal surfaces request broker status at nearly the same time.
// Share one short-lived broker snapshot and one in-flight request so normal
// UI polling does not repeatedly hit broker account APIs and trigger provider
// throttling. Order execution paths still request the broker directly.
const BROKER_STATUS_CACHE_TTL_MS = 15_000;
let brokerStatusCache: { payload: any; expiresAt: number } | null = null;
let brokerStatusInFlight: Promise<any> | null = null;
const lastKnownBrokerAccounts = new Map<BrokerType, any>();
let brokerStatusLoopStarted = false;
const BROKER_STATUS_BACKGROUND_REFRESH_MS = 15_000;

type BrokerCollectionCache = { payload: any[]; expiresAt: number };
const positionsCache: BrokerCollectionCache = { payload: [], expiresAt: 0 };
const ordersCache: BrokerCollectionCache = { payload: [], expiresAt: 0 };
let positionsInFlight: Promise<any[]> | null = null;
let ordersInFlight: Promise<any[]> | null = null;
const BROKER_COLLECTION_CACHE_TTL_MS = 10_000;

function resolveMarketBroker(_market: string): BrokerType {
  return 'FIVE_PAISA';
}

function forexQuoteCurrencies(symbol: string): { base: string; quote: string } | null {
  const compact = String(symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (compact.length !== 6) return null;
  return { base: compact.slice(0, 3), quote: compact.slice(3, 6) };
}

async function convertForexNotionalToAccountCurrency(
  adapter: BrokerAdapter,
  symbol: string,
  notional: number,
  accountCurrency: string
): Promise<number> {
  if (!Number.isFinite(notional) || notional < 0) throw new Error('INVALID_EXPOSURE_NOTIONAL');

  const sourcePair = forexQuoteCurrencies(symbol);
  if (!sourcePair) throw new Error(`Unable to determine Forex currencies for ${symbol}.`);

  const from = sourcePair.base.toUpperCase();
  const target = String(accountCurrency || '').toUpperCase();
  if (!target) throw new Error('ACCOUNT_CURRENCY_UNAVAILABLE');
  if (from === target) return notional;

  // Prefer a directly tradable G10 conversion leg. This avoids the additional
  // cTrader assets/conversion-chain WebSocket round trips that were timing out
  // on the configured account transport.
  const directSymbol = `${from}/${target}`;
  const inverseSymbol = `${target}/${from}`;

  try {
    const direct = await adapter.getQuote(directSymbol);
    if (direct.status === 'FRESH' && direct.bid > 0 && direct.ask > 0) {
      return notional * direct.bid;
    }
  } catch {
    // Try the inverse leg before falling back to native cTrader conversion.
  }

  try {
    const inverse = await adapter.getQuote(inverseSymbol);
    if (inverse.status === 'FRESH' && inverse.bid > 0 && inverse.ask > 0) {
      return notional / inverse.ask;
    }
  } catch {
    // Use cTrader's native conversion-chain API only when no direct pair is usable.
  }

  if (typeof adapter.getAccountCurrencyConversionRate !== 'function') {
    throw new Error(`Authoritative currency conversion unavailable for ${from} to ${target}.`);
  }

  const rate = await adapter.getAccountCurrencyConversionRate(from, target);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Authoritative FX conversion returned an invalid rate for ${from} to ${target}.`);
  }
  return notional * rate;
}

async function calculateAccountCurrencyExposure(
  adapter: BrokerAdapter,
  positions: NormalizedPosition[],
  accountCurrency: string
): Promise<number> {
  let exposure = 0;
  const conversionCache = new Map<string, number>();

  const convertNotional = async (
    symbol: string,
    notional: number,
    sourceCurrency: string,
    preferredRate?: number
  ): Promise<number> => {
    const target = String(accountCurrency || '').toUpperCase();
    const source = String(sourceCurrency || '').toUpperCase();
    if (!target) throw new Error('ACCOUNT_CURRENCY_UNAVAILABLE');
    if (!(notional >= 0)) throw new Error('INVALID_EXPOSURE_NOTIONAL');
    if (source === target) return notional;
    if (preferredRate !== undefined && Number.isFinite(preferredRate) && preferredRate > 0) {
      return notional * preferredRate;
    }

    const key = `${source}->${target}`;
    const cached = conversionCache.get(key);
    if (cached !== undefined) return notional * cached;

    const rate = await adapter.getAccountCurrencyConversionRate!(source, target);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Authoritative FX conversion returned an invalid rate for ${source} to ${target}.`);
    }
    conversionCache.set(key, rate);
    return notional * rate;
  };

  for (const position of positions) {
    const quantity = Math.abs(Number(position.quantity || 0));
    const price = Number(position.currentPrice || position.entryPrice || 0);
    if (!(quantity > 0 && price > 0)) continue;

    if (position.market !== 'FOREX') {
      exposure += quantity * price;
      continue;
    }

    const currencies = forexQuoteCurrencies(position.symbol);
    if (!currencies) throw new Error(`Unable to determine Forex currencies for ${position.symbol}.`);

    // For the common case where account currency equals the pair quote
    // currency (e.g. GBP/USD in a USD account), the position's broker-reported
    // current price is already the authoritative conversion rate.
    if (currencies.quote === String(accountCurrency).toUpperCase()) {
      exposure += quantity * price;
    } else if (currencies.base === String(accountCurrency).toUpperCase()) {
      exposure += quantity;
    } else {
      exposure += await convertNotional(position.symbol, quantity, currencies.base);
    }
  }


  return exposure;
}

async function loadPersistedBrokerAccount(broker: BrokerType): Promise<any | null> {
  try {
    const rows = await executeQuery<any>(
      'SELECT account_json FROM broker_reconciliation_snapshots WHERE broker = ? AND environment = ? ORDER BY timestamp DESC LIMIT 1',
      [broker, 'LIVE']
    );
    const snapshot = rows[0]?.account_json;
    if (!snapshot) return null;
    const account = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    return account && typeof account === 'object' ? account : null;
  } catch {
    try {
      const rows = await executeQuery<any>(
        'SELECT account_id, account_type, balance, equity, available_margin, used_margin, free_margin, currency, connection_status, server, permissions_json, last_update, is_live_account FROM broker_accounts WHERE broker = ? AND environment = ? ORDER BY last_update DESC LIMIT 1',
        [broker, 'LIVE']
      );
      const row = rows[0];
      if (!row) return null;
      return {
        accountId: String(row.account_id),
        accountType: String(row.account_type || 'LIVE'),
        balance: Number(row.balance || 0),
        equity: Number(row.equity || 0),
        availableMargin: Number(row.available_margin || 0),
        usedMargin: Number(row.used_margin || 0),
        freeMargin: Number(row.free_margin || 0),
        currency: String(row.currency || ''),
        broker,
        environment: 'LIVE',
        connectionStatus: 'CONNECTED',
        server: row.server || undefined,
        permissions: row.permissions_json ? JSON.parse(row.permissions_json) : [],
        lastUpdate: Number(row.last_update || 0),
        isLiveAccount: Boolean(row.is_live_account)
      };
    } catch {
      return null;
    }
  }
}

async function persistBrokerAccountSnapshot(account: any): Promise<void> {
  try {
    await executeRun(
      'INSERT OR REPLACE INTO broker_accounts (id, broker, environment, account_id, account_type, balance, equity, available_margin, used_margin, free_margin, currency, connection_status, server, permissions_json, last_update, is_live_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        `${account.broker}_${account.environment}_${account.accountId}`,
        account.broker,
        'LIVE',
        String(account.accountId || ''),
        String(account.accountType || 'LIVE'),
        Number(account.balance || 0),
        Number(account.equity || 0),
        Number(account.availableMargin || 0),
        Number(account.usedMargin || 0),
        Number(account.freeMargin || 0),
        String(account.currency || ''),
        String(account.connectionStatus || 'CONNECTED'),
        account.server || null,
        JSON.stringify(account.permissions || []),
        Number(account.lastUpdate || Date.now()),
        account.isLiveAccount ? 1 : 0
      ]
    );
  } catch {
    // Persistence failure must never break broker status delivery.
  }
}
async function refreshBrokerStatusSnapshot(forceRefresh?: boolean): Promise<any> {
  const environment = brokerRegistry.getEnvironment();
  const controls = autoExecutionEngine.getControls();
  const haltDetails = killSwitch.getHaltDetails();

  const brokerStatus = await Promise.all(LIVE_BROKERS.map(async (broker) => {
    try {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      if (forceRefresh && typeof (adapter as any).clearCache === 'function') {
        (adapter as any).clearCache();
      }
      const account = await (adapter as any).getAccount(forceRefresh);
      lastKnownBrokerAccounts.set(broker, account);
      await persistBrokerAccountSnapshot(account);
      return { broker, environment: 'LIVE', connected: true, account, error: null, stale: false };
    } catch (err: any) {
      const normalized = normalizeBrokerError(err, broker, 'LIVE');
      const transient = ['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'UNAVAILABLE', 'BROKER_UNAVAILABLE'].includes(normalized.code);
      const fallback = transient
        ? (lastKnownBrokerAccounts.get(broker) || await loadPersistedBrokerAccount(broker))
        : null;

      if (fallback) {
        lastKnownBrokerAccounts.set(broker, fallback);
        return {
          broker,
          environment: 'LIVE',
          connected: false,
          account: fallback,
          stale: true,
          lastRefreshError: normalized.message,
          error: null,
          code: normalized.code
        };
      }

      return {
        broker,
        environment: 'LIVE',
        connected: false,
        account: null,
        error: normalized.message,
        code: normalized.code,
        stale: false
      };
    }
  }));

  const payload = {
    environment,
    routingMode: 'AUTOMATIC_BY_MARKET',
    selectedBroker: 'FIVE_PAISA',
    brokerRouting: {
      INDIAN_EQUITY: 'FIVE_PAISA',
      INDIAN_FUTURES: 'FIVE_PAISA',
      INDIAN_OPTIONS: 'FIVE_PAISA'
    },
    brokers: brokerStatus,
    credentials: brokerRegistry.getCredentialStatuses(),
    controls,
    emergencyStop: haltDetails,
    timestamp: Date.now()
  };

  brokerStatusCache = {
    payload,
    expiresAt: Date.now() + BROKER_STATUS_CACHE_TTL_MS
  };
  return payload;
}

function startBrokerStatusRefreshLoop(): void {
  if (brokerStatusLoopStarted) return;
  brokerStatusLoopStarted = true;

  const runRefresh = () => {
    if (brokerStatusInFlight) return;
    brokerStatusInFlight = refreshBrokerStatusSnapshot()
      .catch(err => {
        console.warn('[BROKER_STATUS] background refresh failed:', err?.message || err);
        return brokerStatusCache?.payload;
      })
      .finally(() => {
        brokerStatusInFlight = null;
      });
  };

  // Prime the snapshot once. Subsequent UI requests never need to contact a
  // broker; they read the last snapshot while this single server-side loop
  // refreshes it at a controlled cadence.
  runRefresh();
  setInterval(runRefresh, BROKER_STATUS_BACKGROUND_REFRESH_MS);
}

export function invalidateBrokerStatusCache(): void {
  brokerStatusCache = null;
}

async function getBrokerStatusSnapshot(forceRefresh?: boolean): Promise<any> {
  startBrokerStatusRefreshLoop();

  if (forceRefresh) {
    brokerStatusCache = null;
    return refreshBrokerStatusSnapshot(true);
  }

  if (brokerStatusCache && Date.now() < brokerStatusCache.expiresAt) {
    return brokerStatusCache.payload;
  }

  if (brokerStatusInFlight) {
    return brokerStatusInFlight;
  }

  return refreshBrokerStatusSnapshot();
}

brokerRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.force === 'true' || req.query.refresh === 'true';
    const payload = await getBrokerStatusSnapshot(forceRefresh);
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokerRouter.post('/test-connection', async (req: Request, res: Response) => {
  const requestedBroker = req.body?.broker as BrokerType | undefined;

  if (requestedBroker && !LIVE_BROKERS.includes(requestedBroker)) {
    return res.status(400).json({ error: 'Allowed live brokers: FIVE_PAISA' });
  }

  const brokers = requestedBroker ? [requestedBroker] : LIVE_BROKERS;
  const results = await Promise.all(brokers.map(async (broker) => {
    try {
      return await brokerRegistry.testBrokerConnection(broker, 'LIVE');
    } catch (err: any) {
      const normalized = normalizeBrokerError(err, broker, 'LIVE');
      return {
        broker,
        environment: 'LIVE',
        connected: false,
        account: '****',
        error: normalized.message,
        timestamp: Date.now()
      };
    }
  }));

  res.json({ routingMode: 'AUTOMATIC_BY_MARKET', results });
});

// Account discovery is broker-explicit for administrative diagnostics.
// Normal trading/dashboard flows use /status and aggregate 5paisa.
brokerRouter.get('/accounts', async (req: Request, res: Response) => {
  const requestedBroker = req.query.broker as BrokerType | undefined;
  const brokers = requestedBroker ? [requestedBroker] : LIVE_BROKERS;

  try {
    const results = await Promise.all(brokers.map(async (broker) => {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      if (adapter.getAccounts) return adapter.getAccounts();
      return [await adapter.getAccount()];
    }));
    res.json(results.flat());
  } catch (err: any) {
    const broker = requestedBroker || 'FIVE_PAISA';
    const normalized = normalizeBrokerError(err, broker, 'LIVE');
    res.status(500).json({ error: normalized.message, code: normalized.code });
  }
});

brokerRouter.post('/environment', (_req: Request, res: Response) => {
  const currentEnv = brokerRegistry.getEnvironment();
  brokerRegistry.setEnvironment('LIVE');
  res.json({
    success: true,
    previousEnvironment: currentEnv,
    activeEnvironment: 'LIVE',
    routingMode: 'AUTOMATIC_BY_MARKET'
  });
});

// Legacy endpoint retained for compatibility.
brokerRouter.post('/select', (req: Request, res: Response) => {
  const { broker } = req.body as { broker: BrokerType };

  if (!LIVE_BROKERS.includes(broker)) {
    return res.status(400).json({ error: 'Invalid broker. Allowed: FIVE_PAISA' });
  }

  res.json({
    success: true,
    selectedBroker: 'FIVE_PAISA',
    routingMode: 'AUTOMATIC_BY_MARKET',
    message: 'Goldcrest routes Indian markets to 5paisa LIVE API.'
  });
});

brokerRouter.post('/credentials/live', (req: Request, res: Response) => {
  const { broker, credentials, userConfirmedAcknowledge } = req.body;

  if (!userConfirmedAcknowledge) {
    return res.status(400).json({
      error: 'Live credentials can access real broker APIs. Explicit confirmation is required before updating.'
    });
  }

  if (!LIVE_BROKERS.includes(broker)) {
    return res.status(400).json({ error: 'Missing or invalid broker. Allowed: FIVE_PAISA' });
  }

  if (!credentials) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  brokerRegistry.updateLiveCredentials(broker, credentials);
  logBrokerAction({
    source: 'SETTINGS_UI',
    broker,
    environment: 'LIVE',
    account: maskIdentifier(credentials.accountId || credentials.clientId),
    action: 'UPDATE_LIVE_CREDENTIALS',
    result: 'SUCCESS'
  });

  res.json({
    success: true,
    message: `${broker} LIVE credentials configured. Real-money autonomous order submission is enabled only when the server-side live safety gate passes.`,
    maskedAccountId: maskIdentifier(credentials.accountId || credentials.clientId)
  });
});

const DASHBOARD_SUMMARY_CACHE_TTL_MS = 30_000;
let dashboardSummaryCache: { payload: any; expiresAt: number } | null = null;
let dashboardSummaryInFlight: Promise<any> | null = null;

async function refreshDashboardSummary(): Promise<any> {
  const status = await getBrokerStatusSnapshot();
  const accountByBroker = new Map(
    (status.brokers || []).map((row: any) => [row.broker, row.account]).filter(([, account]) => Boolean(account))
  );

  const results = await Promise.all(LIVE_BROKERS.map(async (broker) => {
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
    const account = accountByBroker.get(broker) || await adapter.getAccount();
    const [positions, openOrders, orderHistory] = await Promise.all([
      adapter.getPositions(),
      adapter.getOpenOrders(),
      adapter.getOrderHistory()
    ]);
    let dailyRealizedPnL: number | null = null;
    if (typeof adapter.getDailyRealizedPnL === 'function') {
      try { dailyRealizedPnL = await adapter.getDailyRealizedPnL(); } catch { dailyRealizedPnL = null; }
    }
    return { broker, account, positions, openOrders, orderHistory, dailyRealizedPnL };
  }));

  const accounts: any[] = results.map(r => r.account);
  const positions = results.flatMap(r => r.positions);
  const openOrders = results.flatMap(r => r.openOrders);
  const orderHistory = results.flatMap(r => r.orderHistory).sort((a, b) => b.timestamp - a.timestamp);
  const currencies = Array.from(new Set(accounts.map((a: any) => String(a?.currency || '').toUpperCase()).filter(Boolean)));
  const sameCurrency = currencies.length <= 1;
  const totalBalance = sameCurrency ? accounts.reduce((sum: number, a: any) => sum + Number(a?.balance || 0), 0) : null;
  const totalEquity = sameCurrency ? accounts.reduce((sum: number, a: any) => sum + Number(a?.equity || 0), 0) : null;
  const totalFreeMargin = sameCurrency ? accounts.reduce((sum: number, a: any) => sum + Number(a?.freeMargin || 0), 0) : null;
  const openPnL = positions.reduce((sum, p) => sum + Number(p.unrealizedPnL || 0), 0);
  const dailyRealizedPnLValues = results.map(r => r.dailyRealizedPnL).filter((v): v is number => Number.isFinite(v as number));
  const dailyRealizedPnL = dailyRealizedPnLValues.length
    ? dailyRealizedPnLValues.reduce((sum, v) => sum + v, 0)
    : null;
  const closedHistory = orderHistory.filter(o => ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(o.status));

  return {
    accounts,
    positions,
    openOrders,
    orderHistory: orderHistory.slice(0, 100),
    brokerSummaries: results.map(r => ({
      broker: r.broker,
      account: r.account,
      dailyRealizedPnL: r.dailyRealizedPnL,
      positionsCount: r.positions.length,
      openOrdersCount: r.openOrders.length,
      orderHistory: r.orderHistory.slice(0, 50)
    })),
    metrics: {
      totalBalance,
      totalEquity,
      totalFreeMargin,
      currencies,
      openPnL,
      dailyRealizedPnL,
      totalOrders: closedHistory.length,
      winRate: null,
      profitFactor: null,
      maxDrawdown: null
    },
    dataStatus: 'LIVE',
    generatedAt: Date.now()
  };
}

brokerRouter.get('/dashboard-summary', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (dashboardSummaryCache && now < dashboardSummaryCache.expiresAt) {
      return res.json(dashboardSummaryCache.payload);
    }
    if (dashboardSummaryInFlight) {
      if (dashboardSummaryCache) return res.json(dashboardSummaryCache.payload);
      return res.json(await dashboardSummaryInFlight);
    }

    dashboardSummaryInFlight = refreshDashboardSummary().then(payload => {
      dashboardSummaryCache = {
        payload,
        expiresAt: Date.now() + DASHBOARD_SUMMARY_CACHE_TTL_MS
      };
      return payload;
    }).catch(err => {
      if (dashboardSummaryCache?.payload) return dashboardSummaryCache.payload;
      throw err;
    }).finally(() => {
      dashboardSummaryInFlight = null;
    });

    if (dashboardSummaryCache) return res.json(dashboardSummaryCache.payload);
    return res.json(await dashboardSummaryInFlight);
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_DASHBOARD_DATA_UNAVAILABLE',
      message: err?.message || 'Authoritative broker dashboard data is unavailable.'
    });
  }
});

brokerRouter.get('/account', async (req: Request, res: Response) => {
  const requestedBroker = req.query.broker as BrokerType | undefined;

  try {
    if (requestedBroker) {
      if (!LIVE_BROKERS.includes(requestedBroker)) {
        return res.status(400).json({ error: 'Allowed live brokers: CTRADER, FIVE_PAISA' });
      }

      // Reuse the same account snapshot as the header/status endpoint. This
      // prevents independent UI surfaces from opening their own broker session.
      const status = await getBrokerStatusSnapshot();
      const row = status.brokers?.find((item: any) => item.broker === requestedBroker);

      if (row?.account) {
        return res.json(row.account);
      }

      const cached = lastKnownBrokerAccounts.get(requestedBroker);
      if (cached) {
        return res.json({
          ...cached,
          stale: true,
          lastRefreshError: row?.error || row?.lastRefreshError || 'Broker account refresh temporarily unavailable.'
        });
      }

      return res.status(503).json({
        error: row?.error || 'LIVE_ACCOUNT_UNAVAILABLE',
        code: row?.code || 'BROKER_UNAVAILABLE'
      });
    }

    const status = await getBrokerStatusSnapshot();
    return res.json({
      routingMode: 'AUTOMATIC_BY_MARKET',
      accounts: (status.brokers || [])
        .map((row: any) => row.account)
        .filter(Boolean)
    });
  } catch (err: any) {
    const broker = requestedBroker || 'CTRADER';
    const normalized = normalizeBrokerError(err, broker, 'LIVE');
    const cached = requestedBroker ? lastKnownBrokerAccounts.get(requestedBroker) : null;

    if (requestedBroker && cached) {
      return res.json({
        ...cached,
        stale: true,
        lastRefreshError: normalized.message
      });
    }

    return res.status(503).json({ error: normalized.message, code: normalized.code });
  }
});

brokerRouter.get('/positions', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (now < positionsCache.expiresAt) return res.json(positionsCache.payload);
  if (positionsInFlight) {
    if (positionsCache.payload.length) return res.json(positionsCache.payload);
    return res.json(await positionsInFlight);
  }

  positionsInFlight = (async () => {
    const results = await Promise.all(LIVE_BROKERS.map(async broker => {
      try {
        return await brokerRegistry.getAdapter(broker, 'LIVE').getPositions();
      } catch {
        return [];
      }
    }));
    const payload = results.flat();
    if (payload.length || positionsCache.payload.length === 0) {
      positionsCache.payload = payload;
    }
    positionsCache.expiresAt = Date.now() + BROKER_COLLECTION_CACHE_TTL_MS;
    return positionsCache.payload;
  })().finally(() => {
    positionsInFlight = null;
  });

  return res.json(await positionsInFlight);
});

brokerRouter.get('/order-history', async (req: Request, res: Response) => {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  const from = Number.isFinite(Number(req.query.from)) ? Number(req.query.from) : defaultFrom;
  const to = Number.isFinite(Number(req.query.to)) ? Number(req.query.to) : defaultTo;
  const direction = String(req.query.direction || 'ALL').toUpperCase();
  const requestedBroker = String(req.query.broker || '').toUpperCase();

  if (!(from >= 0 && to >= from)) {
    return res.status(400).json({ error: 'Invalid history date range.' });
  }
  if (direction !== 'ALL' && direction !== 'BUY' && direction !== 'SELL') {
    return res.status(400).json({ error: 'Direction must be ALL, BUY, or SELL.' });
  }
  if (requestedBroker && !LIVE_BROKERS.includes(requestedBroker as BrokerType)) {
    return res.status(400).json({ error: 'Broker must be CTRADER or FIVE_PAISA.' });
  }

  try {
    const brokers = requestedBroker
      ? [requestedBroker as BrokerType]
      : LIVE_BROKERS;

    const results = await Promise.all(brokers.map(async broker => {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      const history = adapter.getOrderHistoryRange
        ? await adapter.getOrderHistoryRange(from, to)
        : await adapter.getOrderHistory();

      return history
        .filter(order => Number(order.timestamp) >= from && Number(order.timestamp) <= to)
        .filter(order => direction === 'ALL' || order.side === direction)
        .map(order => {
          const closingPrice = Number(order.averageFillPrice ?? order.price ?? 0);
          const closingQuantity = Number(order.filledQuantity ?? order.quantity ?? 0);
          const closingVolume = closingPrice > 0 && closingQuantity > 0
            ? closingPrice * closingQuantity
            : null;

          return {
            id: order.id,
            broker: order.broker,
            environment: order.environment,
            symbol: order.symbol,
            openingDirection: order.side,
            closingTime: order.timestamp,
            entryPrice: Number(order.price ?? 0) || null,
            closingPrice: closingPrice > 0 ? closingPrice : null,
            closingQuantity: closingQuantity > 0 ? closingQuantity : null,
            closingVolume,
            swap: null,
            commission: Number(order.commission ?? 0) || null,
            netAmount: null,
            balance: null,
            orderStatus: order.status,
            brokerOrderId: order.brokerOrderId || null,
            signalId: order.signalId || null,
            strategyId: order.strategyId || null
          };
        });
    }));

    const rows = results.flat().sort((a, b) => Number(b.closingTime) - Number(a.closingTime));
    res.json({
      environment: 'LIVE',
      from,
      to,
      direction,
      rows,
      count: rows.length,
      sources: brokers
    });
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_ORDER_HISTORY_UNAVAILABLE',
      message: err?.message || 'Authoritative live order history is unavailable.'
    });
  }
});

brokerRouter.get('/orders', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (now < ordersCache.expiresAt) return res.json(ordersCache.payload);
  if (ordersInFlight) {
    if (ordersCache.payload.length) return res.json(ordersCache.payload);
    return res.json(await ordersInFlight);
  }

  ordersInFlight = (async () => {
    const results = await Promise.all(LIVE_BROKERS.map(async broker => {
      try {
        return await brokerRegistry.getAdapter(broker, 'LIVE').getOpenOrders();
      } catch {
        return [];
      }
    }));
    const payload = results.flat();
    if (payload.length || ordersCache.payload.length === 0) {
      ordersCache.payload = payload;
    }
    ordersCache.expiresAt = Date.now() + BROKER_COLLECTION_CACHE_TTL_MS;
    return ordersCache.payload;
  })().finally(() => {
    ordersInFlight = null;
  });

  return res.json(await ordersInFlight);
});

brokerRouter.get('/execution-intents', async (req: Request, res: Response) => {
  try {
    const requestedLimit = Number(req.query.limit ?? 50);
    const limit = Math.max(1, Math.min(200, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50));
    const requestedState = String(req.query.state || 'ALL').toUpperCase();
    const allowedStates = ['PENDING', 'IN_FLIGHT', 'RECONCILIATION_TIMEOUT', 'COMPLETED', 'FAILED'];
    const states = requestedState === 'ALL' ? allowedStates : [requestedState];
    if (!states.every(state => allowedStates.includes(state))) {
      return res.status(400).json({ error: 'Invalid execution intent state filter.' });
    }

    const placeholders = states.map(() => '?').join(', ');
    const rows = await executeQuery<any>(
      `SELECT * FROM execution_intents WHERE state IN (${placeholders}) ORDER BY updated_at DESC LIMIT ?`,
      [...states, limit]
    );
    const now = Date.now();
    const intents = rows.map((row: any) => {
      let payload: any = {};
      let result: any = {};
      try { payload = JSON.parse(row.payload_json || '{}'); } catch {}
      try { result = JSON.parse(row.result_json || '{}'); } catch {}
      const createdAt = Number(row.created_at || 0);
      const updatedAt = Number(row.updated_at || 0);
      const lastAttemptAt = Number(result.reconciliationLastAttemptAt || result.reconciledAt || 0);
      const ageMs = createdAt > 0 ? Math.max(0, now - createdAt) : 0;
      return {
        idempotencyKey: row.idempotency_key,
        broker: row.broker,
        market: row.market,
        symbol: row.symbol,
        side: row.side,
        state: row.state,
        createdAt,
        updatedAt,
        ageMs,
        ageSeconds: Math.floor(ageMs / 1000),
        reconciliation: {
          state: result.reconciliationState || row.state,
          attemptCount: Number(result.reconciliationAttemptCount || 0),
          lastAttemptAt: lastAttemptAt || null,
          lastAttemptAgeMs: lastAttemptAt > 0 ? Math.max(0, now - lastAttemptAt) : null,
          brokerOrderId: result.brokerOrderId || result.order?.brokerOrderId || result.order?.id || null,
          clientOrderId: result.clientOrderId || payload.signalId || result.order?.clientOrderId || null,
          brokerStatus: result.brokerStatus || result.order?.status || null,
          requestedQuantity: Number(result.requestedQuantity ?? result.order?.requestedQuantity ?? result.order?.quantity ?? payload.quantity ?? 0) || null,
          filledQuantity: Number(result.filledQuantity ?? result.order?.filledQuantity ?? 0) || 0,
          remainingQuantity: result.remainingQuantity !== undefined ? Number(result.remainingQuantity) : null,
          averageFillPrice: Number(result.averageFillPrice ?? result.order?.averageFillPrice ?? 0) || null,
          errorCode: result.reconciliationErrorCode || result.code || null,
          reason: result.reconciliationError || result.detail || result.error || null,
          operatorActionRequired: Boolean(result.operatorActionRequired || row.state === 'RECONCILIATION_TIMEOUT')
        }
      };
    });
    res.json({ environment: 'LIVE', timestamp: now, count: intents.length, intents });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load execution reconciliation diagnostics.' });
  }
});

brokerRouter.get('/execution/:idempotencyKey', async (req: Request, res: Response) => {
  try {
    const key = String(req.params.idempotencyKey || '').trim();
    if (!key) return res.status(400).json({ error: 'Missing idempotency key.' });
    const intent = await getExecutionIntent(key);
    if (!intent) return res.status(404).json({ error: 'Execution intent not found.' });
    res.json({
      ...intent,
      operatorActionRequired: intent.state === 'RECONCILIATION_TIMEOUT' || Boolean((intent.result as any)?.operatorActionRequired),
      reconciliationState: (intent.result as any)?.reconciliationState || intent.state
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load execution intent.' });
  }
});

brokerRouter.post('/execution/:idempotencyKey/retry-reconciliation', async (req: Request, res: Response) => {
  try {
    const key = String(req.params.idempotencyKey || '').trim();
    if (!key) return res.status(400).json({ error: 'Missing idempotency key.' });
    const intent = await getExecutionIntent(key);
    if (!intent) return res.status(404).json({ error: 'Execution intent not found.' });
    if (intent.state !== 'RECONCILIATION_TIMEOUT') {
      return res.status(409).json({ error: 'Execution intent is not in RECONCILIATION_TIMEOUT state.', state: intent.state });
    }
    await resumeExecutionIntentReconciliation(key);
    void reconcileExecutionIntent(key);
    res.json({ success: true, idempotencyKey: key, state: 'IN_FLIGHT' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to resume reconciliation.' });
  }
});

brokerRouter.post('/order', async (req: Request, res: Response) => {
  res.type('application/json');
  res.setHeader('X-Goldcrest-Route', 'broker-order-live');
  const orderReq = req.body as OrderRequest;
  const env: TradingEnvironment = 'LIVE';

  try {
    if (!orderReq?.market || !orderReq?.symbol) {
      return res.status(400).json({ error: 'Missing market or symbol', code: 'INVALID_SYMBOL' });
    }

    const rawSide = String(orderReq.side || 'BUY').toUpperCase();
    orderReq.side = (rawSide.includes('SELL') || rawSide.includes('SHORT')) ? 'SELL' : 'BUY';

    // Hard requirement: every live order is submitted with trailing stop loss enabled.
    orderReq.trailingStopLoss = true;

    const broker = resolveMarketBroker(orderReq.market);
    const adapter = brokerRegistry.getAdapterForMarket(orderReq.market);

    const compat = brokerRegistry.validateMarketCompatibility(orderReq.market, broker);
    if (!compat.compatible) {
      return res.status(400).json({ error: compat.reason, code: 'INVALID_SYMBOL' });
    }

    if (killSwitch.isHalted()) {
      return res.status(403).json({
        error: 'TRADING HALTED: Emergency Kill Switch is currently active. New orders are blocked.',
        code: 'EMERGENCY_STOP_ACTIVE'
      });
    }

    // Pre-flight check: a live order requires an authoritative, fresh broker quote.
    // Never substitute hard-coded or substitute prices on an autonomous execution path.
    let quote;
    try {
      quote = await adapter.getQuote(orderReq.symbol);
    } catch (err: any) {
      return res.status(503).json({
        error: `Authoritative live quote unavailable: ${err?.message || 'broker quote request failed'}`,
        code: 'LIVE_QUOTE_UNAVAILABLE'
      });
    }

    if (!quote || quote.bid <= 0 || quote.ask <= 0) {
      return res.status(400).json({ error: 'Authoritative real-time quote is currently unavailable.', code: 'STALE_DATA' });
    }

    // Resolve broker instrument precision before sizing or dispatch. Symbol
    // precision is authoritative: XAU/USD can allow 2 decimals while other
    // instruments may allow 3 or more.
    const precisionInstrument = await adapter.getInstrument(orderReq.symbol);
    if (!precisionInstrument) {
      return res.status(400).json({
        error: `Live broker instrument metadata unavailable for ${orderReq.symbol}.`,
        code: 'INVALID_SYMBOL'
      });
    }

    if (!orderReq.price || orderReq.price <= 0) {
      orderReq.price = orderReq.side === 'BUY' ? quote.ask : quote.bid;
    }
    orderReq.price = normalizePriceToInstrumentDigits(Number(orderReq.price), precisionInstrument.digits);

    // Operator-configured Forex pip margins are authoritative for every new
    // Forex order, including Trigger Now. This keeps manual and Auto Live
    // execution on the same Stop Loss / Take Profit contract.
    if (orderReq.market === 'FOREX') {
      const config = getSystemConfig();
      try {
        const pipTargets = calculateForexPipTargets(
          orderReq.side,
          Number(orderReq.price),
          precisionInstrument.pipSize,
          config.forexStopLossPips,
          config.forexTakeProfitPips
        );
        orderReq.stopLoss = pipTargets.stopLoss;
        orderReq.takeProfit = pipTargets.takeProfit;

        liveRuntimeLog('INFO', 'FOREX_PIP_TARGETS_APPLIED', {
          broker,
          symbol: orderReq.symbol,
          side: orderReq.side,
          entryPrice: orderReq.price,
          pipSize: pipTargets.pipSize,
          stopLossPips: pipTargets.stopLossPips,
          takeProfitPips: pipTargets.takeProfitPips,
          stopLoss: pipTargets.stopLoss,
          takeProfit: pipTargets.takeProfit
        });
      } catch (targetError: any) {
        return res.status(400).json({
          error: 'Invalid Forex Stop Loss / Take Profit pip configuration.',
          code: 'INVALID_FOREX_PIP_TARGETS',
          details: [targetError?.message || String(targetError)]
        });
      }
    }

    // Hard position-sizing boundary: calculate the Forex quantity directly from
    // the operator-configured maximum trade value immediately before execution.
    // The requested quantity is audit metadata only; it cannot cap the result.
    // Broker-side minimum/step volume rules are intentionally left to cTrader.
    let sizingResult: Awaited<ReturnType<typeof sizeForexOrderToMaxTradeValue>> | null = null;
    if (orderReq.market === 'FOREX') {
      const instrument = precisionInstrument;

      try {
        sizingResult = await sizeForexOrderToMaxTradeValue(
          adapter,
          orderReq.symbol,
          orderReq.price,
          instrument,
          Number(orderReq.quantity)
        );
        const requestedQuantity = Number(orderReq.quantity);
        orderReq.quantity = sizingResult.quantity;

        liveRuntimeLog('INFO', 'ORDER_POSITION_SIZED', {
          broker,
          market: orderReq.market,
          symbol: orderReq.symbol,
          requestedQuantity,
          directQuantity: sizingResult.directQuantity,
          configuredQuantity: sizingResult.maxTradeValueUsd,
          sizingAdjusted: sizingResult.adjusted,
          sizingMode: 'DIRECT_QUANTITY_NO_CURRENCY_CONVERSION'
        });
      } catch (sizingError: any) {
        return res.status(403).json({
          error: 'Live Safety Gate Rejected Order',
          code: 'POSITION_SIZING_REJECTED',
          details: [sizingError?.message || String(sizingError)]
        });
      }
    }

    // Forex SL/TP were already calculated from the operator pip settings
    // above. Preserve the existing fallback behavior for non-Forex orders.
    if (orderReq.market !== 'FOREX' && (!orderReq.stopLoss || orderReq.stopLoss <= 0)) {
      const referencePrice = orderReq.price;
      const pct = 0.01;
      if (orderReq.side === 'BUY') {
        orderReq.stopLoss = normalizePriceToInstrumentDigits(referencePrice * (1 - pct), precisionInstrument.digits);
        if (!orderReq.takeProfit || orderReq.takeProfit <= 0) {
          orderReq.takeProfit = normalizePriceToInstrumentDigits(referencePrice * (1 + pct * 2), precisionInstrument.digits);
        }
      } else {
        orderReq.stopLoss = normalizePriceToInstrumentDigits(referencePrice * (1 + pct), precisionInstrument.digits);
        if (!orderReq.takeProfit || orderReq.takeProfit <= 0) {
          orderReq.takeProfit = normalizePriceToInstrumentDigits(referencePrice * (1 - pct * 2), precisionInstrument.digits);
        }
      }
    }

    // Normalize final broker-facing SL/TP after the pip settings or fallback
    // calculation has been applied.
    if (orderReq.stopLoss !== undefined && Number(orderReq.stopLoss) > 0) {
      orderReq.stopLoss = normalizePriceToInstrumentDigits(Number(orderReq.stopLoss), precisionInstrument.digits);
    }
    if (orderReq.takeProfit !== undefined && Number(orderReq.takeProfit) > 0) {
      orderReq.takeProfit = normalizePriceToInstrumentDigits(Number(orderReq.takeProfit), precisionInstrument.digits);
    }

    const account = await adapter.getAccount();
    const positions = await adapter.getPositions();
    const isMarketOpen = orderReq.market === 'FOREX'
      ? !getForexSessionState().activeSessions.includes('CLOSED (WEEKEND)')
      : getIndianSessionState().isOpen;
    let totalAccountExposure: number;
    try {
      totalAccountExposure = await calculateAccountCurrencyExposure(
        adapter,
        positions,
        account.currency
      );
    } catch (exposureErr: any) {
      return res.status(403).json({
        error: 'Live Safety Gate Rejected Order',
        code: 'EXPOSURE_CURRENCY_UNAVAILABLE',
        details: [`Account-currency exposure could not be verified safely: ${exposureErr?.message || String(exposureErr)}`]
      });
    }
    const maxAllowedExposure = Math.max(Number(account.equity || 0), 1);
    const dailyLossLimit = Math.max(
      Number(account.balance || 0) * (Number(getSystemConfig().maxDailyLossPct) / 100),
      1
    );

    const gateResult = await liveTradingGate.evaluate(adapter, {
      order: orderReq,
      signalAgeMs: 15000,
      currentQuote: quote,
      isMarketOpen,
      dailyRealizedLoss: await reconciliationService.getDailyLoss(adapter.broker as 'CTRADER' | 'FIVE_PAISA', Number(account.balance || 0)),
      dailyLossLimit,
      totalAccountExposure,
      maxAllowedExposure,
      activePositionsCount: positions.length,
      maxOpenPositions: Number(getSystemConfig().maxOpenPositions),
      activePairPositionsCount: positions.filter(position =>
        String(position.symbol || '').toUpperCase() === String(orderReq.symbol || '').toUpperCase()
      ).length,
      maxPairPositions: Math.max(1, Math.min(20, Math.floor(Number(getSystemConfig().autoLiveMaxTradesPerPair))))
    });

    if (!gateResult.passed) {
      logBrokerAction({
        source: 'ORDER_VALIDATION',
        broker,
        environment: env,
        account: 'LIVE_ACCOUNT',
        action: 'VALIDATE_ORDER',
        symbol: orderReq.symbol,
        quantity: orderReq.quantity,
        price: orderReq.price,
        result: 'BLOCKED',
        error: gateResult.failedReasons.join(', ')
      });

      return res.status(403).json({
        error: 'Live Safety Gate Rejected Order',
        code: 'SAFETY_GATE_REJECTED',
        details: gateResult.failedReasons
      });
    }

    if (req.body.validateOnly) {
      return res.json({
        status: 'VALIDATED',
        broker,
        market: orderReq.market,
        quantity: orderReq.quantity,
        ...(sizingResult ? {
          requestedQuantity: sizingResult.requestedQuantity,
          directQuantity: sizingResult.directQuantity,
          configuredQuantity: sizingResult.maxTradeValueUsd,
          sizingAdjusted: sizingResult.adjusted,
          sizingMode: 'DIRECT_QUANTITY_NO_CURRENCY_CONVERSION'
        } : {}),
        message: 'Order pre-flight checks passed. Live dispatch is permitted by the current server controls.'
      });
    }


    const idempotencyKey = String(
      req.header('X-Idempotency-Key') ||
      orderReq.signalId ||
      ''
    ).trim();

    if (!idempotencyKey) {
      return res.status(400).json({
        error: 'Autonomous live orders require X-Idempotency-Key or signalId.',
        code: 'IDEMPOTENCY_KEY_REQUIRED'
      });
    }

    const intent = await claimExecutionIntent(idempotencyKey, {
      broker,
      market: orderReq.market,
      symbol: orderReq.symbol,
      side: orderReq.side,
      payload: orderReq
    });

    if (!intent.claimed) {
      if (intent.existing?.state === 'COMPLETED') {
        return res.json({
          status: 'DUPLICATE_REPLAY',
          broker,
          market: orderReq.market,
          order: intent.existing.result
        });
      }
      return res.status(409).json({
        error: 'An autonomous execution with this idempotency key is already pending or has failed.',
        code: 'EXECUTION_INTENT_ALREADY_EXISTS',
        state: intent.existing?.state
      });
    }

    const config = getSystemConfig();
    const currentExecMode = config.executionMode || 'LIVE_DRY_RUN';

    let reservationToken: string | null = null;
    if (currentExecMode === 'FIRST_LIVE_CERTIFICATION') {
      const preflight = await firstLiveService.preflightCheck(orderReq);
      if (!preflight.pass) {
        await failExecutionIntent(idempotencyKey, {
          broker,
          market: orderReq.market,
          symbol: orderReq.symbol,
          submissionState: 'REJECTED_OR_FAILED',
          error: preflight.reasons.join(', '),
          code: 'FIRST_LIVE_PREFLIGHT_FAILED',
          failedAt: Date.now()
        });
        return res.status(403).json({
          error: `First-Live preflight checks failed: ${preflight.reasons.join(', ')}`,
          code: 'FIRST_LIVE_PREFLIGHT_FAILED',
          details: preflight.reasons
        });
      }

      let authorizedInstrument;
      if (typeof (adapter as any).resolveAuthoritativeLiveInstrument === 'function') {
        try {
          authorizedInstrument = await (adapter as any).resolveAuthoritativeLiveInstrument(orderReq.symbol, orderReq.market);
        } catch (authErr: any) {
          await failExecutionIntent(idempotencyKey, {
            broker,
            market: orderReq.market,
            symbol: orderReq.symbol,
            submissionState: 'REJECTED_OR_FAILED',
            error: authErr?.message || String(authErr),
            code: authErr?.code || 'AUTHORITATIVE_INSTRUMENT_UNAVAILABLE',
            failedAt: Date.now()
          });
          return res.status(403).json({
            error: authErr?.message || 'Authoritative instrument unavailable for live execution',
            code: authErr?.code || 'AUTHORITATIVE_INSTRUMENT_UNAVAILABLE'
          });
        }
      }

      const correlationId = orderReq.signalId || orderReq.strategyId || idempotencyKey || `fl-corr-${Date.now()}`;
      const reservation = await firstLiveService.reserveFirstLiveOrder({
        correlationId,
        idempotencyKey,
        orderRequest: orderReq,
        authorizedInstrument
      });

      if (!reservation.success || !reservation.reservationToken) {
        await failExecutionIntent(idempotencyKey, {
          broker,
          market: orderReq.market,
          symbol: orderReq.symbol,
          submissionState: 'REJECTED_OR_FAILED',
          error: reservation.message,
          code: 'FIRST_LIVE_RESERVATION_FAILED',
          failedAt: Date.now()
        });
        return res.status(403).json({
          error: reservation.message,
          code: 'FIRST_LIVE_RESERVATION_FAILED'
        });
      }

      reservationToken = reservation.reservationToken;
      orderReq.firstLiveReservationToken = reservationToken;
      orderReq._firstLiveIdempotencyKey = idempotencyKey;
      orderReq._firstLiveCorrelationId = correlationId;
    }

    let placedOrder;
    try {
      placedOrder = await adapter.placeOrder(orderReq);
    } catch (err: any) {
      if (reservationToken) {
        await firstLiveService.finalizeFirstLiveOrder({
          reservationToken,
          status: 'REJECTED',
          error: err?.message || String(err)
        });
      }
      await failExecutionIntent(idempotencyKey, {
        broker,
        market: orderReq.market,
        symbol: orderReq.symbol,
        submissionState: 'REJECTED_OR_FAILED',
        error: err?.message || String(err),
        code: err?.code || 'ORDER_REJECTED',
        failedAt: Date.now()
      });
      throw err;
    }

    if (reservationToken) {
      await firstLiveService.finalizeFirstLiveOrder({
        reservationToken,
        status: placedOrder.status === 'FILLED' ? 'FILLED' : 'ACCEPTED',
        brokerOrderId: placedOrder.brokerOrderId || placedOrder.id,
        result: placedOrder
      });
    }

    if (placedOrder.status === 'FILLED') {
      await completeExecutionIntent(idempotencyKey, placedOrder);
      return res.json({
        status: 'EXECUTED',
        broker,
        market: orderReq.market,
        order: placedOrder
      });
    }

    await markExecutionIntentInFlight(idempotencyKey, placedOrder);

    // Never infer FILLED from submission acknowledgement. The broker remains
    // authoritative and the background reconciler will transition ACCEPTED /
    // PARTIALLY_FILLED to a terminal broker-confirmed state.
    void reconcileExecutionIntent(idempotencyKey);

    return res.json({
      status: placedOrder.status === 'PARTIALLY_FILLED' ? 'PARTIALLY_FILLED' : 'ACCEPTED',
      broker,
      market: orderReq.market,
      order: placedOrder,
      executionState: 'IN_FLIGHT'
    });
  } catch (err: any) {
    const broker = (() => {
      try { return resolveMarketBroker(orderReq?.market); } catch { return 'FIVE_PAISA' as BrokerType; }
    })();
    const normalized = normalizeBrokerError(err, broker, env);
    res.status(400).json({ error: normalized.message, code: normalized.code });
  }
});

brokerRouter.post('/order/:id/cancel', async (req: Request, res: Response) => {
  try {
    const broker = req.body?.broker as BrokerType | undefined;
    if (!broker || !LIVE_BROKERS.includes(broker)) {
      return res.status(400).json({ error: 'Broker is required for cancel operation: FIVE_PAISA' });
    }
    const success = await brokerRegistry.getAdapter(broker, 'LIVE').cancelOrder(req.params.id);
    res.json({ success, broker });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokerRouter.post('/position/:id/close', async (req: Request, res: Response) => {
  try {
    const broker = req.body?.broker as BrokerType | undefined;
    if (!broker || !LIVE_BROKERS.includes(broker)) {
      return res.status(400).json({ error: 'Broker is required for close operation: FIVE_PAISA' });
    }
    const success = await brokerRegistry.getAdapter(broker, 'LIVE').closePosition(req.params.id, req.body?.quantity);
    res.json({ success, broker });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokerRouter.post('/kill-switch', async (req: Request, res: Response) => {
  const { action, reason } = req.body;
  if (action === 'HALT') {
    const result = await killSwitch.triggerEmergencyHalt(reason || 'Operator triggered Emergency Stop');
    return res.json({
      status: 'TRADING HALTED',
      isHalted: true,
      cancelledOrders: result.cancelledCount,
      requestedCancellations: result.requestedCount,
      unconfirmedOpenOrders: result.unconfirmedCount,
      brokerResults: result.brokerResults
    });
  }
  if (action === 'RESUME') {
    killSwitch.resumeTrading();
    return res.json({ status: 'TRADING ACTIVE', isHalted: false });
  }
  return res.status(400).json({ error: 'Action must be HALT or RESUME' });
});

brokerRouter.get('/controls', (_req: Request, res: Response) => {
  res.json({
    success: true,
    controls: autoExecutionEngine.getControls(),
    autoTrading: autoTradingService.getStatus()
  });
});

brokerRouter.post('/controls', (req: Request, res: Response) => {
  const updated = autoExecutionEngine.updateControls(req.body);
  res.json({ success: true, controls: updated });
});

brokerRouter.post('/reconciliation/snapshot', async (req: Request, res: Response) => {
  const broker = req.body?.broker as ('FIVE_PAISA') | undefined;
  const brokers: ('FIVE_PAISA')[] = broker ? [broker] : ['FIVE_PAISA'];
  if (brokers.some(b => !LIVE_BROKERS.includes(b))) {
    return res.status(400).json({ error: 'Allowed live brokers: FIVE_PAISA' });
  }
  try {
    const snapshots = await Promise.all(brokers.map(b => reconciliationService.captureBrokerSnapshot(b)));
    res.json({ success: true, snapshots });
  } catch (err: any) {
    res.status(502).json({ error: err.message, code: 'BROKER_RECONCILIATION_FAILED' });
  }
});

brokerRouter.get('/reconciliation/snapshots', async (req: Request, res: Response) => {
  const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 1), 500) : 50;
  try {
    res.json(await reconciliationService.loadBrokerSnapshots(limit));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokerRouter.get('/audit-logs', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  res.json(getAuditLogs(limit));
});

brokerRouter.post('/fivepaisa/totp-login', async (req: Request, res: Response) => {
  const { totp, pin } = req.body;
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (typeof adapter.loginWithTotp !== 'function') {
      return res.status(400).json({ error: 'Selected adapter does not support TOTP login.' });
    }
    await adapter.loginWithTotp(totp, pin);
    const account = await adapter.getAccount();
    res.json({ success: true, message: 'Successfully authenticated with 5paisa OpenAPI via TOTP.', account });
  } catch (err: any) {
    const isRateLimited = String(err?.message || '').includes('RATE_LIMITED');
    const rateLimitState = FivePaisaBrokerAdapter.getRateLimitState();
    const remainingSec = rateLimitState?.remainingSeconds || 60;
    res.status(isRateLimited ? 429 : 400).json({
      error: isRateLimited
        ? `5paisa authentication is temporarily rate-limited (HTTP 429). Please wait ${remainingSec} seconds before submitting a new TOTP code.`
        : (err.message || '5paisa TOTP authentication failed'),
      code: isRateLimited ? 'RATE_LIMITED' : 'AUTHENTICATION_FAILED',
      timestamp: Date.now(),
      retryAfterSeconds: remainingSec,
      provider: '5paisa',
      endpoint: '/VendorsAPI/Service1.svc/TOTPLogin'
    });
  }
});

brokerRouter.post('/fivepaisa/exchange-token', async (req: Request, res: Response) => {
  const { requestToken } = req.body;
  if (!requestToken) {
    return res.status(400).json({ error: 'Missing requestToken parameter.' });
  }
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (typeof adapter.exchangeRequestToken !== 'function') {
      return res.status(400).json({ error: 'Selected adapter does not support token exchange.' });
    }
    await adapter.exchangeRequestToken(requestToken);
    const account = await adapter.getAccount();
    res.json({ success: true, message: 'Successfully exchanged RequestToken for 5paisa AccessToken.', account });
  } catch (err: any) {
    res.status(400).json({ error: err.message || '5paisa token exchange failed' });
  }
});
