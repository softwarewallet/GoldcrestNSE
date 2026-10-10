import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

let dbInstance: Database | null = null;
let dbInitializationPromise: Promise<Database> | null = null;

// All database paths are dynamically resolved via getDatabaseFilePaths()

export type DatabasePersistenceStatus = {
  lastPersistedAt: number | null;
  lastPersistenceError: string | null;
  lastRecoveryAt: number | null;
  recoveredFromBackup: boolean;
};

let persistenceStatus: DatabasePersistenceStatus = {
  lastPersistedAt: null,
  lastPersistenceError: null,
  lastRecoveryAt: null,
  recoveredFromBackup: false
};

export function getDatabaseFilePaths(): {
  primary: string;
  temporary: string;
  backup: string;
} {
  const envFile = process.env.GOLDCREST_DB_FILE;
  const primary = envFile ? path.resolve(envFile) : path.join(process.cwd(), 'data', 'trading_analyst.sqlite');
  return {
    primary,
    temporary: `${primary}.tmp`,
    backup: `${primary}.bak`
  };
}

export function recoverDatabaseFileIfNeeded(
  primaryFile = getDatabaseFilePaths().primary,
  backupFile = getDatabaseFilePaths().backup,
  temporaryFile = getDatabaseFilePaths().temporary
): boolean {
  if (fs.existsSync(primaryFile)) return false;
  if (fs.existsSync(backupFile)) {
    fs.copyFileSync(backupFile, primaryFile);
    persistenceStatus.lastRecoveryAt = Date.now();
    persistenceStatus.recoveredFromBackup = true;
    return true;
  }
  return false;
}

function loadDatabase(SQL: any): Database {
  const { primary: DB_FILE, temporary: DB_TEMP_FILE, backup: DB_BACKUP_FILE } = getDatabaseFilePaths();
  recoverDatabaseFileIfNeeded();
  if (!fs.existsSync(DB_FILE) && fs.existsSync(DB_TEMP_FILE)) {
    try {
      const recovered = new SQL.Database(fs.readFileSync(DB_TEMP_FILE));
      fs.renameSync(DB_TEMP_FILE, DB_FILE);
      persistenceStatus.lastRecoveryAt = Date.now();
      persistenceStatus.recoveredFromBackup = true;
      return recovered;
    } catch {
      try { fs.unlinkSync(DB_TEMP_FILE); } catch {}
    }
  }
  if (!fs.existsSync(DB_FILE)) return new SQL.Database();

  try {
    return new SQL.Database(fs.readFileSync(DB_FILE));
  } catch (primaryError) {
    if (!fs.existsSync(DB_BACKUP_FILE)) throw primaryError;
    const corruptFile = path.join(path.dirname(DB_FILE), `${path.basename(DB_FILE)}.corrupt-${Date.now()}`);
    try {
      fs.renameSync(DB_FILE, corruptFile);
    } catch {
      // Best effort: preserve the primary if another process owns the file.
    }
    const recovered = new SQL.Database(fs.readFileSync(DB_BACKUP_FILE));
    persistenceStatus.lastRecoveryAt = Date.now();
    persistenceStatus.recoveredFromBackup = true;
    return recovered;
  }
}

async function initializeDatabase(): Promise<Database> {
  const { primary: DB_FILE } = getDatabaseFilePaths();
  const dbDir = path.dirname(DB_FILE);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const SQL = await initSqlJs();

  dbInstance = loadDatabase(SQL);
  // Always run schema migrations against existing databases so newly added
  // SQLite-only persistence tables are available without manual reset.
  initSchema(dbInstance);
  seedInitialData(dbInstance);
  persistDatabase();
  return dbInstance;
}

export async function getDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (dbInitializationPromise) return dbInitializationPromise;

  dbInitializationPromise = initializeDatabase().finally(() => {
    dbInitializationPromise = null;
  });

  return dbInitializationPromise;
}

export function resetDatabaseInstanceForTesting(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
  }
  dbInitializationPromise = null;
}

export function getDatabaseInitializationState(): {
  initialized: boolean;
  initializing: boolean;
} {
  return {
    initialized: Boolean(dbInstance),
    initializing: Boolean(dbInitializationPromise)
  };
}

