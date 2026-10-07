import React, { useEffect, useState } from 'react';
import { Server, ShieldCheck, RefreshCw, CheckCircle2, XCircle, Lock, Database, IndianRupee, Sliders } from 'lucide-react';
import { BrokerCredentialStatus, BrokerType, TradingEnvironment, ConnectionTestResult } from '../brokers/types';

interface BrokerSettingsPanelProps {
  currentEnvironment: TradingEnvironment;
  selectedBroker?: BrokerType;
  onEnvironmentChange: (env: TradingEnvironment) => void;
  onBrokerSelect?: (broker: BrokerType) => void;
  onRefreshGlobal?: () => void;
}

type LiveForm = Record<string, string>;

const emptyFivePaisa: LiveForm = {
  appName: '',
  appSource: '',
  userId: '',
  password: '',
  userKey: '',
  encryptionKey: '',
  clientCode: '',
  accessToken: '',
  totpSecret: '',
  pin: ''
};

interface BrokerCredentialFieldProps {
  name: string;
  label: string;
  secret?: boolean;
  value: string;
  onChange: (name: string, value: string) => void;
  inputClass: string;
}

const BrokerCredentialField: React.FC<BrokerCredentialFieldProps> = React.memo(({
  name,
  label,
  secret = false,
  value,
  onChange,
  inputClass
}) => (
  <label className="block space-y-1">
    <span className="text-[10px] uppercase text-slate-500 font-mono">{label}</span>
    <input
      className={inputClass}
      type={secret ? 'password' : 'text'}
      value={value}
      onChange={e => onChange(name, e.target.value)}
      autoComplete="off"
    />
  </label>
));

