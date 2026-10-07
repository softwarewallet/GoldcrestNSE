import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  IndianRupee,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
  Check,
  ChevronRight,
  MousePointerClick,
  Sliders,
  Filter
} from 'lucide-react';
import { SmallTradeBudgetModal } from './SmallTradeBudgetModal';

type OptionType = 'CALL' | 'PUT';

interface OptionContract {
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionType: OptionType;
  lotSize: number;
  tickSize: number;
  contractMultiplier: number;
  ltp: number;
  change: number;
  changePercent: number;
  oi: number;
  changeOI: number;
  volume: number;
  bid: number;
  ask: number;
  spread: number;
  iv: number;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
    iv: number;
    modelDerived: boolean;
  };
  isATM?: boolean;
  isITM?: boolean;
}

interface OptionChainStrikeRow {
  strike: number;
  isATM: boolean;
  distanceFromAtm: number;
  call: OptionContract;
  put: OptionContract;
}

interface OptionChainSummary {
  underlying: string;
  spotPrice: number;
  atmStrike: number;
  expiry: string;
  availableExpiries: string[];
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;
  callResistanceStrike: number;
  putSupportStrike: number;
  rows: OptionChainStrikeRow[];
  isBlank?: boolean;
  error?: string;
  timestamp: number;
}

interface OptionsOpportunity {
  id: string;
  underlying: string;
  spot: number;
  strategyType: string;
  title: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  mlProbability: number | null;
  entryPremium: number;
  maxLoss: number;
  maxProfit: number;
  breakeven: number[];
  riskReward: number;
  status: 'LONG_CALL' | 'LONG_PUT' | 'BULL_CALL_SPREAD' | 'BEAR_PUT_SPREAD' | 'WAIT' | 'NO_TRADE';
  reasons: string[];
  invalidation: string[];
  expiry: string;
  optionType: OptionType;
  strike: number;
  contractSymbol: string;
  lotSize: number;
  liveBid: number;
  liveAsk: number;
  liveLtp: number;
}

interface OptionsScannerResponse {
  underlying: string;
  spot: number;
  bias: 'Bullish' | 'Bearish' | 'Range-bound';
  pcr: number;
  opportunities: OptionsOpportunity[];
  isBlank?: boolean;
  error?: string;
}

interface OptionsTradingPanelProps {
  isEmergencyHalted: boolean;
  onPositionsRefresh?: () => void;
  onLog?: (type: 'info' | 'success' | 'error' | 'warning' | 'nlp', message: string) => void;
}

const SUPPORTED_UNDERLYINGS = [
  { symbol: 'NIFTY', name: 'NIFTY 50', exchange: 'NSE', lotSize: 25 },
  { symbol: 'BANKNIFTY', name: 'NIFTY BANK', exchange: 'NSE', lotSize: 15 },
  { symbol: 'FINNIFTY', name: 'NIFTY FINANCIAL SERVICES', exchange: 'NSE', lotSize: 25 },
  { symbol: 'MIDCPNIFTY', name: 'NIFTY MIDCAP SELECT', exchange: 'NSE', lotSize: 50 },
  { symbol: 'SENSEX', name: 'BSE SENSEX 30', exchange: 'BSE', lotSize: 10 }
];

const num = (value: number, digits = 2) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';

const money = (value: number) =>
  Number.isFinite(value)
    ? '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

const oi = (value: number) =>
  Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—';

const biasClass = (bias: OptionsScannerResponse['bias']) =>
  bias === 'Bullish'
    ? 'text-emerald-300 border-emerald-800 bg-emerald-950/30'
    : bias === 'Bearish'
      ? 'text-rose-300 border-rose-800 bg-rose-950/30'
      : 'text-amber-300 border-amber-800 bg-amber-950/30';

