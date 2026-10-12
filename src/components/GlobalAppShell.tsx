import React, { useState } from 'react';
import {
  Bell, BookOpen, CandlestickChart, ChevronDown, ChevronRight,
  Grid2X2, ListChecks, Settings, Sparkles, TrendingUp, Activity, History as HistoryIcon, Database
} from 'lucide-react';
import { IndianSessionState } from '../markets/common/types';
import { TradingFooter } from './TradingFooter';

interface GlobalAppShellProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  children: React.ReactNode;
  header: React.ReactNode;
  indianSession: IndianSessionState;
  indianUnderlyings: any[];
}

const nav = [
  { id: 'dashboard', label: 'Dashboard', icon: Grid2X2 },
  { id: 'trading', label: 'Positions', icon: CandlestickChart },
  { id: 'control_center', label: 'Orders', icon: ListChecks },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'signals', label: 'Strategy', icon: Sparkles },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export const GlobalAppShell: React.FC<GlobalAppShellProps> = ({
  activeTab, setActiveTab, children, header, indianSession, indianUnderlyings
}) => {
  const getIndex = (symbol: string) => {
    const item = indianUnderlyings.find((u: any) => String(u?.symbol || '').toUpperCase() === symbol);
    const spot = Number(item?.spot ?? item?.currentPrice);
    const changePercent = Number(item?.changePercent ?? item?.changePct);
    return {
      spot: Number.isFinite(spot) ? spot.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—',
      change: Number.isFinite(changePercent) ? `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%` : '—',
      positive: !Number.isFinite(changePercent) || changePercent >= 0
    };
  };

  return (
    <div className="min-h-screen bg-[#03070d] text-slate-100">
      {header}

      <aside
        id="global_fixed_sidebar"
        style={{ width: '200px' }}
        className="fixed top-[126px] bottom-9 left-0 z-[60] w-[200px] border-r border-slate-800/80 bg-[#02070d] flex flex-col"
      >
        <nav 
          style={{ width: '200px' }}
          className="flex-1 overflow-y-auto px-3 pt-3 pb-3 w-[200px]"
        >
          <div className="space-y-[-4px]">
            {nav.map(item => {
              const Icon = item.icon;
              const selected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full h-[40px] flex items-center gap-3 px-4 rounded-lg text-sm transition text-left ${
                    selected
                      ? 'bg-slate-900 border border-slate-700 text-white font-semibold'
                      : 'border border-transparent text-slate-300 hover:text-white hover:bg-slate-900/60'
                  }`}
                >
                  <Icon className={`w-[18px] h-[18px] ${
                    selected ? 'text-slate-200' : 'text-slate-400'
                  }`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div 
          style={{ width: '200px' }}
          className="px-3 pb-3 shrink-0 w-[200px]"
        >
          <div 
            style={{ padding: '5px' }}
            className="rounded-xl bg-[#07101b] border border-slate-800/80 p-[5px]"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#12366d] border border-blue-500/40 flex items-center justify-center text-white font-semibold">P</div>
              <div className="min-w-0">
                <div 
                  style={{ fontSize: '13px' }}
                  className="text-[13px] font-semibold truncate text-slate-100"
                >
                  Prernaa Sharmaa
                </div>
                <div className="text-[11px] text-slate-400">Administrator</div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main
        id="global_app_content"
        className="ml-[200px] min-h-screen pt-[126px] pb-9 bg-[#03070d] text-slate-100"
      >
        {children}
      </main>

      <TradingFooter />
    </div>
  );
};
