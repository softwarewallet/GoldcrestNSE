import { CTraderBrokerAdapter, CTraderConfig } from './CTraderBrokerAdapter';
import { NormalizedOrder, OrderRequest, TradingEnvironment } from '../../types';
import { BrokerError } from '../../errors';
import { getSystemConfig } from '../../../services/configService';
import { normalizePriceToInstrumentDigits } from '../../safety/TradeSizing';
import { AUTO_LIVE_TRAILING_STOP_LOSS_REQUIRED, AUTO_LIVE_XAU_VOLUME_DIVISOR } from '../../../services/autoLiveTradePolicy';

export class CTraderLiveAdapter extends CTraderBrokerAdapter {
  readonly environment: TradingEnvironment = 'LIVE';
  readonly isLive: boolean = true;

  constructor(customConfig?: Partial<CTraderConfig>) {
    const config: CTraderConfig = {
      clientId: customConfig?.clientId ?? process.env.CTRADER_LIVE_CLIENT_ID,
      clientSecret: customConfig?.clientSecret ?? process.env.CTRADER_LIVE_CLIENT_SECRET,
      accessToken: customConfig?.accessToken ?? process.env.CTRADER_LIVE_ACCESS_TOKEN,
      accountId: customConfig?.accountId ?? process.env.CTRADER_LIVE_ACCOUNT_ID,
      environment: 'LIVE',
      apiHost: customConfig?.apiHost ?? process.env.CTRADER_LIVE_API_HOST ?? 'https://live.ctraderapi.com'
    };
    super(config);
  }

  override syncConfig(): void {
    if (!this.config.clientId && process.env.CTRADER_LIVE_CLIENT_ID) {
      this.config.clientId = process.env.CTRADER_LIVE_CLIENT_ID;
    }
    if (!this.config.clientSecret && process.env.CTRADER_LIVE_CLIENT_SECRET) {
      this.config.clientSecret = process.env.CTRADER_LIVE_CLIENT_SECRET;
    }
    if (!this.config.accessToken && process.env.CTRADER_LIVE_ACCESS_TOKEN) {
      this.config.accessToken = process.env.CTRADER_LIVE_ACCESS_TOKEN;
    }
    if (!this.config.accountId && process.env.CTRADER_LIVE_ACCOUNT_ID) {
      this.config.accountId = process.env.CTRADER_LIVE_ACCOUNT_ID;
    }
    super.syncConfig();
  }

  updateCredentials(credentials: Partial<CTraderConfig>): void {
    const cleanUpdates = Object.fromEntries(
      Object.entries(credentials).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    );
    this.config = {
      ...this.config,
      ...cleanUpdates,
      environment: 'LIVE'
    };
    this.status = 'DISCONNECTED';
  }

  clearCredentials(): void {
    this.config = {
      clientId: undefined,
      clientSecret: undefined,
      accessToken: undefined,
      accountId: undefined,
      environment: 'LIVE',
      apiHost: process.env.CTRADER_LIVE_API_HOST ?? 'https://live.ctraderapi.com'
    };
    this.status = 'DISCONNECTED';
  }

  getConfigStatus() {
    return {
      configured: Boolean(
        this.config.clientId &&
        this.config.clientSecret &&
        this.config.accessToken &&
        this.config.accountId
      ),
      maskedAccountId: this.config.accountId ? '****' + this.config.accountId.slice(-4) : undefined,
      maskedClientId: this.config.clientId ? '****' + this.config.clientId.slice(-4) : undefined,
      maskedClientSecret: this.config.clientSecret ? '•••••••• (Saved)' : undefined,
      maskedAccessToken: this.config.accessToken ? '•••••••• (Saved)' : undefined
    };
  }

