import { executeQuery, executeRun } from '../database/db';
import { brokerRegistry } from '../brokers/registry';
import { maskIdentifier } from '../brokers/auditLog';
import type { BrokerAccountInfo, BrokerType } from '../brokers/types';

export interface AccountBalanceSnapshot {
  id: string;
  broker: BrokerType;
  environment: 'LIVE';
  accountId: string;
  currency: string;
  capturedAt: number;
  balance: number | null;
  equity: number | null;
  usedMargin: number | null;
  freeMargin: number | null;
  status: 'CAPTURED' | 'ERROR';
  errorMessage?: string;
}

export const ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS = 3;

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerStarted = false;

async function ensureTable(): Promise<void> {
  await executeRun(`
    CREATE TABLE IF NOT EXISTS account_balance_snapshots (
      id TEXT PRIMARY KEY,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      account_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      balance REAL,
      equity REAL,
      used_margin REAL,
      free_margin REAL,
      status TEXT NOT NULL,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_account_balance_snapshots_captured_at
      ON account_balance_snapshots(captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_account_balance_snapshots_broker_time
      ON account_balance_snapshots(broker, captured_at DESC);
  `);

  // Remove legacy certification records before any operator-facing LIVE
  // balance-history query or snapshot.
  await executeRun(
    "DELETE FROM account_balance_snapshots WHERE environment = 'LIVE' AND account_id LIKE 'TEST-%'"
  );
}

function snapshotId(broker: BrokerType, capturedAt: number): string {
  return `BALANCE-SNAPSHOT-${broker}-${capturedAt}`;
}

export function nextThreeHourBoundary(now = new Date()): Date {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  const currentHour = next.getHours();
  const nextHour = currentHour - (currentHour % ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS) + ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS;
  next.setHours(nextHour);
  return next;
}

async function loadPersistedBrokerAccount(broker: BrokerType): Promise<any | null> {
  try {
    const rows = await executeQuery<any>(
      'SELECT account_json FROM broker_reconciliation_snapshots WHERE broker = ? AND environment = ? ORDER BY timestamp DESC LIMIT 1',
      [broker, 'LIVE']
    );
    const snapshot = rows[0]?.account_json;
    if (snapshot) {
      const account = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
      if (account && typeof account === 'object' && Number.isFinite(account.balance)) {
        return account;
      }
    }
  } catch {
    // Continue to broker_accounts
  }

  try {
    const rows = await executeQuery<any>(
      'SELECT account_id, balance, equity, available_margin, used_margin, free_margin, currency FROM broker_accounts WHERE broker = ? AND environment = ? ORDER BY last_update DESC LIMIT 1',
      [broker, 'LIVE']
    );
    const row = rows[0];
    if (row && Number.isFinite(row.balance)) {
      return {
        accountId: String(row.account_id),
        balance: Number(row.balance),
        equity: Number(row.equity),
        availableMargin: Number(row.available_margin || 0),
        usedMargin: Number(row.used_margin || 0),
        freeMargin: Number(row.free_margin || 0),
        currency: String(row.currency || (broker === 'FIVE_PAISA' ? 'INR' : 'USD'))
      };
    }
  } catch {
    // Continue to account_balance_snapshots
  }

  try {
    const rows = await executeQuery<any>(
      "SELECT account_id, balance, equity, used_margin, free_margin, currency FROM account_balance_snapshots WHERE broker = ? AND environment = ? AND status = 'CAPTURED' AND balance IS NOT NULL ORDER BY captured_at DESC LIMIT 1",
      [broker, 'LIVE']
    );
    const row = rows[0];
    if (row && Number.isFinite(row.balance)) {
      return {
        accountId: String(row.account_id),
        balance: Number(row.balance),
        equity: Number(row.equity),
        availableMargin: Number(row.free_margin || 0),
        usedMargin: Number(row.used_margin || 0),
        freeMargin: Number(row.free_margin || 0),
        currency: String(row.currency || (broker === 'FIVE_PAISA' ? 'INR' : 'USD'))
      };
    }
  } catch {
    // Return null
  }
  return null;
}

