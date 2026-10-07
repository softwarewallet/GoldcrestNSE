import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, Plus, RefreshCw, Search, Settings2 } from 'lucide-react';
import { Candle, IndianSessionState, TradingSignal } from '../markets/common/types';
import { BrokerType, TradingEnvironment } from '../brokers/types';
import { MarketNews } from './MarketNews';

interface TerminalDashboardProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  indianSession: IndianSessionState;
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
  indianUnderlyings: any[];
  signals: TradingSignal[];
  onSelectSignal: (signal: TradingSignal) => void;
}

type Summary = {
  accounts: any[];
  positions: any[];
  openOrders: any[];
  orderHistory: any[];
  metrics: {
    totalBalance: number;
    totalEquity: number;
    totalFreeMargin: number;
    openPnL: number;
    dailyRealizedPnL: number | null;
    totalOrders: number;
    winRate: number | null;
    profitFactor: number | null;
    maxDrawdown: number | null;
  };
};

const money = (v: number, currency = 'INR') =>
  Number.isFinite(v)
    ? new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency', currency, maximumFractionDigits: 0
      }).format(v)
    : '—';

const num = (v: number, digits = 2) =>
  Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

const pct = (v: number | null | undefined) =>
  Number.isFinite(v as number) ? `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(2)}%` : '—';

const pnlClass = (v: number | null | undefined) =>
  !Number.isFinite(v as number) ? 'text-slate-400' : (v as number) >= 0 ? 'text-emerald-400' : 'text-rose-400';

function ema(values: number[], period: number) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  let prev = values[0];
  return values.map((v, i) => {
    if (i === 0) return prev;
    prev = v * k + prev * (1 - k);
    return prev;
  });
}

function MiniLine({ values, negative = false }: { values: number[]; negative?: boolean }) {
  if (values.length < 2) return <div className="h-8 text-[10px] text-slate-600">No live history</div>;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / range) * 26}`).join(' ');
  return <svg viewBox="0 0 100 32" className={`w-full h-8 ${negative ? 'text-rose-400' : 'text-emerald-400'}`} preserveAspectRatio="none"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>;
}

function Chart({ candles, show20, show50 }: { candles: Candle[]; show20: boolean; show50: boolean }) {
  if (candles.length < 2) {
    return <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">Authoritative NIFTY candle data unavailable.</div>;
  }
  const data = candles.slice(-Math.min(candles.length, 180));
  const min = Math.min(...data.map(c => c.low));
  const max = Math.max(...data.map(c => c.high));
  const range = max - min || 1;
  const W = 1000, H = 360, step = W / data.length;
  const y = (v: number) => H - ((v - min) / range) * H;
  const closes = data.map(c => c.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const line = (vals: number[]) => vals.map((v, i) => `${i * step + step / 2},${y(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      {[0,1,2,3,4,5].map(i => {
        const yy = H / 5 * i;
        const value = max - range / 5 * i;
        return <g key={i}><line x1="0" x2={W} y1={yy} y2={yy} stroke="currentColor" className="text-slate-800/80"/><text x={W-4} y={yy+4} textAnchor="end" className="fill-slate-500 text-[11px]">{num(value)}</text></g>;
      })}
      {data.map((c, i) => {
        const x = i * step + step / 2, up = c.close >= c.open;
        const bodyTop = Math.min(y(c.open), y(c.close)), bodyBottom = Math.max(y(c.open), y(c.close));
        return <g key={`${c.timestamp}-${i}`}><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={up ? '#18c89b' : '#e55364'} strokeWidth="1.2"/><rect x={x-step*.28} y={bodyTop} width={Math.max(3,step*.56)} height={Math.max(2,bodyBottom-bodyTop)} fill={up ? '#18c89b' : '#e55364'} rx="1"/></g>;
      })}
      {show20 && <polyline points={line(e20)} fill="none" stroke="#18c89b" strokeWidth="1.3" opacity=".8"/>}
      {show50 && <polyline points={line(e50)} fill="none" stroke="#4d78d8" strokeWidth="1.3" opacity=".8"/>}
    </svg>
  );
}

