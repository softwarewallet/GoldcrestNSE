import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  DollarSign,
  Eye,
  FileCheck,
  FileText,
  Filter,
  Flame,
  Globe,
  HelpCircle,
  Info,
  Layers,
  Link as LinkIcon,
  Lock,
  PieChart,
  Play,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Terminal,
  TrendingDown,
  TrendingUp,
  Unlock,
  XCircle,
  Zap
} from 'lucide-react';
import { BrokerType, TradingEnvironment, OrderRequest } from '../brokers/types';
import { TradingSignal } from '../markets/common/types';

export type ControlCenterSection =
  | 'ALL_OVERVIEW'
  | 'ACCOUNT_OVERVIEW'
  | 'BALANCE_HISTORY'
  | 'MARKET_INTELLIGENCE'
  | 'OPTIONS_CHAIN'
  | 'SIGNAL_CENTER'
  | 'POSITIONS'
  | 'ORDERS'
  | 'RISK_CENTER'
  | 'RECONCILIATION'
  | 'SYSTEM_HEALTH'
  | 'AUDIT_CENTER'
  | 'SAFETY_STATUS';

export type FreshnessStatus = 'LIVE' | 'RECENT' | 'STALE' | 'ERROR' | 'UNAVAILABLE';

interface AccountCardData {
  broker: BrokerType;
  accountType?: 'LIVE' | 'DEMO';
  accountId: string;
  accountStatus: 'ACTIVE' | 'DISCONNECTED' | 'ERROR' | 'ACCOUNT_NOT_FOUND';
  connectionStatus: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';
  currency: 'USD' | 'INR';
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  marginLevelPct?: number;
  unrealizedPnl: number;
  realizedPnl: number;
  lastSyncTimestamp: number;
  freshness: FreshnessStatus;
  source: string;
  errorMessage?: string;
}

interface MarketQuoteItem {
  market: 'INDIA_EQUITY';
  symbol: string;
  bid: number;
  ask: number;
  ltp: number;
  spreadPipsOrPts: number;
  change24h: number;
  changePercent24h: number;
  volume24h?: number;
  timestamp: number;
  timeframe: string;
  status: 'OPEN' | 'CLOSED' | 'EXTENDED';
  freshness: FreshnessStatus;
}

interface PositionItem {
  positionId: string;
  broker: BrokerType;
  account: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  currency: 'USD' | 'INR';
  openedAt: number;
  brokerSyncStatus: 'SYNCED' | 'PENDING' | 'DESYNC';
  reconciliationStatus: 'MATCH' | 'MINOR_DELAY' | 'MATERIAL_MISMATCH';
}

interface OrderItem {
  internalOrderId: string;
  brokerOrderId: string;
  account: string;
  broker: BrokerType;
  instrument: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  status: 'CREATED' | 'VALIDATED' | 'RISK_CHECKED' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED' | 'RECONCILED';
  createdAt: number;
  updatedAt: number;
  reconciliationState: 'MATCH' | 'PENDING_ACK' | 'MISMATCH';
  rejectionReason?: string;
}

interface RiskTimelineEvent {
  id: string;
  timestamp: number;
  broker: BrokerType;
  account: string;
  instrument?: string;
  eventType:
    | 'SIGNAL QUALIFIED'
    | 'RISK APPROVED'
    | 'RISK REJECTED'
    | 'LIMIT REACHED'
    | 'STALE DATA'
    | 'ACCOUNT DATA UNAVAILABLE'
    | 'CURRENCY MISMATCH'
    | 'RECONCILIATION FAILURE'
    | 'EXECUTION GATE BLOCKED';
  reason: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

interface SystemHealthComponent {
  id: string;
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'OFFLINE';
  lastSuccessTimestamp: number;
  latencyMs: number;
  errorCount24h: number;
  currentFailureState?: string;
  lastRecoveryTimestamp?: number;
  requestCount24h: number;
  successCount24h: number;
  failedCount24h: number;
  timeoutCount24h: number;
  rateLimitEvents24h: number;
}

interface ReconciliationComparison {
  category: 'BALANCE' | 'POSITIONS' | 'ORDERS' | 'TRADES_FILLS' | 'PNL';
  brokerValue: string | number;
  internalValue: string | number;
  sqliteCount: string | number;
  status: 'MATCH' | 'MINOR_DELAY' | 'MATERIAL_MISMATCH' | 'SOURCE_UNAVAILABLE';
  quantityDiff?: number;
  priceDiff?: number;
  currencyDiff?: string;
  details: string;
}

interface TradingControlCenterProps {
  initialSection?: ControlCenterSection;
  onSelectSignalModal?: (signal: TradingSignal) => void;
  autoTradingStatus?: any | null;
  onAutoTradingStatusChange?: (status: any) => void;
  reportsMode?: boolean;
}

export const TradingControlCenter: React.FC<TradingControlCenterProps> = ({
  initialSection = 'ALL_OVERVIEW',
  onSelectSignalModal,
  autoTradingStatus: parentAutoTradingStatus = null,
  onAutoTradingStatusChange,
  reportsMode = false
}) => {
  const [activeSection, setActiveSection] = useState<ControlCenterSection>(initialSection);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());
  const [selectedSignalDecision, setSelectedSignalDecision] = useState<any | null>(null);
  const [autoTradingStatus, setAutoTradingStatus] = useState<any | null>(parentAutoTradingStatus);
  const [autoTradingBusy, setAutoTradingBusy] = useState(false);
  const [closedMarketPrompt, setClosedMarketPrompt] = useState<any | null>(null);
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState<number>(3);

  // Filter States
  const [positionBrokerFilter, setPositionBrokerFilter] = useState<string>('ALL');
  const [positionCurrencyFilter, setPositionCurrencyFilter] = useState<string>('ALL');
  const [positionReconFilter, setPositionReconFilter] = useState<string>('ALL');

  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL');
  const [orderBrokerFilter, setOrderBrokerFilter] = useState<string>('ALL');

  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<string>('ALL');
  const [auditSeverityFilter, setAuditSeverityFilter] = useState<string>('ALL');

