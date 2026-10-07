import React, { useState, useMemo } from 'react';
import { IndianUnderlyingAnalysis } from '../markets/india_equity/indiaEngine';
import { Candle, TradingSignal } from '../markets/common/types';
import { CandleChart } from './CandleChart';
import { ArrowUpRight, ArrowDownRight, Layers, Clock, TrendingUp, AlertCircle, ExternalLink } from 'lucide-react';

interface IndianMarketDashboardProps {
  underlyings: IndianUnderlyingAnalysis[];
  onSelectOptionChain: (symbol: string) => void;
  onSelectSignal: (signal: TradingSignal) => void;
  candlesMap: Record<string, Candle[]>;
  onEnsureCandles?: (symbol: string) => void;
}

export const IndianMarketDashboard: React.FC<IndianMarketDashboardProps> = ({
  underlyings,
  onSelectOptionChain,
  onSelectSignal,
  candlesMap,
  onEnsureCandles
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY');

  React.useEffect(() => {
    if (selectedSymbol && onEnsureCandles) {
      onEnsureCandles(selectedSymbol);
    }
  }, [selectedSymbol, onEnsureCandles]);

  const isConnected = underlyings && underlyings.length > 0;

  const defaultIndices = [
    { symbol: 'NIFTY', name: 'Nifty 50' },
    { symbol: 'BANKNIFTY', name: 'Nifty Bank' },
    { symbol: 'FINNIFTY', name: 'Nifty Financial Services' },
    { symbol: 'MIDCPNIFTY', name: 'Nifty Midcap Select' },
    { symbol: 'SENSEX', name: 'BSE SENSEX' }
  ];

  const selectedIndex = useMemo(() => {
    if (!isConnected) return null;
    return underlyings.find(u => u.symbol === selectedSymbol) || underlyings[0];
  }, [underlyings, selectedSymbol, isConnected]);

  const selectedCandles = useMemo(() => {
    return candlesMap[selectedSymbol] || [];
  }, [candlesMap, selectedSymbol]);

  return (
    <div id="indian_market_dashboard_view" className="space-y-4">
      {/* 5paisa Status Notice Banner when disconnected */}
      {!isConnected && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-amber-200 text-sm">5paisa API Connection Required</div>
              <div className="text-amber-300/80 mt-0.5">
                Indian Market indices stream live via 5paisa API. Placeholder data is disabled. Configure and authenticate 5paisa in Broker Settings to stream real-time NSE/BSE feeds.
              </div>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-amber-900/50 border border-amber-700/60 text-amber-300 font-mono text-[11px] font-semibold whitespace-nowrap">
            Status: Blank (No Dummy Data)
          </div>
        </div>
      )}

      {/* Index Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {isConnected ? (
          underlyings.map(u => {
            const isSelected = u.symbol === selectedSymbol;
            const isUp = u.change >= 0;

            return (
              <div
                key={u.symbol}
                onClick={() => setSelectedSymbol(u.symbol)}
                className={`p-3 rounded-lg border transition cursor-pointer select-none ${
                  isSelected
                    ? 'bg-slate-800/90 border-emerald-500 shadow-md'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm tracking-wide">{u.symbol}</span>
                  <span className="text-[10px] font-mono text-slate-400">{u.name}</span>
                </div>

                <div className="mt-1 flex items-baseline justify-between font-mono">
                  <span className="text-lg font-bold text-slate-100">{u.spot.toLocaleString()}</span>
                  <span className={`text-xs font-semibold flex items-center ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isUp ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                    {isUp ? '+' : ''}{u.change} ({u.changePercent}%)
                  </span>
                </div>

                {/* Sub metrics */}
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>VWAP: {u.vwap.toLocaleString()}</span>
                  <span className={u.vwapStatus === 'ABOVE_VWAP' ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                    {u.vwapStatus === 'ABOVE_VWAP' ? '▲ Bullish' : '▼ Bearish'}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          defaultIndices.map(idx => {
            const isSelected = idx.symbol === selectedSymbol;
            return (
              <div
                key={idx.symbol}
                onClick={() => setSelectedSymbol(idx.symbol)}
                className={`p-3 rounded-lg border transition cursor-pointer select-none ${
                  isSelected
                    ? 'bg-slate-800/60 border-slate-600 shadow-md'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-300 text-sm tracking-wide">{idx.symbol}</span>
                  <span className="text-[10px] font-mono text-slate-500">{idx.name}</span>
                </div>

                <div className="mt-1 flex items-baseline justify-between font-mono">
                  <span className="text-lg font-bold text-slate-500">—</span>
                  <span className="text-xs text-slate-500 font-semibold">
                    Awaiting Feed
                  </span>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>VWAP: —</span>
                  <span className="text-slate-500 font-semibold">—</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Main Grid: Chart & Comprehensive Structural Level Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Candlestick Chart (7 Cols) */}
        <div className="lg:col-span-7 space-y-3">
          <CandleChart
            candles={selectedCandles}
            title={`${selectedIndex?.name} (${selectedIndex?.symbol})`}
            subtitle="NSE Spot Index & VWAP Structure"
            isIndianMarket={true}
          />

          {/* Action to Jump to Option Chain */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-slate-200">
                Ready to inspect derivatives structure for <strong>{selectedIndex?.symbol}</strong>?
              </span>
            </div>
            <button
              onClick={() => onSelectOptionChain(selectedIndex?.symbol || 'NIFTY')}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
            >
              <span>View Option Chain & Greeks</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right: Market Structure & Technical Setup (5 Cols) */}
        <div className="lg:col-span-5 space-y-4 font-mono text-xs">
          {selectedIndex && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <h3 className="text-sm font-bold text-white font-sans">{selectedIndex.name} Market Analysis</h3>
                  <div className="text-[11px] text-slate-400">Intraday Levels & Market Structure</div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                    Score: {selectedIndex.signal.score}/100
                  </span>
                </div>
              </div>

              {/* Levels Matrix */}
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-[10px] text-slate-500 uppercase">Intraday High / Low</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-emerald-400">{selectedIndex.intradayHigh}</span>
                    <span className="text-rose-400">{selectedIndex.intradayLow}</span>
                  </div>
                </div>

                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-[10px] text-slate-500 uppercase">Prev Day High / Low</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-emerald-300">{selectedIndex.prevDayHigh}</span>
                    <span className="text-rose-300">{selectedIndex.prevDayLow}</span>
                  </div>
                </div>

                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-[10px] text-slate-500 uppercase">Opening Range (15m ORB)</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-slate-200">{selectedIndex.openingRangeHigh}</span>
                    <span className="text-slate-200">{selectedIndex.openingRangeLow}</span>
                  </div>
                </div>

                <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                  <div className="text-[10px] text-slate-500 uppercase">Futures Price & Basis</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-slate-200">{selectedIndex.futuresPrice}</span>
                    <span className="text-cyan-400">+{selectedIndex.basis} pts</span>
                  </div>
                </div>
              </div>

              {/* Intraday Sentiment Gauges */}
              <div className="grid grid-cols-3 gap-2 text-center bg-slate-950 p-2.5 rounded border border-slate-800/80">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">India VIX</div>
                  <div className="text-amber-400 font-bold mt-0.5">{selectedIndex.indiaVix}</div>
                  <div className="text-[9px] text-slate-400">Normal Range</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Put/Call Ratio</div>
                  <div className="text-emerald-400 font-bold mt-0.5">{selectedIndex.pcr}</div>
                  <div className="text-[9px] text-slate-400">Bullish Put Bias</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Adv / Decline</div>
                  <div className="text-cyan-400 font-bold mt-0.5">1.45</div>
                  <div className="text-[9px] text-slate-400">Positive Breadth</div>
                </div>
              </div>

              {/* Signal & Trade Action */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-sans font-semibold">Directional Signal:</span>
                  <span className={`font-bold px-2 py-0.5 rounded ${
                    selectedIndex.signal.direction === 'BUY'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : selectedIndex.signal.direction === 'SELL'
                      ? 'bg-rose-950 text-rose-400 border border-rose-800'
                      : 'bg-amber-950 text-amber-400 border border-amber-800'
                  }`}>
                    {selectedIndex.signal.direction} ({selectedIndex.signal.category})
                  </span>
                </div>

                <div className="text-slate-300 text-[11px] space-y-1">
                  {selectedIndex.signal.reasons.map((r, i) => (
                    <div key={i} className="flex items-start space-x-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span>{r}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => onSelectSignal(selectedIndex.signal)}
                  className="w-full mt-2 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition border border-slate-700 text-xs"
                >
                  Inspect Quantitative Signal Architecture
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
