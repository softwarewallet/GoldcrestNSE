import React, { useState, useEffect } from 'react';
import { OptionsOpportunityCandidate } from '../services/scannerService';
import { ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, CheckCircle2, XCircle, ShieldCheck, AlertCircle } from 'lucide-react';

export const OptionsScannerView: React.FC = () => {
  const [selectedUnderlying, setSelectedUnderlying] = useState<string>('NIFTY');
  const [sortBy, setSortBy] = useState<'score' | 'mlProbability' | 'riskReward'>('score');
  const [scannerData, setScannerData] = useState<{
    underlying: string;
    spot: number;
    bias: string;
    pcr: number;
    opportunities: OptionsOpportunityCandidate[];
    isBlank?: boolean;
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchScanner();
  }, [selectedUnderlying]);

  const fetchScanner = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/options/scanner/${selectedUnderlying}`);
      const data = await res.json();
      setScannerData(data);
    } catch (err) {
      console.error('Error fetching options scanner:', err);
    } finally {
      setLoading(false);
    }
  };

  const isBlank = !scannerData || scannerData.isBlank || scannerData.opportunities.length === 0 || scannerData.spot <= 0;

  const sortedOpportunities = React.useMemo(() => {
    if (!scannerData?.opportunities || isBlank) return [];
    return [...scannerData.opportunities].sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'mlProbability') return b.mlProbability - a.mlProbability;
      if (sortBy === 'riskReward') return b.riskReward - a.riskReward;
      return 0;
    });
  }, [scannerData, sortBy, isBlank]);

  const underlyings = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];

  return (
    <div id="options_scanner_view" className="space-y-4 font-sans text-slate-200">
      {/* 5paisa Status Notice Banner when disconnected */}
      {isBlank && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-amber-200 text-sm">5paisa API Connection Required</div>
              <div className="text-amber-300/80 mt-0.5">
                Options quantitative scanners and spread analyzers require active 5paisa API market feeds. Placeholder setups are disabled.
              </div>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-amber-900/50 border border-amber-700/60 text-amber-300 font-mono text-[11px] font-semibold whitespace-nowrap">
            Status: Blank (No Dummy Data)
          </div>
        </div>
      )}

      {/* Top Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-400">Scan Underlying:</span>
          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 font-mono text-xs">
            {underlyings.map(u => (
              <button
                key={u}
                onClick={() => setSelectedUnderlying(u)}
                className={`px-3 py-1 rounded transition ${
                  selectedUnderlying === u ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        {/* Sort Controls */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-400">Sort By:</span>
          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 font-mono text-xs">
            <button
              onClick={() => setSortBy('score')}
              className={`px-2.5 py-0.5 rounded ${sortBy === 'score' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400'}`}
            >
              Score
            </button>
            <button
              onClick={() => setSortBy('mlProbability')}
              className={`px-2.5 py-0.5 rounded ${sortBy === 'mlProbability' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400'}`}
            >
              ML Probability
            </button>
            <button
              onClick={() => setSortBy('riskReward')}
              className={`px-2.5 py-0.5 rounded ${sortBy === 'riskReward' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400'}`}
            >
              Risk/Reward
            </button>
          </div>
        </div>

        {/* Market Context Indicator */}
        <div className="flex items-center space-x-3 text-xs font-mono">
          <span>Spot: <strong className="text-white">{!isBlank && scannerData ? scannerData.spot : '—'}</strong></span>
          <span>Market Bias: <strong className={!isBlank && scannerData && scannerData.bias === 'Bullish' ? 'text-emerald-400' : !isBlank && scannerData && scannerData.bias === 'Bearish' ? 'text-rose-400' : 'text-slate-400'}>{!isBlank && scannerData ? scannerData.bias : '—'}</strong></span>
          <span>PCR: <strong className="text-amber-400">{!isBlank && scannerData ? scannerData.pcr : '—'}</strong></span>
        </div>
      </div>

      {/* Critical Options Rule Notice */}
      <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-lg text-xs font-mono text-slate-400 flex items-start space-x-2">
        <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
        <div>
          <strong className="text-slate-200">Critical Options Rule Enforced:</strong> The platform does NOT automatically recommend buying naked options merely because the underlying has a directional signal. It systematically compares defined-risk vertical spreads against naked options, accounting for IV environment, theta decay, days to expiry, and probability.
        </div>
      </div>

      {/* Opportunities Grid */}
      {!isBlank && sortedOpportunities.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedOpportunities.map(opp => {
            const isNoTrade = opp.status === 'NO_TRADE';
            const isWait = opp.status === 'WAIT';

            return (
              <div
                key={opp.id}
                className={`p-4 rounded-lg border transition ${
                  isNoTrade
                    ? 'bg-slate-950/60 border-slate-800/80 opacity-75'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <h4 className="font-bold text-white text-sm font-sans">{opp.title}</h4>
                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                      {opp.underlying} • Expiry: {opp.expiry}
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    {isNoTrade ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-950 text-slate-400 border border-slate-800">
                        <XCircle className="w-3 h-3 text-rose-400" />
                        <span>NO TRADE</span>
                      </span>
                    ) : isWait ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800">
                        <Minus className="w-3 h-3" />
                        <span>WAIT / WATCH</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                        <ArrowUpRight className="w-3 h-3" />
                        <span>{opp.status.replace(/_/g, ' ')}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Metrics Matrix */}
                <div className="grid grid-cols-4 gap-2 my-3 font-mono text-center">
                  <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                    <div className="text-[9px] text-slate-500 uppercase">Score</div>
                    <div className={`text-base font-bold mt-0.5 ${opp.score >= 80 ? 'text-emerald-400' : opp.score >= 60 ? 'text-cyan-300' : 'text-slate-400'}`}>
                      {opp.score}
                    </div>
                  </div>

                  <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                    <div className="text-[9px] text-slate-500 uppercase">ML Prob</div>
                    <div className="text-base font-bold text-slate-200 mt-0.5">
                      {(opp.mlProbability * 100).toFixed(0)}%
                    </div>
                  </div>

                  <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                    <div className="text-[9px] text-slate-500 uppercase">Max Loss</div>
                    <div className="text-sm font-bold text-rose-400 mt-1">
                      ₹{opp.maxLoss.toLocaleString()}
                    </div>
                  </div>

                  <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                    <div className="text-[9px] text-slate-500 uppercase">Max Profit</div>
                    <div className="text-sm font-bold text-emerald-400 mt-1">
                      ₹{opp.maxProfit.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Breakeven & Risk/Reward */}
                <div className="flex items-center justify-between text-xs font-mono text-slate-400 bg-slate-950/50 px-2.5 py-1.5 rounded border border-slate-800/60 mb-3">
                  <span>Breakeven: <strong className="text-slate-200">{opp.breakeven.join(', ')}</strong></span>
                  <span>R:R: <strong className="text-cyan-300">1:{opp.riskReward}</strong></span>
                </div>

                {/* Rationale & Reasons */}
                <div className="space-y-1 text-xs">
                  <div className="text-[11px] font-semibold text-slate-400">Quantitative Setup Rationale:</div>
                  <ul className="space-y-1 text-slate-300">
                    {opp.reasons.map((r, idx) => (
                      <li key={idx} className="flex items-start space-x-1.5">
                        {isNoTrade ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        )}
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Invalidation */}
                <div className="mt-2.5 pt-2 border-t border-slate-800 text-[11px] font-mono text-slate-500">
                  <span>Invalidation: </span>
                  <span className="text-slate-400">{opp.invalidation.join('; ')}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center text-slate-400">
          <div className="flex flex-col items-center justify-center space-y-2">
            <AlertCircle className="w-8 h-8 text-amber-400/80" />
            <div className="text-sm font-semibold text-slate-200">No Options Opportunities Found (Blank State)</div>
            <div className="text-xs text-slate-500 max-w-md">
              5paisa connection is required to scan live option chain setups. Placeholder setups are disabled.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
