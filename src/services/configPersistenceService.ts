import { executeQuery, executeTransaction } from '../database/db';
import type { SystemConfig } from './configService';

type PersistedConfigKey =
  | 'cTraderApiMode'
  | 'selectedCtraderAccountId'
  | 'selectedCtraderAccountCurrency'
  | 'selectedCtraderAccountLabel'
  | 'defaultRiskPct'
  | 'maxDailyLossPct'
  | 'maxOpenPositions'
  | 'maxTradesPerDay'
  | 'maxConsecutiveLosses'
  | 'maxSpreadBps'
  | 'signalCooldownMs'
  | 'eventProximityThresholdMinutes'
  | 'strikeDepth'
  | 'maxTradeValueForexUsd'
  | 'maxTradeValueIndianInr'
  | 'autoLiveMinSignalScore'
  | 'autoLiveMaxTradesPerPair'
  | 'forexStopLossPips'
  | 'forexTakeProfitPips'
  | 'autoLiveForexPairs'
  | 'autoLiveIndianUnderlyings'
  | 'financialDisclaimer'
  | 'executionMode'
  | 'firstLiveArmed'
  | 'firstLiveOrdersAllowed'
  | 'firstLiveOrdersSubmitted'
  | 'firstLiveLocked'
  | 'firstLiveArmedAt';

const SYSTEM_SETTING_MAP: ReadonlyArray<[string, PersistedConfigKey]> = [
  ['CTRADER_API_MODE', 'cTraderApiMode'],
  ['SELECTED_CTRADER_ACCOUNT_ID', 'selectedCtraderAccountId'],
  ['SELECTED_CTRADER_ACCOUNT_CURRENCY', 'selectedCtraderAccountCurrency'],
  ['SELECTED_CTRADER_ACCOUNT_LABEL', 'selectedCtraderAccountLabel'],
  ['DEFAULT_RISK_PCT', 'defaultRiskPct'],
  ['MAX_DAILY_LOSS_PCT', 'maxDailyLossPct'],
  ['MAX_OPEN_POSITIONS', 'maxOpenPositions'],
  ['MAX_TRADES_PER_DAY', 'maxTradesPerDay'],
  ['MAX_CONSECUTIVE_LOSSES', 'maxConsecutiveLosses'],
  ['MAX_SPREAD_BPS', 'maxSpreadBps'],
  ['SIGNAL_COOLDOWN_MS', 'signalCooldownMs'],
  ['EVENT_PROXIMITY_THRESHOLD_MINUTES', 'eventProximityThresholdMinutes'],
  ['STRIKE_DEPTH', 'strikeDepth'],
  ['MAX_TRADE_VALUE_FOREX_USD', 'maxTradeValueForexUsd'],
  ['MAX_TRADE_VALUE_INDIAN_INR', 'maxTradeValueIndianInr'],
  ['AUTO_LIVE_MIN_SIGNAL_SCORE', 'autoLiveMinSignalScore'],
  ['AUTO_LIVE_MAX_TRADES_PER_PAIR', 'autoLiveMaxTradesPerPair'],
  ['FOREX_STOP_LOSS_PIPS', 'forexStopLossPips'],
  ['FOREX_TAKE_PROFIT_PIPS', 'forexTakeProfitPips'],
  ['AUTO_LIVE_FOREX_PAIRS', 'autoLiveForexPairs'],
  ['AUTO_LIVE_INDIAN_UNDERLYINGS', 'autoLiveIndianUnderlyings'],
  ['FINANCIAL_DISCLAIMER', 'financialDisclaimer'],
  ['EXECUTION_MODE', 'executionMode'],
  ['FIRST_LIVE_ARMED', 'firstLiveArmed'],
  ['FIRST_LIVE_ORDERS_ALLOWED', 'firstLiveOrdersAllowed'],
  ['FIRST_LIVE_ORDERS_SUBMITTED', 'firstLiveOrdersSubmitted'],
  ['FIRST_LIVE_LOCKED', 'firstLiveLocked'],
  ['FIRST_LIVE_ARMED_AT', 'firstLiveArmedAt']
];