export function persistDatabaseBuffer(
  buffer: Buffer,
  primaryFile = getDatabaseFilePaths().primary,
  temporaryFile = getDatabaseFilePaths().temporary,
  backupFile = getDatabaseFilePaths().backup
): void {
  const directory = path.dirname(primaryFile);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });

  fs.writeFileSync(temporaryFile, buffer);
  if (fs.existsSync(primaryFile)) {
    fs.copyFileSync(primaryFile, backupFile);
    fs.rmSync(primaryFile, { force: true });
  }
  try {
    fs.renameSync(temporaryFile, primaryFile);
  } catch (renameError) {
    // Windows may not replace an existing destination during rename. Restore
    // the previous durable image when installing the new image fails.
    if (!fs.existsSync(primaryFile) && fs.existsSync(backupFile)) {
      try { fs.copyFileSync(backupFile, primaryFile); } catch {}
    }
    throw renameError;
  }
}

export function persistDatabase(): void {
  if (!dbInstance) return;
  const { primary, temporary, backup } = getDatabaseFilePaths();
  try {
    // Write a complete new image first. The previous primary is retained as a
    // recovery snapshot so a process crash or filesystem failure cannot leave
    // the only durable database image unreadable.
    persistDatabaseBuffer(
      Buffer.from(dbInstance.export()),
      primary,
      temporary,
      backup
    );
    persistenceStatus.lastPersistedAt = Date.now();
    persistenceStatus.lastPersistenceError = null;
  } catch (err: any) {
    persistenceStatus.lastPersistenceError = err?.message || String(err);
    console.error('Error persisting SQLite database to disk:', err);
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // Best effort cleanup only.
    }
  }
}

export function getDatabasePersistenceStatus(): DatabasePersistenceStatus {
  return { ...persistenceStatus };
}

