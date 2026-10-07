
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database, RefreshCw, Search, ChevronDown, ChevronRight,
  Clock3, ListFilter, Table2, Activity, Braces, Copy
} from 'lucide-react';

type DatabaseTable = {
  name: string;
  label: string;
  category: string;
  description: string;
  count: number;
};

type DatabaseColumn = { name: string; type: string };

type DatabaseResponse = {
  table: string;
  label: string;
  category: string;
  columns: DatabaseColumn[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
  updatedAt: number;
};

const categoryOrder = ['Execution', 'Trading', 'Market Data', 'Strategy', 'Risk & System', 'Reference', 'ML & Research'];

function isTimeColumn(column: string): boolean {
  const name = column.toLowerCase();
  return name.includes('timestamp') || name.endsWith('_at') || name.endsWith('_time');
}

function formatValue(column: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-slate-600">—</span>;

  if (typeof value === 'number') {
    if (isTimeColumn(column) && value > 100000000000) {
      return <span title={String(value)}>{new Date(value).toLocaleString()}</span>;
    }
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(value);
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const text = String(value);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return (
        <pre className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-300">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    }
  } catch {
    // Keep normal text.
  }

  return text.length > 240 ? text.slice(0, 240) + '…' : text;
}

export const DatabaseExplorerPage: React.FC = () => {
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [selectedTable, setSelectedTable] = useState('execution_intents');
  const [data, setData] = useState<DatabaseResponse | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const grouped = useMemo(() => categoryOrder.map(category => ({
    category,
    tables: tables.filter(table => table.category === category)
  })).filter(group => group.tables.length > 0), [tables]);

  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    try {
      const response = await fetch('/api/database/overview', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Database overview unavailable.');
      setTables(Array.isArray(payload?.tables) ? payload.tables : []);
    } catch (err: any) {
      setError(err?.message || 'Database overview unavailable.');
    } finally {
      setLoadingTables(false);
    }
  }, []);

  const loadTable = useCallback(async () => {
    setLoadingRows(true);
    setError(null);
    setExpanded(null);
    try {
      const params = new URLSearchParams({
        table: selectedTable,
        limit: String(pageSize),
        offset: String(page * pageSize)
      });
      if (search.trim()) params.set('search', search.trim());
      if (sort) {
        params.set('sort', sort);
        params.set('dir', direction);
      }

      const response = await fetch('/api/database/table?' + params.toString(), { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Database table unavailable.');
      setData(payload as DatabaseResponse);
      setUpdatedAt(Date.now());
    } catch (err: any) {
      setData(null);
      setError(err?.message || 'Database table unavailable.');
    } finally {
      setLoadingRows(false);
    }
  }, [direction, page, pageSize, search, selectedTable, sort]);

  useEffect(() => { void loadTables(); }, [loadTables]);
  useEffect(() => { void loadTable(); }, [loadTable]);

  const chooseTable = (name: string) => {
    setSelectedTable(name);
    setPage(0);
    setSearch('');
    setSort('');
    setDirection('desc');
  };

  const sortBy = (column: string) => {
    setPage(0);
    if (sort === column) setDirection(current => current === 'asc' ? 'desc' : 'asc');
    else {
      setSort(column);
      setDirection('desc');
    }
  };

  const totalPages = data ? Math.max(Math.ceil(data.total / pageSize), 1) : 1;
  const totals = {
    rows: tables.reduce((sum, table) => sum + table.count, 0),
    execution: tables.filter(t => t.category === 'Execution').reduce((sum, t) => sum + t.count, 0),
    market: tables.filter(t => t.category === 'Market Data').reduce((sum, t) => sum + t.count, 0),
    strategy: tables.filter(t => t.category === 'Strategy').reduce((sum, t) => sum + t.count, 0)
  };

  const copyRow = async (row: Record<string, unknown>) => {
    try { await navigator.clipboard.writeText(JSON.stringify(row, null, 2)); } catch {}
  };

  return (
    <main className="min-h-[calc(100vh-162px)] w-full px-4 sm:px-6 lg:px-8 py-5 space-y-4 bg-[#03070d] text-slate-100">
      <section className="bg-slate-900 border border-slate-800 rounded-xl shadow-lg overflow-hidden">
        <div className="px-4 py-4 border-b border-slate-800 flex flex-col xl:flex-row xl:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <Database className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">SQLite Data Explorer</div>
              <div className="text-[10px] text-slate-500 font-mono">data/trading_analyst.sqlite</div>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
              <div className="text-[9px] uppercase text-slate-500 font-mono">Total rows</div>
              <div className="text-sm font-semibold font-mono">{totals.rows.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
              <div className="text-[9px] uppercase text-slate-500 font-mono">Execution</div>
              <div className="text-sm font-semibold font-mono">{totals.execution.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
              <div className="text-[9px] uppercase text-slate-500 font-mono">Market data</div>
              <div className="text-sm font-semibold font-mono">{totals.market.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
              <div className="text-[9px] uppercase text-slate-500 font-mono">Strategy</div>
              <div className="text-sm font-semibold font-mono">{totals.strategy.toLocaleString()}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => { void loadTables(); void loadTable(); }}
            disabled={loadingTables || loadingRows}
            className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold flex items-center gap-2"
          >
            <RefreshCw className={'w-3.5 h-3.5 ' + ((loadingTables || loadingRows) ? 'animate-spin' : '')} />
            Refresh
          </button>
        </div>
      </section>

      <section className="grid lg:grid-cols-[270px_minmax(0,1fr)] gap-4">
        <aside className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <Table2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold">Database Tables</span>
          </div>
          <div className="max-h-[calc(100vh-285px)] overflow-y-auto p-2">
            {loadingTables ? (
              <div className="p-4 text-xs text-slate-500">Loading table inventory…</div>
            ) : grouped.map(group => (
              <div key={group.category} className="mb-3">
                <div className="px-2 py-1.5 text-[9px] uppercase tracking-widest text-slate-600 font-mono">{group.category}</div>
                <div className="space-y-1">
                  {group.tables.map(table => {
                    const active = table.name === selectedTable;
                    return (
                      <button
                        key={table.name}
                        type="button"
                        onClick={() => chooseTable(table.name)}
                        className={'w-full text-left rounded-lg px-2.5 py-2 border transition ' + (
                          active
                            ? 'bg-blue-500/10 border-blue-500/30 text-white'
                            : 'border-transparent text-slate-400 hover:bg-slate-950 hover:text-slate-200'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-xs font-medium">{table.label}</span>
                          <span className="text-[9px] font-mono text-slate-600">{table.count.toLocaleString()}</span>
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">{table.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden min-w-0">
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex flex-col xl:flex-row xl:items-center gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Activity className="w-4 h-4 text-blue-400" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{selectedTable}</div>
                  <div className="text-[9px] text-slate-500 font-mono">
                    {data?.category || 'Database table'} • {data?.label || selectedTable}
                  </div>
                </div>
              </div>

              <div className="flex-1 flex items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                  <input
                    value={search}
                    onChange={event => { setPage(0); setSearch(event.target.value); }}
                    placeholder="Search rows across this table"
                    className="w-full h-8 bg-slate-950 border border-slate-700 rounded pl-8 pr-3 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="relative">
                  <ListFilter className="pointer-events-none absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <select
                    value={String(pageSize)}
                    onChange={event => { setPage(0); setPageSize(Number(event.target.value)); }}
                    className="h-8 appearance-none bg-slate-950 border border-slate-700 rounded pl-8 pr-8 text-xs text-slate-300"
                  >
                    <option value="25">25 rows</option>
                    <option value="50">50 rows</option>
                    <option value="100">100 rows</option>
                    <option value="250">250 rows</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-2 w-3.5 h-3.5 text-slate-500" />
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[9px] text-slate-500">
              <span>Rows <b className="text-slate-300">{data?.total?.toLocaleString() || 0}</b></span>
              <span>Columns <b className="text-slate-300">{data?.columns.length || 0}</b></span>
              {updatedAt && <span className="flex items-center gap-1"><Clock3 className="w-3 h-3" />Updated {new Date(updatedAt).toLocaleTimeString()}</span>}
              {error && <span className="text-rose-400">{error}</span>}
            </div>
          </div>

          <div className="overflow-auto max-h-[calc(100vh-330px)]">
            {loadingRows ? (
              <div className="min-h-[360px] flex items-center justify-center text-xs text-slate-500">Reading SQLite table…</div>
            ) : data && data.rows.length > 0 ? (
              <table className="w-full min-w-[1100px] text-[10px] font-mono border-collapse">
                <thead className="sticky top-0 z-10 bg-[#111923] text-slate-400">
                  <tr>
                    <th className="w-10 px-2 py-2 border-b border-slate-800"></th>
                    {data.columns.map(column => (
                      <th
                        key={column.name}
                        className="px-3 py-2 text-left font-medium whitespace-nowrap border-b border-slate-800 cursor-pointer hover:text-slate-200"
                        onClick={() => sortBy(column.name)}
                        title={'Sort by ' + column.name}
                      >
                        <div className="flex items-center gap-1">
                          <span>{column.name}</span>
                          {sort === column.name && <span className="text-blue-400">{direction === 'asc' ? '↑' : '↓'}</span>}
                        </div>
                        <div className="text-[8px] text-slate-700">{column.type || 'TEXT'}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => {
                    const isOpen = expanded === index;
                    return (
                      <React.Fragment key={selectedTable + '-' + page + '-' + index}>
                        <tr className="bg-slate-950/20 hover:bg-slate-950/70">
                          <td className="px-2 py-2 border-b border-slate-900 align-top">
                            <button type="button" onClick={() => setExpanded(isOpen ? null : index)} className="text-slate-500 hover:text-white" title="Inspect complete row">
                              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                          {data.columns.map(column => (
                            <td key={column.name} className="px-3 py-2 text-slate-300 border-b border-slate-900 align-top max-w-[360px]">
                              {formatValue(column.name, row[column.name])}
                            </td>
                          ))}
                        </tr>
                        {isOpen && (
                          <tr className="bg-[#050a11]">
                            <td colSpan={data.columns.length + 1} className="px-4 py-4 border-b border-slate-800">
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase tracking-wider">
                                  <Braces className="w-3.5 h-3.5 text-blue-400" />
                                  Complete row payload
                                </div>
                                <button type="button" onClick={() => void copyRow(row)} className="text-[9px] text-slate-500 hover:text-white flex items-center gap-1">
                                  <Copy className="w-3 h-3" />
                                  Copy JSON
                                </button>
                              </div>
                              <pre className="rounded-lg border border-slate-800 bg-black/30 p-3 text-[10px] leading-relaxed text-slate-300 overflow-auto max-h-72">
                                {JSON.stringify(row, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="min-h-[360px] flex flex-col items-center justify-center gap-2 text-xs text-slate-600">
                <Database className="w-8 h-8" />
                <span>{error || 'No records match the current filter.'}</span>
              </div>
            )}
          </div>

          <div className="px-4 py-2 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-[9px] font-mono text-slate-500">
            <span>{data ? 'Showing ' + data.rows.length + ' of ' + data.total.toLocaleString() + ' rows' : 'No data loaded'}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 0 || loadingRows} onClick={() => setPage(current => Math.max(current - 1, 0))} className="px-2.5 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-30">Previous</button>
              <span className="text-slate-400">{page + 1} / {totalPages}</span>
              <button type="button" disabled={page + 1 >= totalPages || loadingRows} onClick={() => setPage(current => Math.min(current + 1, totalPages - 1))} className="px-2.5 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-30">Next</button>
            </div>
          </div>
        </section>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-[9px] font-mono text-slate-500">
        <span className="text-slate-300">Database source:</span> data/trading_analyst.sqlite. This page reads the server-side SQLite database directly and is protected by the operator API.
      </section>
    </main>
  );
};
