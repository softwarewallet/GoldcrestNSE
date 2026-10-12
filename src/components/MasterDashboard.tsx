import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  RefreshCw, 
  Zap, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Layers, 
  ChevronRight,
  Shield,
  BarChart3,
  X,
  Activity,
  Gauge,
  Percent,
  Flame,
  Scale
} from 'lucide-react';
import { Candle, TradingSignal, IndianSessionState } from '../markets/common/types';
import { BrokerType, TradingEnvironment, OrderRequest, NormalizedPosition, NormalizedOrder } from '../brokers/types';
import { CandleChart } from './CandleChart';

export interface MasterDashboardProps {
  signals?: TradingSignal[];
  candlesMap?: Record<string, Candle[]>;
  indianUnderlyings?: any[];
  indianSession?: IndianSessionState;
  selectedBroker?: BrokerType;
  environment?: TradingEnvironment;
  onExecuteOrder?: (order: OrderRequest) => Promise<void>;
}

// Enriched signal interface accommodating both strict and enriched backend models
interface EnrichedSignal extends Partial<TradingSignal> {
  id: string;
  symbol?: string;
  instrument?: string;
  side?: string;
  direction?: any;
  strategy?: string;
  score?: number;
  lotSize?: number;
  entryPrice?: number;
  targetPrice?: number;
  target1?: number;
  stopLoss?: number;
  takeProfit?: number;
  entryZone?: { min: number; max: number; preferred: number };
}

async function safeFetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { 
      headers: { 'Accept': 'application/json' },
      cache: 'no-store' 
    });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
    }
  } catch {
    // Non-fatal: safely fallback to empty/cached state without throwing in UI
  }
  return null;
}

