import React from 'react';
import { Activity, AlertOctagon, BarChart2, Database, Globe, RefreshCw, ShieldAlert } from 'lucide-react';
import { ForexSessionState, IndianSessionState } from '../markets/common/types';
import { BrokerType, TradingEnvironment } from '../brokers/types';
import { BalanceDisplay } from './BalanceDisplay';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  forexSessions: ForexSessionState;
  indianSession: IndianSessionState;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenDiagnostics: () => void;
  environment: TradingEnvironment;
  onRequestEnvironmentChange: (env: TradingEnvironment) => void;
  selectedBroker: BrokerType;
  maskedAccount?: string;
  autoTradingStatus?: { state?: string; autonomousPermission?: boolean } | null;
  isEmergencyHalted: boolean;
  onToggleKillSwitch: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  forexSessions,
  indianSession,
  onRefresh,
  isRefreshing,
  onOpenDiagnostics,
  environment,
  maskedAccount = '****',
  autoTradingStatus,
  isEmergencyHalted,
  onToggleKillSwitch
}) => {
  const isLive = true;
  const activeArea =
    activeTab === 'forex_terminal' ? 'FOREX' :
    activeTab === 'market' ? 'NSE' :
    activeTab === 'market_watch' ? 'MARKET WATCH' :
    activeTab === 'control_center' ? 'ORDERS' :
    activeTab === 'history' ? 'HISTORY' :
    activeTab === 'trading' ? 'POSITIONS' :
    activeTab === 'signals' ? 'STRATEGY' :
    activeTab === 'research' ? 'BACKTEST' :
    activeTab === 'pnl' ? 'REPORTS' :
    activeTab === 'settings' ? 'SETTINGS' : 'MARKET';

  const fxOpen = forexSessions.activeSessions.length > 0 && !forexSessions.activeSessions.includes('CLOSED (WEEKEND)');
  const fxLabel = forexSessions.activeSessions.length ? forexSessions.activeSessions.join(' / ') : 'CLOSED (WEEKEND)';
  const nseOpen = indianSession.isOpen;

  return (
    <header
      id="main_terminal_header"
      className="fixed top-0 left-0 right-0 z-[80] h-[126px] bg-[#07101a] border-b border-slate-800 text-slate-100 select-none shadow-xl"
    >
      <div
        id="global_telemetry_bar"
        className="h-7 bg-[#020711] border-b border-slate-800/80 px-4 flex items-center justify-between gap-3 text-[10px] font-mono overflow-hidden"
      >
        <div className="flex items-center gap-3 whitespace-nowrap min-w-0">
          <span>ACTIVE AREA: <b className="text-slate-200">{activeArea}</b></span>
          <span className="text-slate-700">|</span>
          <span>BROKERS: <b className="text-slate-200">cTrader + 5paisa</b></span>
          <span className="text-slate-700">|</span>
          <span>ENVIRONMENT: <b className="text-rose-400">LIVE</b></span>
          <span className="text-slate-700">|</span>
          <span>EXECUTION: <b className={autoTradingStatus?.autonomousPermission ? 'text-emerald-400' : 'text-amber-400'}>
            {autoTradingStatus?.autonomousPermission ? 'AUTO-LIVE (RUNNING)' : 'AUTO-READINESS (GATED)'}
          </b></span>
          <span className="text-slate-700">|</span>
          <span>DATA: <b className="text-emerald-400">FRESH (LIVE)</b></span>
          <span className="text-slate-700">|</span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            CLOCK: <b className="text-emerald-300">1S REALTIME</b>
          </span>
        </div>
        <div className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded border font-bold ${
          isEmergencyHalted
            ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
            : isLive
              ? 'bg-rose-950/70 border-rose-700 text-rose-300'
              : 'bg-amber-950/70 border-amber-700 text-amber-300'
        }`}>
          <ShieldAlert className="w-3 h-3" />
          <span>{isEmergencyHalted ? 'TRADING HALTED' : isLive ? 'LIVE TRADING' : environment + ' MODE'}</span>
          <span>({maskedAccount})</span>
        </div>
      </div>

      <div className="h-[99px] px-4 flex items-center gap-3 overflow-hidden">
        <div className="flex items-center gap-3 min-w-[265px] shrink-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shadow-inner">
            <BarChart2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white leading-tight">Goldcrest Finman - AI Trading</h1>
            <div className="text-[10px] text-emerald-400 font-bold font-mono mt-1">PRODUCTION TERMINAL</div>
          </div>
        </div>

        <div className="shrink-0">
          <BalanceDisplay environment="LIVE" />
        </div>

        <div className="flex flex-col gap-1.5 min-w-[210px] shrink-0">
          <div
            id="header_fx_session_badge"
            className={`h-7 flex items-center gap-1.5 px-2.5 rounded border text-[10px] font-mono ${
              fxOpen ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            <Globe className={`w-3 h-3 ${fxOpen ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="text-slate-400 font-semibold">FX:</span>
            <span className={`w-2 h-2 rounded-full ${fxOpen ? 'bg-emerald-500' : 'bg-slate-500'}`} />
            <span className="truncate">{fxLabel}</span>
          </div>
          <div
            id="header_nse_session_badge"
            className={`h-7 flex items-center gap-1.5 px-2.5 rounded border text-[10px] font-mono ${
              nseOpen ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            <Activity className={`w-3 h-3 ${nseOpen ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span className="text-slate-400 font-semibold">NSE:</span>
            <span className={`w-2 h-2 rounded-full ${nseOpen ? 'bg-emerald-500' : 'bg-amber-500/80'}`} />
            <span>{indianSession.istTime || '—'} ({indianSession.currentPhase})</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            id="btn_emergency_stop"
            onClick={onToggleKillSwitch}
            title={isEmergencyHalted ? 'Resume trading' : 'Emergency stop'}
            className={`w-9 h-9 rounded border flex items-center justify-center transition ${
              isEmergencyHalted ? 'bg-rose-600 border-rose-400 text-white animate-pulse' : 'bg-rose-950/40 border-rose-800 text-rose-300 hover:bg-rose-900/60'
            }`}
          >
            <AlertOctagon className="w-4 h-4" />
          </button>
          <button
            id="btn_terminal_refresh"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh quotes and signals"
            className="w-9 h-9 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 flex items-center justify-center"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : 'text-slate-300'}`} />
          </button>
          <button
            id="btn_open_diagnostics"
            onClick={onOpenDiagnostics}
            title="SQLite database and system diagnostics"
            className="w-9 h-9 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 flex items-center justify-center"
          >
            <Database className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>
    </header>
  );
};
