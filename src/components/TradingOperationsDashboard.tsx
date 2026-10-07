import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Server,
  Wallet,
  ClipboardCheck
} from 'lucide-react';

interface TradingOperationsDashboardProps {
  initialSubTab?: 'OPS' | 'RESEARCH' | 'EXPLORER';
  focusedSection?: 'RECONCILIATION' | 'PNL' | 'FUNNEL' | 'AUDIT';
}

export const TradingOperationsDashboard: React.FC<TradingOperationsDashboardProps> = () => {
  const [status, setStatus] = useState<any | null>(null);
  const [health, setHealth] = useState<any[]>([]);
  const [positionsRecon, setPositionsRecon] = useState<any[]>([]);
  const [ordersRecon, setOrdersRecon] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, healthRes, posRes, orderRes, auditRes] = await Promise.all([
        fetch('/api/governance/status', { cache: 'no-store' }),
        fetch('/api/governance/live-health', { cache: 'no-store' }),
        fetch('/api/governance/reconciliation/positions', { cache: 'no-store' }),
        fetch('/api/governance/reconciliation/orders', { cache: 'no-store' }),
        fetch('/api/governance/audit-logs?limit=50', { cache: 'no-store' })
      ]);

      if (statusRes.ok) setStatus(await statusRes.json());
      if (healthRes.ok) {
        const data = await healthRes.json();
        setHealth(Array.isArray(data?.components) ? data.components : []);
      }
      if (posRes.ok) setPositionsRecon(await posRes.json());
      if (orderRes.ok) setOrdersRecon(await orderRes.json());
      if (auditRes.ok) {
        const data = await auditRes.json();
        setAuditLogs(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to load live operations dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const emergencyHalted = Boolean(status?.emergencyStop?.isHalted);
  const autoState = status?.autoTrading?.state || 'STOPPED';

  return (
    <div className="space-y-4 font-mono text-xs text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white uppercase tracking-tight">Live Operations</h2>
            <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold">
              LIVE ONLY
            </span>
          </div>
          <p className="text-slate-400 mt-1">Authoritative broker state, execution safety, reconciliation and audit telemetry.</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Live State</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">AUTO LIVE</span>
            <ShieldAlert className={`w-4 h-4 ${autoState === 'RUNNING' ? 'text-emerald-400' : 'text-amber-400'}`} />
          </div>
          <div className="text-lg font-bold text-white mt-2">{autoState}</div>
          <div className="text-slate-500 mt-1">{status?.autoTrading?.lastCycleResult || 'No live runtime message yet.'}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">EMERGENCY STATE</span>
            {emergencyHalted ? <AlertTriangle className="w-4 h-4 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          </div>
          <div className={`text-lg font-bold mt-2 ${emergencyHalted ? 'text-rose-400' : 'text-emerald-400'}`}>
            {emergencyHalted ? 'HALTED' : 'NORMAL'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">LIVE BROKERS</span>
            <Wallet className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-lg font-bold text-white mt-2">
            {Array.isArray(status?.brokers) ? status.brokers.filter((b: any) => b?.connected && b?.environment === 'LIVE').length : 0} / 2
          </div>
          <div className="text-slate-500 mt-1">cTrader + 5paisa</div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Server className="w-4 h-4 text-emerald-400" />
          <h3 className="font-bold text-white uppercase">Live API Health</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {health.length === 0 ? (
            <div className="text-slate-500">Live API health is currently unavailable.</div>
          ) : health.map((component: any) => (
            <div key={component.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="flex justify-between gap-3">
                <span className="text-slate-200 font-bold">{component.name}</span>
                <span className={component.status === 'HEALTHY' ? 'text-emerald-400' : component.status === 'DEGRADED' ? 'text-amber-400' : 'text-rose-400'}>
                  {component.status}
                </span>
              </div>
              <div className="mt-2 text-slate-500">
                Latency: {Number.isFinite(component.latencyMs) && component.latencyMs > 0 ? `${component.latencyMs}ms` : '—'}
              </div>
              {component.currentFailureState && (
                <div className="mt-1 text-rose-300">{component.currentFailureState}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-white uppercase">Position Reconciliation</h3>
          </div>
          <div className="space-y-2">
            {positionsRecon.length === 0 ? (
              <div className="text-slate-500">No live reconciliation result available.</div>
            ) : positionsRecon.map((row: any) => (
              <div key={row.broker} className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-200">{row.broker} LIVE</div>
                  <div className="text-slate-500 mt-1">{row.details}</div>
                </div>
                <div className="text-right">
                  <div className="text-slate-200">{row.brokerCount ?? '—'}</div>
                  <div className="text-[10px] text-slate-500">{row.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck className="w-4 h-4 text-sky-400" />
            <h3 className="font-bold text-white uppercase">Order Reconciliation</h3>
          </div>
          <div className="space-y-2">
            {ordersRecon.length === 0 ? (
              <div className="text-slate-500">No live reconciliation result available.</div>
            ) : ordersRecon.map((row: any) => (
              <div key={row.broker} className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-200">{row.broker} LIVE</div>
                  <div className="text-slate-500 mt-1">{row.details}</div>
                </div>
                <div className="text-right">
                  <div className="text-slate-200">{row.brokerCount ?? '—'}</div>
                  <div className="text-[10px] text-slate-500">{row.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold text-white uppercase">Live Broker Audit</h3>
            <p className="text-slate-500 mt-1">Recent authenticated live broker actions only.</p>
          </div>
          <span className="text-slate-500">{auditLogs.length} events</span>
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {auditLogs.length === 0 ? (
            <div className="text-slate-500">No live broker audit events recorded.</div>
          ) : auditLogs.map((log: any) => (
            <div key={log.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <span className="text-white font-bold">{log.action}</span>
                <span className={log.result === 'SUCCESS' ? 'text-emerald-400' : log.result === 'BLOCKED' ? 'text-amber-400' : 'text-rose-400'}>
                  {log.result}
                </span>
              </div>
              <div className="text-slate-500 mt-1">
                {log.broker} · LIVE · {new Date(log.timestamp).toLocaleString()}
              </div>
              {log.error && <div className="text-rose-300 mt-1">{log.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