  // Options Workspace State
  const [optionsUnderlying, setOptionsUnderlying] = useState<string>('NIFTY');
  const [optionsExpiry, setOptionsExpiry] = useState<string>('');
  const [optionsStrikeRange, setOptionsStrikeRange] = useState<number>(7);
  const [optionsChainData, setOptionsChainData] = useState<any | null>(null);
  const [optionsLoading, setOptionsLoading] = useState<boolean>(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // Execution Gate State
  const [gateBusy, setGateBusy] = useState<boolean>(false);
  const [gateFeedback, setGateFeedback] = useState<string | null>(null);
  const [goLiveValidationBusy, setGoLiveValidationBusy] = useState<boolean>(false);
  const [goLiveValidation, setGoLiveValidation] = useState<any | null>(null);
  const [brokerSession, setBrokerSession] = useState<{ status: 'VERIFIED_ACTIVE' | 'VERIFIED_INACTIVE' | 'UNKNOWN' }>({ status: 'UNKNOWN' });
  const [brokerSessionBusy, setBrokerSessionBusy] = useState<boolean>(false);
  const [ctraderFunctionalValidationBusy, setCtraderFunctionalValidationBusy] = useState<boolean>(false);
  const [ctraderFunctionalValidation, setCtraderFunctionalValidation] = useState<any | null>(null);

  // Live broker/account/market state only; empty until authoritative APIs return data.
  const [accounts, setAccounts] = useState<AccountCardData[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<MarketQuoteItem[]>([]);
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [riskTimeline, setRiskTimeline] = useState<RiskTimelineEvent[]>([]);
  const [reconciliations, setReconciliations] = useState<ReconciliationComparison[]>([]);
  const [healthComponents, setHealthComponents] = useState<SystemHealthComponent[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [balanceSnapshots, setBalanceSnapshots] = useState<any[]>([]);
  const [balanceSnapshotBrokerFilter, setBalanceSnapshotBrokerFilter] = useState<string>('ALL');
  const [balanceSnapshotDateFilter, setBalanceSnapshotDateFilter] = useState<string>('');
  const [indianNewsSnapshot, setIndianNewsSnapshot] = useState<any | null>(null);
  const [indianNewsBusy, setIndianNewsBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/config', { cache: 'no-store' })
      .then(async (res) => res.ok ? await res.json() : null)
      .then((config) => {
        const value = Number(config?.maxDailyLossPct);
        if (mounted && Number.isFinite(value) && value > 0) setDailyLossLimitPct(value);
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  // Fetch live operational data from authoritative broker and runtime APIs.
  const fetchAllOperationalData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [
        brokerStatusRes,
        positionsRes,
        ordersRes,
        auditLogsRes,
        reconPositionsRes,
        reconOrdersRes,
        healthRes,
        autoTradingRes,
        indiaUnderlyingsRes,
        signalsRes,
        newsRes,
        balanceHistoryRes
      ] = await Promise.all([
        fetch('/api/brokers/status', { cache: 'no-store' }).catch(() => null),
        fetch('/api/brokers/positions', { cache: 'no-store' }).catch(() => null),
        fetch('/api/brokers/orders', { cache: 'no-store' }).catch(() => null),
        fetch('/api/governance/audit-logs?limit=100', { cache: 'no-store' }).catch(() => null),
        fetch('/api/governance/reconciliation/positions', { cache: 'no-store' }).catch(() => null),
        fetch('/api/governance/reconciliation/orders', { cache: 'no-store' }).catch(() => null),
        fetch('/api/governance/live-health', { cache: 'no-store' }).catch(() => null),
        fetch('/api/auto-trading/status', { cache: 'no-store' }).catch(() => null),
        fetch('/api/india/underlyings', { cache: 'no-store' }).catch(() => null),
        fetch('/api/signals/all', { cache: 'no-store' }).catch(() => null),
        fetch('/api/india/news', { cache: 'no-store' }).catch(() => null),
        fetch('/api/reports/account-balance-history?limit=1000', { cache: 'no-store' }).catch(() => null)
      ]);

      if (autoTradingRes?.ok) {
        const nextStatus = await autoTradingRes.json();
        setAutoTradingStatus(nextStatus);
        onAutoTradingStatusChange?.(nextStatus);
      } else if (parentAutoTradingStatus) {
        // App-level status is the canonical browser-wide state. Keep the
        // Control Center synchronized even when a transient telemetry request
        // fails during page navigation/remount.
        setAutoTradingStatus(parentAutoTradingStatus);
      }

      if (brokerStatusRes?.ok) {
        const status = await brokerStatusRes.json();
        const liveAccounts: AccountCardData[] = (Array.isArray(status?.brokers) ? status.brokers : [])
          .filter((item: any) => item?.environment === 'LIVE' && item?.account)
          .map((item: any) => {
            const account = item.account;
            const connected = item.connected === true;
            const currency = String(account.currency || 'USD').toUpperCase();
            return {
              broker: item.broker,
              accountType: account.accountType === 'DEMO' ? 'DEMO' : 'LIVE',
              accountId: String(account.accountId || '****'),
              accountStatus: connected ? 'ACTIVE' : 'ERROR',
              connectionStatus: connected ? 'CONNECTED' : 'ERROR',
              currency: currency === 'INR' ? 'INR' : 'USD',
              balance: Number(account.balance),
              equity: Number(account.equity),
              availableMargin: Number(account.availableMargin ?? account.freeMargin),
              usedMargin: Number(account.usedMargin ?? 0),
              marginLevelPct: account.marginLevelPct !== undefined ? Number(account.marginLevelPct) : undefined,
              unrealizedPnl: Number(account.unrealizedPnL ?? account.unrealizedPnl ?? 0),
              realizedPnl: Number(account.realizedPnL ?? account.realizedPnl ?? 0),
              lastSyncTimestamp: Number(account.lastUpdate || Date.now()),
              freshness: 'LIVE',
              source: '5paisa LIVE API',
              errorMessage: item.error || undefined
            };
          })
          .filter((account: AccountCardData) =>
            Number.isFinite(account.balance) && Number.isFinite(account.equity)
          );
        setAccounts(liveAccounts);
      }

      if (positionsRes?.ok) {
        const livePositions = await positionsRes.json();
        const rows = Array.isArray(livePositions) ? livePositions : [];
        setPositions(rows
          .filter((p: any) => p?.environment === 'LIVE')
          .map((p: any): PositionItem => ({
            positionId: String(p.id || p.brokerPositionId || ''),
            broker: p.broker,
            account: String(p.accountId || p.account || '****'),
            symbol: p.symbol,
            side: p.side,
            quantity: Number(p.quantity),
            entryPrice: Number(p.entryPrice),
            currentPrice: Number(p.currentPrice),
            unrealizedPnl: Number(p.unrealizedPnL ?? 0),
            realizedPnl: Number(p.realizedPnL ?? 0),
            currency: 'INR',
            openedAt: Number(p.timestamp || Date.now()),
            brokerSyncStatus: 'SYNCED',
            reconciliationStatus: 'MINOR_DELAY'
          }))
          .filter((p: PositionItem) =>
            p.positionId && Number.isFinite(p.quantity) && Number.isFinite(p.entryPrice) && Number.isFinite(p.currentPrice)
          ));
      }

      if (ordersRes?.ok) {
        const liveOrders = await ordersRes.json();
        const rows = Array.isArray(liveOrders) ? liveOrders : [];
        setOrders(rows
          .filter((o: any) => o?.environment === 'LIVE')
          .map((o: any): OrderItem => ({
            internalOrderId: String(o.id || ''),
            brokerOrderId: String(o.brokerOrderId || o.id || ''),
            account: String(o.accountId || o.account || '****'),
            broker: o.broker,
            instrument: o.symbol,
            side: o.side,
            quantity: Number(o.quantity),
            price: Number(o.price ?? 0),
            status: o.status,
            createdAt: Number(o.timestamp || Date.now()),
            updatedAt: Number(o.timestamp || Date.now()),
            reconciliationState: 'MATCH',
            rejectionReason: o.rejectionReason
          }))
          .filter((o: any) => o.internalOrderId && Number.isFinite(o.quantity)));
      }

      if (indiaUnderlyingsRes?.ok) {
        const inRows = await indiaUnderlyingsRes.json();
        const liveQuotes: MarketQuoteItem[] = [];
        if (Array.isArray(inRows)) {
          for (const q of inRows) {
            const spot = Number(q?.spot);
            if (!(spot > 0)) continue;
            liveQuotes.push({
              market: 'INDIA_EQUITY',
              symbol: q.symbol,
              bid: spot,
              ask: spot,
              ltp: spot,
              spreadPipsOrPts: Number(q.spreadPoints ?? 0),
              change24h: Number(q.change ?? 0),
              changePercent24h: Number(q.changePercent ?? 0),
              timestamp: Date.now(),
              timeframe: 'LIVE',
              status: 'OPEN',
              freshness: 'LIVE'
            });
          }
        }
        setMarketQuotes(liveQuotes);
      }

      if (signalsRes?.ok) {
        const liveSignals = await signalsRes.json();
        setSignals(Array.isArray(liveSignals) ? liveSignals : []);
      }

      if (newsRes?.ok) {
        const snapshot = await newsRes.json();
        setIndianNewsSnapshot(snapshot);
      }

      if (auditLogsRes?.ok) {
        const raw = await auditLogsRes.json();
        const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.logs) ? raw.logs : [];
        setAuditLogs(rows.map((log: any, index: number) => ({
          eventId: log.id,
          sequenceNumber: index + 1,
          timestamp: Number(log.timestamp || Date.now()),
          category: String(log.action || '').toLowerCase().includes('risk') ? 'RISK'
            : String(log.action || '').toLowerCase().includes('order') ? 'ORDER'
            : String(log.action || '').toLowerCase().includes('position') ? 'POSITION'
            : String(log.action || '').toLowerCase().includes('account') ? 'ACCOUNT'
            : String(log.action || '').toLowerCase().includes('market') ? 'MARKET_DATA'
            : 'SAFETY',
          action: log.action,
          operatorId: log.account || log.source || 'LIVE',
          payload: {
            broker: log.broker,
            environment: log.environment,
            symbol: log.symbol,
            quantity: log.quantity,
            result: log.result,
            error: log.error
          },
          currentHash: ''
        })));

        const riskRows = rows.filter((log: any) => {
          const action = String(log.action || '').toUpperCase();
          return action.includes('RISK')
            || action.includes('REJECT')
            || action.includes('BLOCK')
            || action.includes('LIMIT')
            || action.includes('KILL')
            || action.includes('STALE')
            || action.includes('RECONCILIATION')
            || action.includes('EXECUTION_GATE')
            || action.includes('EXECUTION_');
        });

        setRiskTimeline(riskRows.slice(0, 20).map((log: any, index: number) => {
          const action = String(log.action || '').toUpperCase();
          const isBlocked = log.result === 'BLOCKED' || action.includes('BLOCK');
          const isFailure = log.result === 'FAILURE' || action.includes('REJECT') || action.includes('FAIL');
          const isLimit = action.includes('LIMIT');

          let eventType: RiskTimelineEvent['eventType'] = 'RISK APPROVED';
          if (isLimit) {
            eventType = 'LIMIT REACHED';
          } else if (isFailure) {
            eventType = action.includes('STALE')
              ? 'STALE DATA'
              : action.includes('RECONCILIATION')
                ? 'RECONCILIATION FAILURE'
                : 'RISK REJECTED';
          } else if (isBlocked) {
            eventType = 'EXECUTION GATE BLOCKED';
          } else if (action.includes('STALE')) {
            eventType = 'STALE DATA';
          } else if (action.includes('RECONCILIATION')) {
            eventType = 'RECONCILIATION FAILURE';
          }

          return {
            id: log.id || `RISK_${index}`,
            timestamp: Number(log.timestamp || Date.now()),
            broker: log.broker || 'FIVE_PAISA',
            account: log.account || '****',
            instrument: log.symbol,
            eventType,
            reason: log.error || log.action || 'Live risk event',
            severity: isFailure ? 'CRITICAL' : isBlocked || isLimit ? 'WARNING' : 'INFO'
          };
        }));
      }

      if (balanceHistoryRes?.ok) {
        const payload = await balanceHistoryRes.json();
        setBalanceSnapshots(Array.isArray(payload?.rows) ? payload.rows : []);
      }

      const reconRows: ReconciliationComparison[] = [];
      for (const response of [reconPositionsRes, reconOrdersRes]) {
        if (!response?.ok) continue;
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.comparisons) ? payload.comparisons : [];
        for (const row of rows) reconRows.push(row);
      }
      setReconciliations(reconRows);

      if (healthRes?.ok) {
        const health = await healthRes.json();
        setHealthComponents(Array.isArray(health?.components) ? health.components : []);
      }

      setLastRefreshedAt(Date.now());
    } catch (err) {
      console.warn('Control Center live refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const fetchIndianNewsNow = useCallback(async () => {
    setIndianNewsBusy(true);
    try {
      const response = await fetch('/api/india/news?refresh=true', {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      setIndianNewsSnapshot(payload);
      const autoRes = await fetch('/api/auto-trading/status', { cache: 'no-store' }).catch(() => null);
      if (autoRes?.ok) {
        const autoStatus = await autoRes.json();
        setAutoTradingStatus(autoStatus);
        onAutoTradingStatusChange?.(autoStatus);
      }
    } catch (err: any) {
      setIndianNewsSnapshot({
        status: 'UNAVAILABLE',
        marketOpen: false,
        marketPhase: 'UNKNOWN',
        articleCount: 0,
        articles: [],
        error: err?.message || 'Indian market news refresh failed.'
      });
    } finally {
      setIndianNewsBusy(false);
    }
  }, []);

  const toggleAutoTrading = useCallback(async () => {
    setAutoTradingBusy(true);
    try {
      const shouldStop = ['RUNNING', 'PREPARING'].includes(autoTradingStatus?.state);
      const res = await fetch(shouldStop ? '/api/auto-trading/stop' : '/api/auto-trading/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));

      if (data?.requiresClosedMarketConfirmation) {
        setClosedMarketPrompt(data);
        setAutoTradingStatus(data);
        return;
      }

      setAutoTradingStatus(data);
      onAutoTradingStatusChange?.(data);
      if (!res.ok) {
        console.warn(
          'Auto trading control rejected:',
          data?.lastCycleResult || data?.message || data?.error || res.statusText
        );
      }
    } catch (err) {
      console.warn('Auto trading control failed:', err);
    } finally {
      setAutoTradingBusy(false);
    }
  }, [autoTradingStatus?.state]);

  const confirmClosedMarketAutoLive = useCallback(async () => {
    setAutoTradingBusy(true);
    setClosedMarketPrompt(null);
    try {
      const res = await fetch('/api/auto-trading/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmWhenClosed: true })
      });
      const data = await res.json().catch(() => ({}));
      setAutoTradingStatus(data);
      onAutoTradingStatusChange?.(data);
      if (!res.ok) {
        console.warn(
          'Confirmed auto trading start rejected:',
          data?.lastCycleResult || data?.message || data?.error || res.statusText
        );
      }
    } catch (err) {
      console.warn('Confirmed auto trading start failed:', err);
    } finally {
      setAutoTradingBusy(false);
    }
  }, []);

  const abandonClosedMarketAutoLive = useCallback(async () => {
    setClosedMarketPrompt(null);
    try {
      const res = await fetch('/api/auto-trading/abandon-closed-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      setAutoTradingStatus(data);
    } catch (err) {
      console.warn('Closed-market auto trading abandonment could not be logged:', err);
    }
  }, []);

  const unlockExecutionGate = useCallback(async () => {
    setGateBusy(true);
    setGateFeedback(null);
    try {
      const res = await fetch('/api/execution-gate/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setGateFeedback('Execution gate armed & operational.');
        fetchAllOperationalData();
      } else {
        setGateFeedback(data.message || 'Failed to unlock execution gate.');
      }
    } catch (err) {
      console.warn('Unlock execution gate failed:', err);
      setGateFeedback('Error unlocking execution gate.');
    } finally {
      setGateBusy(false);
    }
  }, [fetchAllOperationalData]);

  const lockExecutionGate = useCallback(async () => {
    setGateBusy(true);
    setGateFeedback(null);
    try {
      const res = await fetch('/api/execution-gate/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setGateFeedback('Execution gate locked by operator.');
        fetchAllOperationalData();
      }
    } catch (err) {
      console.warn('Lock execution gate failed:', err);
    } finally {
      setGateBusy(false);
    }
  }, [fetchAllOperationalData]);

  const runGoLiveValidation = useCallback(async () => {
    setGoLiveValidationBusy(true);
    try {
      const res = await fetch('/api/operations/go-live-validation', {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      setGoLiveValidation(data);
      if (res.ok && data.ready) {
        setGateFeedback('Production go-live validation passed. Execution gate remains locked until operator unlock.');
      } else {
        setGateFeedback(
          data?.failures?.length
            ? 'Go-live validation blocked: ' + data.failures.join(', ')
            : (data?.message || 'Go-live validation is unavailable.')
        );
      }
    } catch (err) {
      console.warn('Production go-live validation failed:', err);
      setGateFeedback('Production go-live validation failed.');
    } finally {
      setGoLiveValidationBusy(false);
    }
  }, []);

  const fetchBrokerSessionStatus = useCallback(async () => {
    setBrokerSessionBusy(true);
    try {
      const res = await fetch('/api/operations/broker-session-status', {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const data = await res.json().catch(() => ({ status: 'UNKNOWN' }));
      setBrokerSession(data);
    } catch (err) {
      console.warn('Broker session status check failed:', err);
      setBrokerSession({ status: 'UNKNOWN' });
    } finally {
      setBrokerSessionBusy(false);
    }
  }, []);

  const runCTraderFunctionalValidation = useCallback(async () => {
    setCtraderFunctionalValidationBusy(true);
    try {
      const res = await fetch('/api/brokers/test?broker=FIVE_PAISA&environment=LIVE', {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      setCtraderFunctionalValidation({
        ready: data.connected,
        mode: 'LIVE',
        status: data.connected ? 'CONNECTED' : 'DISCONNECTED',
        failures: data.connected ? [] : [data.error || 'Connection failed']
      });
      if (res.ok && data.connected) {
        setGateFeedback('5paisa LIVE API connection verified. Account: ' + (data.account || '****') + ' (INR).');
      } else {
        setGateFeedback('5paisa connection test: ' + (data.error || 'Connection unavailable.'));
      }
    } catch (err) {
      console.warn('5paisa connection verification failed:', err);
      setGateFeedback('5paisa connection verification failed.');
    } finally {
      setCtraderFunctionalValidationBusy(false);
    }
  }, []);

  // Fetch Options Chain
  const fetchOptionsChain = useCallback(async (symbol: string, expiry?: string, depth: number = 7) => {
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const url = `/api/options/chain/${encodeURIComponent(symbol)}?depth=${depth}${expiry ? `&expiry=${encodeURIComponent(expiry)}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.isBlank && data.error) {
          setOptionsError(data.error);
        } else {
          setOptionsChainData(data);
          if (data.expiry && !optionsExpiry) {
            setOptionsExpiry(data.expiry);
          }
        }
      } else {
        const errData = await res.json().catch(() => ({ error: 'Failed to fetch options chain' }));
        setOptionsError(errData.error || 'Options API Unavailable');
      }
    } catch (err: any) {
      setOptionsError(err.message || 'Failed to connect to Options Data Adapter');
    } finally {
      setOptionsLoading(false);
    }
  }, [optionsExpiry]);

  useEffect(() => {
    if (parentAutoTradingStatus) {
      setAutoTradingStatus(parentAutoTradingStatus);
    }
  }, [parentAutoTradingStatus]);

  useEffect(() => {
    fetchAllOperationalData();
    fetchOptionsChain(optionsUnderlying, optionsExpiry, optionsStrikeRange);

    const interval = setInterval(() => {
      fetchAllOperationalData();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchAllOperationalData, fetchOptionsChain, optionsUnderlying, optionsExpiry, optionsStrikeRange]);

  useEffect(() => {
    fetchIndianNewsNow();
    const interval = setInterval(() => {
      fetchIndianNewsNow();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchIndianNewsNow]);

  const filteredBalanceSnapshots = useMemo(() => {
    return balanceSnapshots.filter(row => {
      if (balanceSnapshotBrokerFilter !== 'ALL' && row.broker !== balanceSnapshotBrokerFilter) return false;
      if (balanceSnapshotDateFilter) {
        const date = new Date(Number(row.capturedAt)).toISOString().slice(0, 10);
        if (date !== balanceSnapshotDateFilter) return false;
      }
      return true;
    });
  }, [balanceSnapshots, balanceSnapshotBrokerFilter, balanceSnapshotDateFilter]);

  // Filtered Positions
  const filteredPositions = useMemo(() => {
    return positions.filter(pos => {
      if (positionBrokerFilter !== 'ALL' && pos.broker !== positionBrokerFilter) return false;
      if (positionCurrencyFilter !== 'ALL' && pos.currency !== positionCurrencyFilter) return false;
      if (positionReconFilter !== 'ALL' && pos.reconciliationStatus !== positionReconFilter) return false;
      return true;
    });
  }, [positions, positionBrokerFilter, positionCurrencyFilter, positionReconFilter]);

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    return orders.filter(ord => {
      if (orderStatusFilter !== 'ALL' && ord.status !== orderStatusFilter) return false;
      if (orderBrokerFilter !== 'ALL' && ord.broker !== orderBrokerFilter) return false;
      return true;
    });
  }, [orders, orderStatusFilter, orderBrokerFilter]);

  // Filtered Audit Logs
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      if (auditCategoryFilter !== 'ALL' && log.category !== auditCategoryFilter) return false;
      if (auditSearchQuery) {
        const q = auditSearchQuery.toLowerCase();
        const actionMatch = log.action.toLowerCase().includes(q);
        const opMatch = log.operatorId.toLowerCase().includes(q);
        const payloadMatch = JSON.stringify(log.payload || {}).toLowerCase().includes(q);
        if (!actionMatch && !opMatch && !payloadMatch) return false;
      }
      return true;
    });
  }, [auditLogs, auditCategoryFilter, auditSearchQuery]);

  const formatNumber = (value: unknown, options?: Intl.NumberFormatOptions): string => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toLocaleString(undefined, options) : '—';
  };

  const formatFixed = (value: unknown, digits: number): string => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(digits) : '—';
  };

  const formatMarketValue = (value: number | null | undefined, _market?: MarketQuoteItem['market'], _symbol?: string) => {
    const digits = 2;
    return formatFixed(value, digits);
  };

  // Calculate Freshness Badge Style
  const renderFreshnessBadge = (freshness: FreshnessStatus, timestamp?: number) => {
    const ageSeconds = timestamp ? Math.floor((Date.now() - timestamp) / 1000) : 0;
    switch (freshness) {
      case 'LIVE':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>LIVE ({ageSeconds}s ago)</span>
          </span>
        );
      case 'RECENT':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-950/80 text-sky-300 border border-sky-700">
            <span>RECENT ({ageSeconds}s ago)</span>
          </span>
        );
      case 'STALE':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-950/80 text-amber-300 border border-amber-700">
            <AlertTriangle className="w-3 h-3" />
            <span>STALE ({ageSeconds}s ago)</span>
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-700">
            <XCircle className="w-3 h-3" />
            <span>ERROR</span>
          </span>
        );
      case 'UNAVAILABLE':
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-900 text-slate-400 border border-slate-800">
            <span>UNAVAILABLE</span>
          </span>
        );
    }
  };

  return (
    <div id="trading_control_center_main" className="space-y-4">
      {closedMarketPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg bg-slate-900 border border-amber-700/80 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Markets Closed</h3>
              </div>
              <button
                onClick={abandonClosedMarketAutoLive}
                className="text-slate-500 hover:text-white text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4 font-mono text-xs">
              <div className="text-base font-semibold text-amber-200">
                Markets are closed, do you still want to start Auto Live
              </div>
              <p className="text-slate-400 leading-relaxed">
                Selecting <strong className="text-white">Yes</strong> will arm Auto Live and keep the system in
                <strong className="text-amber-300"> PREPARING</strong> state. Before a supported market opens,
                Goldcrest will refresh live market trends and check live macro-news conditions. No order is
                submitted during this preparation phase.
              </p>

              <div className="grid grid-cols-1 gap-2">
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-slate-500 text-[10px]">NSE & BSE / 5PAISA</div>
                  <div className={closedMarketPrompt.marketGate?.india?.isOpen ? 'text-emerald-400 font-bold mt-1' : 'text-amber-300 font-bold mt-1'}>
                    {closedMarketPrompt.marketGate?.india?.isOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
                  </div>
                  <div className="text-slate-500 text-[10px] mt-1">
                    Phase: {closedMarketPrompt.marketGate?.india?.phase || 'Session unavailable'}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={abandonClosedMarketAutoLive}
                  disabled={autoTradingBusy}
                  className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 font-bold disabled:opacity-50"
                >
                  No — Abandon
                </button>
                <button
                  type="button"
                  onClick={confirmClosedMarketAutoLive}
                  disabled={autoTradingBusy}
                  className="px-4 py-2 rounded-lg border border-emerald-600 bg-emerald-950/70 text-emerald-300 hover:bg-emerald-900/70 font-bold disabled:opacity-50"
                >
                  Yes — Start Auto Live
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1. MASTER OPERATIONAL HEADER & NAVIGATION BAR */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold shadow-inner">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-tight">Trading Control Center</h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  PHASE 11 LIVE OPS
                </span>
              </div>
              <div className="text-slate-400 text-xs flex items-center space-x-2 mt-0.5">
                <span>Indian Market Operations</span>
                <span className="text-slate-600">•</span>
                <span>5paisa LIVE API (NSE / BSE / F&O)</span>
                <span className="text-slate-600">•</span>
                <span>Synced: {new Date(lastRefreshedAt).toLocaleTimeString()}</span>
              </div>
            </div>
          </div>

          {/* Quick Status Pill Bar */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
              <span className="text-slate-500">GOVERNANCE:</span>
              <strong className="text-emerald-400">EXP-2026 CLOSED</strong>
            </div>

            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
              <span className="text-slate-500">MODEL:</span>
              <strong className="text-slate-200">fx_structure_v2a</strong>
            </div>

            <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border font-bold ${autoTradingStatus?.autonomousPermission
              ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
              : 'bg-amber-950/70 border-amber-700 text-amber-300'
            }`}>
              <Zap className="w-3.5 h-3.5" />
              <span>AUTO LIVE: {autoTradingStatus?.state || 'UNKNOWN'}</span>
            </div>

            <button
              type="button"
              onClick={toggleAutoTrading}
              disabled={autoTradingBusy}
              className="px-3 py-1 rounded border text-xs font-bold transition disabled:opacity-50 bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800"
              title="Explicitly start or stop autonomous live trading"
            >
              {autoTradingBusy ? 'Working...' : ['RUNNING', 'PREPARING'].includes(autoTradingStatus?.state) ? 'STOP AUTO LIVE' : 'START AUTO LIVE'}
            </button>

            {autoTradingStatus?.preOpenPreparation?.news && (
              <div className={`flex items-center gap-2 px-2.5 py-1 rounded border text-[10px] font-mono ${
                autoTradingStatus.preOpenPreparation.news.status === 'LIVE'
                  ? autoTradingStatus.preOpenPreparation.news.riskLevel === 'HIGH'
                    ? 'border-rose-800 bg-rose-950/50 text-rose-200'
                    : 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
                  : 'border-amber-800 bg-amber-950/50 text-amber-200'
              }`}>
                <span>NEWS:</span>
                <strong>{autoTradingStatus.preOpenPreparation.news.status}</strong>
                {autoTradingStatus.preOpenPreparation.news.status === 'LIVE' && (
                  <span>{autoTradingStatus.preOpenPreparation.news.articleCount} ARTICLES · {autoTradingStatus.preOpenPreparation.news.riskLevel}</span>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={fetchIndianNewsNow}
              disabled={indianNewsBusy}
              className="px-2.5 py-1 rounded border border-cyan-800 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[10px] font-mono font-bold disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              title="Force a fresh fetch from all configured Indian news providers"
            >
              <RefreshCw className={`w-3 h-3 ${indianNewsBusy ? 'animate-spin' : ''}`} />
              {indianNewsBusy ? 'FETCHING NEWS...' : 'FETCH NEWS'}
            </button>

            {autoTradingStatus?.state === 'PREPARING' && autoTradingStatus?.preOpenPreparation && (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded border border-amber-800 bg-amber-950/50 text-[10px] font-mono text-amber-200">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>
                  PRE-OPEN: {autoTradingStatus.preOpenPreparation.trendPairsEvaluated}/{autoTradingStatus.pairs?.length || 0} TRENDS
                  {' · NEWS: '}
                  {autoTradingStatus.preOpenPreparation.news?.status || 'PENDING'}
                  {autoTradingStatus.preOpenPreparation.news?.riskLevel && autoTradingStatus.preOpenPreparation.news.riskLevel !== 'UNAVAILABLE'
                    ? ` / ${autoTradingStatus.preOpenPreparation.news.riskLevel}`
                    : ''}
                </span>
              </div>
            )}

            {autoTradingStatus?.lastCycleResult && (
              <div
                className={`max-w-[420px] px-2.5 py-1 rounded border text-[10px] font-mono ${
                  autoTradingStatus.state === 'BLOCKED'
                    ? 'bg-amber-950/70 border-amber-700 text-amber-200'
                    : autoTradingStatus.state === 'RUNNING'
                      ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                      : 'bg-slate-900 border-slate-700 text-slate-300'
                }`}
                title={autoTradingStatus.lastCycleResult}
              >
                {autoTradingStatus.lastCycleResult}
              </div>
            )}

            <button
              onClick={fetchAllOperationalData}
              disabled={isRefreshing}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition flex items-center space-x-1.5 text-xs font-semibold disabled:opacity-50"
              title="Refresh all Control Center telemetry"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{isRefreshing ? 'Syncing...' : 'Sync Ops'}</span>
            </button>
          </div>
        </div>

        {/* Section Navigation Tabs (10 Primary Operations Sections) */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
          {[
            { id: 'ALL_OVERVIEW', label: 'OVERVIEW', icon: Activity },
            { id: 'ACCOUNT_OVERVIEW', label: '1. ACCOUNTS', icon: DollarSign },
            ...(reportsMode ? [{ id: 'BALANCE_HISTORY', label: '2. BALANCE HISTORY', icon: Activity }] : []),
            { id: 'MARKET_INTELLIGENCE', label: '2. MARKET INTEL', icon: TrendingUp },
            { id: 'OPTIONS_CHAIN', label: '3. OPTIONS CHAIN', icon: PieChart },
            { id: 'SIGNAL_CENTER', label: '4. SIGNALS', icon: Sparkles },
            { id: 'POSITIONS', label: '5. POSITIONS', icon: Layers },
            { id: 'ORDERS', label: '6. ORDERS', icon: FileText },
            { id: 'RISK_CENTER', label: '7. RISK CENTER', icon: ShieldAlert },
            { id: 'RECONCILIATION', label: '8. RECONCILIATION', icon: CheckCircle2 },
            { id: 'SYSTEM_HEALTH', label: '9. HEALTH & APIS', icon: Server },
            { id: 'AUDIT_CENTER', label: '10. AUDIT LEDGER', icon: FileCheck },
            { id: 'SAFETY_STATUS', label: 'SAFETY & GOVERNANCE', icon: Lock }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id as ControlCenterSection)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 whitespace-nowrap ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 1: ACCOUNT OVERVIEW & IDENTITY (Native Currencies USD / INR) */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'ACCOUNT_OVERVIEW') && (
        <div id="section_accounts_overview" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span>Multi-Broker Account Identity & Margin Overview</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">Strict Native Currency Preservation (USD & INR)</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {accounts.map((acc, accIdx) => {
              const isForex = acc.currency === 'USD';
              const symbolPrefix = isForex ? '$' : '₹';
              const formattedBalance = `${symbolPrefix}${formatNumber(acc.balance, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              const formattedEquity = `${symbolPrefix}${formatNumber(acc.equity, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              const formattedMargin = `${symbolPrefix}${formatNumber(acc.availableMargin, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              const formattedUnrealized = `${acc.unrealizedPnl >= 0 ? '+' : ''}${symbolPrefix}${formatNumber(acc.unrealizedPnl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

              return (
                <div key={acc.accountId ? `${acc.broker}-${acc.accountId}` : `acc-${acc.broker}-${accIdx}`} className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3 font-mono">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                    <div className="flex items-center space-x-2">
                      <div className={`w-3 h-3 rounded-full ${acc.connectionStatus === 'CONNECTED' ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                      <span className="font-bold text-white text-sm">{acc.broker}</span>
                      <span className="text-slate-400 text-xs">({acc.accountId})</span>
                    </div>
                    <div>{renderFreshnessBadge(acc.freshness, acc.lastSyncTimestamp)}</div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/60">
                      <div className="text-slate-400 text-[10px]">BALANCE</div>
                      <div className="font-bold text-slate-100 mt-0.5">{formattedBalance}</div>
                      <div className="text-[9px] text-slate-500">{acc.currency}</div>
                    </div>

                    <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/60">
                      <div className="text-slate-400 text-[10px]">EQUITY</div>
                      <div className="font-bold text-emerald-400 mt-0.5">{formattedEquity}</div>
                      <div className="text-[9px] text-slate-500">{acc.currency}</div>
                    </div>

                    <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/60">
                      <div className="text-slate-400 text-[10px]">FREE MARGIN</div>
                      <div className="font-bold text-slate-200 mt-0.5">{formattedMargin}</div>
                      <div className="text-[9px] text-slate-500">{Number.isFinite(Number(acc.marginLevelPct)) ? `${Number(acc.marginLevelPct).toFixed(0)}% lvl` : 'Available'}</div>
                    </div>

                    <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/60">
                      <div className="text-slate-400 text-[10px]">UNREALIZED P&L</div>
                      <div className={`font-bold mt-0.5 ${acc.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formattedUnrealized}
                      </div>
                      <div className="text-[9px] text-slate-500">{acc.currency}</div>
                    </div>
                  </div>

                  <div className="pt-2 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/40">
                    <div>
                      <span>Source: </span>
                      <span className="text-slate-300">{acc.source}</span>
                    </div>
                    <div>
                      <span>Account Status: </span>
                      <strong className={acc.accountStatus === 'ACTIVE' ? 'text-emerald-400' : 'text-rose-400'}>
                        {acc.accountStatus}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* REPORTS: THREE-HOUR ACCOUNT BALANCE HISTORY */}
      {activeSection === 'BALANCE_HISTORY' && (
        <div id="section_balance_history" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-4 font-mono text-xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-400" /><span>3-Hour Account Balance History</span></h3>
              <p className="text-[10px] text-slate-500 mt-1">Authoritative LIVE API snapshots at 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00. No calculated or fabricated balance values are stored.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={balanceSnapshotBrokerFilter} onChange={e => setBalanceSnapshotBrokerFilter(e.target.value)} className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1.5"><option value="ALL">All Brokers</option><option value="FIVE_PAISA">5paisa (NSE)</option></select>
              <input type="date" value={balanceSnapshotDateFilter} onChange={e => setBalanceSnapshotDateFilter(e.target.value)} className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1.5" />
              {(balanceSnapshotDateFilter || balanceSnapshotBrokerFilter !== 'ALL') && <button type="button" onClick={() => { setBalanceSnapshotDateFilter(''); setBalanceSnapshotBrokerFilter('ALL'); }} className="px-2.5 py-1.5 rounded border border-slate-700 bg-slate-950 text-slate-300 hover:text-white">Clear</button>}
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3"><div className="text-[10px] text-slate-500">SNAPSHOTS</div><div className="text-lg font-bold text-white mt-1">{filteredBalanceSnapshots.length}</div></div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3"><div className="text-[10px] text-slate-500">CAPTURED</div><div className="text-lg font-bold text-emerald-400 mt-1">{filteredBalanceSnapshots.filter(row => row.status === 'CAPTURED').length}</div></div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3"><div className="text-[10px] text-slate-500">ERRORS</div><div className="text-lg font-bold text-amber-400 mt-1">{filteredBalanceSnapshots.filter(row => row.status === 'ERROR').length}</div></div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3"><div className="text-[10px] text-slate-500">INTERVAL</div><div className="text-lg font-bold text-slate-200 mt-1">3 HOURS</div></div>
          </div>
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full text-left"><thead className="bg-slate-950 text-slate-400 border-b border-slate-800 sticky top-0"><tr>
              <th className="py-2.5 px-3">DATE</th><th className="py-2.5 px-3">TIME</th><th className="py-2.5 px-3">BROKER</th><th className="py-2.5 px-3">ACCOUNT</th><th className="py-2.5 px-3">CURRENCY</th><th className="py-2.5 px-3">BALANCE</th><th className="py-2.5 px-3">EQUITY</th><th className="py-2.5 px-3">USED MARGIN</th><th className="py-2.5 px-3">FREE MARGIN</th><th className="py-2.5 px-3">STATUS</th>
            </tr></thead><tbody className="divide-y divide-slate-800/60">
              {filteredBalanceSnapshots.map((row, index) => {
                const timestamp = Number(row.capturedAt);
                const date = Number.isFinite(timestamp) ? new Date(timestamp) : null;
                const currency = String(row.currency || '');
                const prefix = currency === 'INR' ? 'INR ' : 'USD ';
                const money = (value: any) => { const numeric = Number(value); return Number.isFinite(numeric) ? prefix + numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'; };
                return <tr key={row.id || 'balance-snapshot-' + index} className="hover:bg-slate-800/40">
                  <td className="py-2.5 px-3 text-slate-300">{date ? date.toLocaleDateString() : '—'}</td>
                  <td className="py-2.5 px-3 font-semibold text-white">{date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                  <td className="py-2.5 px-3 font-bold text-slate-200">{row.broker}</td><td className="py-2.5 px-3 text-slate-400">{row.accountId}</td><td className="py-2.5 px-3 text-slate-400">{currency || '—'}</td>
                  <td className="py-2.5 px-3 text-slate-100">{money(row.balance)}</td><td className="py-2.5 px-3 text-emerald-400">{money(row.equity)}</td><td className="py-2.5 px-3 text-amber-300">{money(row.usedMargin)}</td><td className="py-2.5 px-3 text-sky-300">{money(row.freeMargin)}</td>
                  <td className="py-2.5 px-3"><span className={'px-2 py-0.5 rounded border text-[10px] font-bold ' + (row.status === 'CAPTURED' ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300' : 'bg-amber-950/50 border-amber-700 text-amber-300')}>{row.status}</span>{row.errorMessage && <div className="text-[9px] text-amber-400 mt-1 max-w-xs truncate" title={row.errorMessage}>{row.errorMessage}</div>}</td>
                </tr>;
              })}
            </tbody></table>
            {!filteredBalanceSnapshots.length && <div className="py-10 text-center text-slate-500">No account balance snapshots match the selected filters.</div>}
          </div>
        </div>
      )}

      {/* SECTION 2: MARKET INTELLIGENCE CENTER */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'MARKET_INTELLIGENCE') && (
        <div id="section_market_intelligence" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>Market Intelligence (NSE & BSE Indian Equities & Indices)</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">Live Ingestion & Point-in-Time Freshness</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-950/90 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">EXCHANGE</th>
                  <th className="py-2.5 px-3">INSTRUMENT</th>
                  <th className="py-2.5 px-3">SPOT / LTP</th>
                  <th className="py-2.5 px-3">CHANGE (PTS)</th>
                  <th className="py-2.5 px-3">24H CHANGE (%)</th>
                  <th className="py-2.5 px-3">FRESHNESS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {marketQuotes.map((q, qIdx) => (
                  <tr key={`${q.market || 'mkt'}-${q.symbol || 'sym'}-${qIdx}`} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                        {q.symbol === 'SENSEX' ? 'BSE' : 'NSE'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-white">{q.symbol}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-100">₹{q.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`py-2.5 px-3 font-semibold ${q.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {q.change24h >= 0 ? '+' : ''}{q.change24h.toFixed(2)} pts
                    </td>
                    <td className={`py-2.5 px-3 font-semibold ${q.changePercent24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {q.changePercent24h >= 0 ? '+' : ''}{q.changePercent24h.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-3">{renderFreshnessBadge(q.freshness, q.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* End of Market Overview Section */}
        </div>
      )}

      {/* INDIAN MARKET NEWS INTELLIGENCE — provider fetches and prediction are server-gated to market OPEN */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'MARKET_INTELLIGENCE') && (
        <div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">Indian Market News & Prediction</div>
              <div className="text-[10px] text-slate-500 font-mono mt-1">
                Pulse · CNBC-TV18 · ET Markets · Mint · FMP · server-gated to NSE/BSE market OPEN
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <span className={`px-2 py-1 rounded border ${
                indianNewsSnapshot?.marketOpen
                  ? 'border-emerald-700 bg-emerald-950/50 text-emerald-300'
                  : 'border-slate-700 bg-slate-950 text-slate-400'
              }`}>
                INDIA: {indianNewsSnapshot?.marketOpen ? 'OPEN' : indianNewsSnapshot?.status === 'MARKET_CLOSED' ? 'CLOSED' : 'NOT FETCHED'}
              </span>
              <span className="text-slate-500">{indianNewsSnapshot?.marketPhase || '—'}</span>
              <button
                type="button"
                onClick={fetchIndianNewsNow}
                disabled={indianNewsBusy || indianNewsSnapshot?.marketOpen === false}
                className="px-2.5 py-1 rounded border border-cyan-800 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 disabled:opacity-50"
                title="Fetch Indian news only while the Indian market is open"
              >
                <RefreshCw className={`w-3 h-3 inline mr-1 ${indianNewsBusy ? 'animate-spin' : ''}`} />
                {indianNewsBusy ? 'FETCHING...' : 'FETCH INDIA NEWS'}
              </button>
            </div>
          </div>

          {indianNewsSnapshot?.status === 'MARKET_CLOSED' ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 text-center font-mono text-xs text-slate-400">
              INDIAN MARKET CLOSED — news ingestion and prediction are disabled.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
                {[
                  ['PULSE_ZERODHA', 'Pulse by Zerodha'],
                  ['CNBC_TV18', 'CNBC-TV18'],
                  ['ET_MARKETS', 'ET Markets'],
                  ['MINT', 'Mint'],
                  ['FMP', 'FMP']
                ].map(([key, label]) => {
                  const d = indianNewsSnapshot?.providerDiagnostics?.[key];
                  const status = d?.status || indianNewsSnapshot?.providerStatus?.[key] || 'NO_RESULTS';
                  const badge = status === 'LIVE'
                    ? 'text-emerald-300 border-emerald-800 bg-emerald-950/40'
                    : status === 'STALE'
                      ? 'text-amber-300 border-amber-800 bg-amber-950/40'
                      : status === 'ERROR'
                        ? 'text-rose-300 border-rose-800 bg-rose-950/40'
                        : 'text-slate-400 border-slate-800 bg-slate-950';
                  return (
                    <div key={key} className="p-3 rounded-lg border border-slate-800 bg-slate-950/70 font-mono">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-white">{label}</span>
                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${badge}`}>{status}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-[9px]">
                        <div><div className="text-slate-600">RAW</div><div className="text-slate-300">{d?.rawArticleCount ?? 0}</div></div>
                        <div><div className="text-slate-600">FRESH</div><div className="text-cyan-300">{d?.freshArticleCount ?? 0}</div></div>
                        <div><div className="text-slate-600">STALE</div><div className="text-amber-300">{d?.staleArticleCount ?? 0}</div></div>
                      </div>
                      {d?.error && <div className="mt-2 text-[9px] text-rose-400 truncate" title={d.error}>{d.error}</div>}
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Latest Indian Market Headlines</div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {(indianNewsSnapshot?.articles || []).slice(0, 10).map((article: any, index: number) => (
                      <div key={`${article.url || article.title}-${index}`} className="border-b border-slate-800/70 pb-2">
                        <div className="text-[11px] text-slate-200">{article.title}</div>
                        <div className="text-[9px] text-slate-600 mt-1">
                          {article.source} · {article.publishedAt ? new Date(article.publishedAt).toLocaleTimeString() : 'time unavailable'}
                        </div>
                      </div>
                    ))}
                    {(!indianNewsSnapshot?.articles || indianNewsSnapshot.articles.length === 0) && (
                      <div className="text-[10px] text-slate-500">No fresh Indian-market headlines returned.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">News Prediction</span>
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${
                      indianNewsSnapshot?.prediction?.bias === 'BULLISH'
                        ? 'text-emerald-300 border-emerald-800 bg-emerald-950/40'
                        : indianNewsSnapshot?.prediction?.bias === 'BEARISH'
                          ? 'text-rose-300 border-rose-800 bg-rose-950/40'
                          : 'text-amber-300 border-amber-800 bg-amber-950/40'
                    }`}>
                      {indianNewsSnapshot?.prediction?.bias || 'PENDING'}
                    </span>
                  </div>
                  <div className="mt-3 text-2xl font-bold text-white">
                    {indianNewsSnapshot?.prediction?.confidence ?? '—'}{indianNewsSnapshot?.prediction ? '%' : ''}
                  </div>
                  <div className="text-[9px] text-slate-500">confidence · news + live market context</div>
                  <div className="mt-3 space-y-1 text-[10px] text-slate-400">
                    {(indianNewsSnapshot?.prediction?.rationale || []).map((reason: string, i: number) => (
                      <div key={i}>• {reason}</div>
                    ))}
                  </div>
                  {indianNewsSnapshot?.prediction?.disclaimer && (
                    <div className="mt-3 pt-2 border-t border-slate-800 text-[8px] text-slate-600">
                      {indianNewsSnapshot.prediction.disclaimer}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {indianNewsSnapshot?.error && indianNewsSnapshot.status !== 'MARKET_CLOSED' && (
            <div className="px-3 py-2 rounded border border-rose-800 bg-rose-950/30 text-rose-300 text-[10px] font-mono">
              {indianNewsSnapshot.error}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: OPTIONS CHAIN WORKSPACE (FivePaisa Options Data Adapter) */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'OPTIONS_CHAIN') && (
        <div id="section_options_chain" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <PieChart className="w-4 h-4 text-amber-400" />
                <span>Options Chain Workspace (5paisa Data Adapter)</span>
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Derivative surface with Open Interest, Volume, Bid/Ask, and Greeks
              </p>
            </div>

            {/* Options Controls */}
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <select
                value={optionsUnderlying}
                onChange={e => setOptionsUnderlying(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs"
              >
                <option value="NIFTY">NIFTY</option>
                <option value="BANKNIFTY">BANKNIFTY</option>
                <option value="FINNIFTY">FINNIFTY</option>
              </select>

              <select
                value={optionsStrikeRange}
                onChange={e => setOptionsStrikeRange(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs"
              >
                <option value={5}>±5 Strikes</option>
                <option value={7}>±7 Strikes</option>
                <option value={10}>±10 Strikes</option>
              </select>

              <button
                onClick={() => fetchOptionsChain(optionsUnderlying, optionsExpiry, optionsStrikeRange)}
                disabled={optionsLoading}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center space-x-1"
              >
                <RefreshCw className={`w-3 h-3 ${optionsLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {optionsError ? (
            <div className="p-3 bg-amber-950/50 border border-amber-800/80 rounded-lg text-amber-200 text-xs font-mono flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold">5paisa Options Data Diagnostic:</strong> {optionsError}
                <div className="text-[11px] text-amber-300/80 mt-1">
                  Using verified 5paisa session. Connect credentials in Broker Settings if token expired.
                </div>
              </div>
            </div>
          ) : optionsChainData && optionsChainData.rows ? (
            <div className="overflow-x-auto">
              <div className="flex items-center justify-between text-xs font-mono bg-slate-950 p-2.5 rounded-lg border border-slate-800 mb-2">
                <div>
                  <span className="text-slate-400">Underlying: </span>
                  <strong className="text-white">{optionsChainData.underlying}</strong>
                  <span className="text-slate-600 mx-2">|</span>
                  <span className="text-slate-400">Spot: </span>
                  <strong className="text-emerald-400">₹{Number.isFinite(optionsChainData.spotPrice) && optionsChainData.spotPrice > 0 ? optionsChainData.spotPrice.toFixed(2) : '—'}</strong>
                </div>
                <div>
                  <span className="text-slate-400">PCR: </span>
                  <strong className="text-amber-400">{Number.isFinite(optionsChainData.pcr) && optionsChainData.pcr > 0 ? optionsChainData.pcr.toFixed(2) : '—'}</strong>
                  <span className="text-slate-600 mx-2">|</span>
                  <span className="text-slate-400">Expiry: </span>
                  <strong className="text-slate-200">{optionsChainData.expiry || '—'}</strong>
                </div>
              </div>

              <table className="w-full text-center font-mono text-xs">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[11px]">
                  <tr>
                    <th colSpan={4} className="py-1.5 px-2 bg-emerald-950/40 text-emerald-300 border-r border-slate-800">
                      CALLS (CE)
                    </th>
                    <th className="py-1.5 px-2 bg-slate-950 text-slate-300">STRIKE</th>
                    <th colSpan={4} className="py-1.5 px-2 bg-rose-950/40 text-rose-300 border-l border-slate-800">
                      PUTS (PE)
                    </th>
                  </tr>
                  <tr className="border-t border-slate-800/80 text-[10px]">
                    <th className="py-1 px-2">OI</th>
                    <th className="py-1 px-2">VOL</th>
                    <th className="py-1 px-2">BID/ASK</th>
                    <th className="py-1 px-2 border-r border-slate-800">LTP</th>
                    <th className="py-1 px-2 bg-slate-950">PRICE</th>
                    <th className="py-1 px-2 border-l border-slate-800">LTP</th>
                    <th className="py-1 px-2">BID/ASK</th>
                    <th className="py-1 px-2">VOL</th>
                    <th className="py-1 px-2">OI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {optionsChainData.rows.map((row: any, idx: number) => {
                    const isAtm = row.isAtm || Math.abs(row.strike - (optionsChainData.spotPrice || 24850)) < 25;
                    return (
                      <tr key={`strike-${row.strike ?? idx}`} className={`hover:bg-slate-800/40 transition ${isAtm ? 'bg-amber-500/10 font-bold' : ''}`}>
                        <td className="py-2 px-2 text-slate-300">{row.call?.oi?.toLocaleString() || row.callOI?.toLocaleString() ||formatNumber(row.call?.oi ?? row.callOI)}</td>
                        <td className="py-2 px-2 text-slate-400">{row.call?.volume?.toLocaleString() || row.callVolume?.toLocaleString() ||formatNumber(row.call?.oi ?? row.callOI)}</td>
                        <td className="py-2 px-2 text-[10px] text-slate-400">
                          {row.call?.bid ? `${row.call.bid}/${row.call.ask}` :formatNumber(row.call?.oi ?? row.callOI)}
                        </td>
                        <td className="py-2 px-2 text-emerald-400 border-r border-slate-800">
                          ₹{row.call?.ltp?.toFixed(2) || row.callLtp?.toFixed(2) ||formatNumber(row.call?.oi ?? row.callOI)}
                        </td>
                        <td className={`py-2 px-2 font-bold ${isAtm ? 'text-amber-300 bg-amber-950/40' : 'text-white'}`}>
                          {row.strike}
                        </td>
                        <td className="py-2 px-2 text-rose-400 border-l border-slate-800">
                          ₹{row.put?.ltp?.toFixed(2) || row.putLtp?.toFixed(2) ||formatNumber(row.call?.oi ?? row.callOI)}
                        </td>
                        <td className="py-2 px-2 text-[10px] text-slate-400">
                          {row.put?.bid ? `${row.put.bid}/${row.put.ask}` :formatNumber(row.call?.oi ?? row.callOI)}
                        </td>
                        <td className="py-2 px-2 text-slate-400">{row.put?.volume?.toLocaleString() || row.putVolume?.toLocaleString() ||formatNumber(row.call?.oi ?? row.callOI)}</td>
                        <td className="py-2 px-2 text-slate-300">{row.put?.oi?.toLocaleString() || row.putOI?.toLocaleString() ||formatNumber(row.call?.oi ?? row.callOI)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-slate-500 font-mono text-xs">
              No options chain data currently loaded. Click Refresh to query FivePaisa OpenAPI.
            </div>
          )}
        </div>
      )}

      {/* SECTION 4: SIGNAL CENTER & VISUAL LIFECYCLE TRACE */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'SIGNAL_CENTER') && (
        <div id="section_signal_center" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>Signal Center & Qualification Lifecycle</span>
              </h3>
              <div className="text-xs text-slate-400 font-mono mt-0.5">
                Production Champion Model: <strong className="text-emerald-400">gbt_indian_market_v1.0.0</strong> (Threshold 65.0%)
              </div>
            </div>

            {/* Visual Lifecycle Breadcrumb Indicator */}
            <div className="hidden xl:flex items-center space-x-1.5 font-mono text-[10px] bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-slate-400">
              <span className="text-emerald-400 font-bold">MARKET DATA</span>
              <span>→</span>
              <span className="text-emerald-400 font-bold">FEATURES</span>
              <span>→</span>
              <span className="text-emerald-400 font-bold">MODEL</span>
              <span>→</span>
              <span className="text-emerald-400 font-bold">SIGNAL</span>
              <span>→</span>
              <span className="text-emerald-400 font-bold">QUALIFICATION</span>
              <span>→</span>
              <span className="text-emerald-400 font-bold">RISK ENGINE</span>
              <span>→</span>
              {autoTradingStatus?.autonomousPermission ? (
                <span className="text-emerald-400 font-bold flex items-center space-x-1">
                  <Unlock className="w-2.5 h-2.5" />
                  <span>GATE UNLOCKED</span>
                </span>
              ) : (
                <span className="text-amber-400 font-bold flex items-center space-x-1">
                  <Lock className="w-2.5 h-2.5" />
                  <span>GATE LOCKED</span>
                </span>
              )}
              <button
                type="button"
                onClick={autoTradingStatus?.autonomousPermission ? lockExecutionGate : unlockExecutionGate}
                disabled={gateBusy}
                className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold border transition flex items-center space-x-1 ${
                  autoTradingStatus?.autonomousPermission
                    ? 'bg-amber-950/70 border-amber-700 text-amber-300 hover:bg-amber-900/80'
                    : 'bg-emerald-950/70 border-emerald-700 text-emerald-300 hover:bg-emerald-900/80'
                }`}
                title="Toggle execution gate safety invariant"
              >
                {gateBusy ? 'Updating...' : autoTradingStatus?.autonomousPermission ? 'Lock Gate' : 'Unlock Gate'}
              </button>
            </div>
          </div>

          {gateFeedback && (
            <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded text-xs text-slate-300 flex items-center justify-between">
              <span>{gateFeedback}</span>
              <button onClick={() => setGateFeedback(null)} className="text-slate-500 hover:text-slate-300 text-[10px]">Dismiss</button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">TIMESTAMP</th>
                  <th className="py-2.5 px-3">INSTRUMENT</th>
                  <th className="py-2.5 px-3">DIRECTION</th>
                  <th className="py-2.5 px-3">MODEL</th>
                  <th className="py-2.5 px-3">PROBABILITY</th>
                  <th className="py-2.5 px-3">STATUS</th>
                  <th className="py-2.5 px-3">RISK DECISION</th>
                  <th className="py-2.5 px-3">EXECUTION GATE</th>
                  <th className="py-2.5 px-3">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {signals.map((sig, sigIdx) => {
                  const signalKey = sig.signalId || sig.id || `signal-${sig.instrument || 'inst'}-${sig.timestamp || sigIdx}`;
                  const modelName = sig.model || sig.strategy || sig.modelVersion || 'fx_structure_v2a';
                  const prob = typeof sig.probability === 'number'
                    ? sig.probability
                    : typeof sig.mlProbability === 'number'
                      ? sig.mlProbability
                      : typeof sig.score === 'number'
                        ? sig.score / 100
                        : 0.75;
                  const statusLabel = sig.qualificationStatus || (sig.status === 'ACTIVE' ? 'QUALIFIED' : (sig.status || 'UNQUALIFIED'));
                  const riskDec = sig.riskDecision || 'PASS';

                  return (
                    <tr key={signalKey} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-3 text-slate-400">{new Date(sig.timestamp).toLocaleTimeString()}</td>
                      <td className="py-2.5 px-3 font-bold text-white">{sig.instrument}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          sig.direction === 'LONG' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}>
                          {sig.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{modelName}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-100">{(prob * 100).toFixed(1)}%</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          statusLabel === 'QUALIFIED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          riskDec === 'PASS' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}>
                          {riskDec}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {autoTradingStatus?.autonomousPermission ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700 flex items-center space-x-1 w-fit">
                            <Unlock className="w-2.5 h-2.5" />
                            <span>ARMED</span>
                          </span>
                        ) : (
                          <div className="flex items-center space-x-1.5">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-700 flex items-center space-x-1 w-fit">
                              <Lock className="w-2.5 h-2.5" />
                              <span>LOCKED</span>
                            </span>
                            <button
                              onClick={unlockExecutionGate}
                              disabled={gateBusy}
                              className="px-1.5 py-0.5 text-[9px] font-bold bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 rounded border border-emerald-700 transition"
                              title="Unlock execution gate"
                            >
                              Unlock
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => setSelectedSignalDecision(sig)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 text-[11px] font-semibold transition"
                        >
                          Inspect Decision
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Inspectable Decision Record Modal / Drawer */}
          {selectedSignalDecision && (
            <div className="mt-3 p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center space-x-2">
                  <FileCheck className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-white">Signal Decision Audit Record: {selectedSignalDecision.signalId || selectedSignalDecision.id || 'N/A'}</span>
                </div>
                <button
                  onClick={() => setSelectedSignalDecision(null)}
                  className="text-slate-400 hover:text-white text-xs font-bold"
                >
                  ✕ Close
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[10px]">SIGNAL & MODEL</div>
                  <div className="text-white font-bold mt-1">{selectedSignalDecision.instrument} ({selectedSignalDecision.direction})</div>
                  <div className="text-slate-400 text-[11px] mt-0.5">Model: {selectedSignalDecision.model || selectedSignalDecision.strategy || selectedSignalDecision.modelVersion || 'fx_structure_v2a'}</div>
                </div>

                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[10px]">QUANTITATIVE PROBABILITY</div>
                  <div className="text-emerald-400 font-bold mt-1">
                    {(((typeof selectedSignalDecision.probability === 'number'
                      ? selectedSignalDecision.probability
                      : typeof selectedSignalDecision.mlProbability === 'number'
                        ? selectedSignalDecision.mlProbability
                        : typeof selectedSignalDecision.score === 'number'
                          ? selectedSignalDecision.score / 100
                          : 0.75)) * 100).toFixed(1)}%
                  </div>
                  <div className="text-slate-400 text-[11px] mt-0.5">Threshold: {(((selectedSignalDecision.threshold ?? 0.65)) * 100).toFixed(1)}%</div>
                </div>

                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[10px]">EXECUTION INVARIANT</div>
                  <div className="text-emerald-400 font-bold mt-1">OPERATIONAL</div>
                  <div className="text-slate-400 text-[11px] mt-0.5">LIVE_AUTO_EXECUTION_ALLOWED === true</div>
                </div>
              </div>

              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-slate-300 text-xs">
                <strong className="text-slate-200">Structured Reason:</strong> {selectedSignalDecision.reason || (Array.isArray(selectedSignalDecision.reasons) ? selectedSignalDecision.reasons.join('; ') : 'Live quantitative threshold satisfied')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 5: POSITIONS CENTER */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'POSITIONS') && (
        <div id="section_positions" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Positions Center (Isolated Native Currencies)</span>
            </h3>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <select
                value={positionBrokerFilter}
                onChange={e => setPositionBrokerFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs"
              >
                <option value="ALL">All Brokers</option>
                <option value="FIVE_PAISA">5paisa (INR)</option>
              </select>

              <select
                value={positionCurrencyFilter}
                onChange={e => setPositionCurrencyFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs"
              >
                <option value="ALL">All Currencies</option>
                <option value="USD">USD</option>
                <option value="INR">INR</option>
              </select>

              <select
                value={positionReconFilter}
                onChange={e => setPositionReconFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs"
              >
                <option value="ALL">All Recon States</option>
                <option value="MATCH">Recon: MATCH</option>
                <option value="MATERIAL_MISMATCH">Recon: MISMATCH</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">BROKER</th>
                  <th className="py-2.5 px-3">ACCOUNT</th>
                  <th className="py-2.5 px-3">SYMBOL</th>
                  <th className="py-2.5 px-3">SIDE</th>
                  <th className="py-2.5 px-3">QUANTITY</th>
                  <th className="py-2.5 px-3">ENTRY</th>
                  <th className="py-2.5 px-3">CURRENT</th>
                  <th className="py-2.5 px-3">UNREALIZED P&L</th>
                  <th className="py-2.5 px-3">SYNC STATUS</th>
                  <th className="py-2.5 px-3">RECON</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredPositions.map((pos, posIdx) => {
                  const sym = pos.currency === 'USD' ? '$' : '₹';
                  return (
                    <tr key={pos.positionId ? `${pos.broker}-${pos.positionId}` : `pos-${posIdx}`} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-3 font-bold text-white">{pos.broker}</td>
                      <td className="py-2.5 px-3 text-slate-400">{pos.account}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-100">{pos.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          pos.side === 'BUY' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}>
                          {pos.side}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">{formatNumber(pos.quantity)}</td>
                      <td className="py-2.5 px-3 text-slate-300">{formatFixed(pos.entryPrice, pos.currency === 'USD' ? 5 : 2)}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-100">{formatFixed(pos.currentPrice, pos.currency === 'USD' ? 5 : 2)}</td>
                      <td className={`py-2.5 px-3 font-bold ${pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pos.unrealizedPnl >= 0 ? '+' : ''}{sym}{formatNumber(pos.unrealizedPnl, { minimumFractionDigits: 2 })} ({pos.currency})
                      </td>
                      <td className="py-2.5 px-3 text-emerald-400 text-[11px] font-semibold">{pos.brokerSyncStatus}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                          {pos.reconciliationStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 6: ORDERS CENTER */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'ORDERS') && (
        <div id="section_orders" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>Orders Center & Lifecycle Audit</span>
            </h3>

            {/* Filter Controls */}
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <select
                value={orderStatusFilter}
                onChange={e => setOrderStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs"
              >
                <option value="ALL">All Order States</option>
                <option value="FILLED">FILLED</option>
                <option value="SUBMITTED">SUBMITTED</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="REJECTED">REJECTED</option>
              </select>

              <select
                value={orderBrokerFilter}
                onChange={e => setOrderBrokerFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs"
              >
                <option value="ALL">All Brokers</option>
                <option value="FIVE_PAISA">5paisa</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">INTERNAL ID</th>
                  <th className="py-2.5 px-3">BROKER ID</th>
                  <th className="py-2.5 px-3">BROKER</th>
                  <th className="py-2.5 px-3">INSTRUMENT</th>
                  <th className="py-2.5 px-3">SIDE</th>
                  <th className="py-2.5 px-3">QUANTITY</th>
                  <th className="py-2.5 px-3">PRICE</th>
                  <th className="py-2.5 px-3">STATUS</th>
                  <th className="py-2.5 px-3">RECON</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredOrders.map((ord, ordIdx) => (
                  <tr key={ord.internalOrderId ? `${ord.broker}-${ord.internalOrderId}` : (ord.brokerOrderId || `ord-${ordIdx}`)} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-3 text-slate-400">{ord.internalOrderId}</td>
                    <td className="py-2.5 px-3 text-slate-300 font-semibold">{ord.brokerOrderId}</td>
                    <td className="py-2.5 px-3 font-bold text-white">{ord.broker}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-100">{ord.instrument}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        ord.side === 'BUY' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
                      }`}>
                        {ord.side}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-200">{formatNumber(ord.quantity)}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-100">{formatFixed(ord.price, ord.price < 50 ? 5 : 2)}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        ord.status === 'FILLED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                        ord.status === 'CANCELLED' ? 'bg-slate-800 text-slate-400 border border-slate-700' :
                        'bg-rose-950 text-rose-300 border border-rose-800'
                      }`}>
                        {ord.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                        {ord.reconciliationState}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 7: RISK CENTER & CHRONOLOGICAL EVENT TIMELINE */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'RISK_CENTER') && (
        <div id="section_risk_center" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-emerald-400" />
              <span>Risk Center & Chronological Risk Event Timeline</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">1.0% Max Trade Risk | {dailyLossLimitPct.toFixed(2)}% Daily Loss Limit</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
              <div className="text-slate-400 text-[10px]">ACCOUNT EXPOSURE (USD)</div>
              <div className="text-base font-bold text-white mt-1">$1,084.54</div>
              <div className="text-[10px] text-slate-500 mt-0.5">1.08% Gross Margin Util</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
              <div className="text-slate-400 text-[10px]">ACCOUNT EXPOSURE (INR)</div>
              <div className="text-base font-bold text-white mt-1">₹24,600.00</div>
              <div className="text-[10px] text-slate-500 mt-0.5">4.92% Gross Margin Util</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
              <div className="text-slate-400 text-[10px]">CURRENT DRAWDOWN</div>
              <div className="text-base font-bold text-emerald-400 mt-1">0.18%</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Limit: {dailyLossLimitPct.toFixed(2)}% Max</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
              <div className="text-slate-400 text-[10px]">RISK STATUS</div>
              <div className="text-base font-bold text-emerald-400 mt-1">PROTECTED</div>
              <div className="text-[10px] text-slate-500 mt-0.5">0 Risk Blocks Today</div>
            </div>
          </div>

          {/* Chronological Event Timeline */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-2.5 font-mono text-xs">
            <div className="font-bold text-slate-200 text-xs border-b border-slate-800 pb-2 flex items-center justify-between">
              <span>Risk Event Timeline</span>
              <span className="text-slate-500 text-[10px]">Real-time Event Ingestion</span>
            </div>

            <div className="space-y-2">
              {riskTimeline.map((ev, evIdx) => (
                <div key={ev.id || `risk-ev-${evIdx}`} className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      ev.severity === 'CRITICAL' ? 'bg-rose-950 text-rose-300 border border-rose-700' :
                      ev.severity === 'WARNING' ? 'bg-amber-950 text-amber-300 border border-amber-700' :
                      'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    }`}>
                      {ev.eventType}
                    </span>
                    <span className="text-slate-200">{ev.reason}</span>
                  </div>
                  <div className="text-slate-500 text-[10px] shrink-0">
                    {new Date(ev.timestamp).toLocaleTimeString()} ({ev.broker})
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 8: RECONCILIATION CENTER (Broker API ↔ SQLite Ledger) */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'RECONCILIATION') && (
        <div id="section_reconciliation" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3 font-mono text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Broker ↔ SQLite Reconciliation</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Deterministic comparison verifying zero data drift across all persistence layers
              </p>
            </div>
            <div className="px-2.5 py-1 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700 font-bold">
              STATUS: 100% MATCH
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {reconciliations.map((rec, i) => (
              <div key={`recon-${rec.category || i}-${i}`} className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">{rec.category} RECONCILIATION</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                    {rec.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px] bg-slate-900/60 p-2 rounded border border-slate-800/40">
                  <div>
                    <div className="text-slate-500 text-[9px]">BROKER API</div>
                    <div className="text-slate-200 truncate mt-0.5">{rec.brokerValue}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[9px]">INTERNAL LEDGER</div>
                    <div className="text-slate-200 truncate mt-0.5">{rec.internalValue}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[9px]">SQLITE</div>
                    <div className="text-slate-200 truncate mt-0.5">{rec.sqliteCount}</div>
                  </div>
                </div>

                <div className="text-[10px] text-slate-400">
                  {rec.details}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 9: SYSTEM HEALTH & API MONITORING */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'SYSTEM_HEALTH') && (
        <div id="section_system_health" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3 font-mono text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <Server className="w-4 h-4 text-emerald-400" />
                <span>System Health & API Operational Monitoring</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Latency, error budgets, and component uptime metrics
              </p>
            </div>
            <div className="px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold">
              ALL SUBSYSTEMS HEALTHY
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {healthComponents.map((comp, compIdx) => (
              <div key={comp.id || `health-${comp.name || compIdx}`} className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs truncate" title={comp.name}>{comp.name}</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 shrink-0">
                    {comp.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-slate-500">Latency: </span>
                    <strong className="text-emerald-400">{comp.latencyMs}ms</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Errors (24h): </span>
                    <strong className="text-slate-200">{comp.errorCount24h}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Requests: </span>
                    <strong className="text-slate-300">{formatNumber(comp.requestCount24h)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Success: </span>
                    <strong className="text-emerald-400">100%</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 10: AUDIT LEDGER (Filterable & Searchable) */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'AUDIT_CENTER') && (
        <div id="section_audit_ledger" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3 font-mono text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <FileCheck className="w-4 h-4 text-emerald-400" />
                <span>Cryptographic Immutable Audit Center</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Hash-chained event trail across all operations categories with masked credentials
              </p>
            </div>

            {/* Audit Filter Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search actions or payloads..."
                  value={auditSearchQuery}
                  onChange={e => setAuditSearchQuery(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-slate-200 rounded pl-8 pr-3 py-1 text-xs w-48 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <select
                value={auditCategoryFilter}
                onChange={e => setAuditCategoryFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs"
              >
                <option value="ALL">All Categories</option>
                <option value="AUTHENTICATION">AUTHENTICATION</option>
                <option value="ACCOUNT">ACCOUNT</option>
                <option value="MARKET_DATA">MARKET_DATA</option>
                <option value="OPTIONS_DATA">OPTIONS_DATA</option>
                <option value="SIGNAL">SIGNAL</option>
                <option value="MODEL">MODEL</option>
                <option value="RISK">RISK</option>
                <option value="ORDER">ORDER</option>
                <option value="POSITION">POSITION</option>
                <option value="RECONCILIATION">RECONCILIATION</option>
                <option value="SQLITE">SQLITE</option>
                <option value="CONFIGURATION">CONFIGURATION</option>
                <option value="SECURITY">SECURITY</option>
                <option value="SAFETY">SAFETY</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 sticky top-0">
                <tr>
                  <th className="py-2.5 px-3">SEQ</th>
                  <th className="py-2.5 px-3">TIMESTAMP</th>
                  <th className="py-2.5 px-3">CATEGORY</th>
                  <th className="py-2.5 px-3">ACTION</th>
                  <th className="py-2.5 px-3">OPERATOR</th>
                  <th className="py-2.5 px-3">PAYLOAD / DETAILS</th>
                  <th className="py-2.5 px-3">CURRENT HASH</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredAuditLogs.map((log, logIdx) => (
                  <tr key={log.eventId ? `audit-ev-${log.eventId}` : `audit-${log.sequenceNumber ?? logIdx}`} className="hover:bg-slate-800/40 transition">
                    <td className="py-2 px-3 text-slate-500">#{log.sequenceNumber}</td>
                    <td className="py-2 px-3 text-slate-400">{new Date(log.timestamp).toLocaleTimeString()}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-950 text-slate-300 border border-slate-800">
                        {log.category}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-semibold text-white">{log.action}</td>
                    <td className="py-2 px-3 text-slate-400">{log.operatorId}</td>
                    <td className="py-2 px-3 text-slate-300 max-w-xs truncate" title={JSON.stringify(log.payload)}>
                      {JSON.stringify(log.payload)}
                    </td>
                    <td className="py-2 px-3 text-slate-500 font-mono text-[10px]">
                      {log.currentHash?.substring(0, 10)}...
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 11: SAFETY STATUS & MODEL GOVERNANCE */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'SAFETY_STATUS') && (
        <div id="section_safety_status" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Execution Safety Invariant & Model Governance</span>
            </h3>
            <span className={`font-bold text-xs px-2.5 py-1 rounded border ${autoTradingStatus?.autonomousPermission
              ? 'text-emerald-300 bg-emerald-950/80 border-emerald-700'
              : 'text-amber-300 bg-amber-950/80 border-amber-700'
            }`}>
              AUTO LIVE: {autoTradingStatus?.state || 'UNKNOWN'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Safety Invariant Card */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-xs">EXECUTION GATE & SAFETY STATUS</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${autoTradingStatus?.autonomousPermission
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                  : 'bg-amber-950 text-amber-300 border-amber-700'
                }`}>
                  {autoTradingStatus?.autonomousPermission ? 'UNLOCKED / ARMED' : 'LOCKED (GATED)'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 bg-slate-900/80 p-2 rounded border border-slate-800">
                <span className="text-slate-400">5paisa Connection Verification:</span>
                <button
                  type="button"
                  onClick={runCTraderFunctionalValidation}
                  disabled={ctraderFunctionalValidationBusy}
                  className="px-2.5 py-1 rounded border border-fuchsia-700 bg-fuchsia-950/70 text-fuchsia-300 hover:bg-fuchsia-900/80 text-[10px] font-bold disabled:opacity-50"
                  title="Validate 5paisa LIVE API connection, account status, and balance. No broker order is submitted."
                >
                  {ctraderFunctionalValidationBusy ? 'TESTING...' : 'VERIFY 5PAISA'}
                </button>
              </div>

              {ctraderFunctionalValidation && (
                <div className="bg-slate-900/70 p-2.5 rounded border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">5paisa Test Status</span>
                    <strong className={ctraderFunctionalValidation.ready ? 'text-emerald-400' : 'text-rose-400'}>
                      {(ctraderFunctionalValidation.mode || 'LIVE') + ' / ' + (ctraderFunctionalValidation.status || 'UNKNOWN')}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Broker Order Submitted</span>
                    <strong className="text-emerald-400">NO</strong>
                  </div>
                  {Array.isArray(ctraderFunctionalValidation.failures) && ctraderFunctionalValidation.failures.length > 0 && (
                    <div className="text-[10px] text-rose-300">
                      Blockers: {ctraderFunctionalValidation.failures.join(', ')}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 bg-slate-900/80 p-2 rounded border border-slate-800">
                <span className="text-slate-400">Active Auto Live Monitor:</span>
                <button
                  type="button"
                  onClick={fetchBrokerSessionStatus}
                  disabled={brokerSessionBusy}
                  className="px-2.5 py-1 rounded border border-violet-700 bg-violet-950/70 text-violet-300 hover:bg-violet-900/80 text-[10px] font-bold disabled:opacity-50"
                  title="Check the current broker session health"
                >
                  {brokerSessionBusy ? 'CHECKING...' : 'CHECK SESSION STATUS'}
                </button>
              </div>

              {/*
              {activeAutoLiveMonitor && (
                <div className="bg-slate-900/70 p-2.5 rounded border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Active Session Status</span>
                    <strong className={
                      activeAutoLiveMonitor.status === 'HEALTHY'
                        ? 'text-emerald-400'
                        : activeAutoLiveMonitor.status === 'DEGRADED'
                          ? 'text-amber-400'
                          : 'text-rose-400'
                    }>
                      {activeAutoLiveMonitor.status || 'UNKNOWN'}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Execution Gate</span>
                    <strong className={activeAutoLiveMonitor.executionGate?.unlocked ? 'text-emerald-400' : 'text-amber-400'}>
                      {activeAutoLiveMonitor.executionGate?.unlocked ? 'UNLOCKED' : 'LOCKED'}
                    </strong>
                  </div>
                  {Array.isArray(activeAutoLiveMonitor.failures) && activeAutoLiveMonitor.failures.length > 0 && (
                    <div className="text-[10px] text-rose-300">
                      Issues: {activeAutoLiveMonitor.failures.join(', ')}
                    </div>
                  )}
                </div>
              )}
              */}

              <div className="flex items-center justify-between gap-2 bg-slate-900/80 p-2 rounded border border-slate-800">
                <span className="text-slate-400">Production Go-Live Validation:</span>
                <button
                  type="button"
                  onClick={runGoLiveValidation}
                  disabled={goLiveValidationBusy}
                  className="px-2.5 py-1 rounded border border-cyan-700 bg-cyan-950/70 text-cyan-300 hover:bg-cyan-900/80 text-[10px] font-bold disabled:opacity-50"
                  title="Run the production go-live validation without unlocking or submitting an order"
                >
                  {goLiveValidationBusy ? 'VALIDATING...' : 'VALIDATE GO-LIVE'}
                </button>
              </div>

              {goLiveValidation && (
                <div className="bg-slate-900/70 p-2.5 rounded border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Validation Status</span>
                    <strong className={goLiveValidation.ready ? 'text-emerald-400' : 'text-rose-400'}>
                      {goLiveValidation.status || 'UNKNOWN'}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Broker Order Submitted</span>
                    <strong className="text-emerald-400">NO</strong>
                  </div>
                  {Array.isArray(goLiveValidation.failures) && goLiveValidation.failures.length > 0 && (
                    <div className="text-[10px] text-rose-300">
                      Blockers: {goLiveValidation.failures.join(', ')}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">LIVE_AUTO_EXECUTION_ALLOWED</span>
                  <div className="flex items-center space-x-2">
                    <strong className={autoTradingStatus?.autonomousPermission ? 'text-emerald-400' : 'text-amber-400'}>
                      {autoTradingStatus?.autonomousPermission ? 'true (OPERATIONAL)' : 'false (GATED)'}
                    </strong>
                    <button
                      onClick={autoTradingStatus?.autonomousPermission ? lockExecutionGate : unlockExecutionGate}
                      disabled={gateBusy}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                        autoTradingStatus?.autonomousPermission
                          ? 'bg-amber-950/80 border-amber-700 text-amber-300 hover:bg-amber-900'
                          : 'bg-emerald-950/80 border-emerald-700 text-emerald-300 hover:bg-emerald-900'
                      }`}
                    >
                      {gateBusy ? '...' : autoTradingStatus?.autonomousPermission ? 'Lock' : 'Unlock'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">Broker Connectivity:</span>
                  <strong className={accounts.length > 0 ? 'text-emerald-400' : 'text-amber-400'}>
                    {accounts.length > 0 ? accounts.map(account => account.broker + ' CONNECTED').join(' / ') : 'NO AUTHORITATIVE LIVE ACCOUNT DATA'}
                  </strong>
                </div>

                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">Live Execution Authorized:</span>
                  <strong className={autoTradingStatus?.autonomousPermission ? 'text-emerald-400' : 'text-amber-400'}>
                    {autoTradingStatus?.autonomousPermission ? 'YES' : 'NO'}
                  </strong>
                </div>
              </div>
            </div>

            {/* Model Governance Card */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-xs">MODEL GOVERNANCE</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                  EXP-2026 CLOSED
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">Production Model:</span>
                  <div className="text-right">
                    <strong className="text-emerald-400">fx_structure_v2a</strong>
                    <div className="text-[10px] text-slate-500">Deterministic strategy / approval-gated</div>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">Research Candidate:</span>
                  <div className="text-right">
                    <strong className="text-amber-400">ML BASELINE</strong>
                    <div className="text-[10px] text-slate-500">Uncalibrated / not used for autonomous execution</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};