import React, { useState, useMemo } from 'react';
import { Candle } from '../markets/common/types';
import { calculateEMA, calculateRSI } from '../markets/common/indicators';

interface CandleChartProps {
  candles: Candle[];
  title: string;
  subtitle?: string;
  isIndianMarket?: boolean;
  supportLevels?: number[];
  resistanceLevels?: number[];
  entryZone?: { min: number; max: number; preferred?: number };
  stopLoss?: number;
  takeProfits?: { tp1: number; tp2?: number; tp3?: number };
  selectedTimeframe?: string;
  onTimeframeChange?: (tf: any) => void;
}

export const CandleChart: React.FC<CandleChartProps> = ({
  candles,
  title,
  subtitle,
  isIndianMarket = false,
  supportLevels = [],
  resistanceLevels = [],
  entryZone,
  stopLoss,
  takeProfits,
  selectedTimeframe,
  onTimeframeChange
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showEMA9, setShowEMA9] = useState(false);
  const [showEMA21, setShowEMA21] = useState(true);
  const [showEMA50, setShowEMA50] = useState(true);
  const [showEMA200, setShowEMA200] = useState(true);
  const [showSR, setShowSR] = useState(true);
  const [showTradeLevels, setShowTradeLevels] = useState(true);
  const [showVWAP, setShowVWAP] = useState(isIndianMarket);
  const [showRSI, setShowRSI] = useState(true);
  const [timeframe, setTimeframe] = useState<'5M' | '15M' | '1H' | '4H' | 'D'>((selectedTimeframe as any) || '15M');

  const validCandles = useMemo(() => {
    if (!candles || !Array.isArray(candles)) return [];
    return candles.filter(
      c => c && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close)
    );
  }, [candles]);

  const closes = useMemo(() => validCandles.map(c => c.close), [validCandles]);
  const ema9 = useMemo(() => calculateEMA(closes, 9), [closes]);
  const ema21 = useMemo(() => calculateEMA(closes, 21), [closes]);
  const ema50 = useMemo(() => calculateEMA(closes, 50), [closes]);
  const ema200 = useMemo(() => calculateEMA(closes, 200), [closes]);
  const rsi = useMemo(() => calculateRSI(closes, 14), [closes]);

  // Chart dimensions
  const width = 840;
  const height = showRSI ? 340 : 280;
  const mainHeight = showRSI ? 220 : 250;
  const rsiHeight = showRSI ? 70 : 0;
  const paddingLeft = 50;
  const paddingRight = 60;
  const paddingTop = 20;
  const paddingBottom = showRSI ? 30 : 25;

  const chartWidth = width - paddingLeft - paddingRight;

  const minPrice = useMemo(() => {
    if (validCandles.length === 0) return 0;
    const min = Math.min(...validCandles.map(c => c.low));
    return Number.isFinite(min) ? min * 0.999 : 0;
  }, [validCandles]);

  const maxPrice = useMemo(() => {
    if (validCandles.length === 0) return 100;
    const max = Math.max(...validCandles.map(c => c.high));
    return Number.isFinite(max) ? max * 1.001 : 100;
  }, [validCandles]);

  const priceRange = useMemo(() => {
    const diff = maxPrice - minPrice;
    return Number.isFinite(diff) && diff > 0 ? diff : 1;
  }, [maxPrice, minPrice]);

  const maxVolume = useMemo(() => {
    if (validCandles.length === 0) return 1;
    const max = Math.max(...validCandles.map(c => c.volume || 1));
    return Number.isFinite(max) && max > 0 ? max : 1;
  }, [validCandles]);

  const candleCount = validCandles.length;
  const stepX = chartWidth / Math.max(1, candleCount);
  const candleWidth = Math.max(2, stepX * 0.65);

  const getY = (price: number) => {
    if (!Number.isFinite(price) || priceRange <= 0) return paddingTop;
    const ratio = (price - minPrice) / priceRange;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const y = paddingTop + (1 - clamped) * (mainHeight - paddingTop);
    return Number.isFinite(y) ? y : paddingTop;
  };

  const activeCandle = hoverIndex !== null && validCandles[hoverIndex] ? validCandles[hoverIndex] : validCandles[validCandles.length - 1];
  const activeEma9 = hoverIndex !== null ? ema9[hoverIndex] : ema9[ema9.length - 1];
  const activeEma21 = hoverIndex !== null ? ema21[hoverIndex] : ema21[ema21.length - 1];
  const activeRsi = hoverIndex !== null ? rsi[hoverIndex] : rsi[rsi.length - 1];

  // Generate SVG path for an indicator
  const generateLinePath = (data: number[]) => {
    const points = data
      .map((val, idx) => {
        if (!Number.isFinite(val)) return null;
        const x = paddingLeft + idx * stepX + stepX / 2;
        const y = getY(val);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return `${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .filter(Boolean);

    if (points.length === 0) return '';
    return points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p}`).join(' ');
  };

  // Generate RSI sub-chart path
  const rsiTop = mainHeight + 25;
  const getRsiY = (val: number) => {
    const clamped = Math.max(0, Math.min(100, Number.isFinite(val) ? val : 50));
    const y = rsiTop + (1 - clamped / 100) * rsiHeight;
    return Number.isFinite(y) ? y : rsiTop;
  };

  const rsiLinePath = rsi
    .map((val, idx) => {
      if (!Number.isFinite(val)) return null;
      const x = paddingLeft + idx * stepX + stepX / 2;
      const y = getRsiY(val);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p}`)
    .join(' ');

  if (validCandles.length === 0) {
    return (
      <div id="candle_chart_container" className="bg-slate-900 border border-slate-800 rounded-lg p-4 font-sans text-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white tracking-wide">{title}</h3>
            {subtitle && <span className="text-xs font-mono text-slate-400">({subtitle})</span>}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-64 text-slate-400 font-mono text-xs space-y-2">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading telemetry candles...</span>
        </div>
      </div>
    );
  }

  return (
    <div id="candle_chart_container" className="bg-slate-900 border border-slate-800 rounded-lg p-4 font-sans text-slate-200">
      {/* Chart Top Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h3 className="text-base font-bold text-white tracking-wide">{title}</h3>
            {subtitle && <span className="text-xs font-mono text-slate-400">({subtitle})</span>}
          </div>
          {/* Realtime OHLC Readout */}
          {activeCandle && (
            <div className="flex items-center space-x-3 text-xs font-mono mt-1 text-slate-300">
              <span>O: <strong className="text-slate-100">{activeCandle.open}</strong></span>
              <span>H: <strong className="text-emerald-400">{activeCandle.high}</strong></span>
              <span>L: <strong className="text-rose-400">{activeCandle.low}</strong></span>
              <span>C: <strong className={activeCandle.close >= activeCandle.open ? 'text-emerald-400' : 'text-rose-400'}>{activeCandle.close}</strong></span>
              <span>Vol: <strong className="text-slate-400">{activeCandle.volume.toLocaleString()}</strong></span>
              {showRSI && activeRsi !== undefined && (
                <span>RSI(14): <strong className={activeRsi > 70 ? 'text-amber-400' : activeRsi < 30 ? 'text-cyan-400' : 'text-purple-300'}>{activeRsi.toFixed(1)}</strong></span>
              )}
            </div>
          )}
        </div>

        {/* Indicator & Timeframe Toggles */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Timeframes */}
          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 font-mono">
            {(['5M', '15M', '1H', '4H', 'D'] as const).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                  timeframe === tf ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Indicator toggles */}
          <button
            onClick={() => setShowEMA9(!showEMA9)}
            className={`px-2 py-1 rounded text-[11px] font-mono border transition ${
              showEMA9 ? 'bg-cyan-950/80 border-cyan-700 text-cyan-300' : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            EMA 9
          </button>
          <button
            onClick={() => setShowEMA21(!showEMA21)}
            className={`px-2 py-1 rounded text-[11px] font-mono border transition ${
              showEMA21 ? 'bg-amber-950/80 border-amber-700 text-amber-300' : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            EMA 21
          </button>
          <button
            onClick={() => setShowEMA50(!showEMA50)}
            className={`px-2 py-1 rounded text-[11px] font-mono border transition ${
              showEMA50 ? 'bg-purple-950/80 border-purple-700 text-purple-300' : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            EMA 50
          </button>
          <button
            onClick={() => setShowEMA200(!showEMA200)}
            className={`px-2 py-1 rounded text-[11px] font-mono border transition ${
              showEMA200 ? 'bg-rose-950/80 border-rose-700 text-rose-300' : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            EMA 200
          </button>
          {supportLevels.length > 0 && (
            <button
              onClick={() => setShowSR(!showSR)}
              className={`px-2 py-1 rounded text-[11px] font-mono border transition ${
                showSR ? 'bg-sky-950/80 border-sky-700 text-sky-300' : 'bg-slate-950 border-slate-800 text-slate-500'
              }`}
            >
              S/R
            </button>
          )}
          {entryZone && (
            <button
              onClick={() => setShowTradeLevels(!showTradeLevels)}
              className={`px-2 py-1 rounded text-[11px] font-mono border transition ${
                showTradeLevels ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-500'
              }`}
            >
              Trade Levels
            </button>
          )}
          {isIndianMarket && (
            <button
              onClick={() => setShowVWAP(!showVWAP)}
              className={`px-2 py-1 rounded text-[11px] font-mono border transition ${
                showVWAP ? 'bg-orange-950/80 border-orange-700 text-orange-300' : 'bg-slate-950 border-slate-800 text-slate-500'
              }`}
            >
              VWAP
            </button>
          )}
          <button
            onClick={() => setShowRSI(!showRSI)}
            className={`px-2 py-1 rounded text-[11px] font-mono border transition ${
              showRSI ? 'bg-indigo-950/80 border-indigo-700 text-indigo-300' : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            RSI Sub-chart
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full overflow-hidden mt-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Background Grid Lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
            const p = minPrice + pct * priceRange;
            const y = getY(p);
            return (
              <g key={i}>
                <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="#334155" strokeWidth="0.75" strokeDasharray="3 3" />
                <text x={width - paddingRight + 6} y={y + 3} fill="#64748b" fontSize="10" fontFamily="monospace">
                  {p > 100 ? p.toFixed(1) : p.toFixed(4)}
                </text>
              </g>
            );
          })}

          {/* Volume bars behind candles */}
          {validCandles.map((c, i) => {
            const x = paddingLeft + i * stepX + stepX / 2;
            const volHeight = (c.volume / maxVolume) * 45;
            const y = mainHeight - volHeight;
            const isUp = c.close >= c.open;
            return (
              <rect
                key={`vol_${i}`}
                x={x - candleWidth / 2}
                y={y}
                width={candleWidth}
                height={volHeight}
                fill={isUp ? '#059669' : '#e11d48'}
                opacity={0.25}
              />
            );
          })}

          {/* Candlesticks (Wick & Body) */}
          {validCandles.map((c, i) => {
            const x = paddingLeft + i * stepX + stepX / 2;
            const highY = getY(c.high);
            const lowY = getY(c.low);
            const openY = getY(c.open);
            const closeY = getY(c.close);
            const isUp = c.close >= c.open;
            const bodyY = Math.min(openY, closeY);
            const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
            const color = isUp ? '#10b981' : '#ef4444';

            return (
              <g
                key={`candle_${i}`}
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIndex(i)}
              >
                {/* Wick */}
                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1.2" />
                {/* Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={color}
                  stroke={color}
                  strokeWidth="0.5"
                  rx="0.5"
                />
              </g>
            );
          })}

          {/* Moving Averages */}
          {showEMA9 && (
            <path d={generateLinePath(ema9)} fill="none" stroke="#22d3ee" strokeWidth="1.4" opacity={0.9} />
          )}
          {showEMA21 && (
            <path d={generateLinePath(ema21)} fill="none" stroke="#fbbf24" strokeWidth="1.4" opacity={0.9} />
          )}
          {showEMA50 && (
            <path d={generateLinePath(ema50)} fill="none" stroke="#c084fc" strokeWidth="1.4" opacity={0.9} />
          )}
          {showEMA200 && (
            <path d={generateLinePath(ema200)} fill="none" stroke="#f43f5e" strokeWidth="1.6" opacity={0.95} />
          )}
          {isIndianMarket && showVWAP && (
            <path
              d={generateLinePath(validCandles.map(c => c.vwap || c.close))}
              fill="none"
              stroke="#fb923c"
              strokeWidth="1.6"
              strokeDasharray="4 2"
            />
          )}

          {/* Support and Resistance Horizontal Lines */}
          {showSR && supportLevels.map((lvl, idx) => {
            if (lvl < minPrice || lvl > maxPrice) return null;
            const y = getY(lvl);
            return (
              <g key={`sup_${idx}`}>
                <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="#38bdf8" strokeWidth="1" strokeDasharray="3 3" opacity={0.7} />
                <text x={width - paddingRight + 4} y={y + 3} fill="#38bdf8" fontSize="8" fontFamily="monospace">Sup {lvl}</text>
              </g>
            );
          })}
          {showSR && resistanceLevels.map((lvl, idx) => {
            if (lvl < minPrice || lvl > maxPrice) return null;
            const y = getY(lvl);
            return (
              <g key={`res_${idx}`}>
                <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="#f472b6" strokeWidth="1" strokeDasharray="3 3" opacity={0.7} />
                <text x={width - paddingRight + 4} y={y + 3} fill="#f472b6" fontSize="8" fontFamily="monospace">Res {lvl}</text>
              </g>
            );
          })}

          {/* Entry Zone Highlight */}
          {showTradeLevels && entryZone && (
            (() => {
              const yMin = getY(entryZone.max);
              const yMax = getY(entryZone.min);
              const top = Math.min(yMin, yMax);
              const h = Math.max(2, Math.abs(yMax - yMin));
              return (
                <g>
                  <rect x={paddingLeft} y={top} width={chartWidth} height={h} fill="#10b981" opacity={0.12} />
                  <line x1={paddingLeft} y1={top} x2={width - paddingRight} y2={top} stroke="#10b981" strokeWidth="0.8" strokeDasharray="2 2" />
                  <line x1={paddingLeft} y1={top + h} x2={width - paddingRight} y2={top + h} stroke="#10b981" strokeWidth="0.8" strokeDasharray="2 2" />
                  <text x={width - paddingRight + 4} y={top + h / 2 + 3} fill="#10b981" fontSize="8" fontFamily="monospace">Entry Zone</text>
                </g>
              );
            })()
          )}

          {/* Stop-Loss Line */}
          {showTradeLevels && stopLoss && stopLoss >= minPrice && stopLoss <= maxPrice && (
            <g>
              <line x1={paddingLeft} y1={getY(stopLoss)} x2={width - paddingRight} y2={getY(stopLoss)} stroke="#ef4444" strokeWidth="1.4" strokeDasharray="4 2" />
              <text x={width - paddingRight + 4} y={getY(stopLoss) + 3} fill="#ef4444" fontSize="8" fontFamily="monospace" fontWeight="bold">SL {stopLoss}</text>
            </g>
          )}

          {/* Take-Profit Lines */}
          {showTradeLevels && takeProfits && (
            <g>
              {takeProfits.tp1 >= minPrice && takeProfits.tp1 <= maxPrice && (
                <g>
                  <line x1={paddingLeft} y1={getY(takeProfits.tp1)} x2={width - paddingRight} y2={getY(takeProfits.tp1)} stroke="#22c55e" strokeWidth="1.2" strokeDasharray="4 2" />
                  <text x={width - paddingRight + 4} y={getY(takeProfits.tp1) + 3} fill="#22c55e" fontSize="8" fontFamily="monospace" fontWeight="bold">TP1 {takeProfits.tp1}</text>
                </g>
              )}
              {takeProfits.tp2 && takeProfits.tp2 >= minPrice && takeProfits.tp2 <= maxPrice && (
                <g>
                  <line x1={paddingLeft} y1={getY(takeProfits.tp2)} x2={width - paddingRight} y2={getY(takeProfits.tp2)} stroke="#10b981" strokeWidth="1" strokeDasharray="4 2" />
                  <text x={width - paddingRight + 4} y={getY(takeProfits.tp2) + 3} fill="#10b981" fontSize="8" fontFamily="monospace">TP2 {takeProfits.tp2}</text>
                </g>
              )}
              {takeProfits.tp3 && takeProfits.tp3 >= minPrice && takeProfits.tp3 <= maxPrice && (
                <g>
                  <line x1={paddingLeft} y1={getY(takeProfits.tp3)} x2={width - paddingRight} y2={getY(takeProfits.tp3)} stroke="#059669" strokeWidth="1" strokeDasharray="4 2" />
                  <text x={width - paddingRight + 4} y={getY(takeProfits.tp3) + 3} fill="#059669" fontSize="8" fontFamily="monospace">TP3 {takeProfits.tp3}</text>
                </g>
              )}
            </g>
          )}

          {/* RSI Sub-Chart */}
          {showRSI && (
            <g>
              {/* Divider */}
              <line x1={paddingLeft} y1={rsiTop - 10} x2={width - paddingRight} y2={rsiTop - 10} stroke="#475569" strokeWidth="1" />
              <text x={paddingLeft} y={rsiTop - 1} fill="#94a3b8" fontSize="10" fontFamily="monospace">
                RSI (14)
              </text>

              {/* 70 Overbought & 30 Oversold references */}
              <line x1={paddingLeft} y1={getRsiY(70)} x2={width - paddingRight} y2={getRsiY(70)} stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="3 3" opacity={0.7} />
              <line x1={paddingLeft} y1={getRsiY(30)} x2={width - paddingRight} y2={getRsiY(30)} stroke="#06b6d4" strokeWidth="0.8" strokeDasharray="3 3" opacity={0.7} />
              <text x={width - paddingRight + 5} y={getRsiY(70) + 3} fill="#f59e0b" fontSize="9" fontFamily="monospace">70</text>
              <text x={width - paddingRight + 5} y={getRsiY(30) + 3} fill="#06b6d4" fontSize="9" fontFamily="monospace">30</text>

              {/* RSI Curve */}
              <path d={rsiLinePath} fill="none" stroke="#a855f7" strokeWidth="1.4" />
            </g>
          )}

          {/* Hover Crosshair Guide */}
          {hoverIndex !== null && (
            <line
              x1={paddingLeft + hoverIndex * stepX + stepX / 2}
              y1={paddingTop}
              x2={paddingLeft + hoverIndex * stepX + stepX / 2}
              y2={height - paddingBottom}
              stroke="#94a3b8"
              strokeWidth="0.8"
              strokeDasharray="2 2"
            />
          )}
        </svg>
      </div>

      {/* Legend Footer */}
      <div className="flex flex-wrap items-center justify-between text-xs font-mono text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center space-x-4">
          {showEMA9 && <span className="flex items-center space-x-1"><span className="w-2.5 h-0.5 bg-cyan-400"></span><span>EMA 9: {activeEma9?.toFixed(activeCandle?.close > 100 ? 1 : 4)}</span></span>}
          {showEMA21 && <span className="flex items-center space-x-1"><span className="w-2.5 h-0.5 bg-amber-400"></span><span>EMA 21: {activeEma21?.toFixed(activeCandle?.close > 100 ? 1 : 4)}</span></span>}
          {isIndianMarket && showVWAP && <span className="flex items-center space-x-1"><span className="w-2.5 h-0.5 bg-orange-400"></span><span>VWAP</span></span>}
        </div>
        <div>
          <span className="text-slate-500">Tick: 15M • Data: LIVE deterministic engine</span>
        </div>
      </div>
    </div>
  );
};
