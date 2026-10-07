import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, RefreshCw, Target, TrendingDown, TrendingUp, Zap } from 'lucide-react';

type OptionType = 'CALL' | 'PUT';

interface OptionContract {
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionType: OptionType;
  lotSize: number;
  tickSize: number;
  contractMultiplier: number;
  ltp: number;
  change: number;
  changePercent: number;
  oi: number;
  changeOI: number;
  volume: number;
  bid: number;
  ask: number;
  spread: number;
  iv: number;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
    iv: number;
    modelDerived: boolean;
  };
  isATM?: boolean;
  isITM?: boolean;
}

interface OptionChainStrikeRow {
  strike: number;
  isATM: boolean;
  distanceFromAtm: number;
  call: OptionContract;
  put: OptionContract;
}

interface OptionChainSummary {
  underlying: string;
  spotPrice: number;
  atmStrike: number;
  expiry: string;
  availableExpiries: string[];
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;
  callResistanceStrike: number;
  putSupportStrike: number;
  rows: OptionChainStrikeRow[];
  isBlank?: boolean;
  error?: string;
  timestamp: number;
}

interface OptionsOpportunity {
  id: string;
  underlying: string;
  spot: number;
  strategyType: string;
  title: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  mlProbability: number | null;
  entryPremium: number;
  maxLoss: number;
  maxProfit: number;
  breakeven: number[];
  riskReward: number;
  status: 'LONG_CALL' | 'LONG_PUT' | 'BULL_CALL_SPREAD' | 'BEAR_PUT_SPREAD' | 'WAIT' | 'NO_TRADE';
  reasons: string[];
  invalidation: string[];
  expiry: string;
  optionType: OptionType;
  strike: number;
  contractSymbol: string;
  lotSize: number;
  liveBid: number;
  liveAsk: number;
  liveLtp: number;
}

interface OptionsScannerResponse {
  underlying: string;
  spot: number;
  bias: 'Bullish' | 'Bearish' | 'Range-bound';
  pcr: number;
  opportunities: OptionsOpportunity[];
  isBlank?: boolean;
  error?: string;
}

interface OptionsTradingPanelProps {
  isEmergencyHalted: boolean;
  onPositionsRefresh?: () => void;
  onLog?: (type: 'info' | 'success' | 'error' | 'warning' | 'nlp', message: string) => void;
}

const SUPPORTED_UNDERLYINGS = [
  { symbol: 'NIFTY', name: 'NIFTY 50', exchange: 'NSE' },
  { symbol: 'BANKNIFTY', name: 'NIFTY BANK', exchange: 'NSE' },
  { symbol: 'FINNIFTY', name: 'NIFTY FINANCIAL SERVICES', exchange: 'NSE' },
  { symbol: 'MIDCPNIFTY', name: 'NIFTY MIDCAP SELECT', exchange: 'NSE' },
  { symbol: 'SENSEX', name: 'BSE SENSEX 30', exchange: 'BSE' }
];

const num = (value: number, digits = 2) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';

const money = (value: number) =>
  Number.isFinite(value)
    ? '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

const oi = (value: number) =>
  Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—';

const biasClass = (bias: OptionsScannerResponse['bias']) =>
  bias === 'Bullish'
    ? 'text-emerald-300 border-emerald-800 bg-emerald-950/30'
    : bias === 'Bearish'
      ? 'text-rose-300 border-rose-800 bg-rose-950/30'
      : 'text-amber-300 border-amber-800 bg-amber-950/30';