async function captureBrokerBalance(broker: BrokerType, capturedAt: number): Promise<AccountBalanceSnapshot> {
  try {
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');

    // If broker adapter has hasActiveSession() check and session is not active yet (e.g. awaiting daily 2FA/TOTP)
    if (typeof (adapter as any).hasActiveSession === 'function' && !(adapter as any).hasActiveSession()) {
      const persisted = await loadPersistedBrokerAccount(broker);
      if (persisted && Number.isFinite(persisted.balance) && Number.isFinite(persisted.equity)) {
        const snapshot: AccountBalanceSnapshot = {
          id: snapshotId(broker, capturedAt),
          broker,
          environment: 'LIVE',
          accountId: maskIdentifier(String(persisted.accountId || '****')),
          currency: String(persisted.currency || (broker === 'FIVE_PAISA' ? 'INR' : 'USD')),
          capturedAt,
          balance: Number(persisted.balance),
          equity: Number(persisted.equity),
          usedMargin: Number(persisted.usedMargin ?? 0),
          freeMargin: Number(persisted.freeMargin ?? persisted.availableMargin ?? 0),
          status: 'CAPTURED'
        };

        await executeRun(
          `INSERT OR REPLACE INTO account_balance_snapshots
           (id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            snapshot.id,
            snapshot.broker,
            snapshot.environment,
            snapshot.accountId,
            snapshot.currency,
            snapshot.capturedAt,
            snapshot.balance,
            snapshot.equity,
            snapshot.usedMargin,
            snapshot.freeMargin,
            snapshot.status,
            null
          ]
        );
        return snapshot;
      }

      // No persisted snapshot yet and session is awaiting login
      const snapshot: AccountBalanceSnapshot = {
        id: snapshotId(broker, capturedAt),
        broker,
        environment: 'LIVE',
        accountId: '****',
        currency: broker === 'FIVE_PAISA' ? 'INR' : '',
        capturedAt,
        balance: null,
        equity: null,
        usedMargin: null,
        freeMargin: null,
        status: 'ERROR',
        errorMessage: 'Awaiting daily 5paisa TOTP authentication session or Access Token'
      };

      await executeRun(
        `INSERT OR REPLACE INTO account_balance_snapshots
         (id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.id,
          snapshot.broker,
          snapshot.environment,
          snapshot.accountId,
          snapshot.currency,
          snapshot.capturedAt,
          null,
          null,
          null,
          null,
          snapshot.status,
          snapshot.errorMessage
        ]
      );
      return snapshot;
    }

    const account: BrokerAccountInfo = await adapter.getAccount();

    const balance = Number(account.balance);
    const equity = Number(account.equity);
    const usedMargin = Number(account.usedMargin);
    const freeMargin = Number(account.freeMargin);

    if (![balance, equity, usedMargin, freeMargin].every(Number.isFinite)) {
      throw new Error('BROKER_ACCOUNT_BALANCE_FIELDS_INVALID');
    }

    const snapshot: AccountBalanceSnapshot = {
      id: snapshotId(broker, capturedAt),
      broker,
      environment: 'LIVE',
      accountId: maskIdentifier(String(account.accountId || '****')),
      currency: String(account.currency || ''),
      capturedAt,
      balance,
      equity,
      usedMargin,
      freeMargin,
      status: 'CAPTURED'
    };

    await executeRun(
      `INSERT OR REPLACE INTO account_balance_snapshots
       (id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.broker,
        snapshot.environment,
        snapshot.accountId,
        snapshot.currency,
        snapshot.capturedAt,
        snapshot.balance,
        snapshot.equity,
        snapshot.usedMargin,
        snapshot.freeMargin,
        snapshot.status,
        null
      ]
    );

    return snapshot;
  } catch (err: any) {
    const message = err?.message || String(err);
    const isAuthPending = message.includes('Access Token or TOTP session') ||
      message.includes('requires an Access Token') ||
      message.includes('TOTP') ||
      message.includes('Awaiting daily');

    // Attempt persisted fallback
    const persisted = await loadPersistedBrokerAccount(broker);
    if (persisted && Number.isFinite(persisted.balance) && Number.isFinite(persisted.equity)) {
      const snapshot: AccountBalanceSnapshot = {
        id: snapshotId(broker, capturedAt),
        broker,
        environment: 'LIVE',
        accountId: maskIdentifier(String(persisted.accountId || '****')),
        currency: String(persisted.currency || (broker === 'FIVE_PAISA' ? 'INR' : 'USD')),
        capturedAt,
        balance: Number(persisted.balance),
        equity: Number(persisted.equity),
        usedMargin: Number(persisted.usedMargin ?? 0),
        freeMargin: Number(persisted.freeMargin ?? persisted.availableMargin ?? 0),
        status: 'CAPTURED'
      };

      await executeRun(
        `INSERT OR REPLACE INTO account_balance_snapshots
         (id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.id,
          snapshot.broker,
          snapshot.environment,
          snapshot.accountId,
          snapshot.currency,
          snapshot.capturedAt,
          snapshot.balance,
          snapshot.equity,
          snapshot.usedMargin,
          snapshot.freeMargin,
          snapshot.status,
          null
        ]
      );
      return snapshot;
    }

    const snapshot: AccountBalanceSnapshot = {
      id: snapshotId(broker, capturedAt),
      broker,
      environment: 'LIVE',
      accountId: '****',
      currency: '',
      capturedAt,
      balance: null,
      equity: null,
      usedMargin: null,
      freeMargin: null,
      status: 'ERROR',
      errorMessage: message
    };

    await executeRun(
      `INSERT OR REPLACE INTO account_balance_snapshots
       (id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.broker,
        snapshot.environment,
        snapshot.accountId,
        snapshot.currency,
        snapshot.capturedAt,
        null,
        null,
        null,
        null,
        snapshot.status,
        snapshot.errorMessage
      ]
    );

    if (!isAuthPending) {
      console.warn(`[Goldcrest] account balance snapshot failed for ${broker}: ${message}`);
    }
    return snapshot;
  }
}

export async function captureAccountBalanceSnapshots(capturedAt = Date.now()): Promise<AccountBalanceSnapshot[]> {
  await ensureTable();
  const timestamp = Number(capturedAt);
  const brokersToCapture: BrokerType[] = ['FIVE_PAISA'];
  if (brokerRegistry.hasAdapter('CTRADER', 'LIVE')) {
    brokersToCapture.unshift('CTRADER');
  }
  return Promise.all(
    brokersToCapture.map(broker => captureBrokerBalance(broker, timestamp))
  );
}

export async function getAccountBalanceSnapshots(options: {
  from?: number;
  to?: number;
  broker?: BrokerType;
  limit?: number;
} = {}): Promise<AccountBalanceSnapshot[]> {
  await ensureTable();
  const clauses: string[] = [];
  const params: any[] = [];

  if (Number.isFinite(options.from)) {
    clauses.push('captured_at >= ?');
    params.push(Number(options.from));
  }
  if (Number.isFinite(options.to)) {
    clauses.push('captured_at <= ?');
    params.push(Number(options.to));
  }
  if (options.broker) {
    clauses.push('broker = ?');
    params.push(options.broker);
  }

  const limit = Math.min(Math.max(Math.floor(Number(options.limit || 500)), 1), 5000);
  params.push(limit);

  const rows = await executeQuery<any>(
    `SELECT id, broker, environment, account_id, currency, captured_at, balance, equity,
            used_margin, free_margin, status, error_message
       FROM account_balance_snapshots
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY captured_at DESC, broker ASC
      LIMIT ?`,
    params
  );

  return rows.map(row => ({
    id: String(row.id),
    broker: String(row.broker) as BrokerType,
    environment: 'LIVE' as const,
    accountId: String(row.account_id || '****'),
    currency: String(row.currency || ''),
    capturedAt: Number(row.captured_at),
    balance: row.balance === null || row.balance === undefined ? null : Number(row.balance),
    equity: row.equity === null || row.equity === undefined ? null : Number(row.equity),
    usedMargin: row.used_margin === null || row.used_margin === undefined ? null : Number(row.used_margin),
    freeMargin: row.free_margin === null || row.free_margin === undefined ? null : Number(row.free_margin),
    status: String(row.status) as 'CAPTURED' | 'ERROR',
    errorMessage: row.error_message ? String(row.error_message) : undefined
  }));
}

async function captureStartupSnapshotsIfNeeded(): Promise<void> {
  const cutoff = Date.now() - ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS * 60 * 60 * 1000;
  const recentRows = await executeQuery<any>(
    "SELECT broker, MAX(captured_at) AS captured_at FROM account_balance_snapshots WHERE environment = 'LIVE' AND status = 'CAPTURED' AND captured_at >= ? GROUP BY broker",
    [cutoff]
  );
  const recentBrokers = new Set(
    recentRows.map(row => String(row.broker || '').toUpperCase())
  );
  const brokersToCheck: BrokerType[] = ['FIVE_PAISA'];
  if (brokerRegistry.hasAdapter('CTRADER', 'LIVE')) {
    brokersToCheck.unshift('CTRADER');
  }
  const missingBrokers = brokersToCheck
    .filter(broker => !recentBrokers.has(broker));

  if (missingBrokers.length === 0) return;

  const capturedAt = Date.now();
  await Promise.all(missingBrokers.map(broker => captureBrokerBalance(broker, capturedAt)));
}

function scheduleNextBoundary(): void {
  if (!schedulerStarted) return;
  const delay = Math.max(1000, nextThreeHourBoundary().getTime() - Date.now());
  schedulerTimer = setTimeout(async () => {
    try {
      await captureAccountBalanceSnapshots(Date.now());
    } catch (err: any) {
      console.warn('[Goldcrest] 3-hour account balance snapshot cycle failed:', err?.message || err);
    } finally {
      scheduleNextBoundary();
    }
  }, delay);
  schedulerTimer.unref?.();
}

export function startAccountBalanceSnapshotScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  void ensureTable()
    .then(() => captureStartupSnapshotsIfNeeded())
    .then(() => scheduleNextBoundary())
    .catch((err) => {
      console.warn('[Goldcrest] account balance snapshot scheduler initialization failed:', err?.message || err);
      scheduleNextBoundary();
    });
}

export function getAccountBalanceSnapshotSchedulerStatus(): {
  running: boolean;
  intervalHours: number;
  nextRunAt: number | null;
} {
  return {
    running: schedulerStarted,
    intervalHours: ACCOUNT_BALANCE_SNAPSHOT_INTERVAL_HOURS,
    nextRunAt: schedulerTimer ? nextThreeHourBoundary().getTime() : null
  };
}

export function stopAccountBalanceSnapshotScheduler(): void {
  schedulerStarted = false;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
