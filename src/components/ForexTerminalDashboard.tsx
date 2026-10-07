import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Info, RefreshCw, Search } from 'lucide-react';
import { Candle, ForexSessionState, TradingSignal } from '../markets/common/types';
import { BrokerType, OrderRequest, TradingEnvironment } from '../brokers/types';

interface ForexTerminalDashboardProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  forexSessions: ForexSessionState;
  selectedBroker: BrokerType;
  environment: TradingEnvironment;
  maskedAccount: string;
  balance: number;
  currency: string;
  isEmergencyHalted: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onToggleKillSwitch: () => void;
  candlesMap: Record<string, Candle[]>;
  forexPairs: any[];
  signals: TradingSignal[];
  onSelectSignal: (signal: TradingSignal) => void;
  onRequestOrder?: (order: OrderRequest) => void;
}

type Summary = {
  accounts: any[];
  positions: any[];
  openOrders: any[];
  orderHistory: any[];
  metrics: { totalBalance: number; totalEquity: number; totalFreeMargin: number; openPnL: number; dailyRealizedPnL: number | null; totalOrders: number };
};

const price = (v: number, digits = 5) => Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const money = (v: number, c = 'USD') => Number.isFinite(v) ? new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(v) : '—';
const pct = (v: number | null) => Number.isFinite(v as number) ? `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(2)}%` : '—';

function Chart({ candles }: { candles: Candle[] }) {
  if (candles.length < 2) return <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">Authoritative cTrader candle data unavailable.</div>;
  const data = candles.slice(-120);
  const min = Math.min(...data.map(c => c.low)), max = Math.max(...data.map(c => c.high)), range = max - min || 0.0001;
  const maxVol = Math.max(...data.map(c => Number(c.volume || 0)), 1);
  const W = 1000, H = 430, chartH = 350, step = W / data.length;
  const y = (v: number) => chartH - ((v - min) / range) * chartH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      {[0,1,2,3,4,5].map(i => { const yy = chartH / 5 * i; const value = max - range / 5 * i; return <g key={i}><line x1="0" x2={W} y1={yy} y2={yy} stroke="currentColor" className="text-slate-800/80"/><text x={W-4} y={yy+4} textAnchor="end" className="fill-slate-500 text-[11px]">{price(value, 5)}</text></g>; })}
      {data.map((c, i) => {
        const x = i * step + step / 2, up = c.close >= c.open;
        const top = Math.min(y(c.open), y(c.close)), bottom = Math.max(y(c.open), y(c.close));
        const volH = Number(c.volume || 0) / maxVol * 58;
        return <g key={`${c.timestamp}-${i}`}><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={up ? '#18c89b' : '#d95568'} strokeWidth="1.1"/><rect x={x-step*.28} y={top} width={Math.max(3,step*.56)} height={Math.max(2,bottom-top)} fill={up ? '#18c89b' : '#d95568'} rx="1"/><rect x={x-step*.22} y={chartH+8+58-volH} width={Math.max(2,step*.44)} height={volH} fill={up ? '#18c89b' : '#d95568'} opacity=".25"/></g>;
      })}
    </svg>
  );
}

