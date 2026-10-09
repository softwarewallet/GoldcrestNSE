import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  FileCheck,
  FileText,
  HelpCircle,
  Info,
  Layers,
  Lock,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap
} from 'lucide-react';

interface AccountSummary {
  broker: 'FIVE_PAISA' | 'CTRADER';
  environment: 'LIVE';
  accountId: string;
  maskedAccountId: string;
  accountType: string;
  balance: number;
  equity: number;
  availableMargin: number;
  currency: string;
  connected: boolean;
  tradingPermission: boolean;
  smallTradeBudget: number;
  killSwitchHalted: boolean;
  autonomousExecutionGateLocked: boolean;
}

interface Instrument {
  symbol: string;
  name: string;
  exchange: string;
  exchangeType: string;
  segment: string;
  scripCode: string | number;
  lotSize: number;
  tickSize: number;
  digits: number;
}

interface ChargesBreakdown {
  brokerage: number;
  exchangeTurnoverFee: number;
  sebiTurnoverFee: number;
  stt: number;
  gst: number;
  stampDuty: number;
  totalCharges: number;
}

interface TradeReview {
  broker: string;
  accountId: string;
  environment: 'LIVE';
  exchange: string;
  exchangeType: string;
  symbol: string;
  scripCode: string;
  side: 'BUY' | 'SELL';
  orderType: string;
  quantity: number;
  lotSize: number;
  lotCount: number;
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  rawOrderValue: number;
  estimatedCharges: number;
  chargesBreakdown: ChargesBreakdown;
  totalEstimatedOutlay: number;
  smallTradeBudget: number;
  isWithinBudget: boolean;
  availableBalance: number;
  availableMargin: number;
  warningStatement: string;
}

interface PrepareResult {
  ready: boolean;
  authorizationId?: string;
  authorizationToken?: string;
  fingerprint?: string;
  expiresAt?: number;
  rejectionReasons: string[];
  review?: TradeReview;
}

interface ConfirmResult {
  success: boolean;
  authorizationId: string;
  status: 'SUBMITTED' | 'ACCEPTED' | 'FILLED' | 'REJECTED' | 'FAILED' | 'RECONCILIATION_PENDING';
  brokerOrderId?: string;
  reconciled: boolean;
  message: string;
  error?: string;
  executedAt?: number;
}

interface RecentAuthorization {
  id: string;
  broker: string;
  environment: string;
  symbol: string;
  exchange: string;
  exchange_type: string;
  side: string;
  order_type: string;
  quantity: number;
  price: number;
  estimated_outlay: number;
  status: string;
  broker_order_id: string | null;
  rejection_reason: string | null;
  created_at: number;
  expires_at: number;
  confirmed_at: number | null;
  consumed_at: number | null;
}

const SMALL_TRADE_BUDGET_INR = 20.00;