export const TerminalDashboard: React.FC<TerminalDashboardProps> = ({
  indianSession, balance, currency, maskedAccount, isEmergencyHalted,
  isRefreshing, onRefresh, candlesMap, indianUnderlyings, signals
}) => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('NIFTY');
  const [range, setRange] = useState('6M');
  const [timeframe, setTimeframe] = useState('1d');
  const [show20, setShow20] = useState(true);
  const [show50, setShow50] = useState(true);
  const [watchSearch, setWatchSearch] = useState('');
  const [candles, setCandles] = useState<Candle[]>(candlesMap.NIFTY || []);
  const fetchInFlightRef = useRef<Promise<void> | null>(null);

  const fetchDashboard = async () => {
    if (fetchInFlightRef.current) return fetchInFlightRef.current;

    const request = (async () => {
      try {
        const [s, c, cfg] = await Promise.all([
          fetch('/api/brokers/dashboard-summary'),
          fetch(`/api/candles/${encodeURIComponent(selectedSymbol)}?tf=${encodeURIComponent(timeframe)}&limit=500`),
          fetch('/api/config')
        ]);

        if (s.ok) {
          const data = await s.json();
          if (data && typeof data === 'object') setSummary(data);
        }
        if (c.ok) {
          const data = await c.json();
          if (Array.isArray(data) && data.length > 0) setCandles(data);
        }
        if (cfg.ok) {
          const data = await cfg.json();
          if (data && typeof data === 'object') setConfig(data);
        }
      } catch {
        // Preserve last authoritative values on transient refresh failures.
      }
    })();

    fetchInFlightRef.current = request;
    try {
      await request;
    } finally {
      fetchInFlightRef.current = null;
    }
  };

  useEffect(() => { fetchDashboard(); }, [selectedSymbol, timeframe]);
  // The application shell owns the global refresh cycle. Fetch again only
  // when the selected instrument or timeframe changes.


  const indices = useMemo(() => {
    const preferred = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'NIFTYIT', 'MIDCPNIFTY'];
    return preferred.map(symbol => {
      const live = indianUnderlyings.find((u: any) => String(u.symbol).toUpperCase().replace(/[^A-Z0-9]/g, '') === symbol);
      return { symbol, live };
    });
  }, [indianUnderlyings]);

  const selectedIndex = indianUnderlyings.find((u: any) => String(u.symbol).toUpperCase() === selectedSymbol);
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const change = last && previous ? last.close - previous.close : null;
  const changePct = last && previous && previous.close ? change! / previous.close * 100 : null;

  const rangeCount: Record<string, number> = { '1D': 24, '1W': 120, '1M': 220, '3M': 500, '6M': 500, '1Y': 500, All: 500 };
  const chartCandles = useMemo(() => {
    const n = rangeCount[range] || candles.length;
    return candles.slice(-Math.min(n, candles.length));
  }, [candles, range]);

  const strategies = useMemo(() => {
    const names = new Set(signals.map(s => s.strategy).filter(Boolean));
    const active = signals.filter(s => ['ACTIVE','ENTRY_TRIGGERED'].includes(s.status)).length;
    const stopped = signals.filter(s => s.status === 'STOPPED').length;
    return { total: names.size, active, stopped, running: Math.max(0, active - stopped) };
  }, [signals]);

  const filteredIndices = indices.filter(i => !watchSearch || i.symbol.includes(watchSearch.toUpperCase()));
  const nseAccount = summary?.accounts?.find(a => a.broker === 'FIVE_PAISA');
  const nseBrokerSummary = (summary as any)?.brokerSummaries?.find((x: any) => x.broker === 'FIVE_PAISA');
  const nsePositions = (summary?.positions || []).filter((p: any) => p.broker === 'FIVE_PAISA' || p.market === 'INDIAN_EQUITY');
  const equity = Number(nseAccount?.equity ?? balance);
  const accountBalance = Number(nseAccount?.balance ?? balance);
  const freeMargin = Number(nseAccount?.freeMargin ?? 0);
  const dailyPnl = Number.isFinite(Number(nseBrokerSummary?.dailyRealizedPnL)) ? Number(nseBrokerSummary.dailyRealizedPnL) : null;
  const exposure = equity > 0 ? (nsePositions.reduce((s, p) => s + Math.abs(Number(p.quantity || 0) * Number(p.currentPrice || 0)), 0) || 0) / equity * 100 : null;
  const risk = {
    dailyLimit: -Number(config?.maxDailyLossPct ?? 3),
    riskPerTrade: Number(config?.defaultRiskPct ?? 1),
    maxPositions: Number.isFinite(Number(config?.maxOpenPositions)) ? Number(config.maxOpenPositions) : null
  };

  return (
    <div className="w-full min-h-[calc(100vh-162px)] bg-[#020914] text-slate-100 p-3 md:p-4 space-y-3">
      {isEmergencyHalted && <div className="rounded-lg border border-rose-700 bg-rose-950/80 px-4 py-2 text-xs font-mono text-rose-200">TRADING HALTED — emergency stop is active; new orders are blocked.</div>}

      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi label="Live P&L" value={dailyPnl == null ? '—' : money(dailyPnl, nseAccount?.currency || currency)} sub="Broker realized P&L" tone={pnlClass(dailyPnl)} />
        <Kpi label="Win Rate" value="—" sub="Closed trade ledger" />
        <Kpi label="Total Trades" value={nseBrokerSummary ? String(nseBrokerSummary.orderHistory.length) : '—'} sub="Live broker history" />
        <Kpi label="Profit Factor" value="—" sub="Realized P&L required" />
        <Kpi label="Max Drawdown" value="—" sub="Equity history required" tone="text-rose-400" />
        <Kpi label="Account Balance" value={money(accountBalance, nseAccount?.currency || currency)} sub={`Avail: ${nseAccount ? money(freeMargin, nseAccount.currency) : '—'}`} />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-3">
        <div className="rounded-xl border border-slate-800 bg-[#04121f] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold"><span>{selectedIndex?.name || (selectedSymbol === 'NIFTY' ? 'NIFTY 50' : selectedSymbol)} · {timeframe === '1d' ? '1D' : timeframe} · NSE</span><span className={`w-2 h-2 rounded-full ${indianSession.isOpen ? 'bg-emerald-400' : 'bg-amber-400'}`}/></div>
              <div className="text-[11px] font-mono mt-1">
                {last ? <>O <b>{num(last.open)}</b>&nbsp;&nbsp; H <b>{num(last.high)}</b>&nbsp;&nbsp; L <b>{num(last.low)}</b>&nbsp;&nbsp; C <b className="text-emerald-400">{num(last.close)}</b>&nbsp;&nbsp; <span className={pnlClass(change)}>{change == null ? '—' : `${change >= 0 ? '+' : ''}${num(change)} (${pct(changePct)})`}</span></> : <span className="text-slate-500">Authoritative candle feed unavailable</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs"><option value="1d">1D</option><option value="60m">1H</option><option value="15m">15M</option></select>
              <button onClick={() => setShow20(v => !v)} className={`px-2 py-1.5 rounded border text-[11px] ${show20 ? 'border-emerald-600 text-emerald-400' : 'border-slate-700 text-slate-500'}`}>EMA20</button>
              <button onClick={() => setShow50(v => !v)} className={`px-2 py-1.5 rounded border text-[11px] ${show50 ? 'border-blue-600 text-blue-400' : 'border-slate-700 text-slate-500'}`}>EMA50</button>
              <button onClick={onRefresh} className="p-1.5 rounded border border-slate-700"><RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : 'text-slate-400'}`}/></button>
            </div>
          </div>
          <div className="h-[410px] p-2"><Chart candles={chartCandles} show20={show20} show50={show50}/></div>
          <div className="border-t border-slate-800 px-3 py-2 flex items-center gap-1">
            {['1D','1W','1M','3M','6M','1Y','All'].map(x => <button key={x} onClick={() => setRange(x)} className={`px-3 py-1 rounded text-xs ${range === x ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-200'}`}>{x}</button>)}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-slate-800 bg-[#04121f] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between"><h3 className="font-semibold">Watchlist</h3><Plus className="w-4 h-4 text-slate-400"/></div>
            <div className="px-3 py-2"><div className="relative"><Search className="absolute left-2 top-2.5 w-3.5 h-3.5 text-slate-600"/><input value={watchSearch} onChange={e => setWatchSearch(e.target.value)} placeholder="Search index" className="w-full bg-slate-950 border border-slate-800 rounded px-7 py-1.5 text-xs outline-none"/></div></div>
            <div className="grid grid-cols-[1fr_82px_72px] px-4 py-2 text-[10px] text-slate-500"><span>Symbol</span><span>Last</span><span>Chg%</span></div>
            {filteredIndices.map(({symbol, live}) => {
              const selected = selectedSymbol === symbol;
              const spot = Number(live?.spot), ch = Number(live?.change), cp = Number(live?.changePercent);
              return <button key={symbol} onClick={() => setSelectedSymbol(symbol)} className={`w-full grid grid-cols-[1fr_82px_72px] items-center px-4 py-2.5 border-t border-slate-800/70 text-left ${selected ? 'bg-blue-950/40' : 'hover:bg-slate-900/60'}`}>
                <span className="font-semibold text-xs">{live?.name || symbol}</span>
                <span className="font-mono text-xs">{Number.isFinite(spot) ? num(spot) : '—'}</span>
                <span className={`font-mono text-xs ${Number.isFinite(cp) ? (cp >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-600'}`}>{Number.isFinite(cp) ? pct(cp) : '—'}</span>
              </button>;
            })}
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#04121f] p-4">
            <div className="flex items-center justify-between mb-4"><h3 className="font-semibold">Strategy Status</h3><Gauge className="w-4 h-4 text-blue-400"/></div>
            <div className="flex items-center gap-5">
              <div className="w-24 h-24 rounded-full border-[10px] border-blue-600 border-r-emerald-500 border-b-rose-500 flex items-center justify-center"><div className="text-center"><div className="text-xl font-bold">{strategies.total}</div><div className="text-[9px] text-slate-500">Total Strategies</div></div></div>
              <div className="text-xs space-y-2"><div className="flex gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 mt-1"/>Active <b>{strategies.active}</b></div><div className="flex gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 mt-1"/>Running <b>{strategies.running}</b></div><div className="flex gap-2"><span className="w-2 h-2 rounded-full bg-rose-500 mt-1"/>Stopped <b>{strategies.stopped}</b></div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800 bg-[#04121f] p-4">
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">Market Performance</h3><span className="text-[11px] text-slate-500">LIVE LEDGER</span></div>
          <div className="h-36"><MiniLine values={candles.map(c => c.close)} /></div>
          <div className="text-[11px] text-slate-500">Chart uses authoritative NIFTY closes. Realized trade performance is shown separately only when broker history provides it.</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#04121f] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between"><h3 className="font-semibold">Recent Trades</h3><span className="text-[10px] text-slate-500">BROKER HISTORY</span></div>
          <div className="grid grid-cols-[1fr_60px_80px_90px] px-4 py-2 text-[10px] text-slate-500"><span>Symbol</span><span>Side</span><span>Status</span><span>Price</span></div>
          {(summary?.orderHistory || []).slice(0, 5).map((o: any) => <div key={o.id} className="grid grid-cols-[1fr_60px_80px_90px] px-4 py-2.5 border-t border-slate-800/70 text-xs"><span>{o.symbol}</span><span className={o.side === 'SELL' ? 'text-rose-400' : 'text-emerald-400'}>{o.side}</span><span>{o.status}</span><span>{o.price == null ? 'Market' : num(Number(o.price))}</span></div>)}
          {!(summary?.orderHistory?.length) && <div className="p-5 text-xs text-slate-600">No broker order history returned.</div>}
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#04121f] p-4">
          <div className="flex items-center justify-between mb-4"><h3 className="font-semibold">Risk Overview</h3><Settings2 className="w-4 h-4 text-slate-500"/></div>
          <div className="space-y-4 text-xs">
            <RiskRow label="Daily Loss Limit" value={`-${risk.dailyLimit.toFixed(2)}%`} />
            <RiskRow label="Risk Per Trade" value={`${risk.riskPerTrade.toFixed(2)}%`} />
            <RiskRow label="Open Positions" value={risk.maxPositions == null ? `${nsePositions.length} / —` : `${nsePositions.length} / ${risk.maxPositions}`} />
            <RiskRow label="Account Exposure" value={exposure == null ? '—' : `${exposure.toFixed(1)}%`} />
            <RiskRow label="Free Margin" value={nseAccount ? money(freeMargin, nseAccount.currency) : '—'} />
          </div>
        </div>
      </section>

      {/* Real-time Indian Market News & Sentiment Analysis */}
      <section className="w-full">
        <MarketNews maxArticles={30} />
      </section>

      <div className="flex items-center justify-between text-[10px] text-slate-600 font-mono px-1">
        <span>5paisa • LIVE market data • {indianSession.currentPhase}</span>
        <span>Account: {maskedAccount}</span>
      </div>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; sub: string; tone?: string }> = ({ label, value, sub, tone = 'text-white' }) => (
  <div className="rounded-xl border border-slate-800 bg-[#04121f] px-3 py-2 min-h-[68px]">
    <div className="text-[10px] text-slate-400 truncate">{label}</div>
    <div className={`text-base font-semibold mt-0.5 truncate ${tone}`}>{value}</div>
    <div className="text-[9px] text-slate-500 mt-0.5 truncate">{sub}</div>
  </div>
);

const RiskRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
    <span className="text-slate-400">{label}</span><b className="text-slate-200">{value}</b>
  </div>
);