function initSchema(db: Database) {
  const schemaSQL = `
    -- 1. Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT,
      created_at INTEGER NOT NULL
    );

    -- 2. Markets
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      currency TEXT NOT NULL
    );

    -- 3. Instruments
    CREATE TABLE IF NOT EXISTS instruments (
      id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      market_id TEXT NOT NULL,
      tick_size REAL NOT NULL,
      lot_size REAL NOT NULL
    );

    -- 4. Currency Pairs
    CREATE TABLE IF NOT EXISTS currency_pairs (
      symbol TEXT PRIMARY KEY,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      pip_size REAL NOT NULL,
      digits INTEGER NOT NULL,
      typical_spread REAL NOT NULL
    );

    -- 5. Underlyings
    CREATE TABLE IF NOT EXISTS underlyings (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      exchange TEXT NOT NULL,
      strike_step REAL NOT NULL,
      lot_size INTEGER NOT NULL,
      tick_size REAL NOT NULL,
      standard_expiry_day TEXT NOT NULL
    );

    -- 6. Contracts
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      underlying TEXT NOT NULL,
      expiry TEXT NOT NULL,
      strike REAL NOT NULL,
      option_type TEXT NOT NULL,
      lot_size INTEGER NOT NULL
    );

    -- 7. Market Data
    CREATE TABLE IF NOT EXISTS market_data (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      price REAL NOT NULL,
      volume REAL,
      data_status TEXT NOT NULL
    );

    -- 8. Candles
    CREATE TABLE IF NOT EXISTS candles (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      oi REAL,
      vwap REAL
    );

    -- 9. Technical Features
    CREATE TABLE IF NOT EXISTS technical_features (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      rsi REAL,
      ema9 REAL,
      ema21 REAL,
      ema50 REAL,
      ema200 REAL,
      atr REAL,
      vwap REAL
    );

    -- 10. Options Chain
    CREATE TABLE IF NOT EXISTS options_chain (
      id TEXT PRIMARY KEY,
      underlying TEXT NOT NULL,
      expiry TEXT NOT NULL,
      spot_price REAL NOT NULL,
      pcr REAL NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 11. Option Contracts
    CREATE TABLE IF NOT EXISTS option_contracts (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL,
      strike REAL NOT NULL,
      option_type TEXT NOT NULL,
      ltp REAL NOT NULL,
      oi REAL NOT NULL,
      change_oi REAL NOT NULL,
      volume REAL NOT NULL,
      iv REAL NOT NULL
    );

    -- 12. Greeks
    CREATE TABLE IF NOT EXISTS greeks (
      contract_id TEXT PRIMARY KEY,
      delta REAL NOT NULL,
      gamma REAL NOT NULL,
      theta REAL NOT NULL,
      vega REAL NOT NULL,
      rho REAL NOT NULL,
      iv REAL NOT NULL,
      model_derived INTEGER NOT NULL
    );

    -- 13. Signals
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      market TEXT NOT NULL,
      instrument TEXT NOT NULL,
      pair TEXT,
      timeframe TEXT,
      underlying TEXT,
      direction TEXT NOT NULL,
      category TEXT NOT NULL,
      strategy TEXT NOT NULL,
      score REAL NOT NULL,
      ml_probability REAL,
      entry_preferred REAL NOT NULL,
      entry_min REAL,
      entry_max REAL,
      stop_loss REAL NOT NULL,
      target1 REAL NOT NULL,
      target2 REAL NOT NULL,
      target3 REAL,
      risk_reward REAL NOT NULL,
      trend TEXT,
      market_regime TEXT,
      session TEXT,
      status TEXT NOT NULL,
      data_status TEXT,
      strategy_version TEXT,
      model_version TEXT NOT NULL
    );

    -- 14. Signal Events
    CREATE TABLE IF NOT EXISTS signal_events (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      notes TEXT
    );

    -- 15. Trades
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      signal_id TEXT,
      instrument TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL,
      size REAL NOT NULL,
      pnl REAL,
      status TEXT NOT NULL,
      entry_time INTEGER NOT NULL,
      exit_time INTEGER
    );

    -- 16. Positions
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      quantity REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      stop_loss REAL,
      take_profit REAL
    );

    -- 17. Orders
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      order_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      price REAL,
      quantity REAL NOT NULL,
      status TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 19. Economic Events
    CREATE TABLE IF NOT EXISTS economic_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      currency TEXT NOT NULL,
      impact TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      blocks_entry INTEGER NOT NULL
    );

    -- 20. Model Versions
    CREATE TABLE IF NOT EXISTS model_versions (
      id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      model_name TEXT NOT NULL,
      version TEXT NOT NULL,
      trained_at INTEGER NOT NULL,
      status TEXT NOT NULL
    );

    -- 21. Model Predictions
    CREATE TABLE IF NOT EXISTS model_predictions (
      id TEXT PRIMARY KEY,
      model_version_id TEXT NOT NULL,
      instrument TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      predicted_class TEXT NOT NULL,
      probability REAL NOT NULL
    );

    -- 22. Backtest Runs
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,
      strategy_name TEXT NOT NULL,
      market TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      total_trades INTEGER NOT NULL,
      win_rate REAL NOT NULL,
      profit_factor REAL NOT NULL
    );

    -- 23. Backtest Trades
    CREATE TABLE IF NOT EXISTS backtest_trades (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      instrument TEXT NOT NULL,
      pnl REAL NOT NULL,
      return_pct REAL NOT NULL
    );

    -- 24. Strategy Configs
    CREATE TABLE IF NOT EXISTS strategy_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      min_score REAL NOT NULL,
      min_rr REAL NOT NULL
    );

    -- 25. Broker Accounts
    CREATE TABLE IF NOT EXISTS broker_accounts (
      id TEXT PRIMARY KEY,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL NOT NULL,
      equity REAL NOT NULL,
      available_margin REAL NOT NULL,
      used_margin REAL NOT NULL,
      free_margin REAL NOT NULL,
      currency TEXT NOT NULL,
      connection_status TEXT NOT NULL,
      server TEXT,
      permissions_json TEXT,
      last_update INTEGER NOT NULL,
      is_live_account INTEGER NOT NULL DEFAULT 0,
      UNIQUE(broker, environment, account_id)
    );

    -- 26. Trade Trace Roots
    CREATE TABLE IF NOT EXISTS trade_traces (
      trade_trace_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 27. Trade Trace Lifecycle Nodes
    CREATE TABLE IF NOT EXISTS trade_trace_nodes (
      node_id TEXT PRIMARY KEY,
      trade_trace_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 28. Trade Notes
    CREATE TABLE IF NOT EXISTS trade_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      symbol TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Broker reconciliation snapshots
    CREATE TABLE IF NOT EXISTS broker_reconciliation_snapshots (
      id TEXT PRIMARY KEY,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      account_json TEXT,
      positions_json TEXT NOT NULL,
      orders_json TEXT NOT NULL,
      status TEXT NOT NULL
    );

    -- 29. First-Live Certification Ledger
    CREATE TABLE IF NOT EXISTS first_live_ledger (
      id TEXT PRIMARY KEY,
      reservation_token TEXT,
      fingerprint TEXT,
      correlation_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      requested_price REAL,
      status TEXT NOT NULL,
      broker_order_id TEXT,
      filled_quantity REAL,
      fill_price REAL,
      attempted_at INTEGER NOT NULL,
      reconciled_at INTEGER,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      exchange TEXT,
      exchange_type TEXT,
      scrip_code TEXT,
      broker_instrument_id TEXT,
      lot_size REAL
    );

    -- 29.1. Manual Single-Trade Authorizations (Phase C)
    CREATE TABLE IF NOT EXISTS manual_trade_authorizations (
      id TEXT PRIMARY KEY,
      authorization_token_hash TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      operator_id TEXT,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      account_id TEXT NOT NULL,
      market TEXT NOT NULL,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      exchange_type TEXT NOT NULL,
      scrip_code TEXT NOT NULL,
      side TEXT NOT NULL,
      order_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      lot_size REAL NOT NULL,
      price REAL NOT NULL,
      stop_loss REAL,
      take_profit REAL,
      estimated_outlay REAL NOT NULL,
      outlay_inr REAL,
      native_currency TEXT,
      native_trade_value REAL,
      native_charges REAL,
      native_total_outlay REAL,
      fx_rate REAL,
      fx_source TEXT,
      fx_retrieved_at INTEGER,
      fx_rate_status TEXT,
      small_trade_budget REAL NOT NULL,
      status TEXT NOT NULL,
      rejection_reason TEXT,
      broker_order_id TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      consumed_at INTEGER,
      payload_json TEXT NOT NULL,
      result_json TEXT
    );

    -- 30. Autonomous Execution Idempotency
    CREATE TABLE IF NOT EXISTS execution_intents (
      idempotency_key TEXT PRIMARY KEY,
      claim_token TEXT NOT NULL,
      broker TEXT NOT NULL,
      market TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      state TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      broker_order_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- 30.1. Durable execution fill observations
    CREATE TABLE IF NOT EXISTS execution_fill_observations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      broker TEXT NOT NULL,
      broker_order_id TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_quantity REAL,
      filled_quantity REAL NOT NULL,
      remaining_quantity REAL,
      average_fill_price REAL,
      commission REAL,
      observed_at INTEGER NOT NULL
    );

    -- 30.2. Broker-native execution fill event ledger
    -- Each broker fill/deal is stored once by its broker-native execution ID.
    CREATE TABLE IF NOT EXISTS execution_fill_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      broker TEXT NOT NULL,
      broker_order_id TEXT NOT NULL,
      broker_fill_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      commission REAL,
      executed_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      UNIQUE(broker, broker_order_id, broker_fill_id)
    );

    -- 30. ML Persistence Bridge
    CREATE TABLE IF NOT EXISTS ml_storage_records (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 29. Risk Configs & System Settings
    CREATE TABLE IF NOT EXISTS risk_configs (
      id TEXT PRIMARY KEY,
      max_risk_per_trade_pct REAL NOT NULL,
      max_daily_loss_pct REAL NOT NULL,
      max_open_positions INTEGER NOT NULL,
      trading_mode TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Optional external research AI connectors. Credentials are stored server-side
    -- and are never returned by the public configuration endpoint.
    CREATE TABLE IF NOT EXISTS ai_research_server_connections (
      provider TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      health_path TEXT NOT NULL DEFAULT '/health',
      predict_path TEXT NOT NULL DEFAULT '/predict',
      timeout_ms INTEGER NOT NULL DEFAULT 10000,
      auth_token TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    -- Persistent Forex market-history synchronization state.
    CREATE TABLE IF NOT EXISTS market_history_sync (
      symbol TEXT PRIMARY KEY,
      last_attempt_at INTEGER,
      last_success_at INTEGER,
      last_full_backfill_at INTEGER,
      last_incremental_at INTEGER,
      latest_daily_timestamp INTEGER,
      daily_bars_stored INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error TEXT,
      updated_at INTEGER NOT NULL
    );

    -- Derived market-period statistics used by the historical trend engine.
    -- One row exists for each calendar period and each rolling snapshot.
    CREATE TABLE IF NOT EXISTS market_period_stats (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      period_type TEXT NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      range REAL NOT NULL,
      range_pct REAL NOT NULL,
      return_pct REAL NOT NULL,
      atr14 REAL,
      volatility_pct REAL,
      data_points INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(symbol, period_type, period_start)
    );

    CREATE INDEX IF NOT EXISTS idx_candles_symbol_timeframe_timestamp
      ON candles(symbol, timeframe, timestamp);

    CREATE INDEX IF NOT EXISTS idx_market_period_stats_symbol_type_end
      ON market_period_stats(symbol, period_type, period_end);

    CREATE INDEX IF NOT EXISTS idx_market_history_sync_status
      ON market_history_sync(status);

    -- Durable live-trading research ledger.
    -- Stores the information Goldcrest knew at signal time and the resulting
    -- broker execution state so future trend/prediction models can be trained
    -- and evaluated without reconstructing historical TradeLog files.
    CREATE TABLE IF NOT EXISTS live_trade_research (
      signal_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      signal_timestamp INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,
      direction TEXT NOT NULL,
      signal_category TEXT NOT NULL,
      score REAL NOT NULL,
      score_breakdown_json TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      model_version TEXT NOT NULL,
      market_regime TEXT NOT NULL,
      session TEXT NOT NULL,
      data_status TEXT NOT NULL,
      entry_min REAL,
      entry_max REAL,
      entry_preferred REAL,
      entry_type TEXT,
      stop_loss REAL,
      take_profit_1 REAL,
      take_profit_2 REAL,
      take_profit_3 REAL,
      risk_reward REAL,
      quote_bid REAL,
      quote_ask REAL,
      quote_spread REAL,
      quote_timestamp INTEGER,
      quote_status TEXT,
      requested_risk_quantity REAL,
      configured_quantity REAL,
      news_status TEXT,
      news_source TEXT,
      news_json TEXT,
      reasons_json TEXT NOT NULL,
      no_trade_reasons_json TEXT NOT NULL,
      context_json TEXT NOT NULL,
      lifecycle_status TEXT NOT NULL,
      broker_position_id TEXT,
      mfe_pnl REAL,
      mae_pnl REAL,
      max_favorable_price REAL,
      max_adverse_price REAL,
      holding_duration_ms INTEGER,
      execution_status TEXT,
      execution_code TEXT,
      execution_reason TEXT,
      broker_order_id TEXT,
      executed_entry_price REAL,
      executed_quantity REAL,
      commission REAL,
      broker_status TEXT,
      execution_timestamp INTEGER,
      realized_pnl REAL,
      exit_price REAL,
      exit_timestamp INTEGER,
      outcome TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_live_trade_research_symbol_time
      ON live_trade_research(symbol, signal_timestamp);

    CREATE INDEX IF NOT EXISTS idx_live_trade_research_lifecycle
      ON live_trade_research(lifecycle_status, updated_at);

    CREATE INDEX IF NOT EXISTS idx_live_trade_research_position
      ON live_trade_research(broker_position_id, lifecycle_status);
  `;

  db.run(schemaSQL);

  // Safe migrations for preexisting DB
  const safeAddColumns = [
    'ALTER TABLE signals ADD COLUMN pair TEXT;',
    'ALTER TABLE signals ADD COLUMN timeframe TEXT;',
    'ALTER TABLE signals ADD COLUMN entry_min REAL;',
    'ALTER TABLE signals ADD COLUMN entry_max REAL;',
    'ALTER TABLE signals ADD COLUMN target3 REAL;',
    'ALTER TABLE signals ADD COLUMN trend TEXT;',
    'ALTER TABLE signals ADD COLUMN market_regime TEXT;',
    'ALTER TABLE signals ADD COLUMN session TEXT;',
    'ALTER TABLE signals ADD COLUMN data_status TEXT;',
    'ALTER TABLE signals ADD COLUMN strategy_version TEXT;',
    'ALTER TABLE live_trade_research ADD COLUMN broker_position_id TEXT;',
    'ALTER TABLE live_trade_research ADD COLUMN mfe_pnl REAL;',
    'ALTER TABLE live_trade_research ADD COLUMN mae_pnl REAL;',
    'ALTER TABLE live_trade_research ADD COLUMN max_favorable_price REAL;',
    'ALTER TABLE live_trade_research ADD COLUMN max_adverse_price REAL;',
    'ALTER TABLE live_trade_research ADD COLUMN holding_duration_ms INTEGER;',
    'ALTER TABLE first_live_ledger ADD COLUMN reservation_token TEXT;',
    'ALTER TABLE first_live_ledger ADD COLUMN fingerprint TEXT;',
    'ALTER TABLE first_live_ledger ADD COLUMN exchange TEXT;',
    'ALTER TABLE first_live_ledger ADD COLUMN exchange_type TEXT;',
    'ALTER TABLE first_live_ledger ADD COLUMN scrip_code TEXT;',
    'ALTER TABLE first_live_ledger ADD COLUMN broker_instrument_id TEXT;',
    'ALTER TABLE first_live_ledger ADD COLUMN lot_size REAL;',
    'ALTER TABLE execution_intents ADD COLUMN broker_order_id TEXT;',
    'ALTER TABLE manual_trade_authorizations ADD COLUMN outlay_inr REAL;',
    'ALTER TABLE manual_trade_authorizations ADD COLUMN native_currency TEXT;',
    'ALTER TABLE manual_trade_authorizations ADD COLUMN native_trade_value REAL;',
    'ALTER TABLE manual_trade_authorizations ADD COLUMN native_charges REAL;',
    'ALTER TABLE manual_trade_authorizations ADD COLUMN native_total_outlay REAL;',
    'ALTER TABLE manual_trade_authorizations ADD COLUMN fx_rate REAL;',
    'ALTER TABLE manual_trade_authorizations ADD COLUMN fx_source TEXT;',
    'ALTER TABLE manual_trade_authorizations ADD COLUMN fx_retrieved_at INTEGER;',
    'ALTER TABLE manual_trade_authorizations ADD COLUMN fx_rate_status TEXT;'
  ];
  try {
    db.run('ALTER TABLE execution_intents ADD COLUMN claim_token TEXT;');
  } catch {
    // Column already exists.
  }
  db.run("UPDATE execution_intents SET claim_token = idempotency_key WHERE claim_token IS NULL OR claim_token = ''");

  for (const alter of safeAddColumns) {
    try {
      db.run(alter);
    } catch {
      // Column already exists, ignore
    }
  }

  // Safe migration for signals.ml_probability NOT NULL constraint in preexisting DB
  try {
    const tableInfo = db.exec("PRAGMA table_info(signals)");
    const mlCol = tableInfo[0]?.values?.find((col: any[]) => col[1] === 'ml_probability');
    if (mlCol && mlCol[3] === 1) {
      db.run("CREATE TABLE IF NOT EXISTS signals_temp (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, market TEXT NOT NULL, instrument TEXT NOT NULL, pair TEXT, timeframe TEXT, underlying TEXT, direction TEXT NOT NULL, category TEXT NOT NULL, strategy TEXT NOT NULL, score REAL NOT NULL, ml_probability REAL, entry_preferred REAL NOT NULL, entry_min REAL, entry_max REAL, stop_loss REAL NOT NULL, target1 REAL NOT NULL, target2 REAL NOT NULL, target3 REAL, risk_reward REAL NOT NULL, trend TEXT, market_regime TEXT, session TEXT, status TEXT NOT NULL, data_status TEXT, strategy_version TEXT, model_version TEXT NOT NULL)");
      db.run("INSERT INTO signals_temp (id, timestamp, market, instrument, pair, timeframe, underlying, direction, category, strategy, score, ml_probability, entry_preferred, entry_min, entry_max, stop_loss, target1, target2, target3, risk_reward, trend, market_regime, session, status, data_status, strategy_version, model_version) SELECT id, timestamp, market, instrument, pair, timeframe, underlying, direction, category, strategy, score, ml_probability, entry_preferred, entry_min, entry_max, stop_loss, target1, target2, target3, risk_reward, trend, market_regime, session, status, data_status, strategy_version, model_version FROM signals");
      db.run("DROP TABLE signals");
      db.run("ALTER TABLE signals_temp RENAME TO signals");
    }
  } catch (err) {
    console.warn('Migration for signals table nullability skipped:', err);
  }
}