export const ManualTradePanel: React.FC = () => {
  // Account & System state
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Instruments
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingInstruments, setLoadingInstruments] = useState(false);

  // Trade form state
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [quantity, setQuantity] = useState<number>(1);
  const [price, setPrice] = useState<string>('0.50');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [operatorNotes, setOperatorNotes] = useState('');

  // Review & Confirmation state
  const [preparing, setPreparing] = useState(false);
  const [prepareResult, setPrepareResult] = useState<PrepareResult | null>(null);
  const [operatorConfirmed, setOperatorConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  // Time remaining for pending authorization (2 min TTL)
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);

  // Recent history
  const [recentTrades, setRecentTrades] = useState<RecentAuthorization[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  // 1. Fetch Account Summary
  const fetchAccount = useCallback(async () => {
    setLoadingAccount(true);
    setAccountError(null);
    try {
      const res = await fetch('/api/manual-trade/account');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      const data: AccountSummary = await res.json();
      setAccount(data);
    } catch (err: any) {
      setAccountError(err.message || 'Failed to load account information.');
    } finally {
      setLoadingAccount(false);
    }
  }, []);

  // 2. Fetch Instruments
  const fetchInstruments = useCallback(async (query = '') => {
    setLoadingInstruments(true);
    try {
      const res = await fetch(`/api/manual-trade/instruments${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      if (res.ok) {
        const data: Instrument[] = await res.json();
        setInstruments(data);
        if (data.length > 0 && !selectedSymbol) {
          setSelectedSymbol(data[0].symbol);
          setQuantity(data[0].lotSize || 1);
        }
      }
    } catch {
      // fail gracefully
    } finally {
      setLoadingInstruments(false);
    }
  }, [selectedSymbol]);

  // 3. Fetch Recent Authorizations
  const fetchRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const res = await fetch('/api/manual-trade/recent?limit=15');
      if (res.ok) {
        const data = await res.json();
        setRecentTrades(data);
      }
    } catch {
      // fail gracefully
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    fetchAccount();
    fetchInstruments();
    fetchRecent();
  }, [fetchAccount, fetchInstruments, fetchRecent]);

  // Selected instrument details
  const currentInstrument = useMemo(() => {
    return instruments.find(i => i.symbol === selectedSymbol) || null;
  }, [instruments, selectedSymbol]);

  // Auto-align quantity to lot size when instrument changes
  const handleSelectSymbol = (sym: string) => {
    setSelectedSymbol(sym);
    const inst = instruments.find(i => i.symbol === sym);
    if (inst && inst.lotSize) {
      setQuantity(inst.lotSize);
    }
    // Reset any pending preparation
    setPrepareResult(null);
    setConfirmResult(null);
    setSubmissionError(null);
    setOperatorConfirmed(false);
  };

  // Pre-calculated live estimates
  const parsedPrice = parseFloat(price) || 0;
  const parsedQty = quantity || 0;
  const rawOrderValue = parsedPrice * parsedQty;

  // Approximate charges for UI preview
  const estimatedCharges = useMemo(() => {
    if (!account) return 0;
    if (account.broker === 'CTRADER') {
      return Number((rawOrderValue * 0.00003).toFixed(2));
    }
    const isDeriv = currentInstrument?.segment === 'DERIVATIVES' || /(?:CE|PE)$/i.test(selectedSymbol);
    const turnover = rawOrderValue;
    const brokerage = 0.00;
    const exchFee = turnover * (isDeriv ? 0.0005 : 0.0000345);
    const sebiFee = turnover * 0.000001;
    const stt = isDeriv && side === 'SELL' ? turnover * 0.000625 : (!isDeriv ? turnover * 0.001 : 0);
    const gst = (brokerage + exchFee + sebiFee) * 0.18;
    const stamp = side === 'BUY' ? (isDeriv ? turnover * 0.00003 : turnover * 0.00015) : 0;
    return Number((brokerage + exchFee + sebiFee + stt + gst + stamp).toFixed(2));
  }, [account, currentInstrument, rawOrderValue, side, selectedSymbol]);

  const totalEstimatedOutlay = Number((rawOrderValue + estimatedCharges).toFixed(2));
  const isBudgetExceeded = totalEstimatedOutlay > SMALL_TRADE_BUDGET_INR;

  // Real-time client pre-validation warnings
  const clientWarnings = useMemo(() => {
    const list: string[] = [];
    if (!selectedSymbol) list.push('Please select a valid instrument.');
    if (parsedQty <= 0) list.push('Quantity must be greater than zero.');
    if (currentInstrument && currentInstrument.lotSize > 1) {
      if (parsedQty % currentInstrument.lotSize !== 0) {
        list.push(`Quantity must be a multiple of lot size (${currentInstrument.lotSize}).`);
      }
    }
    if (orderType === 'LIMIT' && parsedPrice <= 0) {
      list.push('LIMIT order requires a positive price.');
    }
    if (isBudgetExceeded) {
      list.push(`Estimated outlay of ₹${totalEstimatedOutlay.toFixed(2)} exceeds ₹${SMALL_TRADE_BUDGET_INR.toFixed(2)} Small Trade Budget limit.`);
    }
    const sl = parseFloat(stopLoss);
    if (!isNaN(sl) && sl > 0 && parsedPrice > 0) {
      if (side === 'BUY' && sl >= parsedPrice) {
        list.push(`Stop Loss (${sl}) must be below price (${parsedPrice}) for BUY orders.`);
      } else if (side === 'SELL' && sl <= parsedPrice) {
        list.push(`Stop Loss (${sl}) must be above price (${parsedPrice}) for SELL orders.`);
      }
    }
    const tp = parseFloat(takeProfit);
    if (!isNaN(tp) && tp > 0 && parsedPrice > 0) {
      if (side === 'BUY' && tp <= parsedPrice) {
        list.push(`Take Profit (${tp}) must be above price (${parsedPrice}) for BUY orders.`);
      } else if (side === 'SELL' && tp >= parsedPrice) {
        list.push(`Take Profit (${tp}) must be below price (${parsedPrice}) for SELL orders.`);
      }
    }
    if (account?.killSwitchHalted) {
      list.push('EMERGENCY KILL SWITCH IS ACTIVE: Manual trading is locked.');
    }
    return list;
  }, [selectedSymbol, parsedQty, currentInstrument, orderType, parsedPrice, isBudgetExceeded, totalEstimatedOutlay, stopLoss, takeProfit, side, account]);

  // Countdown timer for pending authorization
  useEffect(() => {
    if (!prepareResult?.expiresAt) {
      setSecondsRemaining(0);
      return;
    }
    const updateCountdown = () => {
      const diff = Math.max(0, Math.floor((prepareResult.expiresAt! - Date.now()) / 1000));
      setSecondsRemaining(diff);
      if (diff <= 0) {
        setPrepareResult(null);
        setSubmissionError('Authorization expired (2-minute TTL elapsed). Please review and prepare the trade again.');
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [prepareResult]);

  // Handle Step 1: Prepare & Validate Trade
  const handlePrepareTrade = async () => {
    setPreparing(true);
    setSubmissionError(null);
    setConfirmResult(null);
    setOperatorConfirmed(false);

    try {
      const body = {
        broker: account?.broker,
        symbol: selectedSymbol,
        side,
        orderType,
        quantity: parsedQty,
        price: orderType === 'LIMIT' ? parsedPrice : undefined,
        stopLoss: parseFloat(stopLoss) || undefined,
        takeProfit: parseFloat(takeProfit) || undefined,
        exchange: currentInstrument?.exchange,
        segment: currentInstrument?.segment,
        operatorNotes: operatorNotes.trim() || undefined
      };

      const res = await fetch('/api/manual-trade/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data: PrepareResult = await res.json();
      if (!res.ok || !data.ready) {
        setPrepareResult(data);
        setSubmissionError(data.rejectionReasons?.join(' | ') || 'Validation rejected by risk gate.');
      } else {
        setPrepareResult(data);
      }
    } catch (err: any) {
      setSubmissionError(err.message || 'Network error preparing manual trade.');
    } finally {
      setPreparing(false);
    }
  };

  // Handle Step 2: Confirm & Execute Trade
  const handleConfirmAndExecute = async () => {
    if (!prepareResult?.authorizationId || !prepareResult?.authorizationToken || !prepareResult.review) {
      setSubmissionError('No active authorization found. Please prepare the trade first.');
      return;
    }
    if (!operatorConfirmed) {
      setSubmissionError('You must explicitly toggle operator confirmation before submitting live order.');
      return;
    }

    setSubmitting(true);
    setSubmissionError(null);

    try {
      const review = prepareResult.review;
      const body = {
        authorizationId: prepareResult.authorizationId,
        authorizationToken: prepareResult.authorizationToken,
        confirmedTrade: {
          broker: review.broker,
          symbol: review.symbol,
          side: review.side,
          orderType: review.orderType,
          quantity: review.quantity,
          price: review.price,
          stopLoss: review.stopLoss ?? undefined,
          takeProfit: review.takeProfit ?? undefined,
          exchange: review.exchange,
          exchangeType: review.exchangeType,
          scripCode: review.scripCode
        },
        operatorConfirmed: true
      };

      const res = await fetch('/api/manual-trade/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data: ConfirmResult = await res.json();
      if (!res.ok || !data.success) {
        setSubmissionError(data.error || data.message || `Execution failed (HTTP ${res.status})`);
      } else {
        setConfirmResult(data);
        setPrepareResult(null); // Consumed
        fetchAccount();
        fetchRecent();
      }
    } catch (err: any) {
      setSubmissionError(err.message || 'Execution error during manual order transmission.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setPrepareResult(null);
    setConfirmResult(null);
    setSubmissionError(null);
    setOperatorConfirmed(false);
  };

  return (
    <div className="space-y-6">
      {/* SECTION HEADER & INDEPENDENT EXECUTION STATUS */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2.5">
              <span className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
                <Send className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-lg font-black text-white tracking-wide flex items-center gap-2">
                  MANUAL SINGLE-TRADE INTERFACE
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    PHASE C
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Dedicated, independent single-trade execution with isolated cryptographic authorization.
                </p>
              </div>
            </div>
          </div>

          {/* ISOLATED EXECUTION GATE BADGES */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center space-x-2">
              <Lock className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-slate-400">Autonomous Gate:</span>
              <span className="font-mono font-bold text-rose-400">LOCKED (Independent)</span>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center space-x-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Small Budget:</span>
              <span className="font-mono font-bold text-emerald-400">₹{SMALL_TRADE_BUDGET_INR.toFixed(2)} Limit</span>
            </div>

            <button
              onClick={() => { fetchAccount(); fetchRecent(); }}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Refresh Broker Account & Status"
            >
              <RefreshCw className={`w-4 h-4 ${loadingAccount ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* BROKER & ACCOUNT IDENTIFICATION CARD */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Active Broker</span>
            <span className="font-bold text-white flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              {account?.broker || 'LOADING...'}
            </span>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Masked Account</span>
            <span className="font-mono font-bold text-slate-200 mt-0.5 block">
              {account?.maskedAccountId || '••••••••'}
            </span>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Available Funds</span>
            <span className="font-mono font-bold text-emerald-400 mt-0.5 block">
              {account?.currency === 'INR' ? '₹' : '$'}
              {account ? Number(account.availableMargin ?? account.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
            </span>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Live Permission</span>
            <span className={`font-bold mt-0.5 block ${account?.tradingPermission ? 'text-emerald-400' : 'text-rose-400'}`}>
              {account?.tradingPermission ? 'ACTIVE (TRADING)' : 'RESTRICTED'}
            </span>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60 col-span-2 md:col-span-1">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Kill Switch</span>
            <span className={`font-bold mt-0.5 block ${account?.killSwitchHalted ? 'text-rose-400' : 'text-emerald-400'}`}>
              {account?.killSwitchHalted ? 'HALTED (BLOCKED)' : 'CLEAR (NORMAL)'}
            </span>
          </div>
        </div>

        {accountError && (
          <div className="mt-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 shrink-0" />
            <span>{accountError}</span>
          </div>
        )}
      </div>

      {/* EMERGENCY STOP NOTIFICATION IF HALTED */}
      {account?.killSwitchHalted && (
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-500 text-rose-200 text-xs flex items-center space-x-3 shadow-lg">
          <AlertOctagon className="w-6 h-6 text-rose-400 shrink-0 animate-pulse" />
          <div>
            <div className="font-bold text-sm">EMERGENCY KILL SWITCH IS ACTIVE</div>
            <div>All manual live order submissions are strictly halted until the emergency stop is cleared by the operator.</div>
          </div>
        </div>
      )}

      {/* CONFIRMED SUBMISSION RESULT BANNER */}
      {confirmResult && (
        <div className="p-5 rounded-xl bg-emerald-950/40 border border-emerald-500/60 text-emerald-200 shadow-xl space-y-3">
          <div className="flex items-center space-x-2.5 text-base font-bold text-emerald-300">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            <span>ORDER SUBMITTED & ACCEPTED BY BROKER</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs text-slate-300">
            <div className="bg-slate-950/80 p-2 rounded border border-emerald-500/20">
              <span className="text-slate-500 text-[10px] block">Broker Order ID</span>
              <span className="font-bold text-white text-sm">{confirmResult.brokerOrderId}</span>
            </div>
            <div className="bg-slate-950/80 p-2 rounded border border-emerald-500/20">
              <span className="text-slate-500 text-[10px] block">Reconciliation Status</span>
              <span className="font-bold text-emerald-400">{confirmResult.reconciled ? 'CONFIRMED' : 'PENDING'}</span>
            </div>
            <div className="bg-slate-950/80 p-2 rounded border border-emerald-500/20">
              <span className="text-slate-500 text-[10px] block">Terminal Status</span>
              <span className="font-bold text-white">{confirmResult.status}</span>
            </div>
            <div className="bg-slate-950/80 p-2 rounded border border-emerald-500/20">
              <span className="text-slate-500 text-[10px] block">Timestamp</span>
              <span className="text-slate-300">{confirmResult.executedAt ? new Date(confirmResult.executedAt).toLocaleTimeString() : 'NOW'}</span>
            </div>
          </div>
          <p className="text-xs text-slate-300">{confirmResult.message}</p>
          <div className="pt-2">
            <button
              onClick={handleReset}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition"
            >
              Configure Next Trade
            </button>
          </div>
        </div>
      )}

      {/* MAIN TWO-COLUMN CONFIGURATION & REVIEW INTERFACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: ORDER CONFIGURATION FORM (7 COLS) */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              CONFIGURE SINGLE TRADE
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              {currentInstrument?.segment || 'EQUITY'} · {currentInstrument?.exchange || 'NSE'}
            </span>
          </div>

          {/* 1. INSTRUMENT SELECTION & SEARCH */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Instrument</span>
              <span className="text-[11px] text-slate-500">Authoritative metadata</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter instruments (e.g. NIFTY, RELIANCE, EUR/USD)..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    fetchInstruments(e.target.value);
                  }}
                  className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <select
              value={selectedSymbol}
              onChange={(e) => handleSelectSymbol(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
            >
              {instruments.map(inst => (
                <option key={inst.symbol} value={inst.symbol}>
                  {inst.symbol} ({inst.name}) · Lot: {inst.lotSize} · Scrip: {inst.scripCode}
                </option>
              ))}
            </select>

            {currentInstrument && (
              <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
                <span>Lot: <strong className="text-white">{currentInstrument.lotSize}</strong></span>
                <span>Tick: <strong className="text-white">{currentInstrument.tickSize}</strong></span>
                <span>Scrip: <strong className="text-white">{currentInstrument.scripCode}</strong></span>
                <span>Segment: <strong className="text-emerald-400">{currentInstrument.segment}</strong></span>
              </div>
            )}
          </div>

          {/* 2. SIDE & ORDER TYPE */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">Side</label>
              <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => { setSide('BUY'); setPrepareResult(null); }}
                  className={`py-1.5 text-xs font-bold rounded transition ${
                    side === 'BUY'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => { setSide('SELL'); setPrepareResult(null); }}
                  className={`py-1.5 text-xs font-bold rounded transition ${
                    side === 'SELL'
                      ? 'bg-rose-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  SELL
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">Order Type</label>
              <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => { setOrderType('LIMIT'); setPrepareResult(null); }}
                  className={`py-1.5 text-xs font-bold rounded transition ${
                    orderType === 'LIMIT'
                      ? 'bg-slate-700 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  LIMIT
                </button>
                <button
                  type="button"
                  onClick={() => { setOrderType('MARKET'); setPrepareResult(null); }}
                  className={`py-1.5 text-xs font-bold rounded transition ${
                    orderType === 'MARKET'
                      ? 'bg-slate-700 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  MARKET
                </button>
              </div>
            </div>
          </div>

          {/* 3. QUANTITY & PRICE */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Quantity
                {currentInstrument?.lotSize && currentInstrument.lotSize > 1 && (
                  <span className="text-[10px] text-amber-400 ml-1">
                    (Multiples of {currentInstrument.lotSize})
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  step={currentInstrument?.lotSize || 1}
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(parseInt(e.target.value) || 0);
                    setPrepareResult(null);
                  }}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
                {currentInstrument?.lotSize && (
                  <div className="text-[10px] text-slate-500 mt-1 font-mono">
                    = {currentInstrument.lotSize > 0 ? (quantity / currentInstrument.lotSize).toFixed(1) : 1} lot(s)
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                {orderType === 'LIMIT' ? 'Limit Price (₹)' : 'Estimated Market Price (₹)'}
              </label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                disabled={orderType === 'MARKET'}
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setPrepareResult(null);
                }}
                className={`w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500 ${
                  orderType === 'MARKET' ? 'opacity-60 cursor-not-allowed' : ''
                }`}
                placeholder="0.50"
              />
              <div className="text-[10px] text-slate-500 mt-1">
                {orderType === 'MARKET' ? 'Fetched from live quote on review' : 'Exact limit order price'}
              </div>
            </div>
          </div>

          {/* 4. RISK CONTROLS: STOP LOSS & TAKE PROFIT */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Stop Loss (Optional)
              </label>
              <input
                type="number"
                step="0.05"
                placeholder="None"
                value={stopLoss}
                onChange={(e) => {
                  setStopLoss(e.target.value);
                  setPrepareResult(null);
                }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Take Profit (Optional)
              </label>
              <input
                type="number"
                step="0.05"
                placeholder="None"
                value={takeProfit}
                onChange={(e) => {
                  setTakeProfit(e.target.value);
                  setPrepareResult(null);
                }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* 5. OPERATOR NOTES */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              Operator Audit Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Single-trade manual verification test"
              value={operatorNotes}
              onChange={(e) => setOperatorNotes(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* CLIENT WARNINGS LIST */}
          {clientWarnings.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Pre-Validation Findings:
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-200/90 pl-1">
                {clientWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ACTION BUTTON: PREPARE & VALIDATE */}
          <div className="pt-2">
            <button
              type="button"
              disabled={preparing || clientWarnings.length > 0 || account?.killSwitchHalted}
              onClick={handlePrepareTrade}
              className={`w-full py-2.5 rounded-lg font-bold text-xs transition flex items-center justify-center space-x-2 ${
                preparing || clientWarnings.length > 0 || account?.killSwitchHalted
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30'
              }`}
            >
              {preparing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Validating Against Broker & Safety Controls...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Review Trade & Request Execution Authorization</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: OUTLAY BREAKDOWN & IMMUTABLE CONFIRMATION (5 COLS) */}
        <div className="lg:col-span-5 space-y-4">
          {/* SMALL TRADE BUDGET & OUTLAY CARD */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                SMALL TRADE BUDGET ESTIMATE
              </h3>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                isBudgetExceeded
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
              }`}>
                {isBudgetExceeded ? 'BUDGET EXCEEDED' : 'WITHIN BUDGET'}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-400">
                <span>Raw Trade Value ({quantity} × ₹{price}):</span>
                <span className="font-mono font-bold text-white">₹{rawOrderValue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Estimated Statutory & Broker Charges:</span>
                <span className="font-mono text-slate-300">+₹{estimatedCharges.toFixed(2)}</span>
              </div>
              <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                <span className="font-bold text-slate-200">Total Estimated Outlay:</span>
                <span className={`font-mono text-base font-black ${
                  isBudgetExceeded ? 'text-rose-400' : 'text-emerald-400'
                }`}>
                  ₹{totalEstimatedOutlay.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center text-[11px] text-slate-500">
                <span>Budget Cap (Enforced Fail-Closed):</span>
                <span className="font-mono font-bold text-slate-400">₹{SMALL_TRADE_BUDGET_INR.toFixed(2)}</span>
              </div>
            </div>

            {/* Budget Progress Bar */}
            <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-300 ${
                  isBudgetExceeded ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, (totalEstimatedOutlay / SMALL_TRADE_BUDGET_INR) * 100)}%` }}
              ></div>
            </div>

            {isBudgetExceeded && (
              <p className="text-[11px] text-rose-400 leading-tight">
                Outlay exceeds ₹20.00. Automatic substitutions or lot alterations are disallowed. Adjust instrument or quantity to fit within budget.
              </p>
            )}
          </div>

          {/* IMMUTABLE CONFIRMATION REVIEW CARD (Appears when prepared) */}
          {prepareResult?.ready && prepareResult.review && (
            <div className="bg-slate-900 border-2 border-emerald-500/60 rounded-xl p-5 shadow-2xl space-y-4 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span className="font-bold text-sm text-white">TRADE READY FOR CONFIRMATION</span>
                </div>
                <div className="flex items-center space-x-1 font-mono text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{secondsRemaining}s TTL</span>
                </div>
              </div>

              {/* REVIEW DETAILS TABLE */}
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">Broker & Account:</span>
                  <span className="text-white font-bold">{prepareResult.review.broker} ({prepareResult.review.accountId})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">Instrument:</span>
                  <span className="text-emerald-400 font-bold">{prepareResult.review.symbol}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">Action:</span>
                  <span className={`font-bold ${prepareResult.review.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {prepareResult.review.side} {prepareResult.review.orderType}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">Quantity & Lots:</span>
                  <span className="text-white">{prepareResult.review.quantity} ({prepareResult.review.lotCount} lot)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">Price:</span>
                  <span className="text-white font-bold">₹{prepareResult.review.price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-500">Total Outlay:</span>
                  <span className="text-emerald-400 font-black">₹{prepareResult.review.totalEstimatedOutlay.toFixed(2)}</span>
                </div>
              </div>

              {/* CRYPTOGRAPHIC FINGERPRINT */}
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="text-[10px] font-semibold text-slate-400 flex items-center justify-between">
                  <span>Cryptographic Fingerprint (SHA-256):</span>
                  <span className="text-emerald-400">Canonical Binding</span>
                </div>
                <div className="font-mono text-[10px] text-slate-300 break-all select-all">
                  {prepareResult.fingerprint}
                </div>
              </div>

              {/* SAFETY WARNING STATEMENT */}
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-[11px] leading-relaxed">
                {prepareResult.review.warningStatement}
              </div>

              {/* EXPLICIT OPERATOR CONFIRMATION CHECKBOX */}
              <label className="flex items-start space-x-2.5 text-xs text-slate-200 select-none cursor-pointer bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                <input
                  type="checkbox"
                  checked={operatorConfirmed}
                  onChange={(e) => setOperatorConfirmed(e.target.checked)}
                  className="mt-0.5 rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                />
                <span className="leading-snug">
                  I explicitly confirm submission of this live broker order. I understand this transmits an order to the active broker.
                </span>
              </label>

              {/* SUBMISSION ERROR IF ANY */}
              {submissionError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500 text-rose-300 text-xs flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4 shrink-0" />
                  <span>{submissionError}</span>
                </div>
              )}

              {/* CONFIRMATION SUBMIT BUTTON */}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={submitting || !operatorConfirmed}
                  onClick={handleConfirmAndExecute}
                  className={`flex-1 py-3 rounded-lg font-bold text-xs transition flex items-center justify-center space-x-2 ${
                    submitting || !operatorConfirmed
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl shadow-emerald-900/40'
                  }`}
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Submitting Order to {prepareResult.review.broker}...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Confirm & Transmit Real Live Order</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  className="px-3 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RECENT MANUAL TRADE AUTHORIZATIONS TABLE */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-xs font-bold text-white flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-emerald-400" />
            MANUAL TRADE AUTHORIZATION & EXECUTION AUDIT LOG
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">
            {recentTrades.length} Authorizations Tracked in SQLite
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 text-[10px] uppercase">
                <th className="py-2 px-3">Time</th>
                <th className="py-2 px-3">Auth ID</th>
                <th className="py-2 px-3">Broker</th>
                <th className="py-2 px-3">Instrument</th>
                <th className="py-2 px-3">Side</th>
                <th className="py-2 px-3">Qty</th>
                <th className="py-2 px-3">Price</th>
                <th className="py-2 px-3">Outlay</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Broker Order ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {recentTrades.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-slate-500 font-sans">
                    No manual trade authorizations recorded yet.
                  </td>
                </tr>
              ) : (
                recentTrades.map((trade) => (
                  <tr key={trade.id} className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                      {new Date(trade.created_at).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3 text-slate-400 text-[11px]">
                      {trade.id.slice(0, 12)}...
                    </td>
                    <td className="py-2 px-3 font-semibold text-white">
                      {trade.broker}
                    </td>
                    <td className="py-2 px-3 font-semibold text-emerald-400">
                      {trade.symbol}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        trade.side === 'BUY'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {trade.side}
                      </span>
                    </td>
                    <td className="py-2 px-3">{trade.quantity}</td>
                    <td className="py-2 px-3">₹{trade.price.toFixed(2)}</td>
                    <td className="py-2 px-3 font-bold text-white">₹{trade.estimated_outlay.toFixed(2)}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        trade.status === 'FILLED' || trade.status === 'ACCEPTED'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : trade.status === 'PENDING_CONFIRMATION'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          : trade.status === 'RESERVED'
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      }`}>
                        {trade.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-400 text-[11px]">
                      {trade.broker_order_id || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
