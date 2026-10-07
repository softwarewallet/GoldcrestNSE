import React, { useEffect, useState } from 'react';
import { LockKeyhole, LogIn, LogOut, ShieldCheck } from 'lucide-react';

interface SessionState {
  configured: boolean;
  authenticated: boolean;
}

export const OperatorSessionGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<SessionState | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await fetch('/api/operator/session', { credentials: 'same-origin' });
      const data = await res.json();
      setState({ configured: Boolean(data.configured), authenticated: Boolean(data.authenticated) });
    } catch {
      setState({ configured: false, authenticated: false });
    }
  };

  useEffect(() => { void load(); }, []);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/operator/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Operator authentication failed.');
      setKey('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Operator authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  if (state === null) {
    return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-mono text-xs">Checking operator session…</div>;
  }

  if (!state.configured || state.authenticated) return <>{children}</>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-6">
      <form onSubmit={login} className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-7 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-emerald-950 border border-emerald-800"><LockKeyhole className="w-5 h-5 text-emerald-400" /></div>
          <div>
            <h1 className="text-lg font-bold text-white">Goldcrest Operator Access</h1>
            <p className="text-[11px] text-slate-500 font-mono">LIVE-only trading analyst · protected operator session</p>
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 mb-5 text-xs text-slate-400 flex gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>The operator API key stays on the server. This browser receives only an HttpOnly, same-origin session cookie.</span>
        </div>
        <label className="block text-xs font-mono text-slate-400 mb-2">Operator API Key</label>
        <input
          autoFocus
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          autoComplete="current-password"
          className="w-full px-3 py-3 rounded-lg bg-slate-950 border border-slate-700 text-white outline-none focus:border-emerald-600 font-mono"
          placeholder="Enter server-configured operator key"
        />
        {error && <div className="mt-3 text-xs text-rose-400 font-mono">{error}</div>}
        <button disabled={busy || !key} className="mt-5 w-full py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2">
          <LogIn className="w-4 h-4" /> {busy ? 'AUTHENTICATING…' : 'ENTER GOLDCREST'}
        </button>
      </form>
    </div>
  );
};
