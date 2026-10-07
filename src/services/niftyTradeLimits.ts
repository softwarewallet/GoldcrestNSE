export interface NiftyIndexDefinition {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  lotSize: number;
  defaultMaxTradeValueInr: number;
}

export const SUPPORTED_NIFTY_INDICES: readonly NiftyIndexDefinition[] = [
  { symbol: 'NIFTY', name: 'NIFTY 50', exchange: 'NSE', lotSize: 25, defaultMaxTradeValueInr: 20 },
  { symbol: 'BANKNIFTY', name: 'NIFTY BANK', exchange: 'NSE', lotSize: 15, defaultMaxTradeValueInr: 20 },
  { symbol: 'FINNIFTY', name: 'NIFTY FINANCIAL SERVICES', exchange: 'NSE', lotSize: 25, defaultMaxTradeValueInr: 20 },
  { symbol: 'MIDCPNIFTY', name: 'NIFTY MIDCAP SELECT', exchange: 'NSE', lotSize: 50, defaultMaxTradeValueInr: 20 },
  { symbol: 'NIFTYNXT50', name: 'NIFTY NEXT 50', exchange: 'NSE', lotSize: 10, defaultMaxTradeValueInr: 20 },
  { symbol: 'SENSEX', name: 'BSE SENSEX 30', exchange: 'BSE', lotSize: 10, defaultMaxTradeValueInr: 20 },
  { symbol: 'BANKEX', name: 'BSE BANKEX', exchange: 'BSE', lotSize: 15, defaultMaxTradeValueInr: 20 }
];

export const DEFAULT_NIFTY_MAX_TRADE_VALUES: Record<string, number> = {
  NIFTY: 20,
  BANKNIFTY: 20,
  FINNIFTY: 20,
  MIDCPNIFTY: 20,
  NIFTYNXT50: 20,
  SENSEX: 20,
  BANKEX: 20
};

/**
 * Normalizes any instrument symbol or derivative contract string to its primary Nifty/Index underlying.
 */
export function extractUnderlyingIndex(symbolOrUnderlying: string): string {
  if (!symbolOrUnderlying) return 'NIFTY';
  const clean = String(symbolOrUnderlying).toUpperCase().trim();

  if (clean.startsWith('BANKNIFTY')) return 'BANKNIFTY';
  if (clean.startsWith('MIDCPNIFTY') || clean.startsWith('NIFTYMIDCAP')) return 'MIDCPNIFTY';
  if (clean.startsWith('FINNIFTY') || clean.startsWith('NIFTYFIN')) return 'FINNIFTY';
  if (clean.startsWith('NIFTYNXT50') || clean.startsWith('NIFTYNEXT50')) return 'NIFTYNXT50';
  if (clean.startsWith('NIFTY')) return 'NIFTY';
  if (clean.startsWith('BANKEX')) return 'BANKEX';
  if (clean.startsWith('SENSEX')) return 'SENSEX';

  for (const idx of SUPPORTED_NIFTY_INDICES) {
    if (clean.includes(idx.symbol)) return idx.symbol;
  }

  const alpha = clean.replace(/[^A-Z]/g, '');
  if (alpha.includes('BANKNIFTY')) return 'BANKNIFTY';
  if (alpha.includes('FINNIFTY')) return 'FINNIFTY';
  if (alpha.includes('MIDCPNIFTY')) return 'MIDCPNIFTY';
  if (alpha.includes('NIFTYNXT50')) return 'NIFTYNXT50';
  if (alpha.includes('NIFTY')) return 'NIFTY';
  if (alpha.includes('SENSEX')) return 'SENSEX';
  if (alpha.includes('BANKEX')) return 'BANKEX';

  return clean;
}

/**
 * Returns the derivative contract standard lot size for a given Nifty index.
 */
export function getNiftyIndexLotSize(symbolOrUnderlying: string): number {
  const underlying = extractUnderlyingIndex(symbolOrUnderlying);
  const found = SUPPORTED_NIFTY_INDICES.find(i => i.symbol === underlying);
  return found ? found.lotSize : 25;
}

/**
 * Strict authoritative lot size resolution for live execution.
 * Rejects with AUTHORITATIVE_LOT_SIZE_UNAVAILABLE if live contract metadata lot size is missing or invalid.
 */
export function getAuthoritativeLotSizeOrReject(contract: { lotSize?: number; symbol?: string; underlying?: string } | null | undefined): number {
  const lotSize = Number(contract?.lotSize);
  if (!Number.isFinite(lotSize) || lotSize <= 0) {
    throw new Error('AUTHORITATIVE_LOT_SIZE_UNAVAILABLE: Live option contract metadata does not provide a valid authoritative lot size.');
  }
  return lotSize;
}

