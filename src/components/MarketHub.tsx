import React, { useState } from 'react';
import { Globe, Activity, Layers, Search, TrendingUp, BarChart2 } from 'lucide-react';
import { ForexDashboard } from './ForexDashboard';
import { IndianMarketDashboard } from './IndianMarketDashboard';
import { OptionsDashboard } from './OptionsDashboard';
import { OptionsScannerView } from './OptionsScannerView';
import { TradingSignal, Candle } from '../markets/common/types';

interface MarketHubProps {
  forexPairs: any[];
  indianUnderlyings: any[];
  candlesMap: Record<string, Candle[]>;
  onSelectSignal: (signal: TradingSignal) => void;
  onEnsureCandles: (symbol: string) => Promise<void>;
  initialOptionSymbol?: string;
  environment?: string;
}

export const MarketHub: React.FC<MarketHubProps> = ({
  forexPairs,
  indianUnderlyings,
  candlesMap,
  onSelectSignal,
  onEnsureCandles,
  initialOptionSymbol = 'NIFTY',
  environment = 'LIVE'
}) => {
  const [activeMarketTab, setActiveMarketTab] = useState<'forex' | 'indian' | 'options' | 'scanner'>('forex');
  const [selectedOptionSymbol, setSelectedOptionSymbol] = useState<string>(initialOptionSymbol);

  const handleSelectOptionChain = (symbol: string) => {
    setSelectedOptionSymbol(symbol);
    setActiveMarketTab('options');
  };

  return (
    <div id="unified_market_hub" className="space-y-4">
      {/* Secondary Market Sub-Navigation Tabs */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-2 px-3 shadow-md" style={{ marginBottom: '5px' }}>
        <div className="flex items-center space-x-1.5 overflow-x-auto text-xs font-mono">
          <span className="text-slate-500 font-semibold px-2 uppercase text-[10px] hidden sm:inline">
            MARKET VIEW:
          </span>
          {[
            { id: 'forex', label: 'FOREX (G10)', icon: Globe },
            { id: 'indian', label: 'INDIAN MARKET (NSE)', icon: Activity },
            { id: 'options', label: 'OPTIONS CHAIN', icon: Layers },
            { id: 'scanner', label: 'OPTIONS SCANNER', icon: Search }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeMarketTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`subtab_market_${tab.id}`}
                onClick={() => setActiveMarketTab(tab.id as any)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap ${
                  isSel
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="hidden md:flex items-center space-x-2 text-[11px] font-mono text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Multi-Timeframe Engine Active</span>
        </div>
      </div>

      {/* Sub-view Rendering */}
      {activeMarketTab === 'forex' && (
        <ForexDashboard
          pairs={forexPairs}
          onSelectSignal={onSelectSignal}
          candlesMap={candlesMap}
          onEnsureCandles={onEnsureCandles}
          environment={environment}
        />
      )}

      {activeMarketTab === 'indian' && (
        <IndianMarketDashboard
          underlyings={indianUnderlyings}
          onSelectOptionChain={handleSelectOptionChain}
          onSelectSignal={onSelectSignal}
          candlesMap={candlesMap}
          onEnsureCandles={onEnsureCandles}
        />
      )}

      {activeMarketTab === 'options' && (
        <OptionsDashboard
          initialSymbol={selectedOptionSymbol}
        />
      )}

      {activeMarketTab === 'scanner' && (
        <OptionsScannerView />
      )}
    </div>
  );
};