export const BrokerSettingsPanel: React.FC<BrokerSettingsPanelProps> = ({
  onRefreshGlobal
}) => {
  const [statuses, setStatuses] = useState<BrokerCredentialStatus[]>([]);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [form, setForm] = useState<LiveForm>({ ...emptyFivePaisa });
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [maxIndianInr, setMaxIndianInr] = useState(1000000);
  const [savingLimits, setSavingLimits] = useState(false);
  const [limitMessage, setLimitMessage] = useState('');
  const [autoLiveMinSignalScore, setAutoLiveMinSignalScore] = useState(75);
  const [autoLiveMaxTradesPerPair, setAutoLiveMaxTradesPerPair] = useState(4);
  const [maxOpenPositions, setMaxOpenPositions] = useState(5);
  const [savingAutoLiveControls, setSavingAutoLiveControls] = useState(false);
  const [autoLiveControlsMessage, setAutoLiveControlsMessage] = useState('');
  const [autoLiveIndianUnderlyings, setAutoLiveIndianUnderlyings] = useState<string[]>([
    'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'
  ]);
  const [savingUniverse, setSavingUniverse] = useState(false);
  const [universeMessage, setUniverseMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch('/api/brokers/status', { cache: 'no-store' }).catch(() => null),
        fetch('/api/config', { cache: 'no-store' }).catch(() => null)
      ]);

      if (statusRes?.ok) {
        const data = await statusRes.json();
        setStatuses(data.credentials || []);
      }

      if (configRes?.ok) {
        const config = await configRes.json();
        if (Number.isFinite(Number(config.maxTradeValueIndianInr))) {
          setMaxIndianInr(Number(config.maxTradeValueIndianInr));
        }
        if (Number.isFinite(Number(config.autoLiveMinSignalScore))) {
          setAutoLiveMinSignalScore(Number(config.autoLiveMinSignalScore));
        }
        if (Number.isFinite(Number(config.autoLiveMaxTradesPerPair))) {
          setAutoLiveMaxTradesPerPair(Number(config.autoLiveMaxTradesPerPair));
        }
        if (Number.isFinite(Number(config.maxOpenPositions))) {
          setMaxOpenPositions(Number(config.maxOpenPositions));
        }
        if (Array.isArray(config.autoLiveIndianUnderlyings)) {
          setAutoLiveIndianUnderlyings(config.autoLiveIndianUnderlyings);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateField = (name: string, value: string) => {
    setForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const save = async () => {
    if (!ack) {
      alert('Please acknowledge that these credentials access the 5paisa LIVE broker environment.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/brokers/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker: 'FIVE_PAISA', environment: 'LIVE', credentials: form })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save credentials');
      await load();
      onRefreshGlobal?.();
      alert('5paisa credentials saved successfully.');
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch('/api/brokers/test?broker=FIVE_PAISA&environment=LIVE');
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setResult({ broker: 'FIVE_PAISA', environment: 'LIVE', connected: false, error: err.message, timestamp: Date.now() });
    } finally {
      setTesting(false);
    }
  };

  const status = statuses.find(s => s.broker === 'FIVE_PAISA' && s.environment === 'LIVE');
  const inputClass = 'w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono outline-none focus:border-emerald-600';

  return (
    <div id="broker_settings_panel" className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-emerald-400 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-white">5paisa Indian Broker Configuration</div>
            <p className="text-xs text-slate-400 mt-1">
              5paisa LIVE API handles execution and market data for NSE Equities, Indices, Futures, and Options Chains. Broker credentials are securely held server-side in SQLite.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-xs text-amber-300 font-mono">
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
          I acknowledge that these credentials access the 5paisa LIVE broker environment.
        </label>
      </div>

      <div className="bg-slate-900 border border-amber-800/50 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-amber-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Maximum Trade Value Limits</div>
            <p className="text-xs text-slate-400 mt-1">
              Hard per-order notional limit. The order value is calculated from quantity × authoritative order price. Orders above the configured limit are rejected by the server safety gate.
            </p>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono flex items-center gap-1">
                  <IndianRupee className="w-3 h-3" /> 5paisa / Indian Market Maximum (INR)
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-mono">₹</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={maxIndianInr}
                    onChange={e => setMaxIndianInr(Number(e.target.value))}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">INR</span>
                </div>
              </label>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={async () => {
                  if (!Number.isFinite(maxIndianInr) || maxIndianInr <= 0) {
                    setLimitMessage('Maximum trade value must be a positive number.');
                    return;
                  }
                  setSavingLimits(true);
                  setLimitMessage('');
                  try {
                    const res = await fetch('/api/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ maxTradeValueIndianInr: maxIndianInr })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save limits');
                    setLimitMessage('Trade value limit saved to SQLite and enforced server-side.');
                    onRefreshGlobal?.();
                  } catch (err: any) {
                    setLimitMessage(err.message || 'Failed to save limits');
                  } finally {
                    setSavingLimits(false);
                  }
                }}
                disabled={savingLimits}
                className="px-4 py-2 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold"
              >
                {savingLimits ? 'SAVING…' : 'SAVE TRADE LIMITS'}
              </button>
              {limitMessage && <span className="text-[10px] text-slate-400 font-mono">{limitMessage}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Auto Live Execution Rules</div>
            <p className="text-xs text-slate-400 mt-1">
              Safety gate parameters for automatic live trade generation in Indian markets.
            </p>
            <div className="grid md:grid-cols-3 gap-4 mt-4">
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono">Minimum Signal Score</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={autoLiveMinSignalScore}
                    onChange={e => setAutoLiveMinSignalScore(Number(e.target.value))}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">0–100</span>
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono">Max Trades / Instrument</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    step="1"
                    value={autoLiveMaxTradesPerPair}
                    onChange={e => setAutoLiveMaxTradesPerPair(Number(e.target.value))}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">1–20</span>
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono">Max Simultaneous System Trades</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={maxOpenPositions}
                    onChange={e => setMaxOpenPositions(Number(e.target.value))}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">1–100</span>
                </div>
              </label>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                type="button"
                onClick={async () => {
                  const score = Number(autoLiveMinSignalScore);
                  const pairLimit = Number(autoLiveMaxTradesPerPair);
                  const systemLimit = Number(maxOpenPositions);
                  setSavingAutoLiveControls(true);
                  setAutoLiveControlsMessage('');
                  try {
                    const res = await fetch('/api/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        autoLiveMinSignalScore: score,
                        autoLiveMaxTradesPerPair: pairLimit,
                        maxOpenPositions: systemLimit
                      })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save Auto Live execution rules.');
                    setAutoLiveControlsMessage('Auto Live rules saved.');
                    onRefreshGlobal?.();
                  } catch (err: any) {
                    setAutoLiveControlsMessage(err.message || 'Failed to save Auto Live execution rules.');
                  } finally {
                    setSavingAutoLiveControls(false);
                  }
                }}
                disabled={savingAutoLiveControls}
                className="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold"
              >
                {savingAutoLiveControls ? 'SAVING…' : 'SAVE AUTO LIVE RULES'}
              </button>
              {autoLiveControlsMessage && <span className="text-[10px] text-slate-400 font-mono">{autoLiveControlsMessage}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-cyan-900/60 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Sliders className="w-5 h-5 text-cyan-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">NSE / BSE Working Instruments</div>
            <p className="text-xs text-slate-400 mt-1">
              Select the Indian benchmark indices and underlyings actively monitored by Goldcrest.
            </p>

            <div className="grid sm:grid-cols-3 gap-2 mt-4">
              {[
                ['NIFTY', 'NIFTY 50', 'NSE'],
                ['BANKNIFTY', 'NIFTY BANK', 'NSE'],
                ['FINNIFTY', 'NIFTY FINANCIAL SERVICES', 'NSE'],
                ['MIDCPNIFTY', 'NIFTY MIDCAP SELECT', 'NSE'],
                ['SENSEX', 'BSE SENSEX 30', 'BSE']
              ].map(([symbol, _label, exchange]) => {
                const checked = autoLiveIndianUnderlyings.includes(symbol);
                return (
                  <label key={symbol} className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer ${
                    checked ? 'border-emerald-700 bg-emerald-950/30 text-emerald-300' : 'border-slate-800 bg-slate-950 text-slate-400'
                  }`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setAutoLiveIndianUnderlyings(prev =>
                        checked ? prev.filter(item => item !== symbol) : [...prev, symbol]
                      )}
                    />
                    <span className="font-mono text-xs">{symbol}</span>
                    <span className="text-[9px] text-slate-600 ml-auto">{exchange}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button
                type="button"
                disabled={savingUniverse || autoLiveIndianUnderlyings.length === 0}
                onClick={async () => {
                  setSavingUniverse(true);
                  setUniverseMessage('');
                  try {
                    const res = await fetch('/api/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ autoLiveIndianUnderlyings })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save working universe.');
                    setUniverseMessage('Working universe saved.');
                    onRefreshGlobal?.();
                  } catch (err: any) {
                    setUniverseMessage(err.message || 'Failed to save working universe.');
                  } finally {
                    setSavingUniverse(false);
                  }
                }}
                className="px-4 py-2 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-bold"
              >
                {savingUniverse ? 'SAVING…' : 'SAVE WORKING UNIVERSE'}
              </button>
              <span className="text-[10px] text-slate-500 font-mono">
                {autoLiveIndianUnderlyings.length} NSE/BSE selected
              </span>
              {universeMessage && <span className="text-[10px] text-slate-400 font-mono">{universeMessage}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">5paisa LIVE Credentials</h3>
          </div>
          <span className={status?.configured ? 'text-emerald-400 text-[10px] font-bold' : 'text-amber-400 text-[10px] font-bold'}>
            {status?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}
          </span>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
          <BrokerCredentialField name="appName" label="App Name" value={form.appName || ''} onChange={updateField} inputClass={inputClass} />
          <BrokerCredentialField name="appSource" label="App Source" value={form.appSource || ''} onChange={updateField} inputClass={inputClass} />
          <BrokerCredentialField name="userId" label="User ID" value={form.userId || ''} onChange={updateField} inputClass={inputClass} />
          <BrokerCredentialField name="password" label="Password" secret value={form.password || ''} onChange={updateField} inputClass={inputClass} />
          <BrokerCredentialField name="userKey" label="User Key" secret value={form.userKey || ''} onChange={updateField} inputClass={inputClass} />
          <BrokerCredentialField name="encryptionKey" label="Encryption Key" secret value={form.encryptionKey || ''} onChange={updateField} inputClass={inputClass} />
          <BrokerCredentialField name="clientCode" label="Client Code" value={form.clientCode || ''} onChange={updateField} inputClass={inputClass} />
          <BrokerCredentialField name="accessToken" label="Access Token" secret value={form.accessToken || ''} onChange={updateField} inputClass={inputClass} />
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={save} disabled={saving} className="px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold">
            {saving ? 'SAVING…' : 'SAVE CREDENTIALS'}
          </button>
          <button onClick={test} disabled={testing || loading} className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold border border-slate-700">
            <RefreshCw className={`inline w-3 h-3 mr-1 ${testing ? 'animate-spin' : ''}`} /> TEST CONNECTION
          </button>
        </div>
        {result && (
          <div className={`mt-3 p-3 rounded border text-xs font-mono ${result.connected ? 'border-emerald-800 bg-emerald-950/30' : 'border-rose-800 bg-rose-950/30'}`}>
            <div className="flex items-center gap-2 font-bold">
              {result.connected ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}
              {result.connected ? 'CONNECTED' : 'UNAVAILABLE'}
            </div>
            {result.connected && (
              <div className="mt-1 text-slate-400">
                Account: {result.account || '—'} · {result.currency || 'INR'} {typeof result.balance === 'number' ? result.balance.toLocaleString('en-IN') : '—'}
              </div>
            )}
            {!result.connected && <div className="mt-1 text-rose-300 break-words">{result.error || 'Connection unavailable'}</div>}
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-white">Market Routing & Safety</span>
        </div>
        <div className="grid md:grid-cols-3 gap-2 text-xs font-mono">
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">INDIAN_EQUITY → <strong className="text-emerald-400">5paisa LIVE</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">INDIAN_FUTURES → <strong className="text-emerald-400">5paisa LIVE</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">INDIAN_OPTIONS → <strong className="text-emerald-400">5paisa LIVE</strong></div>
        </div>
      </div>

      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
        <Database className="w-3 h-3" /> Execution environment: LIVE_ONLY. Dedicated Indian Markets deployment via 5paisa Open API.
      </div>
    </div>
  );
};
