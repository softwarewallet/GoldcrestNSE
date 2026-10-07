import fs from 'node:fs';
import path from 'node:path';
import { FOREX_PAIRS } from '../markets/forex/instruments';
import { evaluateSystemConfigIntegrity } from './configIntegrityService';

export interface SystemConfig {
  tradingMode: 'LIVE_ONLY';
  liveTradingEnabled: boolean;
  dataStatus: 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';
  modelStatus: string;
  researchStatus: 'CLOSED';
  cTraderApiMode: 'LIVE' | 'DEMO';
  selectedCtraderAccountId?: string;
  selectedCtraderAccountCurrency?: string;
  selectedCtraderAccountLabel?: string;
  defaultRiskPct: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  maxConsecutiveLosses: number;
  maxSpreadBps: number;
  signalCooldownMs: number;
  eventProximityThresholdMinutes: number;
  strikeDepth: number;
  maxTradeValueForexUsd: number;
  maxTradeValueIndianInr: number;
  autoLiveMinSignalScore: number;
  autoLiveMaxTradesPerPair: number;
  forexStopLossPips: number;
  forexTakeProfitPips: number;
  autoLiveForexPairs: string[];
  autoLiveIndianUnderlyings: string[];
  financialDisclaimer: string;
}

const CONFIG_DIR = process.env.GOLDCREST_CONFIG_DIR
  ? path.resolve(process.env.GOLDCREST_CONFIG_DIR)
  : path.join(process.cwd(), 'data');
const CONFIG_FILE = process.env.GOLDCREST_CONFIG_FILE
  ? path.resolve(process.env.GOLDCREST_CONFIG_FILE)
  : path.join(CONFIG_DIR, 'system-config.json');
const CONFIG_TMP_FILE = `${CONFIG_FILE}.tmp`;

/**
 * Only operator-editable, non-secret runtime settings are persisted.
 * Broker credentials remain server-side and are intentionally not copied into
 * this configuration file.
 */
const PERSISTED_KEYS: readonly (keyof SystemConfig)[] = [
  'cTraderApiMode',
  'selectedCtraderAccountId',
  'selectedCtraderAccountCurrency',
  'selectedCtraderAccountLabel',
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
  'autoLiveForexPairs',
  'autoLiveIndianUnderlyings',
  'financialDisclaimer'
];

let activeConfig: SystemConfig = {
  tradingMode: 'LIVE_ONLY',
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
  dataStatus: 'UNAVAILABLE',
  modelStatus: 'ML BASELINE / UNCALIBRATED (PHASE 1)',
  researchStatus: 'CLOSED',
  cTraderApiMode: 'DEMO',
  defaultRiskPct: 1.0,
  maxDailyLossPct: 3.0,
  maxOpenPositions: 5,
  maxTradesPerDay: 20,
  maxConsecutiveLosses: 3,
  maxSpreadBps: 30,
  signalCooldownMs: 60000,
  eventProximityThresholdMinutes: 20,
  strikeDepth: 7,
  maxTradeValueForexUsd: 100000,
  maxTradeValueIndianInr: 1000000,
  autoLiveMinSignalScore: 75,
  autoLiveMaxTradesPerPair: 4,
  forexStopLossPips: 20,
  forexTakeProfitPips: 40,
  // If the operator has not persisted a working-universe selection yet,
  // Auto Live evaluates the complete supported Forex universe rather than
  // silently falling back to the old five-pair subset.
  autoLiveForexPairs: FOREX_PAIRS.map(pair => pair.symbol),
  autoLiveIndianUnderlyings: ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'],
  financialDisclaimer:
    'Trading in Forex and derivatives involves substantial risk of loss. Model outputs, signals, probabilities and technical analysis are estimates for informational and analytical purposes only and are not financial advice, guarantees, or assurances of future performance.'
};

