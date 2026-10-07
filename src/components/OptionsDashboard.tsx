import React, { useState, useEffect } from 'react';
import { OptionChainSummary, OptionChainStrikeRow } from '../markets/common/types';
import { PayoffChart } from './PayoffChart';
import { calculateStrategyPayoff } from '../markets/india_options/strategySkeleton';
import { Layers, ShieldCheck, TrendingUp, Info, ChevronDown, AlertCircle } from 'lucide-react';

interface OptionsDashboardProps {
  initialSymbol?: string;
}

export const OptionsDashboard: React.FC<OptionsDashboardProps> = ({
  initialSymbol = 'NIFTY'
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol);
  const [strikeDepth, setStrikeDepth] = useState<number>(7);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [chain, setChain] = useState<OptionChainSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeStrategy, setActiveStrategy] = useState<'BULL_CALL_SPREAD' | 'LONG_CALL' | 'BEAR_PUT_SPREAD'>('BULL_CALL_SPREAD');

  useEffect(() => {
    setSelectedSymbol(initialSymbol);
  }, [initialSymbol]);

  useEffect(() => {
    fetchChain();
  }, [selectedSymbol, selectedExpiry, strikeDepth]);

  const fetchChain = async () => {
    setLoading(true);
    try {
      let url = `/api/options/chain/${selectedSymbol}?depth=${strikeDepth}`;
      if (selectedExpiry) url += `&expiry=${selectedExpiry}`;
      const res = await fetch(url);
      const data = await res.json();
      setChain(data);
      if (!selectedExpiry && data.expiry) {
        setSelectedExpiry(data.expiry);
      }
    } catch (err) {
      console.error('Error fetching option chain:', err);
    } finally {
      setLoading(false);
    }
  };

  const underlyingSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];

  const isBlank = !chain || chain.isBlank || chain.rows.length === 0 || chain.spotPrice <= 0;
  const atmRow = !isBlank ? chain?.rows.find(r => r.isATM) : undefined;
  const otmCallRow = !isBlank ? chain?.rows.find(r => r.distanceFromAtm === 1) : undefined;
  const otmPutRow = !isBlank ? chain?.rows.find(r => r.distanceFromAtm === -1) : undefined;

  // Derive active strategy payoff
  const payoffData = React.useMemo(() => {
    if (isBlank || !chain || !atmRow) return null;
    const spot = chain.spotPrice;

    if (activeStrategy === 'BULL_CALL_SPREAD' && otmCallRow) {
      return calculateStrategyPayoff({
        strategyType: 'BULL_CALL_SPREAD',
        underlying: chain.underlying,
        spotPrice: spot,
        strike1: atmRow.strike,
        premium1: atmRow.call.ltp,
        strike2: otmCallRow.strike,
        premium2: otmCallRow.call.ltp
      });
    } else if (activeStrategy === 'LONG_CALL') {
      return calculateStrategyPayoff({
        strategyType: 'LONG_CALL',
        underlying: chain.underlying,
        spotPrice: spot,
        strike1: atmRow.strike,
        premium1: atmRow.call.ltp
      });
    } else if (activeStrategy === 'BEAR_PUT_SPREAD' && otmPutRow) {
      return calculateStrategyPayoff({
        strategyType: 'BEAR_PUT_SPREAD',
        underlying: chain.underlying,
        spotPrice: spot,
        strike1: otmPutRow.strike,
        premium1: otmPutRow.put.ltp,
        strike2: atmRow.strike,
        premium2: atmRow.put.ltp
      });
    }
    return null;
  }, [chain, atmRow, otmCallRow, otmPutRow, activeStrategy, isBlank]);

  return (
    <div id="options_dashboard_view" className="space-y-4 font-sans text-slate-200">
      {/* 5paisa Connection Banner when disconnected / blank */}
      {isBlank && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-amber-200 text-sm">5paisa API Connection Required</div>
              <div className="text-amber-300/80 mt-0.5">
                Options Chain, Open Interest, and Black-Scholes Greeks stream directly from the 5paisa Developer API. Placeholder data is disabled. When 5paisa is not connected, data is displayed as blank.
              </div>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-amber-900/50 border border-amber-700/60 text-amber-300 font-mono text-[11px] font-semibold whitespace-nowrap">
            Status: Blank (No Dummy Data)
          </div>
        </div>
      )}

      {/* Top Configuration & Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        {/* Underlying Selector */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-400">Underlying:</span>
          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 font-mono text-xs">
            {underlyingSymbols.map(sym => (
              <button
                key={sym}
                onClick={() => setSelectedSymbol(sym)}
                className={`px-2.5 py-1 rounded transition ${
                  selectedSymbol === sym
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Expiry Selector */}
        {chain?.availableExpiries && chain.availableExpiries.length > 0 && (
          <div className="flex items-center space-x-2">
            <span className="text-xs font-mono text-slate-400">Expiry:</span>
            <select
              value={selectedExpiry}
              onChange={e => setSelectedExpiry(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
            >
              {chain.availableExpiries.map(exp => (
                <option key={exp} value={exp}>{exp}</option>
              ))}
            </select>
          </div>
        )}

        {/* Strike Depth Selector */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-400">Depth:</span>
          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 font-mono text-xs">
            {[5, 7, 10].map(d => (
              <button
                key={d}
                onClick={() => setStrikeDepth(d)}
                className={`px-2 py-0.5 rounded text-[11px] transition ${
                  strikeDepth === d ? 'bg-slate-800 text-white font-bold' : 'text-slate-400'
                }`}
              >
                ±{d} Strikes
              </button>
            ))}
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center space-x-1.5 text-xs font-mono text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-800/80">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Feed: 5paisa Market Data API</span>
        </div>
      </div>

      {/* Spot & Market Sentiment Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase">Spot Price</div>
          <div className="text-lg font-bold text-white mt-0.5">{!isBlank && chain ? chain.spotPrice.toLocaleString() : '—'}</div>
          <div className="text-[10px] text-emerald-400">ATM Strike: {!isBlank && chain ? chain.atmStrike : '—'}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase">Put / Call Ratio (PCR)</div>
          <div className="text-lg font-bold text-amber-400 mt-0.5">{!isBlank && chain ? chain.pcr : '—'}</div>
          <div className="text-[10px] text-slate-400">{!isBlank && chain ? (chain.pcr > 1 ? 'Bullish Put Base' : 'Bearish Call Bias') : 'Awaiting Feed'}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase">Call Resistance Zone</div>
          <div className="text-lg font-bold text-rose-400 mt-0.5">{!isBlank && chain ? `${chain.callResistanceStrike} CE` : '—'}</div>
          <div className="text-[10px] text-slate-400">Highest Open Interest</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase">Put Support Zone</div>
          <div className="text-lg font-bold text-emerald-400 mt-0.5">{!isBlank && chain ? `${chain.putSupportStrike} PE` : '—'}</div>
          <div className="text-[10px] text-slate-400">Strongest Put Base</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase">Total Chain OI</div>
          <div className="text-sm font-bold text-slate-300 mt-1">
            Calls: {!isBlank && chain ? `${(chain.totalCallOI / 100000).toFixed(2)}L` : '—'}
          </div>
          <div className="text-[10px] text-slate-400">
            Puts: {!isBlank && chain ? `${(chain.totalPutOI / 100000).toFixed(2)}L` : '—'}
          </div>
        </div>
      </div>

      {/* Option Chain Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col">
        <div className="p-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-2 text-emerald-400 font-bold">
            <span>CALL OPTIONS (CE)</span>
          </div>
          <div className="text-slate-400">
            Center: Strike & Distance • Highlighted: ATM / S&R
          </div>
          <div className="flex items-center space-x-2 text-rose-400 font-bold">
            <span>PUT OPTIONS (PE)</span>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-center text-[11px] font-mono">
            <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
              <tr>
                {/* Calls */}
                <th className="py-2 px-1 text-slate-400">Delta</th>
                <th className="py-2 px-1 text-slate-400">IV%</th>
                <th className="py-2 px-1 text-slate-400">Vol</th>
                <th className="py-2 px-1 text-slate-400">ΔOI</th>
                <th className="py-2 px-2 text-slate-300">Call OI</th>
                <th className="py-2 px-2 text-emerald-400">Call LTP</th>
                {/* Strike */}
                <th className="py-2 px-3 bg-slate-900 text-white font-bold border-x border-slate-800">STRIKE</th>
                {/* Puts */}
                <th className="py-2 px-2 text-rose-400">Put LTP</th>
                <th className="py-2 px-2 text-slate-300">Put OI</th>
                <th className="py-2 px-1 text-slate-400">ΔOI</th>
                <th className="py-2 px-1 text-slate-400">Vol</th>
                <th className="py-2 px-1 text-slate-400">IV%</th>
                <th className="py-2 px-1 text-slate-400">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {!isBlank && chain && chain.rows.length > 0 ? (
                chain.rows.map((row: OptionChainStrikeRow) => {
                  const isATM = row.isATM;
                  const isCallITM = row.call.isITM;
                  const isPutITM = row.put.isITM;
                  const isCallResistance = row.strike === chain.callResistanceStrike;
                  const isPutSupport = row.strike === chain.putSupportStrike;

                  return (
                    <tr
                      key={row.strike}
                      className={`transition hover:bg-slate-800/40 ${
                        isATM ? 'bg-amber-950/20 font-bold' : ''
                      }`}
                    >
                      {/* CALL SIDE */}
                      <td className={`py-1.5 px-1 ${isCallITM ? 'bg-emerald-950/20' : ''} text-slate-400`}>
                        {row.call.greeks.delta}
                      </td>
                      <td className={`py-1.5 px-1 ${isCallITM ? 'bg-emerald-950/20' : ''} text-slate-400`}>
                        {row.call.iv}%
                      </td>
                      <td className={`py-1.5 px-1 ${isCallITM ? 'bg-emerald-950/20' : ''} text-slate-400`}>
                        {row.call.volume.toLocaleString()}
                      </td>
                      <td className={`py-1.5 px-1 ${isCallITM ? 'bg-emerald-950/20' : ''} ${row.call.changeOI >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {row.call.changeOI > 0 ? '+' : ''}{row.call.changeOI.toLocaleString()}
                      </td>
                      <td className={`py-1.5 px-2 ${isCallITM ? 'bg-emerald-950/20' : ''} ${isCallResistance ? 'text-rose-400 font-bold bg-rose-950/30' : 'text-slate-200'}`}>
                        {row.call.oi.toLocaleString()}
                      </td>
                      <td className={`py-1.5 px-2 font-bold ${isCallITM ? 'bg-emerald-950/20' : ''} text-emerald-400`}>
                        ₹{row.call.ltp}
                      </td>

                      {/* CENTER STRIKE */}
                      <td className={`py-1.5 px-3 font-bold border-x border-slate-800 ${
                        isATM
                          ? 'bg-amber-500/20 text-amber-300'
                          : isCallResistance
                          ? 'text-rose-400'
                          : isPutSupport
                          ? 'text-emerald-400'
                          : 'bg-slate-950 text-slate-100'
                      }`}>
                        <div className="flex items-center justify-center space-x-1">
                          <span>{row.strike}</span>
                          {isATM && <span className="text-[9px] bg-amber-500 text-black px-1 rounded font-extrabold">ATM</span>}
                        </div>
                      </td>

                      {/* PUT SIDE */}
                      <td className={`py-1.5 px-2 font-bold ${isPutITM ? 'bg-rose-950/20' : ''} text-rose-400`}>
                        ₹{row.put.ltp}
                      </td>
                      <td className={`py-1.5 px-2 ${isPutITM ? 'bg-rose-950/20' : ''} ${isPutSupport ? 'text-emerald-400 font-bold bg-emerald-950/30' : 'text-slate-200'}`}>
                        {row.put.oi.toLocaleString()}
                      </td>
                      <td className={`py-1.5 px-1 ${isPutITM ? 'bg-rose-950/20' : ''} ${row.put.changeOI >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {row.put.changeOI > 0 ? '+' : ''}{row.put.changeOI.toLocaleString()}
                      </td>
                      <td className={`py-1.5 px-1 ${isPutITM ? 'bg-rose-950/20' : ''} text-slate-400`}>
                        {row.put.volume.toLocaleString()}
                      </td>
                      <td className={`py-1.5 px-1 ${isPutITM ? 'bg-rose-950/20' : ''} text-slate-400`}>
                        {row.put.iv}%
                      </td>
                      <td className={`py-1.5 px-1 ${isPutITM ? 'bg-rose-950/20' : ''} text-slate-400`}>
                        {row.put.greeks.delta}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <AlertCircle className="w-6 h-6 text-amber-400/80" />
                      <div className="text-sm font-semibold text-slate-300">No Option Chain Data (Blank State)</div>
                      <div className="text-xs text-slate-500 max-w-md">
                        5paisa API connection is required to fetch real-time option chain strikes. Please authenticate 5paisa in Broker Settings.
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payoff Visualizer Skeleton & Strategy Selection */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h4 className="text-sm font-bold text-white font-sans">Options Strategy Payoff Simulator</h4>
            <span className="text-xs font-mono text-slate-400">(Pre-Trade Risk Architecture)</span>
          </div>

          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 text-xs font-mono">
            <button
              onClick={() => setActiveStrategy('BULL_CALL_SPREAD')}
              className={`px-3 py-1 rounded transition ${
                activeStrategy === 'BULL_CALL_SPREAD' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'
              }`}
            >
              Bull Call Spread
            </button>
            <button
              onClick={() => setActiveStrategy('LONG_CALL')}
              className={`px-3 py-1 rounded transition ${
                activeStrategy === 'LONG_CALL' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'
              }`}
            >
              Long Call
            </button>
            <button
              onClick={() => setActiveStrategy('BEAR_PUT_SPREAD')}
              className={`px-3 py-1 rounded transition ${
                activeStrategy === 'BEAR_PUT_SPREAD' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'
              }`}
            >
              Bear Put Spread
            </button>
          </div>
        </div>

        {!isBlank && payoffData && chain ? (
          <PayoffChart payoff={payoffData} currentSpot={chain.spotPrice} />
        ) : (
          <div className="py-8 text-center text-xs font-mono text-slate-500">
            Awaiting 5paisa live option chain data to render payoff calculations.
          </div>
        )}
      </div>
    </div>
  );
};

