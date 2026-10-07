import { BrokerInstrument } from '../types';
import { getSystemConfig } from '../../services/configService';
import { AUTO_LIVE_XAU_VOLUME_DIVISOR } from '../../services/autoLiveTradePolicy';

export interface ForexSizingResult {
  requestedQuantity: number;
  quantity: number;
  directQuantity: number;
  rawMaxQuantity: number;
  maxTradeValueUsd: number;
  estimatedTradeValueUsd?: number;
  quoteToUsdRate?: number;
  quoteCurrency?: string;
  adjusted: boolean;
  brokerMaximumQuantity?: number;
  brokerMinimumQuantity?: number;
  brokerStepQuantity?: number;
}

/**
 * Goldcrest-wide broker price precision policy.
 *
 * Every executable/order price is normalized to exactly three
 * decimal places. Broker-reported precision must not override this
 * Goldcrest-wide execution policy.
 */
export const GOLD_CREST_PRICE_DIGITS = 3;

export function normalizePriceToThreeDigits(price: number): number {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('INVALID_PRICE: Price must be a positive finite number.');
  }
  return Number(price.toFixed(GOLD_CREST_PRICE_DIGITS));
}

/**
 * Backward-compatible name used by existing execution code.
 */
export function normalizePriceToInstrumentDigits(price: number, digits?: number): number {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('INVALID_PRICE: Price must be a positive finite number.');
  }
  // The optional digits argument is retained for API compatibility, but
  // executable Goldcrest prices are always normalized to three decimals.
  void digits;
  return Number(price.toFixed(GOLD_CREST_PRICE_DIGITS));
}

export interface ForexPipTargets {
  stopLoss: number;
  takeProfit: number;
  stopLossPips: number;
  takeProfitPips: number;
  pipSize: number;
}

/**
 * Build Forex Stop Loss / Take Profit from the operator-configured pip
 * distances and the authoritative execution entry price.
 *
 * BUY:
 *   SL = entry - stopLossPips * pipSize
 *   TP = entry + takeProfitPips * pipSize
 *
 * SELL:
 *   SL = entry + stopLossPips * pipSize
 *   TP = entry - takeProfitPips * pipSize
 *
 * The resulting prices use Goldcrest's global three-decimal execution policy.
 */
export function calculateForexPipTargets(
  side: 'BUY' | 'SELL',
  entryPrice: number,
  pipSize: number,
  stopLossPips: number,
  takeProfitPips: number
): ForexPipTargets {
  if (side !== 'BUY' && side !== 'SELL') {
    throw new Error('INVALID_SIDE: Forex side must be BUY or SELL.');
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error('INVALID_PRICE: Forex entry price must be a positive finite number.');
  }
  if (!Number.isFinite(pipSize) || pipSize <= 0) {
    throw new Error('INVALID_PIP_SIZE: Broker instrument pip size is unavailable or invalid.');
  }
  if (!Number.isFinite(stopLossPips) || stopLossPips <= 0) {
    throw new Error('INVALID_STOP_LOSS_PIPS: Stop Loss in pips must be greater than zero.');
  }
  if (!Number.isFinite(takeProfitPips) || takeProfitPips <= 0) {
    throw new Error('INVALID_TAKE_PROFIT_PIPS: Take Profit in pips must be greater than zero.');
  }

  const stopDistance = stopLossPips * pipSize;
  const takeProfitDistance = takeProfitPips * pipSize;
  const stopLoss = side === 'BUY'
    ? entryPrice - stopDistance
    : entryPrice + stopDistance;
  const takeProfit = side === 'BUY'
    ? entryPrice + takeProfitDistance
    : entryPrice - takeProfitDistance;

  if (!(stopLoss > 0) || !(takeProfit > 0)) {
    throw new Error('INVALID_PIP_TARGETS: Calculated Stop Loss or Take Profit is not positive.');
  }

  return {
    stopLoss: normalizePriceToThreeDigits(stopLoss),
    takeProfit: normalizePriceToThreeDigits(takeProfit),
    stopLossPips,
    takeProfitPips,
    pipSize
  };
}

/**
 * Direct Forex order sizing.
 *
 * The Auto Live sizing model no longer calculates quantity from price and no
 * longer converts the pair's quote currency into USD. The configured
 * maxTradeValueForexUsd setting is retained for backward-compatible settings
 * storage/UI naming, but its numeric value is now used directly as the order
 * quantity/volume.
 *
 * Example:
 *   maxTradeValueForexUsd = 100
 *   => normal Forex order quantity = 100
 *
 * Gold (any Forex symbol containing XAU) uses a dedicated 1/1000 volume rule:
 *   maxTradeValueForexUsd = 1000
 *   => XAU order quantity = 10
 *
 * The XAU adjustment is applied centrally here so Auto Live and Trigger Now
 * use exactly the same sizing contract. The broker remains authoritative for
 * minimum quantity, maximum quantity and volume-step validation. Goldcrest
 * intentionally does not pre-reject an order based on those broker constraints
 * here.
 */
export async function sizeForexOrderToMaxTradeValue(
  _adapter: unknown,
  _symbol: string,
  _price: number,
  _instrument: BrokerInstrument,
  requestedQuantity: number
): Promise<ForexSizingResult> {
  const config = getSystemConfig();
  const configuredQuantity = Number(config.maxTradeValueForexUsd);
  const requested = Number.isFinite(Number(requestedQuantity)) && Number(requestedQuantity) > 0
    ? Number(requestedQuantity)
    : 0;

  if (!(configuredQuantity > 0) || !Number.isFinite(configuredQuantity)) {
    throw new Error(
      'MAX_TRADE_VALUE_INVALID: Configured maximum Forex trade quantity must be a positive finite number.'
    );
  }

  // XAU/USD and any other Forex symbol containing XAU use one-thousandth
  // of the operator-configured Forex volume. This is a volume rule, not a
  // price/notional conversion.
  const normalizedSymbol = String(_symbol || '').toUpperCase().trim();
  const isXauPair = normalizedSymbol
    .split('/')
    .some(part => part === 'XAU');
  const xauVolumeDivisor = AUTO_LIVE_XAU_VOLUME_DIVISOR;
  const configuredExecutionQuantity = isXauPair
    ? Math.floor(configuredQuantity / xauVolumeDivisor)
    : Math.floor(configuredQuantity);

  if (!(configuredExecutionQuantity > 0) || !Number.isFinite(configuredExecutionQuantity)) {
    throw new Error(
      isXauPair
        ? 'MAX_TRADE_VALUE_INVALID: Configured Forex volume must be at least 1000 for an XAU pair because XAU volume is configured volume / 100.'
        : 'MAX_TRADE_VALUE_INVALID: Configured maximum Forex trade quantity must be at least 1.'
    );
  }

  return {
    requestedQuantity: requested,
    quantity: configuredExecutionQuantity,
    directQuantity: configuredExecutionQuantity,
    rawMaxQuantity: configuredExecutionQuantity,
    // Retain the legacy property name because it is persisted/configured under
    // maxTradeValueForexUsd. It is NOT a USD notional calculation anymore.
    maxTradeValueUsd: configuredQuantity,
    adjusted: Math.abs(configuredExecutionQuantity - requested) > 1e-9
  };
}
