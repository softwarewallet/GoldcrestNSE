import React, { useEffect, useState } from 'react';
import { Server, ShieldCheck, RefreshCw, CheckCircle2, XCircle, Lock, Database, DollarSign, IndianRupee, Sliders } from 'lucide-react';
import { BrokerCredentialStatus, BrokerType, TradingEnvironment, ConnectionTestResult } from '../brokers/types';

interface BrokerSettingsPanelProps {
  currentEnvironment: TradingEnvironment;
  selectedBroker?: BrokerType;
  onEnvironmentChange: (env: TradingEnvironment) => void;
  onBrokerSelect?: (broker: BrokerType) => void;
  onRefreshGlobal?: () => void;
}

type LiveForm = Record<string, string>;

const emptyCTrader: LiveForm = { clientId: '', clientSecret: '', accessToken: '', accountId: '' };
const emptyFivePaisa: LiveForm = { appName: '', appSource: '', userId: '', password: '', userKey: '', encryptionKey: '', clientCode: '', accessToken: '', totpSecret: '', pin: '' };

interface BrokerCredentialFieldProps {
  broker: 'CTRADER' | 'FIVE_PAISA';
  name: string;
  label: string;
  secret?: boolean;
  value: string;
  onChange: (broker: 'CTRADER' | 'FIVE_PAISA', name: string, value: string) => void;
  inputClass: string;
}

