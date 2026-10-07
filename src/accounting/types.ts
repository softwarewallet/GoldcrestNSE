// ============================================================================
// CANONICAL MULTI-CURRENCY ACCOUNTING & CONSOLIDATION LAYER TYPES
// ============================================================================

export type CurrencyCode = 'USD' | 'INR';

export type MarketTypeWithCurrency =
  | 'FOREX'
  | 'INDIAN_EQUITY'
  | 'INDIAN_FUTURES'
  | 'INDIAN_OPTIONS'
  | 'INDIAN_INDEX';

export const MARKET_CURRENCY_MAPPING: Record<string, CurrencyCode> = {
  FOREX: 'USD',
  INDIAN_EQUITY: 'INR',
  INDIAN_FUTURES: 'INR',
  INDIAN_OPTIONS: 'INR',
  INDIAN_INDEX: 'INR',
};

export function getNativeCurrencyForMarket(market: string): CurrencyCode {
  if (market in MARKET_CURRENCY_MAPPING) {
    return MARKET_CURRENCY_MAPPING[market];
  }
  if (market.startsWith('INDIAN')) return 'INR';
  return 'USD';
}

/**
 * Domain Money type enforcing strict currency safety.
 */
export interface Money {
  amount: number;
  currency: CurrencyCode;
}

/**
 * FX Rate Types distinguishing conversion timing.
 */
export type FXRateType = 'TRADE_TIME' | 'REPORT_TIME' | 'PERIOD_END' | 'REFERENCE';

/**
 * FX Rate Status classifications for staleness, validation, and provenance.
 */
export type FXRateStatus = 'FRESH' | 'STALE' | 'UNAVAILABLE' | 'INVALID' | 'REFERENCE';

/**
 * FX Live Source Status indicator.
 */
export type FXLiveSourceStatus = 'NOT_CONFIGURED' | 'CONNECTED' | 'DEGRADED';

/**
 * FX Conversion methodology for historical and reporting conversions.
 */
export type FXConversionMethodology = 'TRADE_TIME_FX' | 'REPORT_TIME_FX' | 'PERIOD_END_FX';

/**
 * Immutable audit record for any FX conversion performed.
 */
export interface FXConversionRecord {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: number;
  effectiveAt: number;
  retrievedAt: number;
  source: string;
  rateType: FXRateType;
  methodology: FXConversionMethodology;
  conversionVersion: string;
  status: FXRateStatus;

  // Audit tracing metadata
  originalAmount?: number;
  originalCurrency?: CurrencyCode;
  convertedAmount?: number;
  reportingCurrency?: CurrencyCode;
}

/**
 * Native-currency ledger record preserving native values as authoritative.
 */
export interface FinancialRecord {
  tradeId: string;
  positionId?: string;
  instrument: string;
  assetClass: string;
  market: string;
  nativeCurrency: CurrencyCode;
  nativeGrossPnL: number;
  nativeCosts: number;
  nativeNetPnL: number;
  nativeEntryValue?: number;
  nativeExitValue?: number;
  timestamp: number;

  // Derived Reporting Layer fields (never mutates native values)
  reportingCurrency?: CurrencyCode;
  convertedAmount?: number;
  fxConversion?: FXConversionRecord;
}

/**
 * Multi-Currency Portfolio Account Balance with explicit execution context.
 */
export interface AccountBalanceWithContext {
  currency: CurrencyCode;
  balance: number;
  executionMode: 'LIVE';
  accountType: 'FOREX_MARGIN' | 'INDIAN_EQUITY_DERIVATIVES';
  isSimulatedCapital: boolean;
  notice: string;
}

/**
 * Historical Reproducible Report Snapshot.
 */
export interface HistoricalReportSnapshot {
  reportId: string;
  reportPeriod: string;
  reportingCurrency: CurrencyCode;
  conversionMethodology: FXConversionMethodology;
  conversionVersion: string;
  fxRecordsUsed: FXConversionRecord[];
  nativeSubtotals: {
    USD: NativePerformanceSummary;
    INR: NativePerformanceSummary;
  };
  convertedSubtotals: {
    USD_in_reportingCurrency: number;
    INR_in_reportingCurrency: number;
  };
  consolidatedTotals: {
    grossPnL: number;
    costs: number;
    netPnL: number;
    drawdownPct: number;
    exposure: number;
  };
  generatedAt: number;
}

/**
 * Multi-Currency Portfolio Buckets (authoritative state).
 */
export interface MultiCurrencyBalances {
  USD: number;
  INR: number;
}

export interface MultiCurrencyPnL {
  USD: number;
  INR: number;
}

export interface MultiCurrencyCosts {
  USD: number;
  INR: number;
}

export interface MultiCurrencyExposure {
  USD: number;
  INR: number;
}

export interface MultiCurrencyDrawdown {
  USD: number;
  INR: number;
}

/**
 * Native Currency Performance Summary for a specific asset class or environment.
 */
export interface NativePerformanceSummary {
  currency: CurrencyCode;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  grossPnL: number;
  costs: number;
  netPnL: number;
  profitFactor: number;
  expectancyR: number;
  maxDrawdownPct: number;
  exposure: number;
}

/**
 * Consolidated P&L Report across multiple native currencies.
 */
export interface ConsolidatedPnLSummary {
  reportingCurrency: CurrencyCode;
  methodology: FXConversionMethodology;
  nativeSubtotals: {
    USD: NativePerformanceSummary;
    INR: NativePerformanceSummary;
  };
  fxConversions: {
    USD_to_INR?: FXConversionRecord;
    INR_to_USD?: FXConversionRecord;
  };
  convertedSubtotals: {
    USD_in_reportingCurrency: number;
    INR_in_reportingCurrency: number;
  };
  consolidatedGrossPnL: number;
  consolidatedCosts: number;
  consolidatedNetPnL: number;
  consolidatedDrawdownPct: number;
  consolidatedExposure: number;
  conversionTimestamp: number;
}

/**
 * Result structure when querying FXRateProvider.
 */
export interface FXRateQueryResult {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  rateStatus: FXRateStatus;
  fxLiveSourceStatus: FXLiveSourceStatus;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate?: number;
  effectiveAt?: number;
  retrievedAt?: number;
  source?: string;
  rateType?: FXRateType;
  methodology?: FXConversionMethodology;
  conversionVersion?: string;
  error?: string;
}
