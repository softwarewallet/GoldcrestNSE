import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Zap,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  IndianRupee,
  Cpu,
  Layers,
  Sparkles,
  ArrowRight,
  Target
} from 'lucide-react';

interface SmallTradeBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (budget: number, enabled: boolean) => void;
}

interface NiftyInstrumentRow {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  lotSize: number;
}

const NIFTY_INSTRUMENTS: NiftyInstrumentRow[] = [
  { symbol: 'NIFTY', name: 'NIFTY 50', exchange: 'NSE', lotSize: 25 },
  { symbol: 'BANKNIFTY', name: 'NIFTY BANK', exchange: 'NSE', lotSize: 15 },
  { symbol: 'FINNIFTY', name: 'NIFTY FINANCIAL SERVICES', exchange: 'NSE', lotSize: 25 },
  { symbol: 'MIDCPNIFTY', name: 'NIFTY MIDCAP SELECT', exchange: 'NSE', lotSize: 50 },
  { symbol: 'SENSEX', name: 'BSE SENSEX 30', exchange: 'BSE', lotSize: 10 }
];

const PRESETS = [10, 15, 20, 25, 30, 50, 100];

export const SmallTradeBudgetModal: React.FC<SmallTradeBudgetModalProps> = ({
  isOpen,
  onClose,
  onSaved
}) => {
  const [budgetInr, setBudgetInr] = useState<number>(20);
  const [customInput, setCustomInput] = useState<string>('20');
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [niftyTestingMode, setNiftyTestingMode] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing configuration from /api/config
  useEffect(() => {
    if (!isOpen) return;
    setSaveSuccess(false);
    setError(null);

    fetch('/api/config', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          const budget = Number(data.smallTradeBudgetInr ?? 20);
          const enabled = data.smallTradeBudgetEnabled ?? true;
          const fnoMode = data.niftyFnoTestingMode ?? true;
          setBudgetInr(budget > 0 ? budget : 20);
          setCustomInput(String(budget > 0 ? budget : 20));
          setIsEnabled(Boolean(enabled));
          setNiftyTestingMode(Boolean(fnoMode));
        }
      })
      .catch(err => {
        console.warn('Failed to load small trade budget config:', err);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectPreset = (val: number) => {
    setBudgetInr(val);
    setCustomInput(String(val));
    setError(null);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setCustomInput(raw);
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      setBudgetInr(n);
      setError(null);
    }
  };

  const handleSave = async () => {
    const val = Number(budgetInr);
    if (!Number.isFinite(val) || val <= 0) {
      setError('Please enter a valid positive budget amount in INR.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smallTradeBudgetInr: val,
          smallTradeBudgetEnabled: isEnabled,
          niftyFnoTestingMode: niftyTestingMode,
          // When small budget is enabled, also ensure Indian max exposure stays bounded safely
          maxTradeValueIndianInr: isEnabled ? Math.min(1000000, val) : 1000000
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || data?.message || 'Failed to save configuration');
      }

      setSaveSuccess(true);
      onSaved?.(val, isEnabled);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      setError(err?.message || 'Failed to update small trade budget.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-[#030c17] border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-950/60 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 bg-gradient-to-r from-cyan-950/40 via-slate-900/60 to-blue-950/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-wide">
                  Nifty F&amp;O Small Trade Budget Configuration
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-bold">
                  MICRO TESTING MODE
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Cap total financial exposure per trade to 10 – 20 INR for end-to-end 5paisa testing.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 overflow-y-auto font-sans text-xs">
          
          {/* Main Controls Section */}
          <div className="bg-[#041220] border border-slate-800 rounded-xl p-4 space-y-4">
            
            {/* Toggle Switches */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/70">
              <div>
                <div className="font-bold text-white text-sm flex items-center gap-2">
                  <span>Enforce Small Amount Budget Cap</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${isEnabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-800 text-slate-400'}`}>
                    {isEnabled ? 'ENFORCED' : 'DISABLED'}
                  </span>
                </div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  Blocks any order exceeding the fixed budget per trade before submission to 5paisa live servers.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={e => setIsEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
              </label>
            </div>

            {/* Quick Budget Presets */}
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-400 font-bold mb-2">
                Select Fixed Budget per Trade (INR):
              </label>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {PRESETS.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`py-2 px-2 rounded-lg font-mono font-bold text-xs transition border flex flex-col items-center justify-center cursor-pointer ${
                      budgetInr === preset
                        ? 'bg-cyan-600 text-white border-cyan-400 shadow-lg shadow-cyan-950'
                        : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:border-cyan-500/60 hover:bg-slate-800'
                    }`}
                  >
                    <span>₹{preset}</span>
                    <span className="text-[9px] opacity-70 font-normal">INR</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Input */}
            <div className="flex items-center gap-3 pt-1">
              <span className="text-slate-400 font-mono text-xs whitespace-nowrap">Or Custom Cap:</span>
              <div className="relative flex-1 max-w-[200px]">
                <span className="absolute left-3 top-2 text-slate-500 font-bold font-mono">₹</span>
                <input
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={customInput}
                  onChange={handleCustomChange}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-xs font-mono font-bold text-cyan-300 focus:border-cyan-400 outline-none"
                  placeholder="20"
                />
              </div>
              <span className="text-slate-500 font-mono text-[11px]">INR Max Outlay</span>
            </div>
          </div>

          {/* Dynamic NIFTY Instruments Exposure Matrix */}
          <div className="bg-[#041220] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-white text-xs tracking-wide flex items-center gap-1.5">
                <Target className="w-4 h-4 text-cyan-400" />
                <span>NIFTY F&amp;O Lot Sizes &amp; Max Allowed Option Premium (At ₹{budgetInr} Cap)</span>
              </h4>
              <span className="text-[10px] text-slate-400 font-mono">
                Formula: Max Premium = ₹{budgetInr} ÷ Lot Size
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-400 bg-slate-950/40">
                    <th className="py-2 px-2.5">Index Instrument</th>
                    <th className="py-2 px-2 text-center">Exchange</th>
                    <th className="py-2 px-2 text-center">1 Lot Qty</th>
                    <th className="py-2 px-2 text-right">Max Option Premium (LTP)</th>
                    <th className="py-2 px-2.5 text-right">1-Lot Total Outlay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {NIFTY_INSTRUMENTS.map(inst => {
                    const maxPremium = Number((budgetInr / inst.lotSize).toFixed(2));
                    const totalCost = maxPremium * inst.lotSize;
                    return (
                      <tr key={inst.symbol} className="hover:bg-slate-900/40">
                        <td className="py-2 px-2.5 font-bold text-white flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                          <span>{inst.name}</span>
                          <span className="text-[10px] text-slate-500 font-normal">({inst.symbol})</span>
                        </td>
                        <td className="py-2 px-2 text-center text-slate-400 text-[10px]">{inst.exchange}</td>
                        <td className="py-2 px-2 text-center font-bold text-cyan-300">{inst.lotSize}</td>
                        <td className="py-2 px-2 text-right font-bold text-amber-300">
                          ≤ ₹{maxPremium.toFixed(2)} / pt
                        </td>
                        <td className="py-2 px-2.5 text-right font-bold text-emerald-400">
                          ₹{totalCost.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-slate-400 mt-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
              💡 <b>How to test safely:</b> In the Option Chain view, look for Deep OTM (Out-of-the-Money) strikes trading at low premiums (e.g., ₹0.20 to ₹0.80). 1 lot of NIFTY 50 (25 units) at ₹0.40 premium costs exactly ₹10.00 total outlay.
            </p>
          </div>

          {/* 5paisa Data Packet & Trade Value Mechanism */}
          <div className="bg-[#020914] border border-cyan-950 rounded-xl p-3.5 space-y-2 text-[11px] font-mono text-slate-400">
            <div className="text-cyan-400 font-bold flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              <span>5paisa API Packet &amp; Trade Value Enforcement Protocol:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-[10.5px]">
              <li>
                <b>Market Feed Packet:</b> 5paisa broadcasts live ticks with <code className="text-cyan-300">LastRate</code> (LTP), <code className="text-cyan-300">TotalQty</code> (Volume), and <code className="text-cyan-300">Bid/Ask</code>.
              </li>
              <li>
                <b>Order Sizing &amp; Safety Gate:</b> Before calling <code className="text-cyan-300">PlaceOrderRequest</code>, Goldcrest calculates <code className="text-amber-300">Total Trade Value = Qty × Price</code>.
              </li>
              <li>
                <b>Zero-Leakage Budget Cap:</b> If <code className="text-amber-300">Trade Value &gt; ₹{budgetInr}</code>, Condition 16 immediately blocks the order, guaranteeing that testing never exceeds your configured budget.
              </li>
            </ul>
          </div>

          {/* Status Messages */}
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {saveSuccess && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>Small Trade Budget successfully saved and applied to live safety gate!</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-800/80 bg-slate-950 flex items-center justify-between gap-3">
          <div className="text-[11px] font-mono text-slate-400">
            Active Cap: <b className="text-cyan-300 font-bold">₹{budgetInr} INR</b> ({isEnabled ? 'Enforced' : 'Unrestricted'})
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-xs font-mono transition cursor-pointer border border-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-xs font-mono transition cursor-pointer shadow-lg shadow-cyan-950 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{loading ? 'SAVING...' : 'APPLY & SAVE BUDGET'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
