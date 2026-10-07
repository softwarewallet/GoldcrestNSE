import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, FileDown, RefreshCw, Search } from 'lucide-react';

type HistoryDirection = 'ALL' | 'BUY' | 'SELL';
type HistoryPeriod = 'TODAY' | 'CURRENT_MONTH' | 'PREVIOUS_MONTH' | 'CUSTOM';

interface OrderHistoryRow {
  id: string;
  broker: 'FIVE_PAISA';
  environment: 'LIVE';
  symbol: string;
  openingDirection: 'BUY' | 'SELL';
  closingTime: number;
  entryPrice: number | null;
  closingPrice: number | null;
  closingQuantity: number | null;
  closingVolume: number | null;
  swap: number | null;
  commission: number | null;
  netAmount: number | null;
  balance: number | null;
  orderStatus: string;
  brokerOrderId: string | null;
}

const pad = (value: number) => String(value).padStart(2, '0');

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthBounds(offset = 0): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return {
    from: `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`,
    to: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`
  };
}

function todayBounds(): { from: string; to: string } {
  const value = monthBounds(0).from;
  return { from: value, to: value };
}

const formatPrice = (value: number | null, symbol: string) => {
  if (value === null || !Number.isFinite(value)) return '—';
  const digits = symbol.includes('/') || !['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY'].some(prefix => symbol.toUpperCase().startsWith(prefix))
    ? 5
    : 2;
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatNumber = (value: number | null, digits = 2) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const csvEscape = (value: unknown) => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

export const HistoryPage: React.FC = () => {
  const currentMonth = monthBounds(0);
  const [period, setPeriod] = useState<HistoryPeriod>('CURRENT_MONTH');
  const [direction, setDirection] = useState<HistoryDirection>('ALL');
  const [fromDate, setFromDate] = useState(currentMonth.from);
  const [toDate, setToDate] = useState(currentMonth.to);
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState<OrderHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = new Date(`${fromDate}T00:00:00`).getTime();
      const to = new Date(`${toDate}T23:59:59.999`).getTime();
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
        throw new Error('Invalid history date range.');
      }

      const params = new URLSearchParams({
        from: String(from),
        to: String(to),
        direction
      });
      const response = await fetch(`/api/brokers/order-history?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || 'Live order history is unavailable.');
      }

      setRows(Array.isArray(payload?.rows) ? payload.rows : []);
      setLastUpdatedAt(Date.now());
    } catch (err: any) {
      setRows([]);
      setError(err?.message || 'Live order history is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [direction, fromDate, toDate]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const applyPeriod = (next: HistoryPeriod) => {
    setPeriod(next);
    if (next === 'TODAY') {
      const bounds = todayBounds();
      setFromDate(bounds.from);
      setToDate(bounds.to);
    } else if (next === 'CURRENT_MONTH') {
      const bounds = monthBounds(0);
      setFromDate(bounds.from);
      setToDate(bounds.to);
    } else if (next === 'PREVIOUS_MONTH') {
      const bounds = monthBounds(-1);
      setFromDate(bounds.from);
      setToDate(bounds.to);
    }
  };

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(row =>
      [
        row.symbol,
        row.broker,
        row.openingDirection,
        row.orderStatus,
        row.brokerOrderId
      ].some(value => String(value || '').toLowerCase().includes(query))
    );
  }, [rows, searchQuery]);

  const totals = useMemo(() => ({
    count: filteredRows.length,
    quantity: filteredRows.reduce((sum, row) => sum + Number(row.closingQuantity || 0), 0),
    volume: filteredRows.reduce((sum, row) => sum + Number(row.closingVolume || 0), 0),
    commission: filteredRows.reduce((sum, row) => sum + Number(row.commission || 0), 0),
    net: filteredRows.reduce((sum, row) => sum + Number(row.netAmount || 0), 0)
  }), [filteredRows]);

  const exportStatement = () => {
    const headers = [
      'Symbol',
      'Opening direction',
      'Closing time',
      'Entry price',
      'Closing price',
      'Closing Quantity',
      'Closing volume',
      'Swap',
      'Commission',
      'Net $',
      'Balance $',
      'Broker',
      'Order status',
      'Broker order ID'
    ];

    const csvRows = filteredRows.map(row => [
      row.symbol,
      row.openingDirection,
      new Date(row.closingTime).toISOString(),
      row.entryPrice,
      row.closingPrice,
      row.closingQuantity,
      row.closingVolume,
      row.swap,
      row.commission,
      row.netAmount,
      row.balance,
      row.broker,
      row.orderStatus,
      row.brokerOrderId
    ].map(csvEscape).join(','));

    const csv = [headers.map(csvEscape).join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `goldcrest-live-order-history-${fromDate}-${toDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-[calc(100vh-162px)] w-full px-4 sm:px-6 lg:px-8 py-5 space-y-4 bg-[#03070d] text-slate-100">
      <section className="bg-slate-900 border border-slate-800 rounded-xl shadow-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white shrink-0">
            <CalendarDays className="w-4 h-4 text-emerald-400" />
            <span>History</span>
            <span className="text-[10px] text-slate-500 font-mono">LIVE ORDER HISTORY</span>
          </div>

          <div className="flex-1 flex flex-wrap items-center gap-2 font-mono text-xs">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search"
                className="w-44 h-8 bg-slate-950 border border-slate-700 rounded pl-8 pr-3 text-slate-200 outline-none focus:border-emerald-500"
              />
            </div>

            <label className="text-slate-500">Direction:</label>
            <div className="relative">
              <select
                value={direction}
                onChange={event => setDirection(event.target.value as HistoryDirection)}
                className="h-8 appearance-none bg-slate-950 border border-slate-700 rounded pl-3 pr-8 text-slate-200"
              >
                <option value="ALL">All directions</option>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2 w-3.5 h-3.5 text-slate-500" />
            </div>

            <label className="text-slate-500">Period:</label>
            <div className="relative">
              <select
                value={period}
                onChange={event => applyPeriod(event.target.value as HistoryPeriod)}
                className="h-8 appearance-none bg-slate-950 border border-slate-700 rounded pl-3 pr-8 text-slate-200"
              >
                <option value="TODAY">Today</option>
                <option value="CURRENT_MONTH">Current month</option>
                <option value="PREVIOUS_MONTH">Previous month</option>
                <option value="CUSTOM">Custom</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2 w-3.5 h-3.5 text-slate-500" />
            </div>

            <input
              type="date"
              value={fromDate}
              onChange={event => {
                setPeriod('CUSTOM');
                setFromDate(event.target.value);
              }}
              className="h-8 bg-slate-950 border border-slate-700 rounded px-2 text-slate-300"
              aria-label="History from date"
            />
            <span className="text-slate-600">—</span>
            <input
              type="date"
              value={toDate}
              onChange={event => {
                setPeriod('CUSTOM');
                setToDate(event.target.value);
              }}
              className="h-8 bg-slate-950 border border-slate-700 rounded px-2 text-slate-300"
              aria-label="History to date"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void fetchHistory()}
              disabled={loading}
              className="h-8 px-3 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5"
              title="Reload authoritative live order history"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Order history
            </button>
            <button
              type="button"
              onClick={exportStatement}
              disabled={!filteredRows.length}
              className="h-8 px-3 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold text-xs flex items-center gap-1.5"
            >
              <FileDown className="w-3.5 h-3.5" />
              Statement
            </button>
          </div>
        </div>

        <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
          <div className="text-slate-400">
            {loading ? 'Loading authoritative live history…' : error ? error : `${filteredRows.length} records`}
          </div>
          <div className="flex items-center gap-4 text-slate-500">
            <span>Quantity <b className="text-slate-300">{formatNumber(totals.quantity, 2)}</b></span>
            <span>Volume <b className="text-slate-300">{formatNumber(totals.volume, 2)}</b></span>
            <span>Commission <b className="text-slate-300">{formatNumber(totals.commission, 2)}</b></span>
            <span>Net <b className="text-slate-300">{totals.net === 0 ? '—' : formatNumber(totals.net, 2)}</b></span>
            {lastUpdatedAt && <span>Updated {new Date(lastUpdatedAt).toLocaleTimeString()}</span>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-xs font-mono border-collapse">
            <thead className="bg-[#252525] text-slate-300">
              <tr>
                <th className="h-10 px-4 text-left font-medium border-r border-slate-700/60">Symbol</th>
                <th className="h-10 px-4 text-left font-medium border-r border-slate-700/60">Opening direction</th>
                <th className="h-10 px-4 text-left font-medium border-r border-slate-700/60">Closing time</th>
                <th className="h-10 px-4 text-right font-medium border-r border-slate-700/60">Entry price</th>
                <th className="h-10 px-4 text-right font-medium border-r border-slate-700/60">Closing price</th>
                <th className="h-10 px-4 text-right font-medium border-r border-slate-700/60">Closing Quantity</th>
                <th className="h-10 px-4 text-right font-medium border-r border-slate-700/60">Closing volume</th>
                <th className="h-10 px-4 text-right font-medium border-r border-slate-700/60">Swap</th>
                <th className="h-10 px-4 text-right font-medium border-r border-slate-700/60">Commission</th>
                <th className="h-10 px-4 text-right font-medium border-r border-slate-700/60">Net $</th>
                <th className="h-10 px-4 text-right font-medium">Balance $</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredRows.map(row => (
                <tr key={`${row.broker}-${row.id}`} className="bg-slate-950/30 hover:bg-slate-900 transition">
                  <td className="px-4 py-3 text-white font-semibold">
                    <div className="flex items-center gap-2">
                      <span>{row.symbol}</span>
                      <span className="text-[9px] text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">{row.broker}</span>
                    </div>
                  </td>
                  <td className={`px-4 py-3 font-semibold ${row.openingDirection === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {row.openingDirection}
                  </td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                    {new Date(row.closingTime).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-200">{formatPrice(row.entryPrice, row.symbol)}</td>
                  <td className="px-4 py-3 text-right text-slate-200">{formatPrice(row.closingPrice, row.symbol)}</td>
                  <td className="px-4 py-3 text-right text-slate-200">{formatNumber(row.closingQuantity)}</td>
                  <td className="px-4 py-3 text-right text-slate-200">{formatNumber(row.closingVolume)}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{formatNumber(row.swap)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{formatNumber(row.commission)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${row.netAmount === null ? 'text-slate-500' : row.netAmount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatNumber(row.netAmount)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{formatNumber(row.balance)}</td>
                </tr>
              ))}

              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-slate-600">
                    {error || 'No live order history records for the selected period.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-[10px] text-slate-500">
        History is sourced from the configured LIVE brokers. Values not supplied by the authoritative broker history feed are shown as “—” rather than estimated.
      </section>
    </main>
  );
};