let diskConfigLoaded = false;

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizePersistedConfig(input: unknown): Partial<SystemConfig> {
  if (!isRecord(input)) return {};

  const output: Partial<SystemConfig> = {};
  for (const key of PERSISTED_KEYS) {
    const value = input[key];

    if (typeof value === 'number') {
      if (Number.isFinite(value)) (output as any)[key] = value;
      continue;
    }

    if (typeof value === 'string') {
      if (value.trim() !== '') (output as any)[key] = value;
      continue;
    }

    if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      (output as any)[key] = [...value];
    }
  }

  return output;
}

/**
 * Load persisted operator settings exactly once per server process.
 * A corrupt/partial file is ignored rather than preventing the terminal from
 * starting; the next successful save replaces it atomically.
 */
export function loadPersistedSystemConfig(): SystemConfig {
  if (diskConfigLoaded) return { ...activeConfig };
  diskConfigLoaded = true;

  try {
    ensureConfigDir();
    if (!fs.existsSync(CONFIG_FILE)) {
      return { ...activeConfig };
    }

    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const persisted = sanitizePersistedConfig(parsed);

    activeConfig = {
      ...activeConfig,
      ...persisted,
      tradingMode: 'LIVE_ONLY'
    };
  } catch (error) {
    console.warn('[CONFIG] Persisted system-config.json could not be loaded; using defaults.', error);
  }

  return { ...activeConfig };
}

export function persistSystemConfig(config: SystemConfig = activeConfig): void {
  try {
    ensureConfigDir();

    const persisted: Record<string, unknown> = {};
    for (const key of PERSISTED_KEYS) {
      persisted[key] = config[key];
    }

    const serialized = JSON.stringify(persisted, null, 2) + '\n';
    fs.writeFileSync(CONFIG_TMP_FILE, serialized, 'utf8');
    fs.renameSync(CONFIG_TMP_FILE, CONFIG_FILE);
  } catch (error) {
    console.error('[CONFIG] Failed to persist system configuration:', error);
    try {
      if (fs.existsSync(CONFIG_TMP_FILE)) fs.unlinkSync(CONFIG_TMP_FILE);
    } catch {}
    throw error;
  }
}

export function getSystemConfig(): SystemConfig {
  loadPersistedSystemConfig();
  return { ...activeConfig };
}

export function applyPersistedSystemConfig(updates: Partial<SystemConfig>): SystemConfig {
  // Once the server hydrates the authoritative persisted store (SQLite), do
  // not subsequently reload the possibly stale file-backed snapshot and
  // overwrite those values. SQLite is the durable runtime source of record;
  // the JSON file is only a bootstrap/fallback snapshot.
  activeConfig = {
    ...activeConfig,
    ...updates,
    tradingMode: 'LIVE_ONLY'
  };
  diskConfigLoaded = true;

  return { ...activeConfig };
}

export function prepareSystemConfigUpdate(updates: Partial<SystemConfig>): SystemConfig {
  loadPersistedSystemConfig();

  // Goldcrest's broker routing remains explicit, while cTrader Open API
  // endpoint mode may be selected independently for connection/testing.
  if (updates.tradingMode !== undefined && updates.tradingMode !== 'LIVE_ONLY') {
    throw new Error('Trading mode rejected: Goldcrest supports LIVE_ONLY mode only.');
  }
  if (updates.cTraderApiMode !== undefined && !['LIVE', 'DEMO'].includes(updates.cTraderApiMode)) {
    throw new Error('cTrader API mode must be LIVE or DEMO.');
  }

  const candidate: SystemConfig = {
    ...activeConfig,
    ...updates,
    tradingMode: 'LIVE_ONLY'
  };
  const integrity = evaluateSystemConfigIntegrity(candidate);
  if (!integrity.ok) {
    throw new Error(`Configuration integrity rejected: ${integrity.failures.join(', ') || 'invalid configuration'}`);
  }
  return { ...candidate };
}

export function updateSystemConfig(updates: Partial<SystemConfig>): SystemConfig {
  const candidate = prepareSystemConfigUpdate(updates);
  activeConfig = candidate;
  persistSystemConfig(activeConfig);
  return { ...activeConfig };
}

export function getCTraderApiMode(): 'LIVE' | 'DEMO' {
  loadPersistedSystemConfig();
  return activeConfig.cTraderApiMode;
}