export const ForexTerminalDashboard: React.FC<ForexTerminalDashboardProps> = ({
  forexSessions, balance, currency, maskedAccount, isEmergencyHalted, isRefreshing, onRefresh,
  candlesMap, forexPairs, signals, onSelectSignal, onRequestOrder
}) => {
  const [selectedPair, setSelectedPair] = useState('EUR/USD');
  const [search, setSearch] = useState('');
  const [timeframe, setTimeframe] = useState('1H');
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'STOP'>('LIMIT');
  const [orderPrice, setOrderPrice] = useState('');
  const [amount, setAmount] = useState('1');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [candles, setCandles] = useState<Candle[]>(candlesMap['EUR/USD'] || []);
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  const pair = forexPairs.find(p => p.symbol === selectedPair) || forexPairs.find(Boolean);
  const actualPair = pair?.symbol || selectedPair;

  const load = async () => {
    if (loadInFlightRef.current) return loadInFlightRef.current;

    const request = (async () => {
      try {
        const [c, s] = await Promise.all([
          fetch(`/api/forex/candles/${encodeURIComponent(actualPair)}?tf=${encodeURIComponent(timeframe)}&limit=300`),
          fetch('/api/brokers/dashboard-summary')
        ]);

        if (c.ok) {
          const data = await c.json();
          // Preserve the current chart during transient provider errors/empty reads.
          if (Array.isArray(data) && data.length > 0) setCandles(data);
        }
        if (s.ok) {
          const data = await s.json();
          if (data && typeof data === 'object') setSummary(data);
        }
      } catch {
        // Keep the last authoritative state; never blank a chart during a refresh.
      }
    })();

    loadInFlightRef.current = request;
    try {
      await request;
    } finally {
      loadInFlightRef.current = null;
    }
  };

  useEffect(() => { if (pair?.symbol) setSelectedPair(pair.symbol); }, [forexPairs.length]);
  useEffect(() => { load(); }, [actualPair, timeframe]);
  // The application shell owns the global refresh loop. Load this dashboard
  // when the selected pair/timeframe changes; do not poll the same broker data
  // independently every 15 seconds.


  const quote = {
    bid: Number(pair?.bid),
    ask: Number(pair?.ask),
    spreadPips: Number(pair?.spreadPips),
    mid: Number.isFinite(Number(pair?.bid)) && Number.isFinite(Number(pair?.ask)) ? (Number(pair.bid) + Number(pair.ask)) / 2 : NaN
  };
  const last = candles[candles.length - 1];
  const candles24h = last ? candles.filter(c => Number(c.timestamp) >= Number(last.timestamp) - 24 * 60 * 60 * 1000) : [];
  const first24 = candles24h[0];
  const change24 = last && first24?.close ? (last.close - first24.close) / first24.close * 100 : null;
  const high24 = candles24h.reduce((m, c) => Math.max(m, c.high), -Infinity);
  const low24 = candles24h.reduce((m, c) => Math.min(m, c.low), Infinity);

  const watchlist = useMemo(() => forexPairs.filter(p => !search || String(p.symbol).toUpperCase().includes(search.toUpperCase())).slice(0, 14), [forexPairs, search]);
  const relatedSignals = signals.filter(s => s.market === 'FOREX').sort((a,b) => b.timestamp - a.timestamp).slice(0, 5);
  const fxPositions = (summary?.positions || []).filter(p => p.market === 'FOREX' || String(p.symbol || '').includes('/'));
  const fxOrders = (summary?.orderHistory || []).filter(o => o.market === 'FOREX' || String(o.symbol || '').includes('/')).slice(0, 5);
  const total = Number(amount || 0) * (Number(orderPrice) || (orderSide === 'BUY' ? quote.ask : quote.bid) || 0);
  const available = summary?.accounts?.filter(a => a.broker === 'CTRADER').reduce((s,a) => s + Number(a.freeMargin || 0), 0) ?? balance;

  const submitOrder = () => {
    if (!onRequestOrder || !actualPair || !Number(amount) || Number(amount) <= 0) return;
    const px = orderType === 'MARKET' ? undefined : Number(orderPrice);
    if (orderType !== 'MARKET' && (!Number.isFinite(px) || px! <= 0)) return;
    onRequestOrder({
      market: 'FOREX',
      symbol: actualPair,
      side: orderSide,
      orderType,
      quantity: Number(amount),
      price: px,
      comment: 'Goldcrest Forex Terminal'
    });
  };

  return (
    <div className="w-full min-h-[calc(100vh-162px)] bg-[#05090d] text-slate-100 p-3 md:p-4 space-y-3">
      {isEmergencyHalted && <div className="rounded-lg border border-rose-700 bg-rose-950/80 px-4 py-2 text-xs font-mono text-rose-200">TRADING HALTED — emergency stop is active; new orders are blocked.</div>}

      <section className="rounded-xl border border-slate-800 bg-[#080d12] overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-5 border-b border-slate-800">
          <div className="min-w-[120px]"><div className="font-semibold text-white">{actualPair}</div><div className="text-[10px] text-slate-500">cTrader • LIVE</div></div>
          <div><span className="text-[10px] text-slate-500">Bid</span><div className="font-mono text-sm">{price(quote.bid)}</div></div>
          <div><span className="text-[10px] text-slate-500">Ask</span><div className="font-mono text-sm">{price(quote.ask)}</div></div>
          <div><span className="text-[10px] text-slate-500">Change</span><div className={`font-mono text-sm ${change24 == null ? 'text-slate-500' : change24 >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pct(change24)}</div></div>
          <div><span className="text-[10px] text-slate-500">Spread</span><div className="font-mono text-sm">{Number.isFinite(quote.spreadPips) ? `${quote.spreadPips.toFixed(1)} pips` : '—'}</div></div>
          <div><span className="text-[10px] text-slate-500">24h High</span><div className="font-mono text-sm">{Number.isFinite(high24) ? price(high24) : '—'}</div></div>
          <div><span className="text-[10px] text-slate-500">24h Low</span><div className="font-mono text-sm">{Number.isFinite(low24) ? price(low24) : '—'}</div></div>
          <div className="ml-auto text-[10px] text-slate-500">{forexSessions.activeSessions.join(' / ') || 'CLOSED'}</div>
          <button onClick={onRefresh} className="p-2 rounded border border-slate-700 bg-slate-900"><RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : 'text-slate-400'}`}/></button>
        </div>
      </section>

      <section className="grid grid-cols-[230px_minmax(0,1fr)_260px_300px] gap-3 min-h-[580px]">
        <div className="rounded-xl border border-slate-800 bg-[#080d12] overflow-hidden">
          <div className="p-3 border-b border-slate-800"><div className="relative"><Search className="absolute left-2 top-2.5 w-3.5 h-3.5 text-slate-600"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pair" className="w-full bg-slate-950 border border-slate-800 rounded px-7 py-1.5 text-xs outline-none"/></div></div>
          <div className="px-3 py-2 grid grid-cols-[1fr_72px_54px] text-[10px] text-slate-500"><span>Pair</span><span>Bid</span><span>Spread</span></div>
          {watchlist.map(p => <button key={p.symbol} onClick={() => setSelectedPair(p.symbol)} className={`w-full grid grid-cols-[1fr_72px_54px] px-3 py-2.5 border-t border-slate-800/70 text-left ${actualPair === p.symbol ? 'bg-emerald-950/30' : 'hover:bg-slate-900/70'}`}><span className="text-xs font-semibold">{p.symbol}</span><span className="text-[11px] font-mono">{Number.isFinite(Number(p.bid)) ? price(Number(p.bid)) : '—'}</span><span className="text-[10px] text-slate-400">{Number.isFinite(Number(p.spreadPips)) ? Number(p.spreadPips).toFixed(1) : '—'}</span></button>)}
          {!watchlist.length && <div className="p-4 text-xs text-slate-600">No live cTrader instruments match.</div>}
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#080d12] overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-4 text-[11px]"><span className="text-emerald-400 font-semibold">CHART</span><span className="text-slate-600">Market data source: cTrader</span><div className="ml-auto flex items-center gap-1">{['5M','15M','1H','4H','Daily'].map(tf => <button key={tf} onClick={() => setTimeframe(tf)} className={`px-2 py-1 rounded ${timeframe === tf ? 'bg-emerald-600/20 text-emerald-400' : 'text-slate-500'}`}>{tf}</button>)}</div></div>
          <div className="h-[470px] p-2"><Chart candles={candles}/></div>
          <div className="px-4 py-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500"><span>Last: {last ? price(last.close) : '—'}</span><span>Fresh cTrader candle feed</span></div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#080d12] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between"><span className="font-semibold text-sm">Market Depth</span><Info className="w-4 h-4 text-slate-600"/></div>
          <div className="h-full flex flex-col items-center justify-center p-5 text-center"><BarChart3 className="w-8 h-8 text-slate-700 mb-3"/><div className="text-xs text-slate-400">Native cTrader Level-2 depth is not exposed by the current broker adapter.</div><div className="text-[10px] text-slate-600 mt-2">Level-2 depth unavailable from the current broker adapter.</div></div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#080d12] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between"><span className="font-semibold">Spot</span><span className="text-slate-600">•••</span></div>
          <div className="p-3">
            <div className="grid grid-cols-2 rounded-full bg-slate-950 border border-slate-800 p-1 mb-3"><button onClick={() => setOrderSide('BUY')} className={`rounded-full py-2 text-xs ${orderSide === 'BUY' ? 'bg-emerald-600/30 text-emerald-300' : 'text-slate-500'}`}>Buy</button><button onClick={() => setOrderSide('SELL')} className={`rounded-full py-2 text-xs ${orderSide === 'SELL' ? 'bg-rose-600/20 text-rose-300' : 'text-slate-500'}`}>Sell</button></div>
            <div className="grid grid-cols-3 gap-1 mb-4">{(['LIMIT','MARKET','STOP'] as const).map(t => <button key={t} onClick={() => setOrderType(t)} className={`py-1.5 rounded text-[10px] border ${orderType === t ? 'border-emerald-600 text-emerald-400 bg-emerald-950/20' : 'border-slate-800 text-slate-500'}`}>{t}</button>)}</div>
            {orderType !== 'MARKET' && <label className="block mb-3"><span className="text-[10px] text-slate-500">Price</span><input value={orderPrice} onChange={e => setOrderPrice(e.target.value)} placeholder={price(orderSide === 'BUY' ? quote.ask : quote.bid)} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm outline-none"/></label>}
            <label className="block mb-3"><span className="text-[10px] text-slate-500">Amount</span><input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm outline-none"/></label>
            <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 mb-3 flex justify-between text-xs"><span className="text-slate-500">Total</span><span>{money(total, currency)}</span></div>
            <div className="text-[10px] text-slate-500 mb-3">Available: {money(available, currency)}</div>
            <button disabled={!onRequestOrder || isEmergencyHalted || !Number(amount) || (orderType !== 'MARKET' && !Number(orderPrice))} onClick={submitOrder} className={`w-full py-2.5 rounded-lg font-semibold text-xs ${orderSide === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'} disabled:opacity-40`}>{orderSide === 'BUY' ? 'Buy' : 'Sell'} {actualPair}</button>
            <div className="mt-3 text-[10px] text-slate-600">Orders pass the existing live broker safety gate and confirmation flow. No automatic order is submitted by this screen.</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-800 bg-[#080d12] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between"><h3 className="font-semibold text-sm">Signals</h3><span className="text-[10px] text-slate-500">LIVE QUANTITATIVE FEED</span></div>
          {relatedSignals.map(s => <button key={s.id} onClick={() => onSelectSignal(s)} className="w-full text-left grid grid-cols-[90px_1fr_80px_80px] px-4 py-2.5 border-t border-slate-800/70 text-xs"><span>{s.direction}</span><span>{(s as any).pair || (s as any).instrument || '—'}</span><span>{s.strategy}</span><span className="text-emerald-400">{Number(s.score).toFixed(1)}</span></button>)}
          {!relatedSignals.length && <div className="p-5 text-xs text-slate-600">No live Forex signals returned.</div>}
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#080d12] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between"><h3 className="font-semibold text-sm">Orders & Positions</h3><span className="text-[10px] text-slate-500">cTrader LIVE</span></div>
          {(fxPositions.length || fxOrders.length) ? <>{fxPositions.slice(0,3).map(p => <div key={p.id} className="px-4 py-2.5 border-t border-slate-800/70 text-xs flex justify-between"><span>{p.symbol} • {p.side}</span><span className={Number(p.unrealizedPnL) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{money(Number(p.unrealizedPnL), p.currency || currency)}</span></div>)}{fxOrders.slice(0,3).map(o => <div key={o.id} className="px-4 py-2.5 border-t border-slate-800/70 text-xs flex justify-between"><span>{o.symbol} • {o.side}</span><span>{o.status}</span></div>)}</> : <div className="p-5 text-xs text-slate-600">No live Forex positions or order history returned.</div>}
        </div>
      </section>

      <div className="flex justify-between text-[10px] text-slate-600 font-mono px-1"><span>cTrader • LIVE • {forexSessions.activeSessions.join(' / ') || 'CLOSED'}</span><span>Account: {maskedAccount}</span></div>
    </div>
  );
};