export const OptionsTradingPanel: React.FC<OptionsTradingPanelProps> = ({
  isEmergencyHalted,
  onPositionsRefresh,
  onLog
}) => {
  const [underlying, setUnderlying] = useState('NIFTY');
  const [expiry, setExpiry] = useState('');
  const [scanner, setScanner] = useState<OptionsScannerResponse | null>(null);
  const [chain, setChain] = useState<OptionChainSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Micro F&O Test Order State
  const [selectedTestContract, setSelectedTestContract] = useState<OptionContract | null>(null);
  const [testOrderSide, setTestOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [testExecuting, setTestExecuting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [budgetInr, setBudgetInr] = useState<number>(20);
  const [budgetEnabled, setBudgetEnabled] = useState<boolean>(true);
  const [filterBudgetOnly, setFilterBudgetOnly] = useState<boolean>(false);
  const [showBudgetModal, setShowBudgetModal] = useState<boolean>(false);

  // Fetch small trade budget settings from /api/config
  const fetchBudgetConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          if (data.smallTradeBudgetInr !== undefined && Number(data.smallTradeBudgetInr) > 0) {
            setBudgetInr(Number(data.smallTradeBudgetInr));
          }
          if (data.smallTradeBudgetEnabled !== undefined) {
            setBudgetEnabled(Boolean(data.smallTradeBudgetEnabled));
          }
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchBudgetConfig();
  }, [fetchBudgetConfig]);

  const activeUnderlyingConfig = useMemo(() => {
    return SUPPORTED_UNDERLYINGS.find(u => u.symbol === underlying) || SUPPORTED_UNDERLYINGS[0];
  }, [underlying]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = expiry ? `?expiry=${encodeURIComponent(expiry)}&depth=7` : '?depth=7';
      const [scannerRes, chainRes] = await Promise.all([
        fetch(`/api/options/scanner/${encodeURIComponent(underlying)}${query}`, { cache: 'no-store' }),
        fetch(`/api/options/chain/${encodeURIComponent(underlying)}${query}`, { cache: 'no-store' })
      ]);

      const scannerData = await scannerRes.json();
      const chainData = await chainRes.json();

      if (!scannerRes.ok || scannerData?.isBlank) {
        throw new Error(scannerData?.error || 'Live option scanner data is unavailable.');
      }
      if (!chainRes.ok || chainData?.isBlank) {
        throw new Error(chainData?.error || 'Live option-chain data is unavailable.');
      }

      setScanner(scannerData);
      setChain(chainData);
      setLastLoadedAt(Date.now());

      const returnedExpiry = String(scannerData?.expiry || chainData?.expiry || '');
      if (!expiry && returnedExpiry) setExpiry(returnedExpiry);
      if (
        returnedExpiry &&
        Array.isArray(chainData?.availableExpiries) &&
        chainData.availableExpiries.includes(returnedExpiry) &&
        expiry &&
        expiry !== returnedExpiry
      ) {
        setExpiry(returnedExpiry);
      }

      // If no test contract is selected yet, default to an OTM or ATM contract for small testing
      if (!selectedTestContract && chainData?.rows?.length) {
        const atm = chainData.rows.find((r: any) => r.isATM) || chainData.rows[0];
        if (atm) setSelectedTestContract(atm.call);
      }
    } catch (err: any) {
      setScanner(null);
      setChain(null);
      setError(err?.message || 'Unable to load live option-chain data.');
    } finally {
      setLoading(false);
    }
  }, [underlying, expiry, selectedTestContract]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const executableOpportunity = useMemo(() => {
    const candidates = scanner?.opportunities || [];
    return candidates.find(item => item.status === 'LONG_CALL' || item.status === 'LONG_PUT') || null;
  }, [scanner]);

  const executableContract = useMemo(() => {
    if (!executableOpportunity || !chain) return null;
    const row = chain.rows.find(item => item.strike === executableOpportunity.strike);
    if (!row) return null;
    return executableOpportunity.optionType === 'CALL' ? row.call : row.put;
  }, [executableOpportunity, chain]);

  const triggerNow = async (opportunity: OptionsOpportunity) => {
    if (isEmergencyHalted) {
      setNotification({ type: 'error', message: 'Trading is halted by the operator emergency stop.' });
      return;
    }

    if (opportunity.status !== 'LONG_CALL' && opportunity.status !== 'LONG_PUT') {
      setNotification({
        type: 'error',
        message: 'Only the executable single-leg CALL/PUT setup can be triggered from this panel.'
      });
      return;
    }

    if (!opportunity.contractSymbol || !(opportunity.lotSize > 0)) {
      setNotification({ type: 'error', message: 'Exact 5paisa option contract metadata is unavailable.' });
      return;
    }

    setTriggeringId(opportunity.id);
    setNotification(null);

    const idempotencyKey = `OPTION:${opportunity.underlying}:${opportunity.contractSymbol}:${crypto.randomUUID()}`;
    const entryReference = opportunity.liveAsk > 0 ? opportunity.liveAsk : opportunity.liveLtp;

    onLog?.(
      'nlp',
      `[OPTION DISPATCH] Trigger Now → ${opportunity.underlying} ${opportunity.optionType} ${opportunity.strike} @ ~₹${entryReference.toFixed(2)}`
    );

    try {
      const payload = {
        market: 'INDIAN_OPTIONS',
        symbol: opportunity.contractSymbol,
        side: 'BUY',
        orderType: 'MARKET',
        quantity: opportunity.lotSize,
        environment: 'LIVE',
        signalId: idempotencyKey,
        executionSource: 'OPTION_CHAIN_TRIGGER_NOW'
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        const details = Array.isArray(data?.details) && data.details.length
          ? ` (${data.details.join(', ')})`
          : '';
        throw new Error((data?.error || data?.message || 'Option order rejected.') + details);
      }

      const executionStatus = String(data?.order?.status || data?.executionState || 'SUBMITTED').toUpperCase();
      const orderRef = data?.order?.id || data?.executionId || idempotencyKey;

      onLog?.(
        executionStatus === 'FILLED' || executionStatus === 'EXECUTED' ? 'success' : 'info',
        `[OPTION ORDER] ${opportunity.contractSymbol} BUY ${opportunity.lotSize.toLocaleString()} → ${executionStatus} (${orderRef})`
      );

      setNotification({
        type: 'success',
        message: `${opportunity.contractSymbol} BUY submitted. Broker status: ${executionStatus}. Ref: ${orderRef}`
      });

      onPositionsRefresh?.();
      void load();
    } catch (err: any) {
      const message = err?.message || 'Option order dispatch failed.';
      onLog?.('error', `[OPTION DISPATCH ERROR] ${opportunity.contractSymbol}: ${message}`);
      setNotification({ type: 'error', message });
    } finally {
      setTriggeringId(null);
    }
  };

  // Micro F&O Small Trade Execution (₹10 - ₹20 Testing)
  const handleMicroTestOrder = async () => {
    if (!selectedTestContract) return;
    if (isEmergencyHalted) {
      setNotification({ type: 'error', message: 'Trading is halted by the operator emergency stop.' });
      return;
    }

    setTestExecuting(true);
    setTestResult(null);

    const lotQty = selectedTestContract.lotSize || activeUnderlyingConfig.lotSize;
    const refPrice = selectedTestContract.ask > 0 ? selectedTestContract.ask : selectedTestContract.ltp;
    const totalOutlay = lotQty * refPrice;
    const idempotencyKey = `MICRO_TEST:${underlying}:${selectedTestContract.symbol}:${Date.now()}`;

    if (budgetEnabled && totalOutlay > budgetInr + 0.0001) {
      setNotification({
        type: 'error',
        message: `Budget Cap Block: Trade outlay of ₹${totalOutlay.toFixed(2)} exceeds the active Small Trade Budget of ₹${budgetInr.toFixed(2)}. Select an OTM strike or adjust budget in Settings.`
      });
      setTestExecuting(false);
      return;
    }

    onLog?.(
      'info',
      `[MICRO F&O TEST] Dispatching 1 lot (${lotQty} units) ${selectedTestContract.symbol} ${testOrderSide} @ ₹${refPrice.toFixed(2)} (Estimated Outlay: ₹${totalOutlay.toFixed(2)})`
    );

    try {
      const payload = {
        market: 'INDIAN_OPTIONS',
        symbol: selectedTestContract.symbol,
        side: testOrderSide,
        orderType: 'MARKET',
        quantity: lotQty,
        environment: 'LIVE',
        signalId: idempotencyKey,
        executionSource: 'MICRO_TEST_RUNNER'
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || data?.message || '5paisa rejected micro test order');
      }

      setTestResult({
        success: true,
        order: data.order,
        brokerOrderId: data.order?.brokerOrderId || data.order?.id,
        status: data.order?.status || 'ACCEPTED',
        timestamp: Date.now(),
        contract: selectedTestContract.symbol,
        totalOutlay
      });

      setNotification({
        type: 'success',
        message: `Micro Test Order placed! 5paisa Order ID: ${data.order?.brokerOrderId || data.order?.id}`
      });

      onPositionsRefresh?.();
      void load();
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.message || 'Micro test order failed',
        timestamp: Date.now()
      });
      setNotification({
        type: 'error',
        message: `Micro Test Failed: ${err.message}`
      });
    } finally {
      setTestExecuting(false);
    }
  };

  const rows = chain?.rows || [];

  return (
    <div className="space-y-4 font-sans text-slate-100">
      {/* Top Selector & NIFTY Family Header */}
      <div className="bg-[#04121f] border border-cyan-900/60 rounded-xl p-4 md:p-5 shadow-lg">
        <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-cyan-400" />
              <h2 className="text-base font-bold text-white tracking-wide">
                NIFTY Family Option Chain &amp; F&amp;O Trading
              </h2>
              <span className="px-2 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800 text-[10px] font-mono font-semibold">
                ALL NIFTIES F&amp;O
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Live 5paisa option-chain execution for NIFTY 50, BANK NIFTY, FIN NIFTY, and MIDCAP NIFTY.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2.5">
            <label className="block">
              <span className="block text-[10px] uppercase text-slate-400 font-mono mb-1 font-semibold">Underlying Index</span>
              <select
                value={underlying}
                onChange={e => {
                  setUnderlying(e.target.value);
                  setExpiry('');
                  setNotification(null);
                  setSelectedTestContract(null);
                }}
                className="min-w-[220px] px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-xs font-mono font-bold focus:border-cyan-500 transition cursor-pointer"
              >
                {SUPPORTED_UNDERLYINGS.map(item => (
                  <option key={item.symbol} value={item.symbol}>
                    {item.symbol} · {item.name} (Lot: {item.lotSize})
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-[10px] uppercase text-slate-400 font-mono mb-1 font-semibold">Contract Expiry</span>
              <select
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
                disabled={!chain?.availableExpiries?.length}
                className="min-w-[180px] px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-xs font-mono focus:border-cyan-500 transition cursor-pointer disabled:opacity-50"
              >
                {(chain?.availableExpiries || []).map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold font-mono transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>REFRESH</span>
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div
          className={`p-4 rounded-xl border text-xs font-mono flex items-center justify-between gap-3 ${
            notification.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : notification.type === 'error'
              ? 'bg-rose-950/40 border-rose-800 text-rose-300'
              : 'bg-blue-950/40 border-blue-800 text-blue-300'
          }`}
        >
          <span>{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-white text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="bg-rose-950/30 border border-rose-800 rounded-xl p-4 text-xs font-mono text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Micro F&O Test Runner (Small ₹10 - ₹20 Trades Testing) */}
      <div className="bg-[#030d17] border border-amber-500/40 rounded-xl p-4 md:p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  Micro F&amp;O Small Trade Tester (₹10 – ₹20 Testing)
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[9px] font-mono font-bold">
                  APP FUNCTIONALITY VERIFICATION
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Execute 1-lot micro-value option trades on 5paisa to test end-to-end order placement, broker response, and position updates with minimal risk.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <button
              type="button"
              onClick={() => setShowBudgetModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-950/30 hover:bg-amber-900/40 text-amber-300 font-mono text-[11px] font-bold transition cursor-pointer"
              title="Click to change small trade budget cap"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Budget: ₹{budgetInr} INR</span>
              <span className={`px-1 py-0.2 rounded text-[8.5px] ${budgetEnabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {budgetEnabled ? 'ENFORCED' : 'OFF'}
              </span>
            </button>
            <span className="text-slate-400">Exchange Lot:</span>
            <span className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-cyan-300 font-bold">
              {activeUnderlyingConfig.lotSize} Units ({underlying})
            </span>
          </div>
        </div>

        {/* Selected Test Contract Box */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 font-mono text-xs">
          <div>
            <div className="text-[10px] uppercase text-slate-500">Selected Contract</div>
            <div className="text-sm font-bold text-cyan-300 mt-1 truncate" title={selectedTestContract?.symbol || 'Select from chain'}>
              {selectedTestContract?.symbol || `${underlying} Option Strike`}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {selectedTestContract ? `${selectedTestContract.strike} ${selectedTestContract.optionType}` : 'Click any strike below'}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase text-slate-500">Premium (Ref Price)</div>
            <div className="text-sm font-bold text-white mt-1">
              {selectedTestContract ? money(selectedTestContract.ask || selectedTestContract.ltp) : '—'}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Bid: {selectedTestContract ? money(selectedTestContract.bid) : '—'}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase text-slate-500">Estimated Total Outlay</div>
            <div className="text-base font-extrabold text-amber-400 mt-0.5 flex items-center gap-1 flex-wrap">
              <IndianRupee className="w-4 h-4" />
              <span>
                {selectedTestContract
                  ? ((selectedTestContract.lotSize || activeUnderlyingConfig.lotSize) * (selectedTestContract.ask || selectedTestContract.ltp)).toFixed(2)
                  : '—'}
              </span>
              {selectedTestContract && budgetEnabled && (
                ((selectedTestContract.lotSize || activeUnderlyingConfig.lotSize) * (selectedTestContract.ask || selectedTestContract.ltp)) > budgetInr ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300 font-bold">
                    EXCEEDS CAP
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 font-bold">
                    SAFE TEST
                  </span>
                )
              )}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {activeUnderlyingConfig.lotSize} units × ₹{selectedTestContract ? (selectedTestContract.ask || selectedTestContract.ltp).toFixed(2) : '0'}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleMicroTestOrder}
              disabled={testExecuting || !selectedTestContract || isEmergencyHalted}
              className="w-full md:w-auto px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold text-xs font-mono shadow-md shadow-amber-950/50 transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Zap className={`w-3.5 h-3.5 ${testExecuting ? 'animate-spin' : ''}`} />
              <span>{testExecuting ? 'SUBMITTING TEST...' : 'SEND MICRO TEST ORDER'}</span>
            </button>
          </div>
        </div>

        {/* Test Result Execution Banner */}
        {testResult && (
          <div
            className={`p-3 rounded-xl border text-xs font-mono space-y-1 ${
              testResult.success
                ? 'bg-emerald-950/30 border-emerald-800/80 text-emerald-200'
                : 'bg-rose-950/30 border-rose-800/80 text-rose-200'
            }`}
          >
            <div className="flex items-center justify-between font-bold">
              <span>{testResult.success ? '5paisa Test Order Executed' : 'Test Order Rejected'}</span>
              <span>{new Date(testResult.timestamp).toLocaleTimeString()}</span>
            </div>
            {testResult.success ? (
              <div className="text-[11px] text-slate-300">
                Broker Order ID: <b className="text-emerald-400 font-mono">{testResult.brokerOrderId}</b> | Contract: {testResult.contract} | Outlay: ₹{testResult.totalOutlay?.toFixed(2)}
              </div>
            ) : (
              <div className="text-[11px] text-rose-300">{testResult.error}</div>
            )}
          </div>
        )}
      </div>

      {scanner && chain && (
        <>
          {/* Metrics summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-[#04121f] border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase text-slate-500 font-mono">Spot Index</div>
              <div className="text-xl font-bold text-white mt-1">{num(scanner.spot)}</div>
            </div>
            <div className="bg-[#04121f] border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase text-slate-500 font-mono">ATM Strike</div>
              <div className="text-xl font-bold text-cyan-300 mt-1">{num(chain.atmStrike, 0)}</div>
            </div>
            <div className={`rounded-xl border p-3.5 ${biasClass(scanner.bias)}`}>
              <div className="text-[10px] uppercase font-mono">System Bias</div>
              <div className="text-xl font-bold mt-1">{scanner.bias.toUpperCase()}</div>
            </div>
            <div className="bg-[#04121f] border border-slate-800 rounded-xl p-3.5">
              <div className="text-[10px] uppercase text-slate-500 font-mono">PCR (Put/Call)</div>
              <div className="text-xl font-bold text-white mt-1">{num(scanner.pcr)}</div>
            </div>
            <div className="bg-[#04121f] border border-slate-800 rounded-xl p-3.5 col-span-2 md:col-span-1">
              <div className="text-[10px] uppercase text-slate-500 font-mono">Expiry Date</div>
              <div className="text-xs font-bold text-white mt-1.5 truncate">{chain.expiry || '—'}</div>
              <div className="text-[9px] text-slate-500 mt-0.5">{lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString() : '—'}</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
            {/* Live Option Chain Table */}
            <div className="bg-[#04121f] border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-[#030e19] gap-3">
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Live Option Chain</span>
                    <span className="text-[10px] text-cyan-400 font-mono font-normal">
                      (Click row to load into Micro Test Order)
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">ATM ±7 strikes · Live 5paisa pricing</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFilterBudgetOnly(prev => !prev)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      filterBudgetOnly
                        ? 'bg-amber-600 text-white border-amber-400 shadow-md'
                        : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
                    }`}
                    title="Filter strikes with 1-lot outlay <= configured budget"
                  >
                    <Filter className="w-3 h-3" />
                    <span>Filter ≤ ₹{budgetInr} Outlay</span>
                  </button>
                  <Activity className="w-4 h-4 text-cyan-400" />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-[10px] text-slate-500 border-b border-slate-800 bg-slate-950/40">
                      <th colSpan={4} className="py-2 text-center text-emerald-400 font-bold">CALLS (CE)</th>
                      <th className="py-2 text-center text-slate-400 font-bold">STRIKE</th>
                      <th colSpan={4} className="py-2 text-center text-rose-400 font-bold">PUTS (PE)</th>
                    </tr>
                    <tr className="text-[10px] text-slate-600 border-b border-slate-800">
                      <th className="py-1.5 px-2 text-right">OI</th>
                      <th className="px-2 text-right">LTP</th>
                      <th className="px-2 text-right">IV</th>
                      <th className="px-2 text-right">Ask (Buy)</th>
                      <th className="px-2 text-center">Strike</th>
                      <th className="px-2 text-left">Ask (Buy)</th>
                      <th className="px-2 text-left">IV</th>
                      <th className="px-2 text-left">LTP</th>
                      <th className="py-1.5 px-2 text-left">OI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.filter(row => {
                      if (!filterBudgetOnly) return true;
                      const lot = row.call.lotSize || activeUnderlyingConfig.lotSize;
                      const callOutlay = lot * (row.call.ask || row.call.ltp);
                      const putOutlay = lot * (row.put.ask || row.put.ltp);
                      return callOutlay <= budgetInr || putOutlay <= budgetInr;
                    }).map(row => {
                      const recommended = executableOpportunity?.strike === row.strike;
                      const isSelectedCall = selectedTestContract?.symbol === row.call.symbol;
                      const isSelectedPut = selectedTestContract?.symbol === row.put.symbol;
                      const lot = row.call.lotSize || activeUnderlyingConfig.lotSize;
                      const callOutlay = lot * (row.call.ask || row.call.ltp);
                      const putOutlay = lot * (row.put.ask || row.put.ltp);
                      const isCallSafe = callOutlay <= budgetInr;
                      const isPutSafe = putOutlay <= budgetInr;

                      return (
                        <tr
                          key={row.strike}
                          className={`border-b border-slate-800/60 transition ${
                            row.isATM ? 'bg-cyan-950/25' : ''
                          } ${recommended ? 'ring-1 ring-inset ring-cyan-700' : ''}`}
                        >
                          <td className="text-right py-2 px-2 text-slate-400">{oi(row.call.oi)}</td>
                          <td className="text-right px-2 text-emerald-300 font-bold">{money(row.call.ltp)}</td>
                          <td className="text-right px-2 text-slate-400">{num(row.call.iv)}%</td>
                          <td className="text-right px-2">
                            <button
                              type="button"
                              onClick={() => setSelectedTestContract(row.call)}
                              className={`px-1.5 py-0.5 rounded text-[11px] font-mono transition cursor-pointer flex items-center justify-end gap-1 ml-auto ${
                                isSelectedCall
                                  ? 'bg-cyan-600 text-white font-bold'
                                  : isCallSafe
                                    ? 'text-cyan-300 hover:bg-slate-800 border border-emerald-500/30 bg-emerald-950/20'
                                    : 'text-cyan-400 hover:bg-slate-800'
                              }`}
                              title={`Select CALL (1-lot outlay: ₹${callOutlay.toFixed(2)})`}
                            >
                              <span>{money(row.call.ask || row.call.ltp)}</span>
                              {isCallSafe && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title={`Within ₹${budgetInr} budget`}></span>}
                            </button>
                          </td>
                          <td className="text-center px-2 py-1 bg-slate-950/30">
                            <div className="font-bold text-white">{num(row.strike, 0)}</div>
                            {row.isATM && <div className="text-[8px] text-cyan-300 font-bold uppercase">ATM</div>}
                          </td>
                          <td className="text-left px-2">
                            <button
                              type="button"
                              onClick={() => setSelectedTestContract(row.put)}
                              className={`px-1.5 py-0.5 rounded text-[11px] font-mono transition cursor-pointer flex items-center justify-start gap-1 mr-auto ${
                                isSelectedPut
                                  ? 'bg-rose-600 text-white font-bold'
                                  : isPutSafe
                                    ? 'text-rose-300 hover:bg-slate-800 border border-emerald-500/30 bg-emerald-950/20'
                                    : 'text-rose-400 hover:bg-slate-800'
                              }`}
                              title={`Select PUT (1-lot outlay: ₹${putOutlay.toFixed(2)})`}
                            >
                              <span>{money(row.put.ask || row.put.ltp)}</span>
                              {isPutSafe && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title={`Within ₹${budgetInr} budget`}></span>}
                            </button>
                          </td>
                          <td className="text-left px-2 text-slate-400">{num(row.put.iv)}%</td>
                          <td className="text-left px-2 text-rose-300 font-bold">{money(row.put.ltp)}</td>
                          <td className="text-left py-2 px-2 text-slate-400">{oi(row.put.oi)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-slate-800 bg-[#020914] grid grid-cols-1 md:grid-cols-3 gap-3 text-[10px] font-mono">
                <div><span className="text-slate-500">CALL RESISTANCE (MAX OI):</span> <b className="text-emerald-400">{num(chain.callResistanceStrike, 0)}</b></div>
                <div><span className="text-slate-500">PUT SUPPORT (MAX OI):</span> <b className="text-rose-400">{num(chain.putSupportStrike, 0)}</b></div>
                <div><span className="text-slate-500">TOTAL OPEN INTEREST:</span> <b className="text-slate-300">CE {oi(chain.totalCallOI)} · PE {oi(chain.totalPutOI)}</b></div>
              </div>
            </div>

            {/* Right Side: Opportunity & Execution Decision */}
            <div className="space-y-4">
              <div className="bg-[#04121f] border border-cyan-900/70 rounded-xl p-5 shadow-lg">
                <div className="flex items-center gap-2">
                  {executableOpportunity?.optionType === 'CALL'
                    ? <TrendingUp className="w-5 h-5 text-emerald-400" />
                    : executableOpportunity?.optionType === 'PUT'
                      ? <TrendingDown className="w-5 h-5 text-rose-400" />
                      : <Target className="w-5 h-5 text-cyan-400" />}
                  <div className="text-sm font-bold text-white">System Strategy Decision</div>
                </div>

                {executableOpportunity ? (
                  <>
                    <div className="mt-4 text-[10px] uppercase text-slate-500 font-mono">Directional Setup</div>
                    <div className={`text-2xl font-black mt-1 ${executableOpportunity.optionType === 'CALL' ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {executableOpportunity.optionType}
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-4">
                      <div><div className="text-[10px] text-slate-500 font-mono">SCORE</div><div className="text-base font-bold text-cyan-300">{num(executableOpportunity.score, 0)}</div></div>
                      <div><div className="text-[10px] text-slate-500 font-mono">ML PROB</div><div className="text-base font-bold text-emerald-300">{executableOpportunity.mlProbability == null ? '—' : (executableOpportunity.mlProbability * 100).toFixed(0) + '%'}</div></div>
                      <div><div className="text-[10px] text-slate-500 font-mono">LOT SIZE</div><div className="text-base font-bold text-white">{oi(executableOpportunity.lotSize)}</div></div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3 p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <div><div className="text-[10px] text-slate-500 font-mono">STRIKE</div><div className="text-sm font-bold text-white">{num(executableOpportunity.strike, 0)} {executableOpportunity.optionType === 'CALL' ? 'CE' : 'PE'}</div></div>
                      <div><div className="text-[10px] text-slate-500 font-mono">ASK (BUY REF)</div><div className="text-sm font-bold text-cyan-300">{money(executableContract?.ask || executableOpportunity.liveAsk || executableOpportunity.liveLtp)}</div></div>
                    </div>

                    <div className="mt-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] uppercase text-slate-500 font-mono">5paisa Contract Symbol</div>
                      <div className="text-xs text-cyan-300 font-mono mt-0.5 break-all">{executableOpportunity.contractSymbol}</div>
                    </div>

                    <div className="mt-4 space-y-1.5">
                      {executableOpportunity.reasons.map((reason, index) => (
                        <div key={index} className="flex items-start gap-2 text-[11px] text-slate-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => void triggerNow(executableOpportunity)}
                      disabled={triggeringId === executableOpportunity.id || loading || isEmergencyHalted}
                      className="w-full mt-4 px-4 py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-black transition cursor-pointer shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-1.5"
                    >
                      <Zap className="w-4 h-4" />
                      <span>{triggeringId === executableOpportunity.id ? 'SUBMITTING…' : `TRIGGER ${executableOpportunity.optionType} NOW`}</span>
                    </button>
                  </>
                ) : (
                  <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-4">
                    <div className="font-bold text-amber-300 text-xs">NO QUALIFYING BREAKOUT SETUP</div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      System is scanning the live chain. You can use the Micro F&amp;O Test Runner above to test small amount trades anytime.
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-amber-950/20 border border-amber-900/60 rounded-xl p-3.5 text-[11px] text-amber-200/90 font-mono">
                <AlertTriangle className="inline w-3.5 h-3.5 mr-1 text-amber-400" />
                All orders are dispatched directly to the 5paisa LIVE API in 1-lot multiples. Ensure your 5paisa TOTP session is active in the top header.
              </div>
            </div>
          </div>
        </>
      )}

      {/* Small Trade Budget Configuration Modal */}
      <SmallTradeBudgetModal
        isOpen={showBudgetModal}
        onClose={() => setShowBudgetModal(false)}
        onSaved={(newBudget, enabled) => {
          setBudgetInr(newBudget);
          setBudgetEnabled(enabled);
          onLog?.('success', `[BUDGET] Small Trade Budget updated to ₹${newBudget} INR (${enabled ? 'Enforced' : 'Disabled'})`);
        }}
      />
    </div>
  );
};