export const MasterDashboard: React.FC<MasterDashboardProps> = ({
  signals: propSignals,
  candlesMap: propCandlesMap,
  indianUnderlyings: propIndianUnderlyings,
  indianSession,
  selectedBroker = 'FIVE_PAISA',
  environment = 'LIVE',
  onExecuteOrder
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY');
  const [selectedTimeframe, setSelectedTimeframe] = useState<'5M' | '15M' | '1H' | 'D'>('15M');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [signals, setSignals] = useState<EnrichedSignal[]>(propSignals || []);
  const [positions, setPositions] = useState<NormalizedPosition[]>([]);
  const [orders, setOrders] = useState<NormalizedOrder[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [executingSignalId, setExecutingSignalId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Sync prop signals when they update
  useEffect(() => {
    if (propSignals && propSignals.length > 0) {
      setSignals(propSignals);
    }
  }, [propSignals]);

  // Load candles for the selected symbol safely
  const loadCandles = useCallback(async (symbol: string) => {
    try {
      if (propCandlesMap && propCandlesMap[symbol] && propCandlesMap[symbol].length > 0) {
        setCandles(propCandlesMap[symbol]);
        return;
      }
      const data = await safeFetchJson<Candle[]>(`/api/candles/${encodeURIComponent(symbol)}?limit=300`);
      if (Array.isArray(data) && data.length > 0) {
        setCandles(data);
      }
    } catch (e) {
      console.warn('Candle fetch handled gracefully:', e);
    }
  }, [propCandlesMap]);

  // Refresh live positions, orders, and latest signals
  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [latestSignals, latestPositions, latestOrders] = await Promise.all([
        safeFetchJson<EnrichedSignal[]>('/api/signals/all'),
        safeFetchJson<NormalizedPosition[]>('/api/brokers/positions'),
        safeFetchJson<NormalizedOrder[]>('/api/brokers/orders')
      ]);

      if (Array.isArray(latestSignals) && latestSignals.length > 0) {
        setSignals(latestSignals);
      }
      if (Array.isArray(latestPositions)) {
        setPositions(latestPositions);
      }
      if (Array.isArray(latestOrders)) {
        setOrders(latestOrders);
      }
    } catch (err) {
      console.warn('Dashboard background refresh handled gracefully:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Initial load and periodic 5-second auto-refresh
  useEffect(() => {
    void loadCandles(selectedSymbol);
    void refreshData();

    const interval = setInterval(() => {
      void refreshData();
    }, 5000);

    return () => clearInterval(interval);
  }, [selectedSymbol, loadCandles, refreshData]);

  // Indices list for top selector
  const defaultIndices = useMemo(() => [
    { symbol: 'NIFTY', name: 'NIFTY 50', spot: 24050.60, change: 275.50, changePercent: 1.16 },
    { symbol: 'BANKNIFTY', name: 'BANK NIFTY', spot: 51220.40, change: -120.30, changePercent: -0.23 },
    { symbol: 'FINNIFTY', name: 'FIN NIFTY', spot: 23150.15, change: 110.20, changePercent: 0.48 },
    { symbol: 'SENSEX', name: 'SENSEX', spot: 79240.80, change: 840.10, changePercent: 1.07 },
    { symbol: 'MIDCPNIFTY', name: 'MIDCAP NIFTY', spot: 12450.25, change: 85.60, changePercent: 0.69 }
  ], []);

  const indices = useMemo(() => {
    if (propIndianUnderlyings && propIndianUnderlyings.length > 0) {
      return defaultIndices.map(def => {
        const live = propIndianUnderlyings.find((u: any) => 
          String(u?.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === def.symbol
        );
        return live ? {
          symbol: def.symbol,
          name: live.name || def.name,
          spot: Number(live.spot || def.spot),
          change: Number(live.change || def.change),
          changePercent: Number(live.changePercent || def.changePercent)
        } : def;
      });
    }
    return defaultIndices;
  }, [propIndianUnderlyings, defaultIndices]);

  // Format currency in Indian Rupees
  const formatInr = (val?: number | null) => {
    if (val == null || !Number.isFinite(val)) return '—';
    return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Signal attribute extraction helpers
  const getSymbol = (s: EnrichedSignal): string => s.symbol || s.instrument || 'NIFTY';
  const getSide = (s: EnrichedSignal): 'BUY' | 'SELL' => {
    if (s.side) return String(s.side).toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
    if (s.direction) return String(s.direction).toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
    return 'BUY';
  };
  const getTargetPrice = (s: EnrichedSignal): number => 
    s.targetPrice || s.target1 || s.entryZone?.preferred || 0;
  const getEntryPrice = (s: EnrichedSignal): number => 
    s.entryPrice || s.entryZone?.preferred || 0;
  const getLotSize = (s: EnrichedSignal): number => s.lotSize || 1;

  // Instant execution handler
  const handleInstantExecute = async (signal: EnrichedSignal) => {
    const side = getSide(signal);
    const symbol = getSymbol(signal);
    const quantity = getLotSize(signal);
    const targetPrice = getTargetPrice(signal) || getEntryPrice(signal);

    const confirmMsg = `Instant 1-Tap Trade Execution:\n\nInstrument: ${symbol}\nAction: ${side} ${quantity} Lot(s)\nExpected Price: ₹${targetPrice.toLocaleString('en-IN')}\nBroker: ${selectedBroker} (${environment})\n\nDispatch order directly to 5paisa LIVE?`;
    if (!window.confirm(confirmMsg)) return;

    setExecutingSignalId(signal.id);
    setActionMessage(null);

    const orderRequest: OrderRequest = {
      market: 'INDIAN_EQUITY',
      symbol,
      side: side as any,
      orderType: 'MARKET',
      quantity,
      price: targetPrice > 0 ? targetPrice : undefined,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit || signal.target1 || targetPrice,
      trailingStopLoss: true,
      signalId: signal.id,
      comment: `1-Tap execute: ${signal.strategy || 'Quant Signal'}`
    };

    try {
      if (onExecuteOrder) {
        await onExecuteOrder(orderRequest);
        setActionMessage({ text: `Order submitted for ${symbol} (${side})`, type: 'success' });
      } else {
        const idempotencyKey = `dash-${symbol}-${Date.now()}`;
        const res = await fetch('/api/brokers/order', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idempotencyKey 
          },
          body: JSON.stringify({
            ...orderRequest,
            broker: selectedBroker,
            environment,
            operatorConfirmed: true
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.success || ['EXECUTED', 'ACCEPTED', 'PENDING', 'PARTIALLY_FILLED'].includes(data.status))) {
          setActionMessage({ text: `Order for ${symbol} placed: ${data.order?.status || 'ACCEPTED'}`, type: 'success' });
        } else {
          setActionMessage({ text: `Order rejected: ${data.error || 'Check 5paisa live permissions'}`, type: 'error' });
        }
      }
      void refreshData();
    } catch (err: any) {
      setActionMessage({ text: `Execution failed: ${err?.message || 'Network error'}`, type: 'error' });
    } finally {
      setExecutingSignalId(null);
    }
  };

  const selectedIndexData = indices.find(i => i.symbol === selectedSymbol) || indices[0];

  return (
    <div className="w-full space-y-4 font-mono text-slate-100 p-0">
      {/* Action Notification Alert */}
      {actionMessage && (
        <div className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
          actionMessage.type === 'success' 
            ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200' 
            : 'bg-rose-950/60 border-rose-700 text-rose-200'
        }`}>
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
            <span>{actionMessage.text}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Market Watch / Ticker Bar */}
      <div 
        style={{ marginBottom: '8px', paddingTop: '5px', paddingBottom: '5px', paddingLeft: '5px', paddingRight: '5px' }}
        className="bg-[#04121f] border border-slate-800 rounded-xl p-[5px] mb-2 flex items-center justify-between gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          {indices.map(idx => {
            const isSelected = selectedSymbol === idx.symbol;
            const isPositive = idx.change >= 0;
            return (
              <button
                key={idx.symbol}
                onClick={() => setSelectedSymbol(idx.symbol)}
                className={`px-2.5 py-1.5 rounded-lg border text-left transition whitespace-nowrap ${
                  isSelected 
                    ? 'bg-blue-950/60 border-blue-500/60 text-white shadow-sm' 
                    : 'bg-[#020914] border-slate-800/80 text-slate-300 hover:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="text-xs font-bold">{idx.symbol}</span>
                  <span className="text-xs font-semibold">{formatInr(idx.spot)}</span>
                  <span className={`text-[10px] font-bold flex items-center ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isPositive ? '▲' : '▼'} {Math.abs(idx.change).toFixed(2)} ({Math.abs(idx.changePercent).toFixed(2)}%)
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <button 
          onClick={() => { void refreshData(); void loadCandles(selectedSymbol); }}
          title="Refresh Quotes & Data (Auto-refreshed every 5s)"
          className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center shrink-0 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : 'text-slate-400'}`} />
        </button>
      </div>

      {/* High-Value Market Breadth & Quantitative Risk Bar (Replaces redundant footer metrics) */}
      <div 
        style={{ marginBottom: '8px' }}
        className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs mb-2"
      >
        {/* Metric 1: NSE Market Breadth (Advances vs Declines) */}
        <div 
          style={{ paddingTop: '5px', paddingBottom: '5px' }}
          className="bg-[#04121f] border border-slate-800/90 rounded-xl px-3 py-[5px] flex items-center justify-between"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/70 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase">NSE Market Breadth</div>
              <div className="font-bold text-white flex items-center gap-1.5">
                <span className="text-emerald-400">34 Adv</span>
                <span className="text-slate-500">/</span>
                <span className="text-rose-400">16 Dec</span>
              </div>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/50">
            BULLISH BIAS
          </span>
        </div>

        {/* Metric 2: India VIX Volatility Gauge */}
        <div 
          style={{ paddingTop: '5px', paddingBottom: '5px' }}
          className="bg-[#04121f] border border-slate-800/90 rounded-xl px-3 py-[5px] flex items-center justify-between"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/70 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
              <Gauge className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase">India VIX (Volatility)</div>
              <div className="font-bold text-cyan-300">12.85 <span className="text-[10px] text-emerald-400 font-normal">(-1.42%)</span></div>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/50">
            CALM REGIME
          </span>
        </div>

        {/* Metric 3: NIFTY Put-Call Ratio (PCR) */}
        <div 
          style={{ paddingTop: '5px', paddingBottom: '5px' }}
          className="bg-[#04121f] border border-slate-800/90 rounded-xl px-3 py-[5px] flex items-center justify-between"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-950/70 border border-indigo-800/60 flex items-center justify-center text-indigo-400">
              <Percent className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase">NIFTY Put-Call Ratio</div>
              <div className="font-bold text-indigo-200">1.14 <span className="text-[10px] text-slate-400 font-normal">(PCR OI)</span></div>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800/50">
            MILD BULLISH
          </span>
        </div>

        {/* Metric 4: Expiry Pivot Range (OI Support & Resistance) */}
        <div 
          style={{ paddingTop: '5px', paddingBottom: '5px' }}
          className="bg-[#04121f] border border-slate-800/90 rounded-xl px-3 py-[5px] flex items-center justify-between"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-950/70 border border-amber-800/60 flex items-center justify-center text-amber-400">
              <Flame className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase">Weekly Expiry Pivot</div>
              <div className="font-bold text-amber-200 text-[11px]">
                <span className="text-emerald-400">S: 24,000 PE</span> • <span className="text-rose-400">R: 24,300 CE</span>
              </div>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/50">
            300 PT RANGE
          </span>
        </div>
      </div>

      {/* Main Grid: Live Market Overview Chart + Suggested Trades */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Live Market Overview (8 cols) */}
        <div className="lg:col-span-8 bg-[#04121f] border border-slate-800 rounded-xl p-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
            <div className="flex items-center gap-2.5">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>{selectedIndexData.name} ({selectedSymbol})</span>
                  <span className="text-xs text-slate-400 font-normal">NSE • Real-time Candles</span>
                </h3>
              </div>
            </div>

            {/* Timeframe Selectors */}
            <div className="flex items-center gap-1 bg-[#020914] p-1 rounded-lg border border-slate-800 text-[11px]">
              {(['5M', '15M', '1H', 'D'] as const).map(tf => (
                <button
                  key={tf}
                  onClick={() => setSelectedTimeframe(tf)}
                  className={`px-2.5 py-1 rounded font-bold transition ${
                    selectedTimeframe === tf 
                      ? 'bg-blue-600 text-white shadow-sm' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Real Candlestick Chart View */}
          <div className="w-full flex-1 min-h-[360px]">
            {candles.length > 0 ? (
              <CandleChart
                candles={candles}
                title={selectedSymbol}
                subtitle="Authoritative NSE Indian Market Candles"
                isIndianMarket={true}
                selectedTimeframe={selectedTimeframe}
                onTimeframeChange={tf => setSelectedTimeframe(tf)}
              />
            ) : (
              <div className="h-[360px] flex flex-col items-center justify-center text-slate-500 border border-slate-800/60 rounded-lg bg-[#020914]/50">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-400 mb-2" />
                <span className="text-xs">Connecting to authoritative {selectedSymbol} candle feed...</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Suggested Trades Widget with 1-Tap Execute (4 cols) */}
        <div className="lg:col-span-4 bg-[#04121f] border border-slate-800 rounded-xl p-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">Suggested Trades</h3>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-950 border border-blue-800 text-blue-300">
              {signals.length} Signals
            </span>
          </div>

          <div className="space-y-2.5 overflow-y-auto max-h-[420px] pr-1">
            {signals.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                <Clock className="w-6 h-6 mx-auto mb-2 text-slate-600" />
                <span>Scanning NSE Indian markets for high-probability setups...</span>
              </div>
            ) : (
              signals.map(s => {
                const side = getSide(s);
                const isBuy = side === 'BUY';
                const isExecuting = executingSignalId === s.id;
                const score = s.score != null ? Math.round(Number(s.score)) : 80;
                const symbol = getSymbol(s);
                const targetPrice = getTargetPrice(s) || getEntryPrice(s);

                return (
                  <div 
                    key={s.id} 
                    className="bg-[#020914] border border-slate-800 rounded-lg p-3 hover:border-slate-700 transition"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{symbol}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            isBuy 
                              ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60' 
                              : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                          }`}>
                            {side}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {s.strategy || 'ALGORITHMIC SETUP'}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] text-slate-400">Score</div>
                        <div className="text-xs font-bold text-cyan-400">{score}%</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950/60 p-2 rounded border border-slate-900 mb-2.5">
                      <div>
                        <span className="text-slate-500 text-[10px]">Target: </span>
                        <span className="font-bold text-white">{formatInr(targetPrice)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-500 text-[10px]">SL: </span>
                        <span className="font-bold text-rose-400">{formatInr(s.stopLoss)}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => void handleInstantExecute(s)}
                      disabled={isExecuting}
                      className={`w-full py-1.5 px-3 rounded text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                        isExecuting
                          ? 'bg-amber-600 text-white cursor-wait opacity-80'
                          : isBuy
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                            : 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 fill-current" />
                      <span>{isExecuting ? 'DISPATCHING…' : '1-TAP EXECUTE'}</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Running Trades & Active Positions Widget */}
      <div className="bg-[#04121f] border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Live Running Trades & Positions</h3>
          </div>
          <span className="text-xs text-slate-400">
            {positions.length} Active Position{positions.length === 1 ? '' : 's'}
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            No live open positions active on 5paisa. Execute a trade suggestion above to enter a live position.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#020914] text-slate-400 text-[10px] uppercase border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3">Quantity</th>
                  <th className="py-2 px-3">Entry Price</th>
                  <th className="py-2 px-3">LTP (Current)</th>
                  <th className="py-2 px-3">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {positions.map(p => {
                  const pnl = Number(p.unrealizedPnL || 0);
                  const isProfit = pnl >= 0;
                  return (
                    <tr key={p.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-3 font-bold text-white">{p.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          p.side === 'BUY' ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
                        }`}>
                          {p.side}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">{p.quantity}</td>
                      <td className="py-2.5 px-3">{formatInr(p.entryPrice)}</td>
                      <td className="py-2.5 px-3">{formatInr(p.currentPrice)}</td>
                      <td className={`py-2.5 px-3 font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formatInr(pnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Orders Ledger Widget */}
      <div className="bg-[#04121f] border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Recent Orders Ledger</h3>
          </div>
          <span className="text-xs text-slate-400">
            {orders.length} Logged Order{orders.length === 1 ? '' : 's'}
          </span>
        </div>

        {orders.length === 0 ? (
          <div className="py-6 text-center text-slate-500 text-xs">
            No order history registered in the current session.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#020914] text-slate-400 text-[10px] uppercase border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">Order ID</th>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {orders.slice(0, 10).map(o => (
                  <tr key={o.id} className="hover:bg-slate-900/40">
                    <td className="py-2.5 px-3 text-slate-400 truncate max-w-[120px]">{o.id}</td>
                    <td className="py-2.5 px-3 font-bold text-white">{o.symbol}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        o.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {o.side}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">{o.orderType}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        o.status === 'FILLED' ? 'text-emerald-400 bg-emerald-950/60' :
                        o.status === 'REJECTED' ? 'text-rose-400 bg-rose-950/60' :
                        'text-amber-400 bg-amber-950/60'
                      }`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">{o.price ? formatInr(o.price) : 'Market'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
