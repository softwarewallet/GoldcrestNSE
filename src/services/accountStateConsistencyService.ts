import type { BrokerAccountInfo, BrokerType } from '../brokers/types';
import type { AccountBalanceSnapshot } from './accountBalanceSnapshotService';

export type AccountStateConsistencyStatus =
  | 'ALIGNED'
  | 'STALE_HISTORY'
  | 'ACCOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'HISTORY_UNAVAILABLE'
  | 'LIVE_ACCOUNT_UNAVAILABLE';

export interface AccountStateConsistencyResult {
  broker: BrokerType;
  status: AccountStateConsistencyStatus;
  consistent: boolean;
  accountIdMatches: boolean;
  currencyMatches: boolean;
  liveAccountValid: boolean;
  historyValid: boolean;
  snapshotAgeMs: number | null;
  balanceDelta: number | null;
  equityDelta: number | null;
  usedMarginDelta: number | null;
  freeMarginDelta: number | null;
  details: string[];
}

const HISTORY_FRESHNESS_LIMIT_MS = 3 * 60 * 60 * 1000 + 15 * 60 * 1000;

function validNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundCurrencyDelta(value: number): number {
  return Number(value.toFixed(2));
}

export function evaluateAccountStateConsistency(
  broker: BrokerType,
  liveAccount: BrokerAccountInfo | null,
  latestSnapshot: AccountBalanceSnapshot | null,
  now = Date.now()
): AccountStateConsistencyResult {
  if (!liveAccount) {
    return {
      broker,
      status: 'LIVE_ACCOUNT_UNAVAILABLE',
      consistent: false,
      accountIdMatches: false,
      currencyMatches: false,
      liveAccountValid: false,
      historyValid: Boolean(latestSnapshot),
      snapshotAgeMs: latestSnapshot ? Math.max(0, now - latestSnapshot.capturedAt) : null,
      balanceDelta: null,
      equityDelta: null,
      usedMarginDelta: null,
      freeMarginDelta: null,
      details: ['Authoritative LIVE account state is unavailable.']
    };
  }

  const liveAccountValid =
    liveAccount.environment === 'LIVE' &&
    Boolean(String(liveAccount.accountId || '').trim()) &&
    Boolean(String(liveAccount.currency || '').trim()) &&
    [liveAccount.balance, liveAccount.equity, liveAccount.usedMargin, liveAccount.freeMargin].every(validNumber);

  if (!latestSnapshot) {
    return {
      broker,
      status: 'HISTORY_UNAVAILABLE',
      consistent: false,
      accountIdMatches: false,
      currencyMatches: false,
      liveAccountValid,
      historyValid: false,
      snapshotAgeMs: null,
      balanceDelta: null,
      equityDelta: null,
      usedMarginDelta: null,
      freeMarginDelta: null,
      details: ['No persisted LIVE balance snapshot is available for this broker.']
    };
  }

  const accountIdMatches = String(latestSnapshot.accountId || '').trim() === String(liveAccount.accountId || '').trim();
  const currencyMatches = String(latestSnapshot.currency || '').trim().toUpperCase() === String(liveAccount.currency || '').trim().toUpperCase();
  const snapshotAgeMs = Math.max(0, now - Number(latestSnapshot.capturedAt));
  const historyValid =
    latestSnapshot.environment === 'LIVE' &&
    latestSnapshot.status === 'CAPTURED' &&
    Boolean(String(latestSnapshot.accountId || '').trim()) &&
    Boolean(String(latestSnapshot.currency || '').trim()) &&
    [latestSnapshot.balance, latestSnapshot.equity, latestSnapshot.usedMargin, latestSnapshot.freeMargin].every(validNumber);

  const balanceDelta = historyValid ? roundCurrencyDelta(Number(liveAccount.balance) - Number(latestSnapshot.balance)) : null;
  const equityDelta = historyValid ? roundCurrencyDelta(Number(liveAccount.equity) - Number(latestSnapshot.equity)) : null;
  const usedMarginDelta = historyValid ? roundCurrencyDelta(Number(liveAccount.usedMargin) - Number(latestSnapshot.usedMargin)) : null;
  const freeMarginDelta = historyValid ? roundCurrencyDelta(Number(liveAccount.freeMargin) - Number(latestSnapshot.freeMargin)) : null;

  let status: AccountStateConsistencyStatus = 'ALIGNED';
  const details: string[] = [];

  if (!liveAccountValid) {
    status = 'LIVE_ACCOUNT_UNAVAILABLE';
    details.push('LIVE account identity or financial fields are invalid.');
  } else if (!accountIdMatches) {
    status = 'ACCOUNT_MISMATCH';
    details.push('Latest history snapshot belongs to a different account identity.');
  } else if (!currencyMatches) {
    status = 'CURRENCY_MISMATCH';
    details.push('Latest history snapshot currency differs from the LIVE account currency.');
  } else if (!historyValid) {
    status = 'HISTORY_UNAVAILABLE';
    details.push('Latest history snapshot does not contain a valid captured LIVE account state.');
  } else if (snapshotAgeMs > HISTORY_FRESHNESS_LIMIT_MS) {
    status = 'STALE_HISTORY';
    details.push('Latest history snapshot is older than the operational freshness window.');
  } else {
    details.push('History snapshot is linked to the same LIVE account and currency.');
  }

  if (balanceDelta !== null || equityDelta !== null) {
    details.push('Current LIVE financial values may differ from the historical snapshot because the snapshot is time-bound.');
  }

  return {
    broker,
    status,
    consistent: status === 'ALIGNED',
    accountIdMatches,
    currencyMatches,
    liveAccountValid,
    historyValid,
    snapshotAgeMs,
    balanceDelta,
    equityDelta,
    usedMarginDelta,
    freeMarginDelta,
    details
  };
}