const BrokerCredentialField: React.FC<BrokerCredentialFieldProps> = React.memo(({
  broker,
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
      onChange={e => onChange(broker, name, e.target.value)}
      autoComplete="off"
    />
  </label>
));

export const BrokerSettingsPanel: React.FC<BrokerSettingsPanelProps> = ({
  currentEnvironment,
  onRefreshGlobal
}) => {
  const [statuses, setStatuses] = useState<BrokerCredentialStatus[]>([]);
  const [results, setResults] = useState<Record<string, ConnectionTestResult | null>>({});
  const [forms, setForms] = useState<Record<'CTRADER' | 'FIVE_PAISA', LiveForm>>({
    CTRADER: { ...emptyCTrader },
    FIVE_PAISA: { ...emptyFivePaisa }
  });
  const [ack, setAck] = useState(false);
  const [cTraderApiMode, setCTraderApiMode] = useState<'LIVE' | 'DEMO'>('DEMO');
  const [savingCTraderApiMode, setSavingCTraderApiMode] = useState(false);
  const [cTraderApiModeMessage, setCTraderApiModeMessage] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxForexUsd, setMaxForexUsd] = useState(100000);
  const [maxIndianInr, setMaxIndianInr] = useState(1000000);
  const [savingLimits, setSavingLimits] = useState(false);
  const [limitMessage, setLimitMessage] = useState('');
  const [forexStopLossPips, setForexStopLossPips] = useState(20);
  const [forexTakeProfitPips, setForexTakeProfitPips] = useState(40);
  const [savingForexPipTargets, setSavingForexPipTargets] = useState(false);
  const [forexPipTargetsMessage, setForexPipTargetsMessage] = useState('');
  const [autoLiveMinSignalScore, setAutoLiveMinSignalScore] = useState(75);
  const [autoLiveMaxTradesPerPair, setAutoLiveMaxTradesPerPair] = useState(4);
  const [maxOpenPositions, setMaxOpenPositions] = useState(5);
  const [savingAutoLiveControls, setSavingAutoLiveControls] = useState(false);
  const [autoLiveControlsMessage, setAutoLiveControlsMessage] = useState('');
  const [autoLiveForexPairs, setAutoLiveForexPairs] = useState<string[]>([
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD'
  ]);
  const [autoLiveIndianUnderlyings, setAutoLiveIndianUnderlyings] = useState<string[]>([
    'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'
  ]);
  const [newForexPair, setNewForexPair] = useState('');
  const [pairMessage, setPairMessage] = useState('');
  const [savingUniverse, setSavingUniverse] = useState(false);
  const [universeMessage, setUniverseMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      // Load broker status and persisted configuration independently. A transient
      // broker-status failure must never cause the UI to fall back to hard-coded
      // trade-limit defaults.
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
        if (config.cTraderApiMode === 'LIVE' || config.cTraderApiMode === 'DEMO') {
          setCTraderApiMode(config.cTraderApiMode);
        }
        if (Number.isFinite(Number(config.maxTradeValueForexUsd))) {
          setMaxForexUsd(Number(config.maxTradeValueForexUsd));
        }
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
        if (Number.isFinite(Number(config.forexStopLossPips))) {
          setForexStopLossPips(Number(config.forexStopLossPips));
        }
        if (Number.isFinite(Number(config.forexTakeProfitPips))) {
          setForexTakeProfitPips(Number(config.forexTakeProfitPips));
        }
        if (Array.isArray(config.autoLiveForexPairs) && config.autoLiveForexPairs.length > 0) {
          setAutoLiveForexPairs(config.autoLiveForexPairs);
        }
        if (Array.isArray(config.autoLiveIndianUnderlyings)) {
          setAutoLiveIndianUnderlyings(config.autoLiveIndianUnderlyings);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const updateField = (broker: 'CTRADER' | 'FIVE_PAISA', key: string, value: string) =>
    setForms(prev => ({ ...prev, [broker]: { ...prev[broker], [key]: value } }));

  const save = async (broker: 'CTRADER' | 'FIVE_PAISA') => {
    if (!ack) {
      alert('Acknowledge the LIVE broker credential warning before saving.');
      return;
    }
    setSaving(broker);
    try {
      const credentials = Object.fromEntries(Object.entries(forms[broker]).filter(([, v]) => String(v).trim() !== ''));
      const res = await fetch('/api/brokers/credentials/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker, credentials, userConfirmedAcknowledge: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Credential update failed');
      setForms(prev => ({ ...prev, [broker]: broker === 'CTRADER' ? { ...emptyCTrader } : { ...emptyFivePaisa } }));
      await load();
      onRefreshGlobal?.();
    } catch (err: any) {
      alert(err.message || 'Credential update failed');
    } finally {
      setSaving(null);
    }
  };

  const test = async (broker: 'CTRADER' | 'FIVE_PAISA') => {
    setTesting(broker);
    try {
      const res = await fetch('/api/brokers/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker })
      });
      const data = await res.json();
      const result = Array.isArray(data.results) ? data.results[0] : data;
      setResults(prev => ({ ...prev, [broker]: result }));
      await load();
    } catch (err: any) {
      setResults(prev => ({ ...prev, [broker]: {
        broker, environment: 'LIVE', connected: false, timestamp: Date.now(), error: err.message
      }}));
    } finally {
      setTesting(null);
    }
  };

  const statusFor = (broker: BrokerType) => statuses.find(s => s.broker === broker && s.environment === 'LIVE');
  const inputClass = 'w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono outline-none focus:border-emerald-600';

  return (
    <div id="broker_settings_panel" className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-emerald-400 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-white">Broker Configuration</div>
            <p className="text-xs text-slate-400 mt-1">cTrader Open API can connect to either the LIVE or DEMO endpoint. Forex routing remains on cTrader; 5paisa remains on its LIVE integration. Broker credentials are held by the server and must never be exposed in the client UI.</p>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-xs text-amber-300 font-mono">
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
          I acknowledge that these credentials access the selected cTrader broker environment.
        </label>
        <div className="mt-4 p-4 rounded-lg border border-cyan-900/60 bg-slate-950">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[220px] space-y-1">
              <span className="text-[10px] uppercase text-cyan-300 font-mono">cTrader Open API Mode</span>
              <select
                value={cTraderApiMode}
                onChange={e => setCTraderApiMode(e.target.value as 'LIVE' | 'DEMO')}
                className={inputClass}
              >
                <option value="LIVE">LIVE</option>
                <option value="DEMO">DEMO</option>
              </select>
            </label>
            <button
              type="button"
              disabled={savingCTraderApiMode}
              onClick={async () => {
                setSavingCTraderApiMode(true);
                setCTraderApiModeMessage('');
                try {
                  const res = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cTraderApiMode })
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'Failed to save cTrader API mode.');
                  setCTraderApiModeMessage('cTrader API mode saved: ' + cTraderApiMode + '. TEST CONNECTION will now use the matching endpoint.');
                  onRefreshGlobal?.();
                } catch (err: any) {
                  setCTraderApiModeMessage(err.message || 'Failed to save cTrader API mode.');
                } finally {
                  setSavingCTraderApiMode(false);
                }
              }}
              className="px-4 py-2 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-bold"
            >
              {savingCTraderApiMode ? 'SAVING…' : 'APPLY API MODE'}
            </button>
            {cTraderApiModeMessage && <span className="text-[10px] text-slate-400 font-mono">{cTraderApiModeMessage}</span>}
          </div>
          <div className="mt-2 text-[10px] text-slate-500 font-mono">
            LIVE → wss://live.ctraderapi.com:5036 · DEMO → wss://demo.ctraderapi.com:5036
          </div>
        </div>
      </div>
      <div className="bg-slate-900 border border-amber-800/50 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-amber-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Maximum Trade Value Limits</div>
            <p className="text-xs text-slate-400 mt-1">
              Hard per-API notional limit. The order value is calculated from quantity × authoritative order price
              (BUY uses ask, SELL uses bid for market orders). Orders above the configured limit are rejected by
              the server safety gate before any dispatch path.
            </p>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono flex items-center gap-1"><DollarSign className="w-3 h-3" /> cTrader / Forex maximum</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-mono">$</span>
                  <input type="number" min="0.01" step="0.01" value={maxForexUsd} onChange={e => setMaxForexUsd(Number(e.target.value))} className={inputClass} />
                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">USD</span>
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono flex items-center gap-1"><IndianRupee className="w-3 h-3" /> 5paisa / Indian maximum</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-mono">₹</span>
                  <input type="number" min="0.01" step="0.01" value={maxIndianInr} onChange={e => setMaxIndianInr(Number(e.target.value))} className={inputClass} />
                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">INR</span>
                </div>
              </label>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={async () => {
                  if (!Number.isFinite(maxForexUsd) || maxForexUsd <= 0 || !Number.isFinite(maxIndianInr) || maxIndianInr <= 0) {
                    setLimitMessage('Both maximum trade values must be positive numbers.');
                    return;
                  }
                  setSavingLimits(true);
                  setLimitMessage('');
                  try {
                    const res = await fetch('/api/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ maxTradeValueForexUsd: maxForexUsd, maxTradeValueIndianInr: maxIndianInr })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save limits');
                    setLimitMessage('Trade value limits saved to SQLite and enforced server-side.');
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

      <div id="forex_pip_targets_settings" className="bg-slate-900 border border-cyan-900/60 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Sliders className="w-5 h-5 text-cyan-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Forex Stop Loss / Take Profit Margins</div>
            <p className="text-xs text-slate-400 mt-1">
              Set the execution distance from the actual market entry in pips. At order placement, Goldcrest reads these values and calculates Stop Loss and Take Profit from the authoritative broker entry price.
            </p>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono">Stop Loss</span>
                <div className="flex items-center gap-2">
                  <input type="number" min="0.1" max="10000" step="0.1" value={forexStopLossPips} onChange={e => setForexStopLossPips(Number(e.target.value))} className={inputClass} />
                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">PIPS</span>
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono">Take Profit</span>
                <div className="flex items-center gap-2">
                  <input type="number" min="0.1" max="10000" step="0.1" value={forexTakeProfitPips} onChange={e => setForexTakeProfitPips(Number(e.target.value))} className={inputClass} />
                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">PIPS</span>
                </div>
              </label>
            </div>
            <div className="mt-3 text-[10px] text-slate-600 font-mono">
              BUY: SL below entry / TP above entry · SELL: SL above entry / TP below entry.
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                type="button"
                disabled={savingForexPipTargets}
                onClick={async () => {
                  const stopLoss = Number(forexStopLossPips);
                  const takeProfit = Number(forexTakeProfitPips);
                  if (!Number.isFinite(stopLoss) || stopLoss <= 0 || stopLoss > 10000) {
                    setForexPipTargetsMessage('Stop Loss must be greater than 0 and no greater than 10000 pips.');
                    return;
                  }
                  if (!Number.isFinite(takeProfit) || takeProfit <= 0 || takeProfit > 10000) {
                    setForexPipTargetsMessage('Take Profit must be greater than 0 and no greater than 10000 pips.');
                    return;
                  }
                  setSavingForexPipTargets(true);
                  setForexPipTargetsMessage('');
                  try {
                    const res = await fetch('/api/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ forexStopLossPips: stopLoss, forexTakeProfitPips: takeProfit })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save Forex pip settings.');
                    setForexPipTargetsMessage(`Forex margins saved: SL ${stopLoss} pips / TP ${takeProfit} pips. New orders will use these values.`);
                    onRefreshGlobal?.();
                  } catch (err: any) {
                    setForexPipTargetsMessage(err.message || 'Failed to save Forex pip settings.');
                  } finally {
                    setSavingForexPipTargets(false);
                  }
                }}
                className="px-4 py-2 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-bold"
              >
                {savingForexPipTargets ? 'SAVING…' : 'SAVE FOREX MARGINS'}
              </button>
              {forexPipTargetsMessage && <span className="text-[10px] text-slate-400 font-mono">{forexPipTargetsMessage}</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="bg-slate-900 border border-emerald-900/60 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Sliders className="w-5 h-5 text-emerald-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Auto Live Execution Rules</div>
            <p className="text-xs text-slate-400 mt-1">
              These values are the server-side controls used by the autonomous Forex execution loop. They are persisted in SQLite and applied on the next Auto Live evaluation cycle.
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
                <span className="text-[10px] text-slate-600 font-mono">A signal must meet or exceed this score before Auto Live can attempt execution.</span>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono">Maximum Simultaneous Trades / Pair</span>
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
                <span className="text-[10px] text-slate-600 font-mono">Multiple positions on the same pair are allowed until this limit is reached.</span>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase text-slate-500 font-mono">Maximum Simultaneous Trades / System</span>
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
                <span className="text-[10px] text-slate-600 font-mono">Condition 13B uses this account-wide limit. It counts all current live positions across all pairs/markets routed through the same broker.</span>
              </label>

            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                type="button"
                onClick={async () => {
                  const score = Number(autoLiveMinSignalScore);
                  const pairLimit = Number(autoLiveMaxTradesPerPair);
                  if (!Number.isInteger(score) || score < 0 || score > 100) {
                    setAutoLiveControlsMessage('Minimum Signal Score must be an integer from 0 to 100.');
                    return;
                  }
                  if (!Number.isInteger(pairLimit) || pairLimit < 1 || pairLimit > 20) {
                    setAutoLiveControlsMessage('Maximum Simultaneous Trades / Pair must be an integer from 1 to 20.');
                    return;
                  }
                  const systemLimit = Number(maxOpenPositions);
                  if (!Number.isInteger(systemLimit) || systemLimit < 1 || systemLimit > 100) {
                    setAutoLiveControlsMessage('Maximum Simultaneous Trades / System must be an integer from 1 to 100.');
                    return;
                  }
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
                    setAutoLiveControlsMessage(
                      `Auto Live rules saved: minimum score ${score}, maximum ${pairLimit} simultaneous trades per pair, maximum ${systemLimit} simultaneous trades system-wide.`
                    );
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
            <div className="text-sm font-bold text-white">Auto Live Working Universe</div>
            <p className="text-xs text-slate-400 mt-1">
              Select the Forex pairs and NSE/BSE index instruments that Goldcrest should actively monitor and prepare.
              Selection is persisted in SQLite and survives restarts. Auto Live uses the selected Forex pairs for its autonomous Forex evaluation loop.
            </p>

            <div className="grid xl:grid-cols-2 gap-5 mt-4">
              <div>
                <div className="text-[10px] uppercase text-slate-500 font-mono mb-2">Forex / cTrader</div>
                <div className="text-[10px] text-slate-500 font-mono mb-2">Select supported pairs or add another broker-supported FX pair.</div>
                <div className="flex gap-2 mb-3">
                  <input
                    value={newForexPair}
                    onChange={e => setNewForexPair(e.target.value.toUpperCase())}
                    placeholder="e.g. CAD/JPY"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const pair = newForexPair.trim().toUpperCase();
                      if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) {
                        setPairMessage('Use BASE/QUOTE format, e.g. CAD/JPY.');
                        return;
                      }
                      if (autoLiveForexPairs.includes(pair)) {
                        setPairMessage(pair + ' is already selected.');
                        return;
                      }
                      setAutoLiveForexPairs(prev => [...prev, pair]);
                      setNewForexPair('');
                      setPairMessage(pair + ' added. Save Working Universe to activate it.');
                    }}
                    className="shrink-0 px-3 py-2 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold"
                  >ADD PAIR</button>
                </div>
                {pairMessage && <div className="text-[10px] text-cyan-300 font-mono mb-2">{pairMessage}</div>}

                <div className="grid sm:grid-cols-2 gap-2">
                  {['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY','AUD/JPY','EUR/AUD','GBP/AUD','XAU/USD'].map(pair => {
                    const checked = autoLiveForexPairs.includes(pair);
                    return (
                      <label key={pair} className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer ${
                        checked ? 'border-emerald-700 bg-emerald-950/30 text-emerald-300' : 'border-slate-800 bg-slate-950 text-slate-400'
                      }`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setAutoLiveForexPairs(prev =>
                            checked ? prev.filter(item => item !== pair) : [...prev, pair]
                          )}
                        />
                        <span className="font-mono text-xs">{pair}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase text-slate-500 font-mono mb-2">NSE / BSE Working Instruments</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {[
                    ['NIFTY', 'NIFTY 50', 'NSE'],
                    ['BANKNIFTY', 'NIFTY BANK', 'NSE'],
                    ['FINNIFTY', 'NIFTY FINANCIAL SERVICES', 'NSE'],
                    ['MIDCPNIFTY', 'NIFTY MIDCAP SELECT', 'NSE'],
                    ['SENSEX', 'BSE SENSEX 30', 'BSE']
                  ].map(([symbol, label, exchange]) => {
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
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button
                type="button"
                disabled={savingUniverse || autoLiveForexPairs.length === 0}
                onClick={async () => {
                  if (autoLiveForexPairs.length === 0) {
                    setUniverseMessage('Select at least one Forex pair.');
                    return;
                  }
                  setSavingUniverse(true);
                  setUniverseMessage('');
                  try {
                    const res = await fetch('/api/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        autoLiveForexPairs,
                        autoLiveIndianUnderlyings
                      })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save working universe.');
                    setUniverseMessage('Working universe saved to SQLite. Auto Live will use the selected Forex pairs.');
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
                {autoLiveForexPairs.length} Forex · {autoLiveIndianUnderlyings.length} NSE/BSE selected
              </span>
              {universeMessage && <span className="text-[10px] text-slate-400 font-mono">{universeMessage}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        {(['CTRADER', 'FIVE_PAISA'] as const).map(broker => {
          const s = statusFor(broker);
          const result = results[broker];
          const isC = broker === 'CTRADER';
          return (
            <div key={broker} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Server className="w-4 h-4 text-cyan-400" /><h3 className="text-sm font-bold text-white">{isC ? 'cTrader API' : '5paisa'} {isC ? `(${cTraderApiMode})` : 'LIVE'}</h3></div>
                <span className={s?.configured ? 'text-emerald-400 text-[10px] font-bold' : 'text-amber-400 text-[10px] font-bold'}>{s?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {isC ? <>
                  <BrokerCredentialField broker={broker} name="clientId" label="Client ID" value={forms[broker].clientId || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="clientSecret" label="Client Secret" secret value={forms[broker].clientSecret || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="accessToken" label="Access Token" secret value={forms[broker].accessToken || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="accountId" label="Account ID" value={forms[broker].accountId || ''} onChange={updateField} inputClass={inputClass} />
                </> : <>
                  <BrokerCredentialField broker={broker} name="appName" label="App Name" value={forms[broker].appName || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="appSource" label="App Source" value={forms[broker].appSource || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="userId" label="User ID" value={forms[broker].userId || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="password" label="Password" secret value={forms[broker].password || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="userKey" label="User Key" secret value={forms[broker].userKey || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="encryptionKey" label="Encryption Key" secret value={forms[broker].encryptionKey || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="clientCode" label="Client Code" value={forms[broker].clientCode || ''} onChange={updateField} inputClass={inputClass} />
                  <BrokerCredentialField broker={broker} name="accessToken" label="Access Token" secret value={forms[broker].accessToken || ''} onChange={updateField} inputClass={inputClass} />
                </>}
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={() => save(broker)} disabled={saving === broker} className="px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold">
                  {saving === broker ? 'SAVING…' : 'SAVE CREDENTIALS'}
                </button>
                <button onClick={() => test(broker)} disabled={testing === broker || loading} className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold border border-slate-700">
                  <RefreshCw className={`inline w-3 h-3 mr-1 ${testing === broker ? 'animate-spin' : ''}`} /> TEST CONNECTION
                </button>
              </div>
              {result && (
                <div className={`mt-3 p-3 rounded border text-xs font-mono ${result.connected ? 'border-emerald-800 bg-emerald-950/30' : 'border-rose-800 bg-rose-950/30'}`}>
                  <div className="flex items-center gap-2 font-bold">{result.connected ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}{result.connected ? 'CONNECTED' : 'UNAVAILABLE'}</div>
                  {result.connected && <div className="mt-1 text-slate-400">Account: {result.account || '—'} · {result.currency || '—'} {typeof result.balance === 'number' ? result.balance.toLocaleString() : '—'}</div>}
                  {result.connected && result.apiMode && <div className="mt-1 text-cyan-300">cTrader API: {result.apiMode} · {result.apiEndpoint || 'endpoint unavailable'}</div>}
                  {!result.connected && <div className="mt-1 text-rose-300 break-words">{result.error || 'Connection unavailable'}</div>}
                </div>
              )}
              {s?.lastTestResult && !result && (
                <div className="mt-3 text-[10px] text-slate-500 font-mono">Last test: {s.lastTestResult.connected ? 'CONNECTED' : 'FAILED'}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4 text-cyan-400" /><span className="text-sm font-bold text-white">Routing & Safety</span></div>
        <div className="grid md:grid-cols-2 gap-2 text-xs font-mono">
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">FOREX → <strong className="text-emerald-400">cTrader ({cTraderApiMode})</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">INDIAN_EQUITY → <strong className="text-emerald-400">5paisa LIVE</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">INDIAN_FUTURES → <strong className="text-emerald-400">5paisa LIVE</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">INDIAN_OPTIONS → <strong className="text-emerald-400">5paisa LIVE</strong></div>
          <div className="p-2 bg-slate-950 border border-rose-900 rounded">AUTONOMOUS LIVE EXECUTION → <strong className="text-rose-400">BLOCKED</strong></div>
          <div className="p-2 bg-slate-950 border border-cyan-900 rounded">APPLICATION PERSISTENCE → <strong className="text-cyan-400">SQLITE</strong></div>
        </div>
      </div>

      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2"><Database className="w-3 h-3" /> Execution environment: LIVE_ONLY. cTrader API transport may use LIVE or DEMO; the selected API mode is used for the cTrader connection.</div>
    </div>
  );
};