/**
 * Resolves the authoritative Maximum Trade Value (INR) configured in settings for a specific Nifty instrument.
 */
export function getResolvedMaxTradeValueForNifty(
  symbolOrUnderlying: string,
  config?: {
    customNiftyBudgetEnabled?: boolean;
    niftyMaxTradeValues?: Record<string, number>;
    smallTradeBudgetEnabled?: boolean;
    smallTradeBudgetInr?: number;
    maxTradeValueIndianInr?: number;
  } | null
): {
  underlying: string;
  maxTradeValueInr: number;
  lotSize: number;
  maxAllowedPremium: number;
  source: 'PER_NIFTY_SETTING' | 'GLOBAL_SMALL_BUDGET' | 'INDIAN_MAX_LIMIT' | 'DEFAULT';
} {
  const underlying = extractUnderlyingIndex(symbolOrUnderlying);
  const lotSize = getNiftyIndexLotSize(underlying);

  // 1. Check custom per-Nifty configured settings dictionary
  const perNiftyConfig = config?.niftyMaxTradeValues;
  if (perNiftyConfig && typeof perNiftyConfig === 'object') {
    const customVal = perNiftyConfig[underlying] ?? perNiftyConfig[underlying.toUpperCase()];
    if (typeof customVal === 'number' && Number.isFinite(customVal) && customVal > 0) {
      return {
        underlying,
        maxTradeValueInr: customVal,
        lotSize,
        maxAllowedPremium: Number((customVal / lotSize).toFixed(2)),
        source: 'PER_NIFTY_SETTING'
      };
    }
  }

  // 2. Check small trade budget mode
  if (config?.smallTradeBudgetEnabled && typeof config.smallTradeBudgetInr === 'number' && config.smallTradeBudgetInr > 0) {
    return {
      underlying,
      maxTradeValueInr: config.smallTradeBudgetInr,
      lotSize,
      maxAllowedPremium: Number((config.smallTradeBudgetInr / lotSize).toFixed(2)),
      source: 'GLOBAL_SMALL_BUDGET'
    };
  }

  // 3. Fallback to general Indian market maximum
  if (typeof config?.maxTradeValueIndianInr === 'number' && config.maxTradeValueIndianInr > 0) {
    return {
      underlying,
      maxTradeValueInr: config.maxTradeValueIndianInr,
      lotSize,
      maxAllowedPremium: Number((config.maxTradeValueIndianInr / lotSize).toFixed(2)),
      source: 'INDIAN_MAX_LIMIT'
    };
  }

  const defaultVal = DEFAULT_NIFTY_MAX_TRADE_VALUES[underlying] || 20;
  return {
    underlying,
    maxTradeValueInr: defaultVal,
    lotSize,
    maxAllowedPremium: Number((defaultVal / lotSize).toFixed(2)),
    source: 'DEFAULT'
  };
}

/**
 * Automates and verifies Nifty order preparation against the configured maximum trade value limit.
 */
export function prepareAndValidateNiftyOrder(params: {
  symbolOrUnderlying: string;
  priceOrPremium: number;
  quantity?: number;
  config?: any;
}) {
  const { symbolOrUnderlying, priceOrPremium, quantity, config } = params;
  const resolution = getResolvedMaxTradeValueForNifty(symbolOrUnderlying, config);
  const lotSize = resolution.lotSize;
  const effectiveQty = quantity && quantity > 0 ? quantity : lotSize;
  const totalValue = Number((effectiveQty * priceOrPremium).toFixed(2));
  const isAllowed = totalValue <= resolution.maxTradeValueInr + 1e-8;

  const maxSafeLots = priceOrPremium > 0
    ? Math.max(0, Math.floor(resolution.maxTradeValueInr / (lotSize * priceOrPremium)))
    : 1;
  const maxSafeQty = maxSafeLots * lotSize;

  return {
    isAllowed,
    underlying: resolution.underlying,
    lotSize,
    effectiveQty,
    priceOrPremium,
    totalTradeValue: totalValue,
    maxAllowedTradeValue: resolution.maxTradeValueInr,
    maxAllowedPremium: resolution.maxAllowedPremium,
    maxSafeLots,
    maxSafeQty,
    source: resolution.source,
    rejectionReason: !isAllowed
      ? `Order value ₹${totalValue.toFixed(2)} exceeds configured limit of ₹${resolution.maxTradeValueInr.toFixed(2)} for ${resolution.underlying}. Max allowed premium for 1 lot (${lotSize} qty) is ₹${resolution.maxAllowedPremium.toFixed(2)}.`
      : undefined
  };
}
