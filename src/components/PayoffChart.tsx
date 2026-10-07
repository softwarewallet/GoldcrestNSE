import React, { useMemo } from 'react';
import { StrategyPayoff } from '../markets/common/types';

interface PayoffChartProps {
  payoff: StrategyPayoff;
  currentSpot: number;
}

export const PayoffChart: React.FC<PayoffChartProps> = ({ payoff, currentSpot }) => {
  const points = useMemo(() => {
    if (!payoff || !Array.isArray(payoff.payoffPoints)) return [];
    return payoff.payoffPoints.filter(p => p && Number.isFinite(p.underlyingPrice) && Number.isFinite(p.pnl));
  }, [payoff]);

  const width = 640;
  const height = 240;
  const paddingLeft = 60;
  const paddingRight = 40;
  const paddingTop = 25;
  const paddingBottom = 35;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const minPrice = useMemo(() => {
    if (points.length === 0) return 0;
    const min = Math.min(...points.map(p => p.underlyingPrice));
    return Number.isFinite(min) ? min : 0;
  }, [points]);

  const maxPrice = useMemo(() => {
    if (points.length === 0) return 100;
    const max = Math.max(...points.map(p => p.underlyingPrice));
    return Number.isFinite(max) ? max : 100;
  }, [points]);

  const priceSpan = useMemo(() => {
    const diff = maxPrice - minPrice;
    return Number.isFinite(diff) && diff > 0 ? diff : 1;
  }, [maxPrice, minPrice]);

  const minPnl = useMemo(() => {
    const rawMin = points.length > 0 ? Math.min(...points.map(p => p.pnl)) : -1000;
    const loss = payoff && Number.isFinite(payoff.maxLoss) ? -payoff.maxLoss : -1000;
    const val = Math.min(rawMin, loss);
    return Number.isFinite(val) ? val : -1000;
  }, [points, payoff]);

  const maxPnl = useMemo(() => {
    const rawMax = points.length > 0 ? Math.max(...points.map(p => p.pnl)) : 1000;
    const profit = payoff && Number.isFinite(payoff.maxProfit) && payoff.maxProfit < 900000 ? payoff.maxProfit : 5000;
    const val = Math.max(rawMax, profit);
    return Number.isFinite(val) ? val : 1000;
  }, [points, payoff]);

  const pnlSpan = useMemo(() => {
    const diff = maxPnl - minPnl;
    return Number.isFinite(diff) && diff > 0 ? diff : 1;
  }, [maxPnl, minPnl]);

  const getX = (price: number) => {
    if (!Number.isFinite(price) || priceSpan <= 0) return paddingLeft;
    const ratio = (price - minPrice) / priceSpan;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const x = paddingLeft + clamped * chartWidth;
    return Number.isFinite(x) ? x : paddingLeft;
  };

  const getY = (pnl: number) => {
    if (!Number.isFinite(pnl) || pnlSpan <= 0) return paddingTop;
    const ratio = (pnl - minPnl) / pnlSpan;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const y = paddingTop + (1 - clamped) * chartHeight;
    return Number.isFinite(y) ? y : paddingTop;
  };

  const zeroY = Number.isFinite(getY(0)) ? getY(0) : paddingTop + chartHeight / 2;

  const pathD = points
    .map((pt, i) => {
      const x = getX(pt.underlyingPrice);
      const y = getY(pt.pnl);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const spotX = getX(currentSpot);

  if (points.length === 0) {
    return (
      <div id="strategy_payoff_chart_container" className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-400 text-center py-8">
        No strategy payoff data available for this contract.
      </div>
    );
  }

  return (
    <div id="strategy_payoff_chart_container" className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-slate-200 uppercase tracking-wide">{payoff.strategyName} Payoff Graph</span>
        <div className="flex items-center space-x-3 text-[11px]">
          <span>Max Profit: <strong className="text-emerald-400">{payoff.maxProfit > 900000 ? 'Unlimited' : `₹${payoff.maxProfit.toLocaleString()}`}</strong></span>
          <span>Max Loss: <strong className="text-rose-400">₹{payoff.maxLoss.toLocaleString()}</strong></span>
          <span>Breakeven: <strong className="text-amber-400">{payoff.breakeven.join(', ')}</strong></span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none">
        {/* Zero P&L Axis */}
        <line x1={paddingLeft} y1={zeroY} x2={width - paddingRight} y2={zeroY} stroke="#475569" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x={paddingLeft - 8} y={zeroY + 4} textAnchor="end" fill="#94a3b8" fontSize="10">
          ₹0
        </text>

        {/* Max Profit line */}
        {payoff.maxProfit < 900000 && (
          <g>
            <line x1={paddingLeft} y1={getY(payoff.maxProfit)} x2={width - paddingRight} y2={getY(payoff.maxProfit)} stroke="#065f46" strokeWidth="0.8" strokeDasharray="2 2" />
            <text x={paddingLeft - 8} y={getY(payoff.maxProfit) + 4} textAnchor="end" fill="#10b981" fontSize="9">
              +₹{payoff.maxProfit}
            </text>
          </g>
        )}

        {/* Max Loss line */}
        <line x1={paddingLeft} y1={getY(-payoff.maxLoss)} x2={width - paddingRight} y2={getY(-payoff.maxLoss)} stroke="#881337" strokeWidth="0.8" strokeDasharray="2 2" />
        <text x={paddingLeft - 8} y={getY(-payoff.maxLoss) + 4} textAnchor="end" fill="#f43f5e" fontSize="9">
          -₹{payoff.maxLoss}
        </text>

        {/* Payoff curve */}
        <path d={pathD} fill="none" stroke="#10b981" strokeWidth="2.5" />

        {/* Spot price vertical indicator */}
        {spotX >= paddingLeft && spotX <= width - paddingRight && (
          <g>
            <line x1={spotX} y1={paddingTop} x2={spotX} y2={height - paddingBottom} stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 2" />
            <text x={spotX} y={paddingTop - 6} textAnchor="middle" fill="#fbbf24" fontSize="10" fontWeight="bold">
              Spot {currentSpot}
            </text>
          </g>
        )}

        {/* Breakeven markers */}
        {payoff.breakeven.map((be, idx) => {
          const beX = getX(be);
          if (beX < paddingLeft || beX > width - paddingRight) return null;
          return (
            <circle key={idx} cx={beX} cy={zeroY} r="4" fill="#fbbf24" stroke="#000" strokeWidth="1" />
          );
        })}

        {/* Price axis labels on bottom */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
          const p = minPrice + pct * priceSpan;
          const x = paddingLeft + pct * chartWidth;
          return (
            <text key={idx} x={x} y={height - paddingBottom + 16} textAnchor="middle" fill="#64748b" fontSize="9">
              {p.toFixed(0)}
            </text>
          );
        })}
      </svg>
    </div>
  );
};