const NUMERIC_KEYS = new Set<PersistedConfigKey>([
  'defaultRiskPct',
  'maxDailyLossPct',
  'maxOpenPositions',
  'maxTradesPerDay',
  'maxConsecutiveLosses',
  'maxSpreadBps',
  'signalCooldownMs',
  'eventProximityThresholdMinutes',
  'strikeDepth',
  'maxTradeValueForexUsd',
  'maxTradeValueIndianInr',
  'autoLiveMinSignalScore',
  'autoLiveMaxTradesPerPair',
  'forexStopLossPips',
  'forexTakeProfitPips',
  'firstLiveOrdersAllowed',
  'firstLiveOrdersSubmitted'
]);

const BOOLEAN_KEYS = new Set<PersistedConfigKey>([
  'firstLiveArmed',
  'firstLiveLocked'
]);

const ARRAY_KEYS = new Set<PersistedConfigKey>([
  'autoLiveForexPairs',
  'autoLiveIndianUnderlyings'
]);

function serializeConfigValue(key: PersistedConfigKey, value: SystemConfig[PersistedConfigKey]): string {
  if (ARRAY_KEYS.has(key)) {
    return JSON.stringify(Array.isArray(value) ? value : []);
  }
  if (value === undefined || value === null) return '';
  return String(value);
}

export function buildSystemSettingRows(
  config: SystemConfig,
  updatedAt = Date.now()
): Array<[string, string, number]> {
  return SYSTEM_SETTING_MAP.map(([dbKey, configKey]) => [
    dbKey,
    serializeConfigValue(configKey, config[configKey]),
    updatedAt
  ]);
}

export function decodeSystemSettingRows(
  rows: Array<{ key?: unknown; value?: unknown }>
): Partial<SystemConfig> {
  const keyToConfig = new Map(SYSTEM_SETTING_MAP);
  const updates: Partial<SystemConfig> = {};

  for (const row of rows) {
    const dbKey = String(row.key ?? '');
    const configKey = keyToConfig.get(dbKey);
    if (!configKey) continue;

    const raw = String(row.value ?? '');
    if (ARRAY_KEYS.has(configKey)) {
      try {
        const parsed: unknown = JSON.parse(raw || 'null');
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
          (updates as any)[configKey] = [...parsed];
        }
      } catch {
        // Ignore malformed persisted arrays; configuration integrity checks
        // on the resulting runtime snapshot remain fail-closed.
      }
      continue;
    }

    if (BOOLEAN_KEYS.has(configKey)) {
      (updates as any)[configKey] = raw === 'true';
      continue;
    }

    if (configKey === 'firstLiveArmedAt') {
      (updates as any)[configKey] = raw.trim() !== '' ? Number(raw) : null;
      continue;
    }

    if (NUMERIC_KEYS.has(configKey)) {
      const value = Number(raw);
      if (Number.isFinite(value)) (updates as any)[configKey] = value;
      continue;
    }

    if (raw.trim() !== '') {
      (updates as any)[configKey] = raw;
    }
  }

  return updates;
}

export async function loadPersistedSystemConfigFromDatabase(): Promise<Partial<SystemConfig>> {
  const rows = await executeQuery<{ key: string; value: string }>(
    'SELECT key, value FROM system_settings'
  );
  return decodeSystemSettingRows(rows);
}

export async function persistSystemConfigToDatabase(
  config: SystemConfig,
  updatedAt = Date.now()
): Promise<void> {
  const rows = buildSystemSettingRows(config, updatedAt);

  await executeTransaction((db) => {
    for (const [key, value, timestamp] of rows) {
      db.run(
        'INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)',
        [key, value, timestamp]
      );
    }
  });
}