function seedInitialData(db: Database) {
  // Markets
  db.run(`INSERT OR IGNORE INTO markets (id, code, name, status, currency) VALUES 
    ('mkt_fx', 'FOREX', 'Global Foreign Exchange', 'ACTIVE', 'USD'),
    ('mkt_in_eq', 'INDIA_EQUITY', 'Indian Equity Benchmark Indices', 'ACTIVE', 'INR'),
    ('mkt_in_opt', 'INDIA_OPTIONS', 'Indian Equity Index Options', 'ACTIVE', 'INR');
  `);

  // System settings
  const now = Date.now();
  db.run(`INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES 
    ('TRADING_MODE', 'LIVE_ONLY', ${now}),
    ('DATA_STATUS', 'UNAVAILABLE', ${now}),
    ('MODEL_STATUS', 'BASELINE_UNCALIBRATED', ${now}),
    ('DEFAULT_RISK_PCT', '1.0', ${now}),
    ('STRIKE_DEPTH', '7', ${now}),
    ('MAX_TRADE_VALUE_FOREX_USD', '100000', ${now}),
    ('MAX_TRADE_VALUE_INDIAN_INR', '1000000', ${now}),
    ('EXECUTION_MODE', 'LIVE_DRY_RUN', ${now}),
    ('FIRST_LIVE_ARMED', 'false', ${now}),
    ('FIRST_LIVE_ORDERS_ALLOWED', '1', ${now}),
    ('FIRST_LIVE_ORDERS_SUBMITTED', '0', ${now}),
    ('FIRST_LIVE_LOCKED', 'false', ${now}),
    ('FIRST_LIVE_ARMED_AT', '', ${now});
  `);

  // Enforce LIVE_ONLY persistence.
  db.run(`UPDATE system_settings SET value = 'LIVE_ONLY', updated_at = ${now} WHERE key = 'TRADING_MODE';
    UPDATE system_settings SET value = 'UNAVAILABLE', updated_at = ${now} WHERE key = 'DATA_STATUS';
    UPDATE risk_configs SET trading_mode = 'LIVE_ONLY';
  `);

  // Risk configs
  db.run(`INSERT OR IGNORE INTO risk_configs (id, max_risk_per_trade_pct, max_daily_loss_pct, max_open_positions, trading_mode) VALUES 
    ('default_risk', 1.0, 3.0, 5, 'LIVE_ONLY');
  `);

  // Economic events
  db.run(`INSERT OR IGNORE INTO economic_events (id, title, currency, impact, timestamp, blocks_entry) VALUES 
    ('ev_1', 'FOMC Rate Decision & Press Conference', 'USD', 'HIGH', ${now + 7200000}, 0),
    ('ev_2', 'ECB Monetary Policy Statement', 'EUR', 'HIGH', ${now + 14400000}, 0),
    ('ev_3', 'RBI Monetary Policy Committee Outcome', 'INR', 'HIGH', ${now + 28800000}, 0),
    ('ev_4', 'US Core CPI Inflation (YoY)', 'USD', 'HIGH', ${now + 50000000}, 0);
  `);
}

