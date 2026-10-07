import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Candle } from '../markets/common/types';
import { CandleChart } from './CandleChart';
import {
  CompletePairAnalysisResponse,
  ForexCandle,
  ForexSignal,
  ForexTimeframe
} from '../markets/forex/types';
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertTriangle,
  ChevronRight,
  XCircle,
  Sparkles,
  ShieldAlert,
  Target,
  Layers,
  Activity,
  Compass,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';

interface ForexDashboardProps {
  pairs: any[];
  onSelectSignal: (signal: any) => void;
  candlesMap: Record<string, Candle[]>;
  onEnsureCandles?: (symbol: string) => void;
  environment?: string;
}

export const ForexDashboard: React.FC<ForexDashboardProps> = ({
  pairs,
  onSelectSignal,
  candlesMap,
  onEnsureCandles,
  environment = 'LIVE'
}) => {
  const [selectedPairSymbol, setSelectedPairSymbol] = useState<string>('EUR/USD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<ForexTimeframe>('15M');
  const [filterDirection, setFilterDirection] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Detailed Phase 2A Analysis State
  const [analysis, setAnalysis] = useState<CompletePairAnalysisResponse | null>(null);
  const [timeframeCandles, setTimeframeCandles] = useState<ForexCandle[]>([]);
  const [loadingAnalysis, setLoadingAnalysis] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Gemini Explanation State
  const [explanation, setExplanation] = useState<any | null>(null);
  const [loadingExplanation, setLoadingExplanation] = useState<boolean>(false);
  const [explanationOpen, setExplanationOpen] = useState<boolean>(false);

  // Fetch Full Quantitative Analysis for selected pair
  const fetchAnalysis = useCallback(async (pair: string, tf: ForexTimeframe = '15M', silent = false) => {
    if (!silent) setLoadingAnalysis(true);
    setAnalysisError(null);
    try {
      const encodedPair = encodeURIComponent(pair);
      const [analysisRes, candlesRes] = await Promise.all([
        fetch(`/api/forex/analysis/${encodedPair}`),
        fetch(`/api/forex/candles/${encodedPair}?tf=${tf}&limit=80`)
      ]);

      if (!analysisRes.ok) {
        throw new Error(`Failed to load analysis for ${pair}`);
      }

      const analysisData = await analysisRes.json();
      setAnalysis(analysisData);

      if (candlesRes.ok) {
        const candlesData = await candlesRes.json();
        if (Array.isArray(candlesData)) {
          setTimeframeCandles(candlesData);
        }
      }
    } catch (err: any) {
      setAnalysisError(err.message || 'Failed to fetch pair analysis');
    } finally {
      if (!silent) setLoadingAnalysis(false);
    }
  }, []);

  // Request Gemini Explanation
  const handleRequestExplanation = async () => {
    if (!analysis) return;
    setLoadingExplanation(true);
    setExplanationOpen(true);
    try {
      const res = await fetch('/api/forex/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis })
      });
      if (res.ok) {
        const data = await res.json();
        setExplanation(data);
      }
    } catch (err) {
      console.error('Gemini explainer error:', err);
    } finally {
      setLoadingExplanation(false);
    }
  };


  useEffect(() => {
    fetchAnalysis(selectedPairSymbol, selectedTimeframe);
    const timer = setInterval(() => {
      fetchAnalysis(selectedPairSymbol, selectedTimeframe, true);
    }, 15000);
    return () => clearInterval(timer);
  }, [selectedPairSymbol, selectedTimeframe, fetchAnalysis]);

  const selectedPair = useMemo(() => {
    return pairs.find(p => p.symbol === selectedPairSymbol) || pairs[0];
  }, [pairs, selectedPairSymbol]);

  const filteredPairs = useMemo(() => {
    return pairs.filter(p => {
      const matchesSearch =
        p.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase()));
      if (!matchesSearch) return false;
      if (filterDirection === 'ALL') return true;
      if (filterDirection === 'BUY') return p.signal?.direction?.includes('BUY');
      if (filterDirection === 'SELL') return p.signal?.direction?.includes('SELL');
      if (filterDirection === 'NO_TRADE') return p.signal?.direction === 'NO_TRADE';
      return true;
    });
  }, [pairs, searchQuery, filterDirection]);

  // Derive Chart props
  const candlesForChart = timeframeCandles.length > 0 ? timeframeCandles : candlesMap[selectedPairSymbol] || [];
  const supportLevels = useMemo(() => {
    if (!analysis) return [];
    const list: number[] = [];
    if (analysis.supportResistance.majorSupport) list.push(analysis.supportResistance.majorSupport);
    if (analysis.supportResistance.nearestSupport) list.push(analysis.supportResistance.nearestSupport);
    return list;
  }, [analysis]);

  const resistanceLevels = useMemo(() => {
    if (!analysis) return [];
    const list: number[] = [];
    if (analysis.supportResistance.majorResistance) list.push(analysis.supportResistance.majorResistance);
    if (analysis.supportResistance.nearestResistance) list.push(analysis.supportResistance.nearestResistance);
    return list;
  }, [analysis]);

  const entryZone = analysis?.tradePlan ? {
    min: analysis.tradePlan.entryMin,
    max: analysis.tradePlan.entryMax
  } : undefined;

  const stopLoss = analysis?.tradePlan?.stopLoss;
  const takeProfits = analysis?.tradePlan ? {
    tp1: analysis.tradePlan.takeProfit1,
    tp2: analysis.tradePlan.takeProfit2,
    tp3: analysis.tradePlan.takeProfit3
  } : undefined;

  return (
    <div id="forex_dashboard_view" className="space-y-4">
      {/* Top Banner & Live Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ marginBottom: '5px' }}>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-mono uppercase">Forex Instruments</span>

          </div>
          <div className="text-xl font-bold text-white mt-1">{pairs.length} Pairs</div>
          <div className="text-[11px] text-slate-500 mt-1">Instituational Majors & Crosses</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-slate-400 text-xs font-mono uppercase">Active Session</div>
          <div className="text-base font-bold text-cyan-300 mt-1 truncate">
            {analysis?.session || 'Interbank Overlap'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">UTC Session Engine Active</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-slate-400 text-xs font-mono uppercase">Market Regime</div>
          <div className="text-base font-bold text-purple-300 mt-1">
            {analysis?.regime || 'EVALUATING'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Structure & Volatility Model — LIVE</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-slate-400 text-xs font-mono uppercase">Signal Protocol</div>
          <div className="text-base font-bold text-emerald-400 mt-1">Phase 2A Engine</div>
          <div className="text-[11px] text-slate-500 mt-1">Strict Rules • Live Execution Gates</div>
        </div>
      </div>


      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Pairs Scanner Table (5 Cols) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col">
          {/* Controls Header */}
          <div className="p-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-950/50">
            <input
              type="text"
              placeholder="Search pair (EUR, JPY)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono w-40"
            />
            <div className="flex items-center space-x-1 text-xs font-mono">
              {(['ALL', 'BUY', 'SELL', 'NO_TRADE'] as const).map(dir => (
                <button
                  key={dir}
                  onClick={() => setFilterDirection(dir)}
                  className={`px-2 py-0.5 rounded text-[11px] transition ${
                    filterDirection === dir
                      ? 'bg-slate-800 text-white font-bold border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {dir}
                </button>
              ))}
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] uppercase sticky top-0 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Pair</th>
                  <th className="py-2.5 px-3">Bid / Ask</th>
                  <th className="py-2.5 px-3">Spread</th>
                  <th className="py-2.5 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredPairs.map(p => {
                  const isSelected = p.symbol === selectedPairSymbol;
                  return (
                    <tr
                      key={p.symbol}
                      onClick={() => setSelectedPairSymbol(p.symbol)}
                      className={`cursor-pointer transition hover:bg-slate-800/50 ${
                        isSelected ? 'bg-slate-800/90 border-l-2 border-emerald-400' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-white">{p.symbol}</div>
                        <div className="text-[10px] text-slate-400 truncate">{p.name || p.description}</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        <div>{p.bid ?? p.currentPrice ?? '--'}</div>
                        <div className="text-[10px] text-slate-500">{p.ask ?? '--'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {p.spreadPips ?? p.typicalSpreadPips ?? 1.2} p
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          'bg-rose-950 text-rose-300 border-rose-800'
                        }`}>
                          LIVE
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Detailed Analysis & Interactive Chart (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Active Pair Header Banner */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 font-mono">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white">{selectedPairSymbol}</h2>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  'bg-rose-500/20 text-rose-300 border-rose-500/30'
                }`}>
                  LIVE FEED
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                  {analysis?.session || 'Forex Session'}
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center space-x-3">
                <span>Price: <strong className="text-white">{analysis?.currentPrice.toFixed(5)}</strong></span>
                <span>Spread: <strong className="text-cyan-300">{analysis?.spreadPips} pips</strong></span>
                <span>Regime: <strong className="text-purple-300">{analysis?.regime}</strong></span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => fetchAnalysis(selectedPairSymbol, selectedTimeframe)}
                className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1 border border-slate-700"
                title="Refresh Quantitative Analysis"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingAnalysis ? 'animate-spin text-emerald-400' : ''}`} />
                <span>Analyze</span>
              </button>
              <button
                onClick={handleRequestExplanation}
                disabled={loadingExplanation || !analysis}
                className="px-3 py-1.5 rounded bg-purple-900/60 hover:bg-purple-800 text-purple-200 text-xs flex items-center space-x-1.5 border border-purple-700 transition"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                <span>Gemini Explanation</span>
              </button>
            </div>
          </div>

          {/* Interactive Chart with Overlays */}
          <CandleChart
            candles={candlesForChart}
            title={`${selectedPairSymbol} Multi-Indicator Chart`}
            subtitle={`Timeframe: ${selectedTimeframe} • Realtime Quant Overlays`}
            supportLevels={supportLevels}
            resistanceLevels={resistanceLevels}
            entryZone={entryZone}
            stopLoss={stopLoss}
            takeProfits={takeProfits}
            selectedTimeframe={selectedTimeframe}
            onTimeframeChange={tf => setSelectedTimeframe(tf)}
          />

          {/* Timeframe Selector Bar */}
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono">
            <span className="text-slate-400">Execution Timeframe:</span>
            <div className="flex items-center space-x-1">
              {(['5M', '15M', '1H', '4H', 'Daily'] as ForexTimeframe[]).map(tf => (
                <button
                  key={tf}
                  onClick={() => setSelectedTimeframe(tf)}
                  className={`px-2.5 py-1 rounded text-xs transition ${
                    selectedTimeframe === tf
                      ? 'bg-emerald-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Multi-Timeframe Matrix Card */}
          {analysis && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-slate-200 flex items-center space-x-1.5">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <span>Multi-Timeframe Trend Matrix</span>
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  analysis.multiTimeframe.alignment.includes('BULLISH')
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : analysis.multiTimeframe.alignment.includes('BEARISH')
                    ? 'bg-rose-950 text-rose-300 border border-rose-800'
                    : 'bg-slate-950 text-amber-300 border border-slate-800'
                }`}>
                  {analysis.multiTimeframe.alignment}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2 text-center pt-1">
                {(['5m', '15m', '1h', '4h', 'daily'] as const).map(tfKey => {
                  const val = analysis.multiTimeframe[tfKey];
                  const isBull = val === 'bullish';
                  const isBear = val === 'bearish';
                  return (
                    <div key={tfKey} className="bg-slate-950 p-1.5 rounded border border-slate-800/80">
                      <div className="text-[10px] text-slate-500 uppercase">{tfKey}</div>
                      <div className={`font-bold mt-0.5 text-[11px] ${
                        isBull ? 'text-emerald-400' : isBear ? 'text-rose-400' : 'text-slate-400'
                      }`}>
                        {val.toUpperCase()}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-[11px] text-slate-400 font-sans mt-1">
                {analysis.multiTimeframe.summary}
              </div>
            </div>
          )}

          {/* Market Structure & Support/Resistance Summary */}
          {analysis && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Market Structure */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2 font-mono text-xs">
                <div className="font-bold text-slate-200 flex items-center space-x-1.5 border-b border-slate-800 pb-1.5">
                  <Compass className="w-4 h-4 text-purple-400" />
                  <span>Market Structure</span>
                </div>
                <div className="space-y-1 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Pattern:</span>
                    <span className="text-white font-bold">{analysis.marketStructure.type.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Phase:</span>
                    <span className="text-cyan-300 font-bold">{analysis.marketStructure.phase}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Trend Strength:</span>
                    <span className="text-emerald-400 font-bold">{analysis.trend.strength} / 100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Breakout:</span>
                    <span className="text-slate-300">{analysis.marketStructure.breakoutStatus}</span>
                  </div>
                </div>
              </div>

              {/* Support & Resistance */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2 font-mono text-xs">
                <div className="font-bold text-slate-200 flex items-center space-x-1.5 border-b border-slate-800 pb-1.5">
                  <Activity className="w-4 h-4 text-sky-400" />
                  <span>Support & Resistance</span>
                </div>
                <div className="space-y-1 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Major Resistance:</span>
                    <span className="text-rose-400 font-bold">{analysis.supportResistance.majorResistance ?? 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Nearest Resistance:</span>
                    <span className="text-rose-300">{analysis.supportResistance.nearestResistance ?? 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Nearest Support:</span>
                    <span className="text-emerald-300">{analysis.supportResistance.nearestSupport ?? 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Major Support:</span>
                    <span className="text-emerald-400 font-bold">{analysis.supportResistance.majorSupport ?? 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quantitative Signal & Trade Plan Card */}
          {analysis && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center space-x-2">
                  <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                    analysis.signal.direction.includes('BUY')
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                      : analysis.signal.direction.includes('SELL')
                      ? 'bg-rose-950 text-rose-300 border border-rose-700'
                      : 'bg-slate-950 text-slate-400 border border-slate-800'
                  }`}>
                    {analysis.signal.direction}
                  </span>
                  <span className="text-slate-400 font-sans">
                    Score: <strong className="text-white">{analysis.signal.score}</strong>/100
                  </span>
                </div>

              </div>

              {/* Numerical Execution Levels */}
              {analysis.tradePlan ? (
                <div className="grid grid-cols-3 gap-2 bg-slate-950 p-2.5 rounded border border-slate-800/80 text-center">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Entry Zone</div>
                    <div className="text-slate-100 font-bold mt-0.5">
                      {analysis.tradePlan.entryMin} - {analysis.tradePlan.entryMax}
                    </div>
                    <div className="text-[9px] text-slate-400">Spread: {analysis.spreadPips} p</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-rose-400 uppercase">Stop Loss</div>
                    <div className="text-rose-400 font-bold mt-0.5">{analysis.tradePlan.stopLoss}</div>
                    <div className="text-[9px] text-slate-500 truncate" title={analysis.tradePlan.stopLossReason}>
                      {analysis.tradePlan.stopLossReason}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-emerald-400 uppercase">TP1 (R:R {analysis.tradePlan.riskReward}:1)</div>
                    <div className="text-emerald-400 font-bold mt-0.5">{analysis.tradePlan.takeProfit1}</div>
                    <div className="text-[9px] text-slate-400">TP2: {analysis.tradePlan.takeProfit2} • TP3: {analysis.tradePlan.takeProfit3}</div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950 p-3 rounded border border-slate-800 text-slate-400 font-sans">
                  No active trade plan formed. Quantitative engine suppresses entries when direction is neutral or strict trade filters apply.
                </div>
              )}

              {/* Warnings / Filter Rejections */}
              {analysis.warnings.length > 0 && (
                <div className="bg-amber-950/40 border border-amber-800/60 rounded p-2 text-amber-300 font-sans text-xs">
                  <div className="flex items-center space-x-1.5 font-bold mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Engine Notice / Filters:</span>
                  </div>
                  <ul className="space-y-0.5 text-[11px]">
                    {analysis.warnings.map((w, idx) => (
                      <li key={idx}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Technical Indicators Reference Card */}
          {analysis && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2 font-mono text-xs">
              <div className="font-bold text-slate-200 border-b border-slate-800 pb-1.5">
                Technical Indicator Confluence (15M Execution)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-slate-500">EMA 9 / 21</div>
                  <div className="text-cyan-300 mt-0.5">{analysis.indicators.ema9 ?? '--'} / {analysis.indicators.ema21 ?? '--'}</div>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-slate-500">EMA 50 / 200</div>
                  <div className="text-purple-300 mt-0.5">{analysis.indicators.ema50 ?? '--'} / {analysis.indicators.ema200 ?? '--'}</div>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-slate-500">RSI (14)</div>
                  <div className="text-amber-300 mt-0.5">{analysis.indicators.rsi ?? '--'}</div>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-slate-500">MACD Histogram</div>
                  <div className={analysis.indicators.macdHistogram && analysis.indicators.macdHistogram > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {analysis.indicators.macdHistogram ?? '--'}
                  </div>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-slate-500">ADX (14)</div>
                  <div className="text-slate-300 mt-0.5">{analysis.indicators.adx ?? '--'}</div>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-slate-500">ATR (14)</div>
                  <div className="text-slate-300 mt-0.5">{analysis.indicators.atr ?? '--'}</div>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-slate-500">Bollinger Upper/Lower</div>
                  <div className="text-slate-300 mt-0.5">{analysis.indicators.bollingerUpper ?? '--'} / {analysis.indicators.bollingerLower ?? '--'}</div>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-slate-500">Stochastic %K/%D</div>
                  <div className="text-slate-300 mt-0.5">
                    {analysis.indicators.stochastic ? `${analysis.indicators.stochastic.k} / ${analysis.indicators.stochastic.d}` : '--'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Gemini Explanation Drawer/Card */}
          {explanationOpen && (
            <div className="bg-slate-900 border border-purple-800/80 rounded-lg p-4 space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-purple-800/60 pb-2">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span className="font-bold text-purple-200">Gemini Setup Explanation</span>
                  <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-700 px-1.5 py-0.5 rounded">
                    EXPLANATION LAYER ONLY
                  </span>
                </div>
                <button
                  onClick={() => setExplanationOpen(false)}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  Close
                </button>
              </div>

              {loadingExplanation ? (
                <div className="py-6 text-center text-slate-400 font-sans flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                  <span>Synthesizing quantitative explanation with Gemini...</span>
                </div>
              ) : explanation ? (
                <div className="space-y-3 font-sans text-slate-300">
                  <div>
                    <h4 className="font-bold text-white font-mono text-xs text-purple-300">1. Market Summary</h4>
                    <p className="text-xs text-slate-300 mt-1">{explanation.sections.marketSummary}</p>
                  </div>
                  <div>
                    <h4 className="font-bold text-white font-mono text-xs text-purple-300">2. Trend Explanation</h4>
                    <p className="text-xs text-slate-300 mt-1">{explanation.sections.trendExplanation}</p>
                  </div>
                  <div>
                    <h4 className="font-bold text-white font-mono text-xs text-emerald-300">3. Supporting Evidence</h4>
                    <ul className="list-disc pl-4 text-xs text-slate-300 mt-1 space-y-0.5">
                      {explanation.sections.supportingEvidence.map((s: string, i: number) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold text-white font-mono text-xs text-amber-300">4. Conflicting Evidence</h4>
                    <ul className="list-disc pl-4 text-xs text-slate-300 mt-1 space-y-0.5">
                      {explanation.sections.conflictingEvidence.map((c: string, i: number) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold text-white font-mono text-xs text-cyan-300">5. Trade-Plan Explanation</h4>
                    <p className="text-xs text-slate-300 mt-1">{explanation.sections.tradePlanExplanation}</p>
                  </div>
                  <div>
                    <h4 className="font-bold text-white font-mono text-xs text-rose-300">6. Main Risks</h4>
                    <ul className="list-disc pl-4 text-xs text-slate-300 mt-1 space-y-0.5">
                      {explanation.sections.mainRisks.map((r: string, i: number) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold text-white font-mono text-xs text-rose-400">7. Invalidation Conditions</h4>
                    <ul className="list-disc pl-4 text-xs text-slate-300 mt-1 space-y-0.5">
                      {explanation.sections.invalidationConditions.map((inv: string, i: number) => (
                        <li key={i}>{inv}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>
          )}
      </div>
    </div>
    </div>
  );
};
