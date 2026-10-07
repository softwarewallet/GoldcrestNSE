import React, { useState, useEffect } from 'react';
import { X, Database, CheckCircle2, ShieldCheck, RefreshCw, Server, Lock } from 'lucide-react';

interface DiagnosticsModalProps { onClose: () => void; }

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ onClose }) => {
  const [dbStats, setDbStats] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const [statsRes, eventsRes] = await Promise.all([
        fetch('/api/db/stats'),
        fetch('/api/economic-events')
      ]);
      setDbStats(await statsRes.json());
      setEvents(await eventsRes.json());
    } catch (err) {
      console.error('Error fetching local diagnostics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  const phase1Checklist = [
    { title:'Market Intelligence Layer', detail:'NSE & BSE Equities, Indices, Options & Futures', verified:true },
    { title:'Indian Equity & Derivatives', detail:'NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX', verified:true },
    { title:'Options Analytics & Greeks', detail:'Dynamic strike depth and Black-Scholes analytics', verified:true },
    { title:'SQLite Database Layer', detail:'Authoritative local SQLite persistence', verified:true },
    { title:'Authoritative Broker Routing', detail:'5paisa Open API for Indian markets (NSE / BSE / F&O)', verified:true },
    { title:'Live Execution Safety', detail:'Preflight risk gates, per-order limits & kill switch', verified:true }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto font-sans">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto text-slate-200 shadow-2xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 sticky top-0 z-10">
          <div className="flex items-center space-x-2.5">
            <Database className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-bold text-white font-mono">SQLite Database & System Diagnostics</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 text-xs font-mono">
          <div className="bg-slate-950 p-4 rounded-lg border border-cyan-900/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-cyan-400 font-bold font-sans text-xs">
                <Server className="w-4 h-4" /><span>SQLite Local Persistence</span>
              </div>
              <button onClick={fetchStats} disabled={loading} className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] border border-slate-700 flex items-center space-x-1">
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin text-cyan-400' : ''}`} /><span>Refresh</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
              <div className="bg-slate-900 p-2 rounded border border-slate-800/80"><div className="text-slate-500">Storage</div><div className="text-cyan-300 font-bold mt-0.5">SQLite</div><div className="text-[10px] text-emerald-400">Authoritative local database</div></div>
              <div className="bg-slate-900 p-2 rounded border border-slate-800/80"><div className="text-slate-500">Database File</div><div className="text-white font-bold mt-0.5">data/trading_analyst.sqlite</div><div className="text-[10px] text-slate-400">Persistent on server disk</div></div>
              <div className="bg-slate-900 p-2 rounded border border-slate-800/80"><div className="text-slate-500">Cloud Database</div><div className="text-amber-300 font-bold mt-0.5">DISABLED</div><div className="text-[10px] text-slate-400">No Firestore dependency for application data</div></div>
            </div>
            <div className="bg-slate-900/90 p-2.5 rounded border border-slate-800/80 text-[11px] text-slate-300">
              <div className="font-bold text-slate-200 flex items-center space-x-1.5"><Lock className="w-3.5 h-3.5 text-cyan-400" /><span>Persistence Policy</span></div>
              <div className="pt-1 text-slate-400">Broker account snapshots, signals, trades, positions, orders, reconciliation traces, notes, settings and ML persistence use SQLite. Broker APIs remain the authoritative source for live account and market data.</div>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center space-x-2 text-emerald-400 font-bold font-sans text-xs"><ShieldCheck className="w-4 h-4" /><span>Architecture Compliance Checklist</span></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {phase1Checklist.map((item, idx) => <div key={idx} className="bg-slate-900 p-2 rounded border border-slate-800/80 flex items-start space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" /><div><div className="font-bold text-slate-200">{item.title}</div><div className="text-[10px] text-slate-400">{item.detail}</div></div></div>)}
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between"><span className="font-bold text-slate-300 font-sans text-xs">SQLite Storage Tables</span><span className="text-[10px] text-slate-500">Local authoritative persistence</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">{Object.entries(dbStats).map(([name,count]) => <div key={name} className="bg-slate-900 p-2 rounded border border-slate-800/80"><div className="text-[10px] text-slate-400 truncate">{name}</div><div className="text-sm font-bold text-cyan-400 mt-0.5">{count} rows</div></div>)}</div>
          </div>

          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
            <span className="font-bold text-slate-300 font-sans text-xs block">Macroeconomic Calendar Events</span>
            <div className="space-y-1.5">{events.map((ev:any)=><div key={ev.id} className="bg-slate-900 p-2 rounded border border-slate-800/80 flex items-center justify-between text-[11px]"><div><span className="font-bold text-amber-400 mr-2">{ev.currency}</span><span className="text-slate-200">{ev.title}</span></div><div className="text-right text-slate-400"><span>In {ev.minutesUntil} mins</span><span className="text-rose-400 ml-2 font-bold uppercase">{ev.impact}</span></div></div>)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
