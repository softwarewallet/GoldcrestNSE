import React, { useEffect, useState } from 'react';
import {
  Server,
  Key,
  ShieldAlert,
  Sliders,
  Play,
  FileText,
  ShieldCheck,
  Award,
  Layers,
  CheckCircle2,
  Lock,
  Cpu,
  Activity,
  Download
} from 'lucide-react';
import { BrokerSettingsPanel } from './BrokerSettingsPanel';
import { BrokerType, TradingEnvironment } from '../brokers/types';

interface SettingsHubProps {
  currentEnvironment: TradingEnvironment;
  selectedBroker: BrokerType;
  onEnvironmentChange: (env: TradingEnvironment) => void;
  onBrokerSelect: (broker: BrokerType) => void;
  onRefreshGlobal?: () => void;
}


const LiveRuntimeLogSettings: React.FC = () => {
  const [status, setStatus] = useState<{
    enabled: boolean;
    file: string;
    exists: boolean;
    sizeBytes: number;
    lastModifiedAt: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<Array<{ date: string; file: string; sizeBytes: number; lastModifiedAt: string | null }>>([]);

  const refresh = async () => {
    try {
      const [res, filesRes] = await Promise.all([
        fetch('/api/live-log/status'),
        fetch('/api/live-log/files')
      ]);
      const data = await res.json();
      if (res.ok) setStatus(data);
      if (filesRes.ok) {
        const archive = await filesRes.json();
        setFiles(Array.isArray(archive.files) ? archive.files : []);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to read log status.');
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const toggle = async () => {
    setBusy(true);
    setMessage('');
    try {
      const endpoint = status?.enabled ? '/api/live-log/stop' : '/api/live-log/start';
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to change log state.');
      setStatus({ ...status, ...data, file: data.file || status?.file || '' });
      setMessage(status?.enabled ? 'Live runtime logging stopped.' : 'Live runtime logging started.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to change log state.');
    } finally {
      setBusy(false);
    }
  };

  const openLog = (date?: string) => {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    window.open(`/api/live-log/file${query}`, '_blank', 'noopener,noreferrer');
  };

  const sizeLabel = status ? `${(status.sizeBytes / 1024).toFixed(1)} KB` : '—';

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">LIVE Runtime Audit Log</h3>
            </div>
            <p className="text-xs text-slate-400 mt-2 max-w-3xl">
              Records sanitized live-environment events to a normal text file so runtime activity can be audited after a trading session.
              Credentials and access tokens are redacted before anything is written.
            </p>
          </div>
          <div className={`px-3 py-1 rounded border text-xs font-bold font-mono ${
            status?.enabled
              ? 'text-emerald-300 bg-emerald-950/60 border-emerald-700'
              : 'text-amber-300 bg-amber-950/60 border-amber-700'
          }`}>
            {status?.enabled ? 'RECORDING' : 'STOPPED'}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3 mt-5">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] uppercase text-slate-500 font-mono">FILE</div>
            <div className="text-xs text-slate-200 font-mono mt-1 break-all">{status?.file || 'logs/goldcrest-live.log'}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] uppercase text-slate-500 font-mono">SIZE</div>
            <div className="text-xs text-slate-200 font-mono mt-1">{sizeLabel}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] uppercase text-slate-500 font-mono">LAST UPDATE</div>
            <div className="text-xs text-slate-200 font-mono mt-1">{status?.lastModifiedAt ? new Date(status.lastModifiedAt).toLocaleString() : '—'}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-5">
          <button
            onClick={toggle}
            disabled={busy}
            className={`px-4 py-2 rounded text-xs font-bold border disabled:opacity-50 ${
              status?.enabled
                ? 'bg-rose-950/60 border-rose-700 text-rose-300 hover:bg-rose-900/60'
                : 'bg-emerald-700 border-emerald-600 text-white hover:bg-emerald-600'
            }`}
          >
            {busy ? 'WORKING…' : status?.enabled ? 'STOP LIVE LOG' : 'START LIVE LOG'}
          </button>
          <button
            onClick={() => void openLog()}
            disabled={!status?.exists}
            className="px-4 py-2 rounded bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold disabled:opacity-50"
          >
            <Download className="inline w-3.5 h-3.5 mr-1" /> OPEN LOG
          </button>
          <button
            onClick={() => void refresh()}
            className="px-4 py-2 rounded bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold"
          >
            REFRESH STATUS
          </button>
          {message && <span className="text-[10px] text-slate-400 font-mono">{message}</span>}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-white">Daily Audit Archive</div>
            <p className="text-xs text-slate-500 mt-1">Each calendar date is stored as a separate text file for long-term auditability.</p>
          </div>
          <span className="text-[10px] font-mono text-slate-500">{files.length} day{files.length === 1 ? '' : 's'}</span>
        </div>
        <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
          {files.length === 0 ? (
            <div className="text-xs text-slate-500 font-mono p-3 bg-slate-950 border border-slate-800 rounded-lg">No daily runtime log files yet.</div>
          ) : files.map(item => (
            <div key={item.date} className="flex items-center justify-between gap-3 p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="min-w-0">
                <div className="text-xs text-slate-200 font-mono">{item.date}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  {(item.sizeBytes / 1024).toFixed(1)} KB · {item.lastModifiedAt ? new Date(item.lastModifiedAt).toLocaleString() : '—'}
                </div>
              </div>
              <button onClick={() => openLog(item.date)} className="shrink-0 px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-200 text-[10px] font-bold">
                OPEN {item.date}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-cyan-950/20 border border-cyan-900 rounded-xl p-4 text-xs text-slate-300">
        <div className="font-bold text-cyan-300">Audit workflow</div>
        <div className="mt-2 font-mono text-[11px] leading-5">
          START LIVE LOG → run your live test → STOP LIVE LOG → provide the relevant <span className="text-cyan-300">logs/goldcrest-live-YYYY-MM-DD.log</span> file for audit.
        </div>
      </div>
    </div>
  );
};


interface ResearchAiGatewayConfig {
  enabled: boolean;
  baseUrl: string;
  llamaModel: string;
  qwenModel: string;
  healthPath: string;
  predictPath: string;
  timeoutMs: number;
  authConfigured: boolean;
  updatedAt: number | null;
}

const ResearchAiServerSettings: React.FC = () => {
  const [config, setConfig] = useState<ResearchAiGatewayConfig>({
    enabled: false,
    baseUrl: '',
    llamaModel: '',
    qwenModel: '',
    healthPath: '/health',
    predictPath: '/predict',
    timeoutMs: 10000,
    authConfigured: false,
    updatedAt: null
  });
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [testResult, setTestResult] = useState('');
  const [predictionTestResult, setPredictionTestResult] = useState('');

  const load = async () => {
    try {
      const res = await fetch('/api/research-ai/server', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to load AI gateway settings.');
      if (data.server) setConfig(data.server);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load AI gateway settings.');
    }
  };

  useEffect(() => { void load(); }, []);

  const update = (patch: Partial<ResearchAiGatewayConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }));
  };

  const save = async () => {
    setBusy('SAVE');
    setMessage('');
    try {
      const body: Record<string, unknown> = {
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        llamaModel: config.llamaModel,
        qwenModel: config.qwenModel,
        healthPath: config.healthPath,
        predictPath: config.predictPath,
        timeoutMs: config.timeoutMs
      };
      if (token !== '') body.authToken = token;
      const res = await fetch('/api/research-ai/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to save AI gateway settings.');
      setConfig(data.server);
      setToken('');
      setMessage('AI gateway settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save AI gateway settings.');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('TEST');
    setTestResult('Testing…');
    try {
      const res = await fetch('/api/research-ai/server/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      setTestResult(data.ok
        ? `CONNECTED · ${data.status} · ${data.latencyMs} ms`
        : `NOT CONNECTED · ${data.message}`);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'Connection test failed.');
    } finally {
      setBusy(null);
    }
  };

  const testPrediction = async () => {
    setBusy('PREDICTION');
    setPredictionTestResult('Testing prediction contract…');
    try {
      const res = await fetch('/api/research-ai/server/test-prediction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      setPredictionTestResult(data.ok
        ? `PREDICTION OK · ${data.direction} · confidence ${Math.round(Number(data.confidence) * 100)}% · ${data.latencyMs} ms`
        : `PREDICTION FAILED · ${data.message}`);
    } catch (error) {
      setPredictionTestResult(error instanceof Error ? error.message : 'Prediction contract test failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-cyan-950/20 border border-cyan-900 rounded-xl p-4 text-xs text-slate-300">
        <div className="font-bold text-cyan-300">Optional AI Research Gateway</div>
        <div className="mt-2 leading-5">
          Goldcrest uses one connection only. The remote server is Llama-hosted and may run Qwen internally.
          Qwen and Llama therefore share the same gateway URL, authentication and network connection.
          Both remain optional: Goldcrest works normally with this connector disabled or unavailable.
          This gateway is research-only and is not part of Auto Live execution or broker safety decisions.
        </div>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">LLAMA AI GATEWAY · QWEN + LLAMA</h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">Single plug-and-play connection for the future external AI server.</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={config.enabled} onChange={e => update({ enabled: e.target.checked })} />
            ENABLED
          </label>
        </div>

        <div className="grid md:grid-cols-2 gap-3 mt-4">
          <label className="text-[10px] uppercase text-slate-500 font-mono">
            SERVER BASE URL
            <input value={config.baseUrl} onChange={e => update({ baseUrl: e.target.value })} placeholder="http://192.168.1.50:8000" className="mt-1 w-full rounded bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white" />
          </label>
          <label className="text-[10px] uppercase text-slate-500 font-mono">
            LLAMA MODEL
            <input value={config.llamaModel} onChange={e => update({ llamaModel: e.target.value })} placeholder="llama3.3" className="mt-1 w-full rounded bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white" />
          </label>
          <label className="text-[10px] uppercase text-slate-500 font-mono">
            QWEN MODEL
            <input value={config.qwenModel} onChange={e => update({ qwenModel: e.target.value })} placeholder="qwen3" className="mt-1 w-full rounded bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white" />
          </label>
          <label className="text-[10px] uppercase text-slate-500 font-mono">
            HEALTH PATH
            <input value={config.healthPath} onChange={e => update({ healthPath: e.target.value })} className="mt-1 w-full rounded bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white" />
          </label>
          <label className="text-[10px] uppercase text-slate-500 font-mono">
            PREDICTION PATH
            <input value={config.predictPath} onChange={e => update({ predictPath: e.target.value })} className="mt-1 w-full rounded bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white" />
          </label>
          <label className="text-[10px] uppercase text-slate-500 font-mono">
            TIMEOUT (MS)
            <input type="number" min={1000} max={60000} value={config.timeoutMs} onChange={e => update({ timeoutMs: Number(e.target.value) })} className="mt-1 w-full rounded bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white" />
          </label>
          <label className="text-[10px] uppercase text-slate-500 font-mono md:col-span-2">
            AUTH TOKEN
            <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={config.authConfigured ? 'Configured · leave blank to keep' : 'Optional bearer token'} className="mt-1 w-full rounded bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white" />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button onClick={() => void save()} disabled={busy !== null} className="px-4 py-2 rounded bg-emerald-700 border border-emerald-600 text-white text-xs font-bold disabled:opacity-50">
            {busy === 'SAVE' ? 'SAVING…' : 'SAVE CONNECTION'}
          </button>
          <button onClick={() => void test()} disabled={busy !== null || !config.baseUrl} className="px-4 py-2 rounded bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold disabled:opacity-50">
            {busy === 'TEST' ? 'TESTING…' : 'TEST CONNECTION'}
          </button>
          <button onClick={() => void testPrediction()} disabled={busy !== null || !config.baseUrl} className="px-4 py-2 rounded bg-cyan-900/50 border border-cyan-700 text-cyan-200 text-xs font-bold disabled:opacity-50">
            {busy === 'PREDICTION' ? 'TESTING…' : 'TEST PREDICTION'}
          </button>
          <span className={`text-[10px] font-mono ${config.enabled ? 'text-emerald-300' : 'text-slate-500'}`}>
            {config.enabled ? 'GATEWAY ENABLED · QWEN + LLAMA' : 'DISABLED · GOLDCREST WORKS WITHOUT IT'}
          </span>
        </div>
        {testResult && <div className="mt-3 text-[10px] font-mono text-slate-300">{testResult}</div>}
        {predictionTestResult && <div className="mt-2 text-[10px] font-mono text-cyan-300">{predictionTestResult}</div>}
        {message && <div className="mt-2 text-[10px] text-slate-400 font-mono">{message}</div>}
      </div>
    </div>
  );
};

export const SettingsHub: React.FC<SettingsHubProps> = ({
  currentEnvironment,
  selectedBroker,
  onEnvironmentChange,
  onBrokerSelect,
  onRefreshGlobal
}) => {
  const [activeSettingsSection, setActiveSettingsSection] = useState<'BROKER_CONFIG' | 'LIVE_LOG' | 'RESEARCH_AI'>('BROKER_CONFIG');

  return (
    <div id="unified_settings_hub" className="space-y-4">
      {/* Top Settings Sub-Navigation Tabs */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-2 px-3 shadow-md">
        <div className="flex items-center space-x-1.5 overflow-x-auto text-xs font-mono">
          <span className="text-slate-500 font-semibold px-2 uppercase text-[10px] hidden sm:inline">
            SETTINGS AREA:
          </span>
          {[
            { id: 'BROKER_CONFIG', label: 'BROKER & RISK CONFIGURATION', icon: Server },
            { id: 'LIVE_LOG', label: 'LIVE RUNTIME LOG', icon: Activity },
            { id: 'RESEARCH_AI', label: 'OPTIONAL AI SERVERS', icon: Cpu }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeSettingsSection === tab.id;
            return (
              <button
                key={tab.id}
                id={`settings_section_${tab.id.toLowerCase()}`}
                onClick={() => setActiveSettingsSection(tab.id as any)}
                className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-lg font-bold transition whitespace-nowrap ${
                  isSel
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="hidden md:flex items-center space-x-2 text-[11px] font-mono text-slate-400">
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span>Encrypted Secure Storage</span>
        </div>
      </div>

      {activeSettingsSection === 'RESEARCH_AI' && <ResearchAiServerSettings />}

      {activeSettingsSection === 'LIVE_LOG' && (
        <LiveRuntimeLogSettings />
      )}

      {/* Render Selected Sub-Section */}
      {activeSettingsSection === 'BROKER_CONFIG' && (
        <BrokerSettingsPanel
          currentEnvironment={currentEnvironment}
          selectedBroker={selectedBroker}
          onEnvironmentChange={onEnvironmentChange}
          onBrokerSelect={onBrokerSelect}
          onRefreshGlobal={onRefreshGlobal}
        />
      )}

      {activeSettingsSection !== 'BROKER_CONFIG' && activeSettingsSection !== 'LIVE_LOG' && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
          Retired research and model-governance workflows are not part of the LIVE production runtime.
        </div>
      )}
    </div>
  );
};
