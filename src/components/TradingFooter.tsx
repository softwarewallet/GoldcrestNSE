import React, { useMemo, useState, useEffect } from 'react';

interface FooterStatsProps {}

export const TradingFooter: React.FC<FooterStatsProps> = () => {
  const [summary, setSummary] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sRes, cRes] = await Promise.all([
          fetch('/api/brokers/dashboard-summary', { 
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
          }),
          fetch('/api/config', { 
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
          })
        ]);

        if (sRes.ok) {
          const contentType = sRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            setSummary(await sRes.json());
          } else {
            console.warn('Dashboard summary not JSON, ignoring.');
          }
        } else {
          console.warn(`Failed to fetch dashboard summary: ${sRes.status}`);
        }

        if (cRes.ok) {
          const contentType = cRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            setConfig(await cRes.json());
          } else {
            console.warn('Config not JSON, ignoring.');
          }
        } else {
          console.warn(`Failed to fetch config: ${cRes.status}`);
        }
      } catch (e) {
        console.error('Footer data fetch error (non-fatal):', e);
      }
    };
    fetchData();
  }, []);

  const { dailyRealizedPnL, orderHistory } = summary || { dailyRealizedPnL: 0, orderHistory: [] };
  const dailyTarget = config?.dailyProfitTarget || 500;

  const { totalTrades, winningTrades, losingTrades, pendingTrades } = useMemo(() => {
    if (!orderHistory || !Array.isArray(orderHistory)) return { totalTrades: 0, winningTrades: 0, losingTrades: 0, pendingTrades: 0 };
    const pending = orderHistory.filter((o: any) => o.status === 'PENDING').length;
    const completed = orderHistory.filter((o: any) => o.status === 'COMPLETED');
    const winning = completed.filter((o: any) => Number(o.pnl) > 0).length;
    const losing = completed.filter((o: any) => Number(o.pnl) <= 0).length;
    return {
      totalTrades: orderHistory.length,
      winningTrades: winning,
      losingTrades: losing,
      pendingTrades: pending
    };
  }, [orderHistory]);

  const netPnL = Number(dailyRealizedPnL || 0);
  const remainingTarget = dailyTarget - netPnL;

  const money = (v: number) =>
    Number.isFinite(v)
      ? '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-[70] h-10 border-t border-slate-800 bg-[#020c18] px-4 flex items-center justify-between text-[11px] font-mono text-slate-400">
      <div className="flex items-center gap-6">
        <span>TOTAL TRADES: <b className="text-white">{totalTrades}</b></span>
        <span>WINNING TRADES: <b className="text-emerald-400">{winningTrades}</b></span>
        <span>LOOSE TRADES: <b className="text-rose-400">{losingTrades}</b></span>
        <span>PENDING TRADES: <b className="text-amber-400">{pendingTrades}</b></span>
      </div>
      <div className="flex items-center gap-6">
        <span>TODAY'S NET P&L: <b className={netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{money(netPnL)}</b></span>
        <span>REMAINING TARGET: <b className="text-cyan-400">{money(remainingTarget)}</b></span>
      </div>
    </footer>
  );
};
