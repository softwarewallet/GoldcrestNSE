import React, { useState } from 'react';
import { TradingSignal } from '../markets/common/types';
import { X, Sparkles, AlertCircle, ShieldAlert, CheckCircle2, TrendingUp, Info } from 'lucide-react';

interface SignalModalProps {
  signal: TradingSignal | null;
  onClose: () => void;
}

export const SignalModal: React.FC<SignalModalProps> = ({ signal, onClose }) => {
  const [aiExplanation, setAiExplanation] = useState<any>(null);
  const [loadingAi, setLoadingAi] = useState<boolean>(false);

  if (!signal) return null;

  const handleRequestExplanation = async () => {
    setLoadingAi(true);
    try {
      const res = await fetch('/api/analysis/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signal)
      });
      const data = await res.json();
      setAiExplanation(data);
    } catch (err) {
      console.error('Error generating explanation:', err);
    } finally {
      setLoadingAi(false);
    }
  };

  const isBuy = signal.direction === 'BUY';
  const isSell = signal.direction === 'SELL';
  const isNoTrade = signal.direction === 'NO_TRADE';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto font-sans">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto text-slate-200 shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 sticky top-0 z-10">
          <div className="flex items-center space-x-3">
            <span className="text-base font-bold text-white font-mono">{signal.instrument} Quantitative Setup</span>
            <span className={`px-2.5 py-0.5 rounded text-xs font-bold font-mono ${
              isBuy
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                : isSell
                ? 'bg-rose-950 text-rose-400 border border-rose-800'
                : 'bg-slate-950 text-slate-400 border border-slate-800'
            }`}>
              {signal.direction} ({signal.category})
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs font-mono">
          {/* Key Metric Highlights */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Composite Score</div>
              <div className={`text-xl font-bold mt-0.5 ${signal.score >= 80 ? 'text-emerald-400' : 'text-slate-200'}`}>
                {signal.score} <span className="text-xs text-slate-500 font-normal">/ 100</span>
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">ML Probability</div>
              <div className="text-xl font-bold text-cyan-400 mt-0.5">
                {(signal.mlProbability * 100).toFixed(0)}%
              </div>
              <div className="text-[9px] text-slate-500">Calibrated Estimate</div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Risk / Reward</div>
              <div className="text-xl font-bold text-amber-400 mt-0.5">
                1:{signal.riskReward}
              </div>
              <div className="text-[9px] text-slate-500">Target 1</div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase">Market & Strategy</div>
              <div className="text-sm font-bold text-slate-200 mt-1 truncate">
                {signal.strategy}
              </div>
              <div className="text-[9px] text-slate-500">{signal.market}</div>
            </div>
          </div>

          {/* Trade Execution Zone */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-2">
            <div className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
              Deterministic Execution Levels
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              <div className="p-2 bg-slate-900 rounded border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">Preferred Entry</span>
                <span className="text-sm font-bold text-white">{signal.entryZone.preferred}</span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Zone: {signal.entryZone.min} - {signal.entryZone.max}</span>
              </div>

              <div className="p-2 bg-slate-900 rounded border border-slate-800">
                <span className="text-[10px] text-rose-400 uppercase block">Stop Loss</span>
                <span className="text-sm font-bold text-rose-400">{signal.stopLoss}</span>
                <span className="text-[10px] text-slate-500 block mt-0.5">ATR Volatility Bounded</span>
              </div>

              <div className="p-2 bg-slate-900 rounded border border-slate-800">
                <span className="text-[10px] text-emerald-400 uppercase block">Targets</span>
                <span className="text-sm font-bold text-emerald-400">TP1: {signal.target1}</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">TP2: {signal.target2}</span>
              </div>
            </div>
          </div>

          {/* Detailed Score Breakdown (Section 35) */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-2">
            <div className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
              Quantitative Score Factors (0 - 100 Scale)
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-[11px]">
              <div className="bg-slate-900 p-1.5 rounded">
                <span className="text-slate-500 text-[9px] block">Trend</span>
                <span className="font-bold text-slate-200">{signal.scoreBreakdown.trend} / 15</span>
              </div>
              <div className="bg-slate-900 p-1.5 rounded">
                <span className="text-slate-500 text-[9px] block">Multi-TF</span>
                <span className="font-bold text-slate-200">{signal.scoreBreakdown.multiTimeframe} / 15</span>
              </div>
              <div className="bg-slate-900 p-1.5 rounded">
                <span className="text-slate-500 text-[9px] block">Momentum</span>
                <span className="font-bold text-slate-200">{signal.scoreBreakdown.momentum} / 10</span>
              </div>
              <div className="bg-slate-900 p-1.5 rounded">
                <span className="text-slate-500 text-[9px] block">Structure</span>
                <span className="font-bold text-slate-200">{signal.scoreBreakdown.marketStructure} / 10</span>
              </div>
              <div className="bg-slate-900 p-1.5 rounded">
                <span className="text-slate-500 text-[9px] block">S / R</span>
                <span className="font-bold text-slate-200">{signal.scoreBreakdown.supportResistance} / 10</span>
              </div>
              <div className="bg-slate-900 p-1.5 rounded">
                <span className="text-slate-500 text-[9px] block">Volume/OI</span>
                <span className="font-bold text-slate-200">{signal.scoreBreakdown.volumeOI} / 10</span>
              </div>
              <div className="bg-slate-900 p-1.5 rounded">
                <span className="text-slate-500 text-[9px] block">ML Prob</span>
                <span className="font-bold text-cyan-300">{signal.scoreBreakdown.mlProbability} / 15</span>
              </div>
              <div className="bg-slate-900 p-1.5 rounded">
                <span className="text-slate-500 text-[9px] block">R : R</span>
                <span className="font-bold text-amber-300">{signal.scoreBreakdown.riskReward} / 10</span>
              </div>
              <div className="bg-slate-900 p-1.5 rounded">
                <span className="text-slate-500 text-[9px] block">Volatility</span>
                <span className="font-bold text-slate-200">{signal.scoreBreakdown.volatility} / 5</span>
              </div>
              <div className="bg-slate-900 p-1.5 rounded border border-emerald-800/80">
                <span className="text-emerald-400 text-[9px] block font-bold">TOTAL</span>
                <span className="font-bold text-emerald-400">{signal.score} / 100</span>
              </div>
            </div>
          </div>

          {/* Rationale & Invalidation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5">
              <span className="font-bold text-slate-300 text-[11px] block font-sans">
                Why the system identified the setup:
              </span>
              <ul className="space-y-1 text-slate-300 text-[11px]">
                {signal.reasons.map((r, i) => (
                  <li key={i} className="flex items-start space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5">
              <span className="font-bold text-slate-300 text-[11px] block font-sans">
                Conditions that invalidate the setup:
              </span>
              <ul className="space-y-1 text-slate-400 text-[11px]">
                {signal.invalidationConditions.map((c, i) => (
                  <li key={i} className="flex items-start space-x-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* AI Explanation Layer (Sections 51 & 52) */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span className="font-bold text-slate-200 font-sans text-xs">
                  Gemini AI Explanation Layer
                </span>
                <span className="text-[10px] text-slate-500 font-mono">(Natural-Language Narrative)</span>
              </div>

              {!aiExplanation && (
                <button
                  onClick={handleRequestExplanation}
                  disabled={loadingAi}
                  className="flex items-center space-x-1.5 px-3 py-1 rounded bg-cyan-900/60 hover:bg-cyan-800/80 text-cyan-200 border border-cyan-700/80 text-xs font-semibold transition"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${loadingAi ? 'animate-spin' : ''}`} />
                  <span>{loadingAi ? 'Synthesizing...' : 'Generate AI Explanation'}</span>
                </button>
              )}
            </div>

            {aiExplanation && (
              <div className="space-y-2 text-slate-300 font-sans text-xs bg-slate-900/80 p-3 rounded border border-slate-800">
                <p className="leading-relaxed text-slate-100">{aiExplanation.summary}</p>

                {aiExplanation.supportingFactors?.length > 0 && (
                  <div>
                    <strong className="text-emerald-400 block text-[11px] mb-0.5">Supporting Factors:</strong>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-300 text-[11px]">
                      {aiExplanation.supportingFactors.map((f: string, i: number) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiExplanation.conflictingFactors?.length > 0 && (
                  <div>
                    <strong className="text-amber-400 block text-[11px] mb-0.5">Conflicting Evidence & Uncertainty:</strong>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-400 text-[11px]">
                      {aiExplanation.conflictingFactors.map((f: string, i: number) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiExplanation.riskNote && (
                  <div className="pt-1.5 border-t border-slate-800 text-[11px] text-slate-400 flex items-start space-x-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <span>{aiExplanation.riskNote}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
