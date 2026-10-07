import React, { useState, useMemo } from 'react';
import { TradingSignal } from '../markets/common/types';
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  XCircle,
  Filter,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Sparkles,
  ShieldCheck,
  History
} from 'lucide-react';

interface SignalsViewProps {
  signals: TradingSignal[];
  onSelectSignal: (signal: TradingSignal) => void;
}

export const SignalsView: React.FC<SignalsViewProps> = ({ signals, onSelectSignal }) => {
  const [activeCategory, setActiveCategory] = useState<
    'ALL' | 'FOREX' | 'INDIAN_EQUITY' | 'INDIAN_OPTIONS' | 'QUALIFIED' | 'WATCHLIST' | 'NO_TRADE' | 'HISTORY'
  >('ALL');
  const [directionFilter, setDirectionFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');

  const filteredSignals = useMemo(() => {
    return signals.filter(s => {
      const matchSearch =
        s.instrument.toLowerCase().includes(search.toLowerCase()) ||
        s.strategy.toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;

      // Category filter
      if (activeCategory === 'FOREX' && s.market !== 'FOREX') return false;
      if (activeCategory === 'INDIAN_EQUITY' && s.market !== 'INDIA_EQUITY') return false;
      if (activeCategory === 'INDIAN_OPTIONS' && s.market !== 'INDIA_OPTIONS') return false;
      if (activeCategory === 'QUALIFIED' && (s.direction === 'WAIT' || s.direction === 'NO_TRADE' || (s.mlProbability && s.mlProbability < 0.60))) return false;
      if (activeCategory === 'WATCHLIST' && s.direction !== 'WAIT') return false;
      if (activeCategory === 'NO_TRADE' && s.direction !== 'NO_TRADE') return false;

      // Direction Filter
      if (directionFilter !== 'ALL' && s.direction !== directionFilter) return false;

      return true;
    });
  }, [signals, activeCategory, directionFilter, search]);

  return (
    <div id="consolidated_signals_view" className="space-y-4 font-sans text-slate-200">
      {/* Category Sub-Navigation Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 px-3 shadow-md">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono w-full">
          {[
            { id: 'ALL', label: 'ALL SIGNALS', icon: Layers, count: signals.length },
            { id: 'FOREX', label: 'FOREX', icon: Sparkles, count: signals.filter(s => s.market === 'FOREX').length },
            { id: 'INDIAN_EQUITY', label: 'INDIAN EQUITIES', icon: Sparkles, count: signals.filter(s => s.market === 'INDIA_EQUITY').length },
            { id: 'INDIAN_OPTIONS', label: 'OPTIONS', icon: Sparkles, count: signals.filter(s => s.market === 'INDIA_OPTIONS').length },
            { id: 'QUALIFIED', label: 'QUALIFIED (≥60% ML)', icon: ShieldCheck, count: signals.filter(s => s.direction !== 'WAIT' && s.direction !== 'NO_TRADE' && s.mlProbability >= 0.60).length },
            { id: 'WATCHLIST', label: 'WATCH (WAIT)', icon: Clock, count: signals.filter(s => s.direction === 'WAIT').length },
            { id: 'NO_TRADE', label: 'NO TRADE / CONFLICT', icon: XCircle, count: signals.filter(s => s.direction === 'NO_TRADE').length },
            { id: 'HISTORY', label: 'SIGNAL HISTORY', icon: History, count: signals.length }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeCategory === tab.id;
            return (
              <button
                key={tab.id}
                id={`sig_tab_${tab.id.toLowerCase()}`}
                onClick={() => setActiveCategory(tab.id as any)}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg font-bold transition min-w-0 ${
                  isSel
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 border border-slate-800/80'
                }`}
              >
                <div className="flex items-center space-x-1.5 min-w-0 truncate">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0 ml-1.5 ${
                  isSel ? 'bg-emerald-900/80 text-emerald-200' : 'bg-slate-800 text-slate-400'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Controls & Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search instrument or strategy..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded pl-8 pr-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-emerald-500 w-60"
            />
          </div>
        </div>

        {/* Action / Direction Filter */}
        <div className="flex items-center space-x-2 text-xs font-mono">
          <span className="text-slate-400">Action:</span>
          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5">
            {(['ALL', 'BUY', 'SELL', 'WAIT', 'NO_TRADE'] as const).map(d => (
              <button
                key={d}
                onClick={() => setDirectionFilter(d)}
                className={`px-2.5 py-0.5 rounded text-[11px] transition ${
                  directionFilter === d ? 'bg-slate-800 text-white font-bold' : 'text-slate-400'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Signals Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Instrument</th>
                <th className="py-2.5 px-3">Market</th>
                <th className="py-2.5 px-3">Strategy</th>
                <th className="py-2.5 px-3">Direction</th>
                <th className="py-2.5 px-3">Entry Zone</th>
                <th className="py-2.5 px-3">Stop Loss</th>
                <th className="py-2.5 px-3">Targets</th>
                <th className="py-2.5 px-3 text-right">Rule Score</th>
                <th className="py-2.5 px-3 text-right">ML Prob</th>
                <th className="py-2.5 px-3 text-right">R:R</th>
                <th className="py-2.5 px-3 text-center">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-500 font-mono">
                    No signals found matching the selected filter criteria.
                  </td>
                </tr>
              ) : (
                filteredSignals.map(sig => {
                  const isBuy = sig.direction === 'BUY';
                  const isSell = sig.direction === 'SELL';
                  const isNoTrade = sig.direction === 'NO_TRADE';

                  return (
                    <tr
                      key={sig.id}
                      onClick={() => onSelectSignal(sig)}
                      className="hover:bg-slate-800/50 cursor-pointer transition"
                    >
                      <td className="py-2.5 px-3 font-bold text-white">{sig.instrument}</td>
                      <td className="py-2.5 px-3 text-slate-400">{sig.market}</td>
                      <td className="py-2.5 px-3 text-slate-300 truncate max-w-[140px]">{sig.strategy}</td>
                      <td className="py-2.5 px-3">
                        {isBuy ? (
                          <span className="inline-flex items-center space-x-1 text-emerald-400 font-bold bg-emerald-950/80 border border-emerald-800/80 px-2 py-0.5 rounded text-[11px]">
                            <ArrowUpRight className="w-3 h-3" />
                            <span>BUY</span>
                          </span>
                        ) : isSell ? (
                          <span className="inline-flex items-center space-x-1 text-rose-400 font-bold bg-rose-950/80 border border-rose-800/80 px-2 py-0.5 rounded text-[11px]">
                            <ArrowDownRight className="w-3 h-3" />
                            <span>SELL</span>
                          </span>
                        ) : isNoTrade ? (
                          <span className="inline-flex items-center space-x-1 text-slate-400 bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-[11px]">
                            <XCircle className="w-3 h-3 text-rose-400" />
                            <span>NO TRADE</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded text-[11px]">
                            <Minus className="w-3 h-3" />
                            <span>WAIT</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">{sig.entryZone.preferred}</td>
                      <td className="py-2.5 px-3 text-rose-400">{sig.stopLoss}</td>
                      <td className="py-2.5 px-3 text-emerald-400">
                        TP1: {sig.target1}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={`font-bold ${sig.score >= 80 ? 'text-emerald-400' : sig.score >= 60 ? 'text-cyan-300' : 'text-slate-400'}`}>
                          {sig.score}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        <span className={`font-bold ${sig.mlProbability >= 0.65 ? 'text-emerald-400' : sig.mlProbability >= 0.55 ? 'text-indigo-300' : 'text-slate-400'}`}>
                          {(sig.mlProbability * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        1:{sig.riskReward}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectSignal(sig);
                          }}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 text-[11px] transition border border-slate-700"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
