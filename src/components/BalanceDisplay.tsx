import React, { useEffect, useState } from 'react';
import { Wallet, RefreshCw, AlertCircle, Clock, KeyRound, X, Lock, CheckCircle2 } from 'lucide-react';
import { BrokerAccountInfo, BrokerType } from '../brokers/types';

interface BalanceDisplayProps {
  environment?: string;
}

const BROKERS: BrokerType[] = ['FIVE_PAISA'];

export const BalanceDisplay: React.FC<BalanceDisplayProps> = () => {
  const [accounts, setAccounts] = useState<Record<string, BrokerAccountInfo | null>>({
    FIVE_PAISA: null
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({
    FIVE_PAISA: null
  });
  const [loading, setLoading] = useState<Record<string, boolean>>({
    FIVE_PAISA: false
  });
  const [lastUpdated, setLastUpdated] = useState<Record<string, number | null>>({
    FIVE_PAISA: null
  });

  // TOTP Modal State
  const [isTotpModalOpen, setIsTotpModalOpen] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [totpSuccess, setTotpSuccess] = useState<string | null>(null);

  const fetchBalances = async (force: boolean = false) => {
    setLoading({ FIVE_PAISA: true });

    try {
      const url = force ? '/api/brokers/status?force=true' : '/api/brokers/status';
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || data?.message || `Broker status request failed (HTTP ${response.status})`));
      }

      const nextAccounts: Record<string, BrokerAccountInfo | null> = {
        FIVE_PAISA: null
      };
      const nextErrors: Record<string, string | null> = {
        FIVE_PAISA: null
      };
      const now = Date.now();

      for (const broker of BROKERS) {
        const row = Array.isArray(data?.brokers)
          ? data.brokers.find((item: any) => item?.broker === broker)
          : null;

        if (row?.account && row.account.broker === broker) {
          nextAccounts[broker] = row.account as BrokerAccountInfo;
          continue;
        }

        const message = String(row?.error || row?.lastRefreshError || '');
        nextErrors[broker] = message || `${broker} live account data unavailable`;

        if (row?.code === 'RATE_LIMITED' || row?.lastRefreshError) {
          const previousAccount = accounts[broker];
          if (previousAccount) {
            nextAccounts[broker] = previousAccount;
            continue;
          }
        }
      }

      setAccounts(nextAccounts);
      setErrors(nextErrors);
      setLastUpdated(prev => ({
        ...prev,
        FIVE_PAISA: nextAccounts.FIVE_PAISA ? now : prev.FIVE_PAISA
      }));
    } catch (err: any) {
      setErrors(prev => ({
        ...prev,
        FIVE_PAISA: prev.FIVE_PAISA || err?.message || '5paisa status temporarily unavailable'
      }));
    } finally {
      setLoading({ FIVE_PAISA: false });
    }
  };
  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleTotpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode.trim()) {
      setTotpError('Please enter a valid 6-digit TOTP code.');
      return;
    }
    setTotpSubmitting(true);
    setTotpError(null);
    setTotpSuccess(null);

    try {
      const res = await fetch('/api/brokers/fivepaisa/totp-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totp: totpCode.trim(),
          pin: pinCode.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '5paisa TOTP authentication failed');
      }

      setTotpSuccess('Session established successfully!');
      setTimeout(() => {
        setIsTotpModalOpen(false);
        setTotpCode('');
        setPinCode('');
        setTotpSuccess(null);
        void fetchBalances();
      }, 1000);
    } catch (err: any) {
      setTotpError(err.message || 'TOTP session establishment failed');
    } finally {
      setTotpSubmitting(false);
    }
  };

  const isTotpRequiredError = (errorMsg: string | null, broker: BrokerType) => {
    if (broker !== 'FIVE_PAISA' || !errorMsg) return false;
    const lower = errorMsg.toLowerCase();
    return (
      lower.includes('totp') ||
      lower.includes('two-factor') ||
      lower.includes('2fa') ||
      lower.includes('pin')
    );
  };

  const formatCurrency = (value: number | undefined, currency = 'INR') => {
    if (value === undefined || value === null || !Number.isFinite(value)) return '--';
    const normalized = currency.toUpperCase();
    return new Intl.NumberFormat(normalized === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: normalized,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const timeAgo = (timestamp: number | null) => {
    if (!timestamp) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  };

  const renderCard = (broker: BrokerType) => {
    const account = accounts[broker];
    const error = errors[broker];
    const isLoading = loading[broker];
    const updated = lastUpdated[broker];
    const isStale = updated ? Date.now() - updated > 30000 : false;
    const label = '5paisa';
    const market = 'INDIAN MARKETS';

    const metric = (
      title: string,
      value: number | undefined,
      tone: string = 'text-white'
    ) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[9px] text-slate-500">
          <span>{title}</span>
        </div>
        <div className={`mt-0.5 text-[12px] font-semibold font-mono ${tone}`}>
          {formatCurrency(value, account?.currency || 'INR')}
        </div>
      </div>
    );

    return (
      <div key={broker} id={`balance_display_${broker.toLowerCase()}`} className="flex flex-col bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg py-2 px-3 min-w-[340px] shadow-sm font-mono">
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : account?.connectionStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">{label}</span>
            <span className="text-[8px] px-1 rounded bg-slate-800 text-slate-500 border border-slate-700">{market}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-emerald-500" />
            <button
              type="button"
              id={`btn_refresh_balance_${broker.toLowerCase()}`}
              onClick={() => fetchBalances(true)}
              disabled={isLoading}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 disabled:opacity-50 transition cursor-pointer"
              title="Refresh Balance"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {account ? (
          <>
            <div className="grid grid-cols-4 gap-2 border-t border-slate-800/60 pt-2">
              {metric('Balance', account.balance)}
              {metric('Equity', account.equity)}
              {metric('Used margin', account.usedMargin, 'text-amber-300')}
              {metric('Free margin', account.freeMargin ?? account.availableMargin, 'text-emerald-300')}
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[9px] text-slate-500">
              <span className="truncate max-w-[145px]" title={account.accountId}>A/C {account.accountId}</span>
              <span>{account.currency || 'INR'}</span>
              <span className={isStale ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                <Clock className="inline w-2.5 h-2.5 mr-0.5" />{isStale ? 'STALE' : timeAgo(updated)}
              </span>
            </div>
          </>
        ) : (
          <div className="py-1.5">
            <div className="text-sm font-bold text-slate-500">{isLoading ? 'Connecting…' : 'Balance Unavailable'}</div>
            {error && (
              isTotpRequiredError(error, broker) ? (
                <button
                  type="button"
                  id={`btn_totp_required_${broker.toLowerCase()}`}
                  onClick={() => setIsTotpModalOpen(true)}
                  className="mt-1 inline-flex items-center space-x-1.5 px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold tracking-wide transition cursor-pointer shadow-sm hover:border-amber-400"
                  title="Click to enter TOTP & PIN to establish session"
                >
                  <KeyRound className="w-3 h-3 text-amber-400 animate-pulse" />
                  <span>TOTP Required</span>
                </button>
              ) : (
                <div className="text-[9px] text-rose-400 truncate mt-0.5" title={error}>
                  <AlertCircle className="inline w-2.5 h-2.5 mr-1" />
                  {error.length > 50 ? `${error.substring(0, 47)}...` : error}
                </div>
              )
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div id="live_balance_display" className="flex items-center">
        {renderCard('FIVE_PAISA')}
      </div>

      {/* TOTP Session Window Overlay */}
      {isTotpModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 font-mono text-xs text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">5paisa TOTP Authentication</h3>
                  <p className="text-[10px] text-slate-400">Establish an active live broker session</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsTotpModalOpen(false);
                  setTotpError(null);
                  setTotpSuccess(null);
                }}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {totpError && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="break-words">{totpError}</span>
              </div>
            )}

            {totpSuccess && (
              <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{totpSuccess}</span>
              </div>
            )}

            <form onSubmit={handleTotpLogin} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  6-Digit TOTP Code <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 123456"
                  autoFocus
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-sm font-mono tracking-widest focus:outline-none focus:border-amber-500 transition placeholder:text-slate-600"
                />
                <p className="text-[9px] text-slate-500 mt-1">
                  Enter current code from Google Authenticator, Authy, or 2FA app
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  2FA PIN (Optional if saved in config)
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value)}
                  placeholder="Enter 2FA PIN"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-sm font-mono tracking-widest focus:outline-none focus:border-amber-500 transition placeholder:text-slate-600"
                />
                <p className="text-[9px] text-slate-500 mt-1">
                  Your 5paisa security PIN (4-6 digits)
                </p>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsTotpModalOpen(false);
                    setTotpError(null);
                    setTotpSuccess(null);
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={totpSubmitting || !totpCode.trim()}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-amber-950/40"
                >
                  {totpSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Authenticating...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Establish Session</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