export const OptionsTradingPanel: React.FC<OptionsTradingPanelProps> = ({
  isEmergencyHalted,
  onPositionsRefresh,
  onLog
}) => {
  const [underlying, setUnderlying] = useState('NIFTY');
  const [expiry, setExpiry] = useState('');
  const [scanner, setScanner] = useState<OptionsScannerResponse | null>(null);
  const [chain, setChain] = useState<OptionChainSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = expiry ? `?expiry=${encodeURIComponent(expiry)}&depth=7` : '?depth=7';
      const [scannerRes, chainRes] = await Promise.all([
        fetch(`/api/options/scanner/${encodeURIComponent(underlying)}${query}`, { cache: 'no-store' }),
        fetch(`/api/options/chain/${encodeURIComponent(underlying)}${query}`, { cache: 'no-store' })
      ]);

      const scannerData = await scannerRes.json();
      const chainData = await chainRes.json();

      if (!scannerRes.ok || scannerData?.isBlank) {
        throw new Error(scannerData?.error || 'Live option scanner data is unavailable.');
      }
      if (!chainRes.ok || chainData?.isBlank) {
        throw new Error(chainData?.error || 'Live option-chain data is unavailable.');
      }

      setScanner(scannerData);
      setChain(chainData);
      setLastLoadedAt(Date.now());

      const returnedExpiry = String(scannerData?.expiry || chainData?.expiry || '');
      if (!expiry && returnedExpiry) setExpiry(returnedExpiry);
      if (
        returnedExpiry &&
        Array.isArray(chainData?.availableExpiries) &&
        chainData.availableExpiries.includes(returnedExpiry) &&
        expiry &&
        expiry !== returnedExpiry
      ) {
        setExpiry(returnedExpiry);
      }
    } catch (err: any) {
      setScanner(null);
      setChain(null);
      setError(err?.message || 'Unable to load live option-chain data.');
    } finally {
      setLoading(false);
    }
  }, [underlying, expiry]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const executableOpportunity = useMemo(() => {
    const candidates = scanner?.opportunities || [];
    return candidates.find(item => item.status === 'LONG_CALL' || item.status === 'LONG_PUT') || null;
  }, [scanner]);

  const executableContract = useMemo(() => {
    if (!executableOpportunity || !chain) return null;
    const row = chain.rows.find(item => item.strike === executableOpportunity.strike);
    if (!row) return null;
    return executableOpportunity.optionType === 'CALL' ? row.call : row.put;
  }, [chain, executableOpportunity]);

  const triggerNow = async (opportunity: OptionsOpportunity) => {
    if (isEmergencyHalted) {
      setNotification({ type: 'error', message: 'Emergency Kill Switch is active. New orders are blocked.' });
      return;
    }

    if (opportunity.status !== 'LONG_CALL' && opportunity.status !== 'LONG_PUT') {
      setNotification({
        type: 'info',
        message: 'Only the executable single-leg CALL/PUT setup can be triggered from this panel.'
      });
      return;
    }

    if (!opportunity.contractSymbol || !(opportunity.lotSize > 0)) {
      setNotification({ type: 'error', message: 'Exact 5paisa option contract metadata is unavailable.' });
      return;
    }

    setTriggeringId(opportunity.id);
    setNotification(null);

    const idempotencyKey = `OPTION:${opportunity.underlying}:${opportunity.contractSymbol}:${crypto.randomUUID()}`;
    const entryReference = opportunity.liveAsk > 0 ? opportunity.liveAsk : opportunity.liveLtp;

    onLog?.(
      'nlp',
      `[OPTION DISPATCH] Trigger Now → ${opportunity.underlying} ${opportunity.optionType} ${opportunity.strike} @ ~₹${entryReference.toFixed(2)}`
    );

    try {
      const runtimeRes = await fetch('/api/runtime', {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const runtimeText = await runtimeRes.text();
      if (!runtimeRes.ok || !runtimeRes.headers.get('content-type')?.includes('application/json')) {
        throw new Error(`Goldcrest backend runtime probe failed (HTTP ${runtimeRes.status}).`);
      }
      JSON.parse(runtimeText);

      const payload = {
        market: 'INDIAN_OPTIONS',
        symbol: opportunity.contractSymbol,
        side: 'BUY',
        orderType: 'MARKET',
        quantity: opportunity.lotSize,
        environment: 'LIVE',
        signalId: idempotencyKey,
        executionSource: 'OPTION_CHAIN_TRIGGER_NOW'
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        const details = Array.isArray(data?.details) && data.details.length
          ? ` (${data.details.join(', ')})`
          : '';
        throw new Error((data?.error || data?.message || 'Option order rejected.') + details);
      }

      const executionStatus = String(data?.order?.status || data?.executionState || 'SUBMITTED').toUpperCase();
      const orderRef = data?.order?.id || data?.executionId || idempotencyKey;

      onLog?.(
        executionStatus === 'FILLED' || executionStatus === 'EXECUTED' ? 'success' : 'info',
        `[OPTION ORDER] ${opportunity.contractSymbol} BUY ${opportunity.lotSize.toLocaleString()} → ${executionStatus} (${orderRef})`
      );

      setNotification({
        type: 'success',
        message: `${opportunity.contractSymbol} BUY submitted. Broker status: ${executionStatus}. Ref: ${orderRef}`
      });

      onPositionsRefresh?.();
      void load();
    } catch (err: any) {
      const message = err?.message || 'Option order dispatch failed.';
      onLog?.('error', `[OPTION DISPATCH ERROR] ${opportunity.contractSymbol}: ${message}`);
      setNotification({ type: 'error', message });
    } finally {
      setTriggeringId(null);
    }
  };

  const rows = chain?.rows || [];

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-cyan-900/60 rounded-xl p-5">
        <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-cyan-400" />
              <h2 className="text-base font-bold text-white">NIFTY Family Option Chain</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Live 5paisa option-chain analysis for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY and SENSEX.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block text-[10px] uppercase text-slate-500 font-mono mb-1">Underlying</span>
              <select
                value={underlying}
                onChange={e => { setUnderlying(e.target.value); setExpiry(''); setNotification(null); }}
                className="min-w-[210px] px-3 py-2 rounded bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono"
              >
                {SUPPORTED_UNDERLYINGS.map(item => (
                  <option key={item.symbol} value={item.symbol}>
                    {item.symbol} · {item.name} · {item.exchange}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-[10px] uppercase text-slate-500 font-mono mb-1">Expiry</span>
              <select
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
                disabled={!chain?.availableExpiries?.length}
                className="min-w-[180px] px-3 py-2 rounded bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono disabled:opacity-50"
              >
                {(chain?.availableExpiries || []).map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="px-3 py-2 rounded bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold disabled:opacity-50"
            >
              <RefreshCw className={`inline w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
              REFRESH
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/30 border border-rose-800 rounded-xl p-4 text-xs font-mono text-rose-300">
          {error}
        </div>
      )}

      {scanner && chain && (
        <>
          <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-[10px] uppercase text-slate-500 font-mono">Spot</div>
              <div className="text-2xl font-bold text-white mt-1">{num(scanner.spot)}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-[10px] uppercase text-slate-500 font-mono">ATM Strike</div>
              <div className="text-2xl font-bold text-cyan-300 mt-1">{num(chain.atmStrike, 0)}</div>
            </div>
            <div className={`rounded-xl border p-4 ${biasClass(scanner.bias)}`}>
              <div className="text-[10px] uppercase font-mono">System Bias</div>
              <div className="text-2xl font-bold mt-1">{scanner.bias.toUpperCase()}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-[10px] uppercase text-slate-500 font-mono">PCR</div>
              <div className="text-2xl font-bold text-white mt-1">{num(scanner.pcr)}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-[10px] uppercase text-slate-500 font-mono">Expiry</div>
              <div className="text-sm font-bold text-white mt-2">{chain.expiry || '—'}</div>
              <div className="text-[10px] text-slate-500 mt-1">{lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString() : '—'}</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-white">Live Option Chain</div>
                  <div className="text-[10px] text-slate-500 font-mono">ATM ±7 strikes · broker-reported live fields</div>
                </div>
                <Activity className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-[10px] text-slate-500 border-b border-slate-800">
                      <th colSpan={4} className="py-2 text-center text-emerald-300">CALLS</th>
                      <th className="py-2 text-center">STRIKE</th>
                      <th colSpan={4} className="py-2 text-center text-rose-300">PUTS</th>
                    </tr>
                    <tr className="text-[10px] text-slate-600 border-b border-slate-800">
                      <th>OI</th><th>LTP</th><th>IV</th><th>Bid/Ask</th>
                      <th></th>
                      <th>Bid/Ask</th><th>IV</th><th>LTP</th><th>OI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const recommended = executableOpportunity?.strike === row.strike;
                      return (
                        <tr key={row.strike} className={`border-b border-slate-800/60 ${row.isATM ? 'bg-cyan-950/20' : ''} ${recommended ? 'ring-1 ring-inset ring-cyan-700' : ''}`}>
                          <td className="text-right py-2 px-2 text-slate-300">{oi(row.call.oi)}</td>
                          <td className="text-right px-2 text-emerald-300">{money(row.call.ltp)}</td>
                          <td className="text-right px-2 text-slate-300">{num(row.call.iv)}%</td>
                          <td className="text-right px-2 text-slate-500">{money(row.call.bid)} / {money(row.call.ask)}</td>
                          <td className="text-center px-2">
                            <div className="font-bold text-white">{num(row.strike, 0)}</div>
                            {row.isATM && <div className="text-[9px] text-cyan-300">ATM</div>}
                          </td>
                          <td className="text-left px-2 text-slate-500">{money(row.put.bid)} / {money(row.put.ask)}</td>
                          <td className="text-left px-2 text-slate-300">{num(row.put.iv)}%</td>
                          <td className="text-left px-2 text-rose-300">{money(row.put.ltp)}</td>
                          <td className="text-left px-2 text-slate-300">{oi(row.put.oi)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-slate-800 grid md:grid-cols-3 gap-3 text-[10px] font-mono">
                <div><span className="text-slate-600">CALL OI RESISTANCE</span><div className="text-emerald-300 mt-1">{num(chain.callResistanceStrike, 0)}</div></div>
                <div><span className="text-slate-600">PUT OI SUPPORT</span><div className="text-rose-300 mt-1">{num(chain.putSupportStrike, 0)}</div></div>
                <div><span className="text-slate-600">TOTAL OI</span><div className="text-slate-300 mt-1">CE {oi(chain.totalCallOI)} · PE {oi(chain.totalPutOI)}</div></div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-900 border border-cyan-900/70 rounded-xl p-5">
                <div className="flex items-center gap-2">
                  {executableOpportunity?.optionType === 'CALL'
                    ? <TrendingUp className="w-5 h-5 text-emerald-400" />
                    : executableOpportunity?.optionType === 'PUT'
                      ? <TrendingDown className="w-5 h-5 text-rose-400" />
                      : <Target className="w-5 h-5 text-cyan-400" />}
                  <div className="text-sm font-bold text-white">System Option Decision</div>
                </div>

                {executableOpportunity ? (
                  <>
                    <div className="mt-4 text-[10px] uppercase text-slate-500 font-mono">Direction</div>
                    <div className={`text-2xl font-black mt-1 ${executableOpportunity.optionType === 'CALL' ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {executableOpportunity.optionType}
                    </div>

                    <div className="grid grid-cols-3 gap-3 mt-4">
                      <div><div className="text-[10px] text-slate-500 font-mono">SYSTEM SCORE</div><div className="text-lg font-bold text-cyan-300">{num(executableOpportunity.score, 0)}</div></div>
                      <div><div className="text-[10px] text-slate-500 font-mono">ML PROBABILITY</div><div className="text-lg font-bold text-emerald-300">{executableOpportunity.mlProbability == null ? '—' : (executableOpportunity.mlProbability * 100).toFixed(0) + '%'}</div></div>
                      <div><div className="text-[10px] text-slate-500 font-mono">EXPIRY</div><div className="text-sm font-bold text-white mt-1">{executableOpportunity.expiry || '—'}</div></div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div><div className="text-[10px] text-slate-500 font-mono">STRIKE</div><div className="text-lg font-bold text-white">{num(executableOpportunity.strike, 0)} {executableOpportunity.optionType === 'CALL' ? 'CE' : 'PE'}</div></div>
                      <div><div className="text-[10px] text-slate-500 font-mono">LOT SIZE</div><div className="text-lg font-bold text-white">{oi(executableOpportunity.lotSize)}</div></div>
                      <div><div className="text-[10px] text-slate-500 font-mono">BUY REFERENCE (ASK)</div><div className="text-lg font-bold text-cyan-300">{money(executableContract?.ask || executableOpportunity.liveAsk || executableOpportunity.liveLtp)}</div></div>
                      <div><div className="text-[10px] text-slate-500 font-mono">LTP</div><div className="text-lg font-bold text-white">{money(executableContract?.ltp || executableOpportunity.liveLtp)}</div></div>
                    </div>

                    <div className="mt-4 p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] uppercase text-slate-500 font-mono">Exact 5paisa Contract</div>
                      <div className="text-xs text-cyan-300 font-mono mt-1 break-all">{executableOpportunity.contractSymbol}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div><div className="text-[10px] text-slate-500 font-mono">BREAK-EVEN</div><div className="text-sm font-bold text-white">{executableOpportunity.breakeven.map(value => num(value, 0)).join(' / ') || '—'}</div></div>
                      <div><div className="text-[10px] text-slate-500 font-mono">R:R</div><div className="text-sm font-bold text-white">{num(executableOpportunity.riskReward)}</div></div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {executableOpportunity.reasons.map((reason, index) => (
                        <div key={index} className="flex items-start gap-2 text-[11px] text-slate-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => void triggerNow(executableOpportunity)}
                      disabled={triggeringId === executableOpportunity.id || loading}
                      className="w-full mt-5 px-4 py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-black disabled:opacity-50"
                    >
                      <Zap className="inline w-4 h-4 mr-1" />
                      {triggeringId === executableOpportunity.id ? 'SUBMITTING…' : `TRIGGER ${executableOpportunity.optionType} NOW`}
                    </button>

                    <div className="mt-2 text-[10px] text-slate-600 font-mono">
                      MARKET order · one broker lot · final fill is determined by the live 5paisa quote at submission.
                    </div>
                  </>
                ) : (
                  <div className="mt-4 rounded-lg border border-amber-900 bg-amber-950/20 p-4">
                    <div className="font-bold text-amber-300">WAIT / NO EXECUTABLE OPTION</div>
                    <div className="text-[11px] text-slate-400 mt-2">
                      The current live rules do not produce an executable ATM CALL or PUT. Review the option chain and wait for a qualifying setup.
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-sm font-bold text-white flex items-center gap-2"><Target className="w-4 h-4 text-cyan-400" /> Analysis Context</div>
                <div className="mt-3 space-y-2 text-[11px] font-mono">
                  {(scanner?.opportunities || []).filter(item => item.strategyType !== 'LONG_CALL' && item.strategyType !== 'LONG_PUT').slice(0, 2).map(item => (
                    <div key={item.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-slate-300 font-bold">{item.title}</div>
                      <div className="text-slate-500 mt-1">Status: <span className="text-cyan-300">{item.status}</span> · Score: {num(item.score)} · R:R {num(item.riskReward)}</div>
                    </div>
                  ))}
                  {!scanner?.opportunities?.length && <div className="text-slate-600">No additional option strategies returned.</div>}
                </div>
              </div>

              <div className="bg-amber-950/20 border border-amber-900 rounded-xl p-3 text-[10px] text-amber-200/80">
                <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
                The displayed premium is a live broker reference. Trigger Now submits a MARKET order, so the actual fill can differ from the displayed LTP/ask.
              </div>
            </div>
          </div>
        </>
      )}

      {!scanner && !loading && !error && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500 font-mono">
          Select an index to load the live option chain.
        </div>
      )}
    </div>
  );
};