  /**
   * Final cTrader LIVE Forex execution boundary.
   *
   * The configured maxTradeValueForexUsd is used directly as the cTrader
   * protocol volume. No price-based quantity calculation, quote conversion,
   * broker min/step quantization, or requested-quantity sizing is performed.
   *
   * cTrader represents volume in 0.01 base-currency units, so Goldcrest's
   * internal quantity is maxTradeValueForexUsd / 100. The cTrader API then
   * receives exactly maxTradeValueForexUsd in its volume field.
   *
   * The operator controls the resulting order size by setting the maximum
   * Forex trade value limit to the desired cTrader volume.
   */
  private async enforceMaxTradeValueSizing(order: OrderRequest): Promise<void> {
    order.trailingStopLoss = AUTO_LIVE_TRAILING_STOP_LOSS_REQUIRED;

    if (order.market !== 'FOREX') return;

    const instrument = await this.getInstrument(order.symbol);
    if (!instrument) {
      throw new BrokerError(
        'INVALID_SYMBOL',
        `Live broker instrument metadata unavailable for ${order.symbol}.`,
        'CTRADER',
        this.environment
      );
    }

    const config = getSystemConfig();
    const maxTradeValueForexUsd = Number(config.maxTradeValueForexUsd);
    if (!(maxTradeValueForexUsd > 0) || !Number.isFinite(maxTradeValueForexUsd)) {
      throw new BrokerError(
        'INVALID_QUANTITY',
        'Configured maximum Forex trade value must be a positive finite number.',
        'CTRADER',
        this.environment
      );
    }

    // cTrader volume is an integer protocol field represented in 0.01 units.
    // Normal FX uses the configured protocol volume directly. XAU uses 1/1000
    // of the configured volume, matching the shared Goldcrest sizing contract.
    const normalizedSymbol = String(order.symbol || '').toUpperCase().trim();
    const isXauPair = normalizedSymbol.split('/').some(part => part === 'XAU');
    const xauVolumeDivisor = AUTO_LIVE_XAU_VOLUME_DIVISOR;
    const configuredProtocolVolume = isXauPair
      ? Math.floor(maxTradeValueForexUsd / xauVolumeDivisor)
      : Math.floor(maxTradeValueForexUsd);

    if (!Number.isSafeInteger(configuredProtocolVolume) || configuredProtocolVolume <= 0) {
      throw new BrokerError(
        'INVALID_QUANTITY',
        isXauPair
          ? 'Configured maximum Forex trade value must produce a positive integer cTrader volume for an XAU pair after the 1/1000 rule.'
          : 'Configured maximum Forex trade value must be a positive integer because cTrader volume is an integer protocol field.',
        'CTRADER',
        this.environment
      );
    }

    let executionPrice = Number(order.price || 0);
    if (!(executionPrice > 0) || !Number.isFinite(executionPrice)) {
      const quote = await this.getQuote(order.symbol);
      if (quote.status !== 'FRESH' || !(quote.bid > 0 && quote.ask > 0)) {
        throw new BrokerError(
          'STALE_DATA',
          `Fresh live quote unavailable for ${order.symbol}; a valid execution price is still required.`,
          'CTRADER',
          this.environment
        );
      }
      executionPrice = order.side === 'BUY' ? quote.ask : quote.bid;
    }

    const normalizedExecutionPrice = normalizePriceToInstrumentDigits(
      executionPrice,
      instrument.digits
    );

    // The cTrader API multiplies Goldcrest normalized quantity by 100 when
    // constructing the integer protocol volume. Keep the normalized quantity
    // consistent with the effective configured protocol volume.
    order.quantity = configuredProtocolVolume / 100;
    order.price = normalizedExecutionPrice;

    if (order.stopLoss !== undefined && order.stopLoss > 0) {
      order.stopLoss = normalizePriceToInstrumentDigits(order.stopLoss, instrument.digits);
    }
    if (order.takeProfit !== undefined && order.takeProfit > 0) {
      order.takeProfit = normalizePriceToInstrumentDigits(order.takeProfit, instrument.digits);
    }

    this.logAction('FORCE_MAX_TRADE_VALUE_VOLUME', 'SUCCESS', this.config.accountId || '', {
      symbol: order.symbol,
      quantity: order.quantity,
      price: normalizedExecutionPrice
    });
  }
  // Direct broker-route orders remain explicitly blocked. The autonomous
  // execution engine uses placeAutonomousOrder() only after its own gates pass.
  override async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    await this.enforceMaxTradeValueSizing(order);
    return super.placeOrder(order);
  }

  async placeAutonomousOrder(order: OrderRequest): Promise<NormalizedOrder> {
    await this.enforceMaxTradeValueSizing(order);
    return super.placeOrder(order);
  }
}
