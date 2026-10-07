import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { MarketHub } from './components/MarketHub';
import { SignalsView } from './components/SignalsView';
import { TradingHub } from './components/TradingHub';
import { TradingOperationsDashboard } from './components/TradingOperationsDashboard';
import { TradingControlCenter } from './components/TradingControlCenter';
import { HistoryPage } from './components/HistoryPage';
import { DatabaseExplorerPage } from './components/DatabaseExplorerPage';
import { SettingsHub } from './components/SettingsHub';
import { TerminalDashboard } from './components/TerminalDashboard';
import { ForexTerminalDashboard } from './components/ForexTerminalDashboard';
import { GlobalAppShell } from './components/GlobalAppShell';
import { SignalModal } from './components/SignalModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { OrderConfirmationModal } from './components/OrderConfirmationModal';
import { TradingSignal, Candle, ForexSessionState, IndianSessionState } from './markets/common/types';
import { getForexSessionState, getIndianSessionState } from './markets/common/session';
import { BrokerType, TradingEnvironment, OrderRequest } from './brokers/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('forex_terminal');
  const [forexPairs, setForexPairs] = useState<any[]>([]);
  const [forexSessions, setForexSessions] = useState<ForexSessionState>(() => getForexSessionState(new Date()));
  const [indianUnderlyings, setIndianUnderlyings] = useState<any[]>([]);
  const [indianSession, setIndianSession] = useState<IndianSessionState>(() => getIndianSessionState(new Date()));
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [candlesMap, setCandlesMap] = useState<Record<string, Candle[]>>({});
  const [selectedSignal, setSelectedSignal] = useState<TradingSignal | null>(null);
  const [selectedOptionUnderlying, setSelectedOptionUnderlying] = useState<string>('NIFTY');
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const terminalRefreshInFlightRef = useRef<Promise<void> | null>(null);

  // Broker Environment & Safety State
  const [environment, setEnvironment] = useState<TradingEnvironment>('LIVE');
  const [selectedBroker, setSelectedBroker] = useState<BrokerType>('CTRADER');
  const [maskedAccount, setMaskedAccount] = useState<string>('****');
  const [currency, setCurrency] = useState<string>('USD');
  const [balance, setBalance] = useState<number>(0);
  const [isEmergencyHalted, setIsEmergencyHalted] = useState<boolean>(false);
  const [autoTradingStatus, setAutoTradingStatus] = useState<any | null>(null);
  const [activeForexUniverse, setActiveForexUniverse] = useState<string[]>([
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD'
  ]);
  const [activeIndianUniverse, setActiveIndianUniverse] = useState<string[]>([
    'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'
  ]);

  // Order confirmation modal; Goldcrest operates in LIVE_ONLY mode.
  const [pendingOrder, setPendingOrder] = useState<OrderRequest | null>(null);

  // Fetch Broker Status
  const refreshBrokerStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/brokers/status');
      if (res.ok) {
        const data = await res.json();
        setEnvironment('LIVE');
        setSelectedBroker(data.selectedBroker || 'CTRADER');
        setIsEmergencyHalted(data.emergencyStop?.isHalted || false);

        if (data.activeAccount) {
          setMaskedAccount(data.activeAccount.accountId || '****');
          setCurrency(data.activeAccount.currency || 'USD');
          setBalance(data.activeAccount.balance || 0);
        } else {
          const cred = data.credentials?.find((c: any) => c.broker === data.selectedBroker && c.environment === data.environment);
          if (cred) {
            setMaskedAccount(cred.maskedAccountId || cred.maskedClientId || '****');
          }
        }
      }
    } catch (err) {
      console.warn('Broker status endpoint temporarily unavailable, using LIVE-only state:', err);
    }
  }, []);

  // Fetch all primary terminal data
  // Fetch all primary terminal data. Background refreshes are serialized
  // and never replace valid state with an empty/error fallback.
  const refreshTerminalData = useCallback(async (showSpinner = true) => {
    if (terminalRefreshInFlightRef.current) {
      return terminalRefreshInFlightRef.current;
    }

    const run = (async () => {
      if (showSpinner) setIsRefreshing(true);

      try {
        const safeFetchJson = async (url: string, fallback: any = []) => {
          try {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) {
              return await res.json();
            }
          } catch (e) {
            console.warn(`Safe fetch failed for ${url}:`, e);
          }
          return fallback;
        };

        const [fxPairs, inUnder, sigs, autoStatus, config] = await Promise.all([
          safeFetchJson('/api/forex/pairs'),
          safeFetchJson('/api/india/underlyings'),
          safeFetchJson('/api/signals/all'),
          safeFetchJson('/api/auto-trading/status', null),
          safeFetchJson('/api/config', null)
        ]);

        if (config && typeof config === 'object') {
          if (Array.isArray(config.autoLiveForexPairs)) {
            setActiveForexUniverse(config.autoLiveForexPairs);
          }
          if (Array.isArray(config.autoLiveIndianUnderlyings)) {
            setActiveIndianUniverse(config.autoLiveIndianUnderlyings);
          }
        }

        const selectedForex = Array.isArray(config?.autoLiveForexPairs)
          ? new Set(config.autoLiveForexPairs.map((symbol: any) => String(symbol).toUpperCase()))
          : null;
        const selectedIndia = Array.isArray(config?.autoLiveIndianUnderlyings)
          ? new Set(config.autoLiveIndianUnderlyings.map((symbol: any) => String(symbol).toUpperCase()))
          : null;

        if (Array.isArray(fxPairs) && fxPairs.length > 0) {
          setForexPairs(selectedForex
            ? fxPairs.filter((row: any) => selectedForex.has(String(row?.symbol || '').toUpperCase()))
            : fxPairs);
        }

        if (Array.isArray(inUnder) && inUnder.length > 0) {
          setIndianUnderlyings(selectedIndia
            ? inUnder.filter((row: any) => selectedIndia.has(String(row?.symbol || '').toUpperCase()))
            : inUnder);
        }

        if (Array.isArray(sigs) && sigs.length > 0) setSignals(sigs);
        if (autoStatus && typeof autoStatus === 'object') setAutoTradingStatus(autoStatus);

        const [eurCandles, niftyCandles] = await Promise.all([
          safeFetchJson('/api/candles/EUR%2FUSD'),
          safeFetchJson('/api/candles/NIFTY')
        ]);

        // Preserve valid chart data during transient broker/API errors.
        if (Array.isArray(eurCandles) && eurCandles.length > 0) {
          setCandlesMap(prev => ({ ...prev, 'EUR/USD': eurCandles }));
        }
        if (Array.isArray(niftyCandles) && niftyCandles.length > 0) {
          setCandlesMap(prev => ({ ...prev, 'NIFTY': niftyCandles }));
        }
      } catch (err) {
        console.error('Failed to load terminal data:', err);
      } finally {
        if (showSpinner) setIsRefreshing(false);
        setLoadingInitial(false);
      }
    })();

    terminalRefreshInFlightRef.current = run;
    try {
      await run;
    } finally {
      terminalRefreshInFlightRef.current = null;
    }
  }, [terminalRefreshInFlightRef]);

  // One application-level market refresh loop. Child dashboards do not need
  // independent high-frequency polling for the same broker resources.
  useEffect(() => {
    void refreshTerminalData(true);

    const dataTimer = setInterval(() => {
      void refreshTerminalData(false);
    }, 30000);

    return () => clearInterval(dataTimer);
  }, [refreshTerminalData]);

  // LIVE_ONLY runtime: no environment switching is exposed.
  const handleRequestEnvironmentChange = (_targetEnv: TradingEnvironment) => {
    // Intentionally ignored; server enforces LIVE_ONLY.
  };

  // Broker selection handler
  const handleSelectBroker = async (broker: BrokerType) => {
    try {
      const res = await fetch('/api/brokers/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker })
      });
      if (res.ok) {
        setSelectedBroker(broker);
        await refreshBrokerStatus();
      }
    } catch (err) {
      console.error('Failed to select broker:', err);
    }
  };

  // Toggle Emergency Kill Switch
  const handleToggleKillSwitch = async () => {
    const action = isEmergencyHalted ? 'RESUME' : 'HALT';
    if (action === 'HALT') {
      const confirmed = confirm('CRITICAL: Are you sure you want to trigger the EMERGENCY STOP? This will cancel all pending orders and immediately block any new trade orders.');
      if (!confirmed) return;
    }

    try {
      const res = await fetch('/api/brokers/emergency-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: 'Operator manual UI button' })
      });
      if (res.ok) {
        const data = await res.json();
        setIsEmergencyHalted(data.emergencyStop.isHalted);
      }
    } catch (err) {
      console.error('Failed to trigger emergency stop:', err);
    }
  };

  // Track last fetched timestamps to prevent redundant polling loops
  const candleFetchTimesRef = useRef<Record<string, number>>({});

  // Ensure candles loaded for an instrument
  const ensureCandlesLoaded = useCallback(async (symbol: string) => {
    if (!symbol) return;
    const now = Date.now();
    const lastFetch = candleFetchTimesRef.current[symbol] || 0;
    // Throttle to at most once every 10 seconds per symbol
    if (now - lastFetch < 10000) return;
    candleFetchTimesRef.current[symbol] = now;

    try {
      const encoded = encodeURIComponent(symbol);
      const res = await fetch(`/api/candles/${encoded}`);
      if (res.ok) {
        const data = await res.json();
        setCandlesMap(prev => ({ ...prev, [symbol]: Array.isArray(data) ? data : [] }));
      }
    } catch {
      // Safe fallback when disconnected or server is restarting
      setCandlesMap(prev => ({ ...prev, [symbol]: prev[symbol] || [] }));
    }
  }, []);

  // Execute confirmed order
  const handleExecuteConfirmedOrder = async (confirmedOrder: OrderRequest) => {
    setPendingOrder(null);
    try {
      const idempotencyKey = confirmedOrder.signalId || `manual-${confirmedOrder.market}-${confirmedOrder.symbol}-${confirmedOrder.side}-${Date.now()}`;
      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          ...confirmedOrder,
          broker: selectedBroker,
          environment,
          operatorConfirmed: true
        })
      });
      const data = await res.json();
      if (res.ok && (data.success || ['EXECUTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'DUPLICATE_REPLAY'].includes(data.status))) {
        alert(`Order Placed Successfully!\nBroker: ${selectedBroker}\nID: ${data.order?.orderId}\nStatus: ${data.order?.status}`);
        await refreshBrokerStatus();
      } else {
        alert(`Order Rejected / Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Order Execution Error: ${err.message}`);
    }
  };

  return (
    <GlobalAppShell
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      indianSession={indianSession}
      indianUnderlyings={indianUnderlyings}
      header={
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          forexSessions={forexSessions}
          indianSession={indianSession}
          onRefresh={refreshTerminalData}
          isRefreshing={isRefreshing}
          onOpenDiagnostics={() => setShowDiagnostics(true)}
          environment={environment}
          onRequestEnvironmentChange={handleRequestEnvironmentChange}
          selectedBroker={selectedBroker}
          maskedAccount={maskedAccount}
          autoTradingStatus={autoTradingStatus}
          isEmergencyHalted={isEmergencyHalted}
          onToggleKillSwitch={handleToggleKillSwitch}
        />
      }
    >
      {/* Fixed global shell content outlet: dashboards and all secondary pages render here. */}
      {activeTab === 'forex_terminal' ? (
        <ForexTerminalDashboard
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          forexSessions={forexSessions}
          selectedBroker={selectedBroker}
          environment={environment}
          maskedAccount={maskedAccount}
          balance={balance}
          currency={currency}
          isEmergencyHalted={isEmergencyHalted}
          isRefreshing={isRefreshing}
          onRefresh={refreshTerminalData}
          onToggleKillSwitch={handleToggleKillSwitch}
          candlesMap={candlesMap}
          forexPairs={forexPairs}
          signals={signals}
          onSelectSignal={(sig) => setSelectedSignal(sig)}
          onRequestOrder={(order) => setPendingOrder(order)}
        />
      ) : activeTab === 'market' ? (
        <TerminalDashboard
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          forexSessions={forexSessions}
          indianSession={indianSession}
          selectedBroker={selectedBroker}
          environment={environment}
          maskedAccount={maskedAccount}
          balance={balance}
          currency={currency}
          isEmergencyHalted={isEmergencyHalted}
          isRefreshing={isRefreshing}
          onRefresh={refreshTerminalData}
          onToggleKillSwitch={handleToggleKillSwitch}
          candlesMap={candlesMap}
          indianUnderlyings={indianUnderlyings}
          signals={signals}
          onSelectSignal={(sig) => setSelectedSignal(sig)}
        />
      ) : (
        <main className="min-h-[calc(100vh-162px)] w-full px-4 sm:px-6 lg:px-8 py-5 space-y-4 bg-[#03070d] text-slate-100">
          {loadingInitial ? (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3 font-mono">
              <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-sm text-slate-300">Initializing Quantitative Terminal Engine...</div>
              <div className="text-xs text-slate-500">Loading broker adapters, SQLite storage and risk gates</div>
            </div>
          ) : (
            <>
              {/* Market Watch / scanners */}
              {activeTab === 'market_watch' && (
                <MarketHub
                  forexPairs={forexPairs}
                  indianUnderlyings={indianUnderlyings}
                  candlesMap={candlesMap}
                  onSelectSignal={(sig) => setSelectedSignal(sig)}
                  onEnsureCandles={ensureCandlesLoaded}
                  initialOptionSymbol={selectedOptionUnderlying}
                  environment={environment}
                />
              )}

              {activeTab === 'signals' && (
                <SignalsView
                  signals={signals}
                  onSelectSignal={(sig) => setSelectedSignal(sig)}
                />
              )}

              {activeTab === 'trading' && (
                <TradingHub
                  environment={environment}
                  selectedBroker={selectedBroker}
                  maskedAccount={maskedAccount}
                  balance={balance}
                  currency={currency}
                  isEmergencyHalted={isEmergencyHalted}
                  onRequestEnvironmentChange={handleRequestEnvironmentChange}
                />
              )}

              {(activeTab === 'pnl' || activeTab === 'accounting') && (
                <TradingControlCenter
                initialSection="ACCOUNT_OVERVIEW"
                reportsMode={true}
                onSelectSignalModal={(sig) => setSelectedSignal(sig)}
                autoTradingStatus={autoTradingStatus}
                onAutoTradingStatusChange={setAutoTradingStatus}
              />
              )}

              {(activeTab === 'research' || activeTab === 'ml') && (
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
                  Research and ML training interfaces are retired from the LIVE production runtime.
                </div>
              )}

              {(activeTab === 'control_center' || activeTab === 'operations' || activeTab === 'reconciliation' || activeTab === 'reconcile') && (
                <TradingControlCenter
                onSelectSignalModal={(sig) => setSelectedSignal(sig)}
                autoTradingStatus={autoTradingStatus}
                onAutoTradingStatusChange={setAutoTradingStatus}
              />
              )}

              {activeTab === 'alerts' && (
                <TradingOperationsDashboard initialSubTab="OPS" />
              )}

              {activeTab === 'history' && (
                <HistoryPage />
              )}

              {activeTab === 'database' && (
                <DatabaseExplorerPage />
              )}

              {(activeTab === 'settings' || activeTab === 'governance') && (
                <SettingsHub
                  currentEnvironment={environment}
                  selectedBroker={selectedBroker}
                  onEnvironmentChange={handleRequestEnvironmentChange}
                  onBrokerSelect={handleSelectBroker}
                  onRefreshGlobal={refreshBrokerStatus}
                />
              )}
            </>
          )}
        </main>
      )}
 
      {/* Signal Quantitative Inspection Modal */}
      {selectedSignal && (
        <SignalModal
          signal={selectedSignal}
          onClose={() => setSelectedSignal(null)}
        />
      )}

      {/* Database & Diagnostics Modal */}
      {showDiagnostics && (
        <DiagnosticsModal
          onClose={() => setShowDiagnostics(false)}
        />
      )}

      {/* Order Confirmation Modal */}
      {pendingOrder && (
        <OrderConfirmationModal
          isOpen={!!pendingOrder}
          onClose={() => setPendingOrder(null)}
          onConfirm={handleExecuteConfirmedOrder}
          order={pendingOrder}
          broker={selectedBroker}
          environment={environment}
          maskedAccount={maskedAccount}
          currentPrice={pendingOrder.price || 0}
        />
      )}
    </GlobalAppShell>
  );
}