export async function executeQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDatabase();
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export async function executeRun(sql: string, params: any[] = []): Promise<void> {
  const db = await getDatabase();
  db.run(sql, params);
  persistDatabase();
}
export async function executeTransaction<T>(work: (db: Database) => T): Promise<T> {
  const db = await getDatabase();
  db.run('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = work(db);
    db.run('COMMIT');
    persistDatabase();
    return result;
  } catch (err) {
    try {
      db.run('ROLLBACK');
    } catch {
      // Preserve the original transaction error.
    }
    throw err;
  }
}


export async function getDatabaseStats() {
  const db = await getDatabase();
  const tables = [
    'markets', 'currency_pairs', 'underlyings', 'contracts', 'candles',
    'market_history_sync', 'market_period_stats',
    'signals', 'trades', 'positions', 'orders', 'economic_events',
    'risk_configs', 'system_settings', 'broker_accounts',
    'broker_reconciliation_snapshots', 'execution_intents', 'execution_fill_observations', 'execution_fill_events',
    'trade_traces', 'trade_trace_nodes', 'trade_notes', 'ml_storage_records',
    'live_trade_research'
  ];

  const stats: Record<string, number> = {};
  for (const table of tables) {
    try {
      const res = db.exec(`SELECT count(*) as count FROM ${table}`);
      const count = (res[0]?.values[0]?.[0] as number) ?? 0;
      stats[table] = count;
    } catch {
      stats[table] = 0;
    }
  }

  return stats;
}
