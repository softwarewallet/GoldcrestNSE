import { BaseBrokerAdapter } from '../BaseBrokerAdapter';
import { FOREX_PAIRS } from '../../../markets/forex/instruments';
import { getSystemConfig, getCTraderApiMode } from '../../../services/configService';
import {
  BrokerAccountInfo,
  BrokerInstrument,
  BrokerStatus,
  NormalizedPositionClose,
  OrderSide,
  BrokerType,
  ConnectionTestResult,
  NormalizedOrder,
  NormalizedFill,
  NormalizedPosition,
  NormalizedQuote,
  OrderModification,
  OrderRequest,
  TradingEnvironment,
  OrderType
} from '../../types';
import { BrokerError, normalizeBrokerError } from '../../errors';
import { maskIdentifier } from '../../auditLog';
import { normalizePriceToThreeDigits } from '../../safety/TradeSizing';
import {
  fetchLiveCTraderAccounts,
  fetchLiveCTraderAccountDetails,
  fetchCTraderSymbols,
  fetchLiveCTraderQuote,
  submitLiveCTraderOrder,
  fetchCTraderTrendbars,
  fetchCTraderReconcileState,
  fetchCTraderPositionUnrealizedPnL,
  fetchCTraderDeals,
  fetchCTraderDealsByPositionId,
  fetchCTraderOrderDetails,
  fetchCTraderAssets,
  fetchCTraderConversionSymbols,
  amendLiveCTraderOrder,
  cancelLiveCTraderOrder,
  closeLiveCTraderPosition,
  CTraderRawAccount
} from './cTraderApiClient';

export function resolveLivePositionPrice(
  side: 'BUY' | 'SELL',
  quote: { status: NormalizedQuote['status']; bid?: number; ask?: number }
): { currentPrice: number; currentPriceStatus: 'LIVE' | 'UNAVAILABLE' } {
  const currentPrice = side === 'BUY' ? Number(quote.bid) : Number(quote.ask);
  if (quote.status !== 'FRESH' || !(currentPrice > 0) || !Number.isFinite(currentPrice)) {
    return { currentPrice: 0, currentPriceStatus: 'UNAVAILABLE' };
  }
  return { currentPrice, currentPriceStatus: 'LIVE' };
}

export interface CTraderConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  accountId?: string;
  environment: 'LIVE';
  apiHost?: string;
}

export abstract class CTraderBrokerAdapter extends BaseBrokerAdapter {
  readonly broker: BrokerType = 'CTRADER';
  abstract readonly environment: TradingEnvironment;
  abstract readonly isLive: boolean;

  protected config: CTraderConfig;
  protected accountData: BrokerAccountInfo | null = null;
  protected openPositions: Map<string, NormalizedPosition> = new Map();
  protected openOrders: Map<string, NormalizedOrder> = new Map();
  // Conversion metadata changes far less frequently than live prices. Cache the
  // broker-provided asset map and conversion topology, while still fetching fresh
  // quotes for every risk decision.
  private conversionAssetCache: { expiresAt: number; assets: Awaited<ReturnType<typeof fetchCTraderAssets>> } | null = null;
  private conversionChainCache = new Map<string, { expiresAt: number; chain: Awaited<ReturnType<typeof fetchCTraderConversionSymbols>> }>();
  private static readonly CONVERSION_METADATA_TTL_MS = 5 * 60 * 1000;
  // Account identity and symbol metadata are stable over short trading windows.
  // Re-fetching them for every candle/quote request created dozens of extra
  // authenticated WebSocket sessions during Auto Live preparation.
  private rawAccountCache: { expiresAt: number; account: CTraderRawAccount } | null = null;
  private symbolCache: { expiresAt: number; accountKey: string; symbols: Awaited<ReturnType<typeof fetchCTraderSymbols>> } | null = null;
  private static readonly RAW_ACCOUNT_CACHE_TTL_MS = 60 * 1000;
  private static readonly SYMBOL_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly ACCOUNT_DATA_CACHE_TTL_MS = 10 * 1000;
  private accountFetchInFlight: Promise<BrokerAccountInfo> | null = null;
  private lastKnownApiMode: string | null = null;

  /**
   * Derives effective trading permissions from the authoritative cTrader
   * token scope and account access rights. The previous implementation
   * hard-coded TRADE/READ/TRADING, which could report a connected account as
   * tradable even when the access token was view-only.
   */
  private static getEffectivePermissions(permissionScope?: number, accessRights?: number): string[] {
    const permissions = ['READ'];
    if (permissionScope === 1 && (accessRights === undefined || accessRights === 0)) {
      permissions.push('TRADE', 'TRADING');
    } else if (permissionScope === 1 && accessRights === 1) {
      permissions.push('CLOSE_ONLY');
    }
    return permissions;
  }

  constructor(config: CTraderConfig) {
    super();
    this.config = config;
  }

  public clearCache(): void {
    this.accountData = null;
    this.rawAccountCache = null;
    this.symbolCache = null;
    this.conversionAssetCache = null;
    this.conversionChainCache.clear();
  }

  /**
   * Synchronizes the internal adapter configuration with the global system configuration.
   * This is critical for authoritative account selection if multiple accounts exist.
   */
  protected syncConfig(): void {
    const globalConfig = getSystemConfig();
    const currentApiMode = getCTraderApiMode();

    if (this.lastKnownApiMode !== null && this.lastKnownApiMode !== currentApiMode) {
      this.clearCache();
    }
    this.lastKnownApiMode = currentApiMode;

    // If the global config has a selected account ID, override the adapter's accountId.
    // Conversion metadata is account-scoped, so invalidate it if the selected
    // account changes during the lifetime of this adapter instance.
    if (globalConfig.selectedCtraderAccountId) {
      const previousAccountId = this.config.accountId;
      this.config.accountId = globalConfig.selectedCtraderAccountId;
      if (previousAccountId !== this.config.accountId) {
        this.clearCache();
      }
    }
  }

  protected getApiHost(): string {
    if (this.config.apiHost) return this.config.apiHost;
    return 'https://live.ctraderapi.com';
  }

  protected validateCredentials(): void {
    this.syncConfig();
    const { clientId, clientSecret, accessToken, accountId } = this.config;
    if (!clientId || !clientSecret || !accessToken) {
      this.status = 'DISCONNECTED';
      throw new BrokerError(
        'AUTHENTICATION_FAILED',
        `cTrader ${this.environment} credentials missing. Required: Client ID, Client Secret, and Access Token.`,
        'CTRADER',
        this.environment
      );
    }
  }

  async authenticate(): Promise<boolean> {
    this.status = 'CONNECTING';
    try {
      this.validateCredentials();
      this.status = 'CONNECTED';
      return true;
    } catch (err: any) {
      this.status = 'AUTHENTICATION_FAILED';
      this.lastError = err.message;
      throw normalizeBrokerError(err, 'CTRADER', this.environment);
    }
  }

  async disconnect(): Promise<void> {
    this.status = 'DISCONNECTED';
    this.logAction('DISCONNECT', 'SUCCESS', this.config.accountId || '');
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      this.validateCredentials();
      
      // Authoritative source: Fetch real account data from API simulation
      const account = await this.getAccount();
      const latency = Date.now() - start;

      const apiMode = getCTraderApiMode();
      const apiEndpoint = apiMode === 'DEMO'
        ? 'wss://demo.ctraderapi.com:5036'
        : 'wss://live.ctraderapi.com:5036';

      const res: ConnectionTestResult = {
        broker: 'CTRADER',
        environment: this.environment,
        connected: true,
        apiMode,
        apiEndpoint,
        account: account.accountId,
        accountType: account.accountType,
        balance: account.balance,
        equity: account.equity,
        availableMargin: account.availableMargin,
        currency: account.currency,
        server: account.server,
        permissions: account.permissions,
        timestamp: Date.now(),
        latency
      };

      this.lastConnectionTest = res;
      this.logAction('TEST_CONNECTION', 'SUCCESS', this.config.accountId || '');

      return res;
    } catch (err: any) {
      const latency = Date.now() - start;
      this.status = 'AUTHENTICATION_FAILED';
      this.lastError = err.message;

      const apiMode = getCTraderApiMode();
      const apiEndpoint = apiMode === 'DEMO'
        ? 'wss://demo.ctraderapi.com:5036'
        : 'wss://live.ctraderapi.com:5036';

      const res: ConnectionTestResult = {
        broker: 'CTRADER',
        environment: this.environment,
        connected: false,
        apiMode,
        apiEndpoint,
        account: maskIdentifier(this.config.accountId),
        accountType: apiMode,
        error: err.message,
        timestamp: Date.now(),
        latency: Date.now() - start
      };

      this.lastConnectionTest = res;
      this.logAction('TEST_CONNECTION', 'FAILURE', this.config.accountId || '', {
        error: err.message
      });

      return res;
    }
  }

  /**
   * Discovers accounts associated with the authenticated cTrader identity via Open API.
   * Never injects fabricated fallback accounts.
   */
  async getAccounts(): Promise<BrokerAccountInfo[]> {
    this.syncConfig();
    this.validateCredentials();
    
    const { clientId, clientSecret, accessToken } = this.config;

    if (!clientId || !clientSecret || !accessToken) {
      throw new BrokerError(
        'AUTHENTICATION_FAILED',
        `cTrader ${this.environment} credentials missing. Required: Client ID, Client Secret, and Access Token.`,
        'CTRADER',
        this.environment
      );
    }

    try {
      const liveAccounts = await fetchLiveCTraderAccounts(
        clientId,
        clientSecret,
        accessToken,
        'live'
      );

      if (!liveAccounts || liveAccounts.length === 0) {
        throw new BrokerError(
          'ACCOUNT_NOT_FOUND',
          'No cTrader accounts found for authenticated identity.',
          'CTRADER',
          this.environment
        );
      }

      const results: BrokerAccountInfo[] = [];
      for (const raw of liveAccounts) {
        try {
          const details = await fetchLiveCTraderAccountDetails(
            raw,
            clientId,
            clientSecret,
            accessToken
          );

          results.push({
            accountId: String(details.traderLogin),
            accountType: details.isLive ? 'LIVE' : 'DEMO',
            balance: details.balance,
            equity: details.equity,
            availableMargin: details.availableMargin,
            usedMargin: details.usedMargin,
            freeMargin: details.freeMargin,
            currency: details.currency,
            broker: 'CTRADER',
            environment: this.environment,
            connectionStatus: 'CONNECTED',
            server: details.brokerName || raw.brokerTitleShort || 'cTrader-Live',
            permissions: CTraderBrokerAdapter.getEffectivePermissions(raw.permissionScope, details.accessRights),
            lastUpdate: Date.now(),
            isLiveAccount: details.isLive
          });
        } catch (detailErr: any) {
          throw new BrokerError(
            'ACCOUNT_DATA_UNAVAILABLE',
            `cTrader account ${String(raw.traderLogin)} detail retrieval failed: ${detailErr?.message || String(detailErr)}`,
            'CTRADER',
            this.environment,
            detailErr
          );
        }
      }

      return results;
    } catch (err: any) {
      if (err instanceof BrokerError) {
        throw err;
      }
      throw new BrokerError(
        'ACCOUNT_DATA_UNAVAILABLE',
        `cTrader API account discovery failed: ${err?.message || String(err)}`,
        'CTRADER',
        this.environment,
        err
      );
    }
  }

  /**
   * Retrieves authoritative account information for the selected cTrader account.
   * If a specific accountId is configured, it MUST be found in the authenticated accounts.
   */
  async getAccount(forceRefresh?: boolean): Promise<BrokerAccountInfo> {
    this.syncConfig();
    this.validateCredentials();

    if (forceRefresh) {
      this.clearCache();
    }

    const now = Date.now();
    if (
      !forceRefresh &&
      this.accountData
      && now - Number(this.accountData.lastUpdate || 0) < CTraderBrokerAdapter.ACCOUNT_DATA_CACHE_TTL_MS
    ) {
      return this.accountData;
    }

    if (this.accountFetchInFlight) {
      return this.accountFetchInFlight;
    }

    const { clientId, clientSecret, accessToken } = this.config;
    const targetId = this.config.accountId;

    if (!clientId || !clientSecret || !accessToken) {
      throw new BrokerError(
        'AUTHENTICATION_FAILED',
        `cTrader ${this.environment} credentials missing.`,
        'CTRADER',
        this.environment
      );
    }

    this.accountFetchInFlight = (async () => {
      try {
        const liveAccounts = await fetchLiveCTraderAccounts(
          clientId,
          clientSecret,
          accessToken,
          'live'
        );

        if (!liveAccounts || liveAccounts.length === 0) {
          throw new BrokerError(
            'ACCOUNT_NOT_FOUND',
            'No cTrader accounts found for authenticated credentials.',
            'CTRADER',
            this.environment
          );
        }

        let matched: CTraderRawAccount | undefined;
        if (targetId) {
          matched = liveAccounts.find(
            a => String(a.traderLogin) === String(targetId) || String(a.ctidTraderAccountId) === String(targetId)
          );
          if (!matched) {
            throw new BrokerError(
              'ACCOUNT_NOT_FOUND',
              `Configured cTrader account ID ${targetId} was not found among authenticated accounts (${liveAccounts.map(a => a.traderLogin).join(', ')}).`,
              'CTRADER',
              this.environment
            );
          }
        } else if (liveAccounts.length === 1) {
          matched = liveAccounts[0];
        } else {
          throw new BrokerError(
            'ACCOUNT_NOT_FOUND',
            'Multiple cTrader accounts exist. Please select a specific account ID in configuration.',
            'CTRADER',
            this.environment
          );
        }

        const details = await fetchLiveCTraderAccountDetails(
          matched,
          clientId,
          clientSecret,
          accessToken
        );

        this.status = 'CONNECTED';
        const authoritativeAccount: BrokerAccountInfo = {
          accountId: String(details.traderLogin),
          accountType: details.isLive ? 'LIVE' : 'DEMO',
          balance: details.balance,
          equity: details.equity,
          availableMargin: details.availableMargin,
          usedMargin: details.usedMargin,
          freeMargin: details.freeMargin,
          currency: details.currency,
          broker: 'CTRADER',
          environment: this.environment,
          connectionStatus: 'CONNECTED',
          server: details.brokerName || matched.brokerTitleShort || 'cTrader-Live',
          permissions: CTraderBrokerAdapter.getEffectivePermissions(matched.permissionScope, details.accessRights),
          lastUpdate: Date.now(),
          isLiveAccount: details.isLive
        };

        this.accountData = authoritativeAccount;
        return authoritativeAccount;
      } catch (err: any) {
        if (err instanceof BrokerError) throw err;
        throw new BrokerError(
          'ACCOUNT_DATA_UNAVAILABLE',
          `Authoritative cTrader account data retrieval failed: ${err?.message || String(err)}`,
          'CTRADER',
          this.environment,
          err
        );
      }
    })().finally(() => {
      this.accountFetchInFlight = null;
    });

    return this.accountFetchInFlight;
  }
  /**
   * Converts a Forex base-currency notional into the cTrader account deposit
   * currency using cTrader's native asset conversion-chain API. This avoids
   * assuming that every currency pair exists as a directly tradable symbol.
   * The returned rate is based on authoritative live broker quotes and fails
   * closed if any required conversion leg is unavailable or stale.
   */
  async getAccountCurrencyConversionRate(fromCurrency: string, toCurrency: string): Promise<number> {
    const from = String(fromCurrency || '').trim().toUpperCase();
    const to = String(toCurrency || '').trim().toUpperCase();
    if (!from || !to) throw new Error('Currency conversion requires both source and target currencies.');
    if (from === to) return 1;

    // Prefer a directly tradable conversion leg before opening the native
    // conversion-chain workflow. This avoids an unnecessary assets/chain
    // request on the account-specific broker transport and is sufficient for
    // the common G10 currencies used by Goldcrest.
    const directPair = FOREX_PAIRS.find(
      pair => pair.baseCurrency === from && pair.quoteCurrency === to
    );
    if (directPair) {
      const quote = await this.getQuote(directPair.symbol);
      if (quote.status !== 'FRESH' || !(quote.bid > 0 && quote.ask > 0)) {
        throw new Error(`Authoritative live quote unavailable for conversion leg ${directPair.symbol}.`);
      }
      return quote.bid;
    }

    const inversePair = FOREX_PAIRS.find(
      pair => pair.baseCurrency === to && pair.quoteCurrency === from
    );
    if (inversePair) {
      const quote = await this.getQuote(inversePair.symbol);
      if (quote.status !== 'FRESH' || !(quote.bid > 0 && quote.ask > 0)) {
        throw new Error(`Authoritative live quote unavailable for conversion leg ${inversePair.symbol}.`);
      }
      return 1 / quote.ask;
    }

    const raw = await this.resolveRawAccount();
    const { clientId, clientSecret, accessToken } = this.config;
    if (!clientId || !clientSecret || !accessToken) throw new Error('cTrader credentials unavailable for currency conversion.');

    const now = Date.now();
    let assets: Awaited<ReturnType<typeof fetchCTraderAssets>>;
    if (this.conversionAssetCache && this.conversionAssetCache.expiresAt > now) {
      assets = this.conversionAssetCache.assets;
    } else {
      assets = await fetchCTraderAssets(raw.ctidTraderAccountId, clientId, clientSecret, accessToken, raw.isLive);
      this.conversionAssetCache = {
        assets,
        expiresAt: now + CTraderBrokerAdapter.CONVERSION_METADATA_TTL_MS
      };
    }
    const assetByName = new Map(assets.map(asset => [asset.name.toUpperCase(), asset.assetId]));
    const firstAssetId = assetByName.get(from);
    const lastAssetId = assetByName.get(to);
    if (firstAssetId === undefined || lastAssetId === undefined) {
      throw new Error(`cTrader asset ID unavailable for ${from} to ${to} conversion.`);
    }

    const chainKey = `${raw.ctidTraderAccountId}:${firstAssetId}:${lastAssetId}`;
    const cachedChain = this.conversionChainCache.get(chainKey);
    const chain = cachedChain && cachedChain.expiresAt > now
      ? cachedChain.chain
      : await fetchCTraderConversionSymbols(
          raw.ctidTraderAccountId,
          firstAssetId,
          lastAssetId,
          clientId,
          clientSecret,
          accessToken,
          raw.isLive
        );
    if (!cachedChain || cachedChain.expiresAt <= now) {
      this.conversionChainCache.set(chainKey, {
        chain,
        expiresAt: now + CTraderBrokerAdapter.CONVERSION_METADATA_TTL_MS
      });
    }
    if (chain.length === 0) throw new Error(`cTrader returned no conversion chain for ${from} to ${to}.`);

    let rate = 1;
    let currentAssetId = firstAssetId;
    for (const leg of chain) {
      const baseAssetId = leg.baseAssetId;
      const quoteAssetId = leg.quoteAssetId;
      if (baseAssetId === undefined || quoteAssetId === undefined) {
        throw new Error(`cTrader conversion leg ${leg.symbolName} is missing asset direction metadata.`);
      }

      const quote = await this.getQuote(leg.symbolName);
      if (quote.status === 'STALE' || !(quote.bid > 0 && quote.ask > 0)) {
        throw new Error(`Authoritative live quote unavailable for conversion leg ${leg.symbolName}.`);
      }

      if (baseAssetId === currentAssetId) {
        // Selling the source/base asset into the next asset uses bid.
        rate *= quote.bid;
        currentAssetId = quoteAssetId;
      } else if (quoteAssetId === currentAssetId) {
        // Converting the current asset through a reversed pair requires buying
        // the pair's base asset, so use ask and divide.
        rate /= quote.ask;
        currentAssetId = baseAssetId;
      } else {
        throw new Error(`cTrader conversion chain is discontinuous at ${leg.symbolName}.`);
      }
    }

    if (currentAssetId !== lastAssetId || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`cTrader conversion chain did not resolve ${from} to ${to}.`);
    }
    return rate;
  }

  async getBalance(): Promise<number> {
    const acc = await this.getAccount();
    return acc.balance;
  }

  async getEquity(): Promise<number> {
    const acc = await this.getAccount();
    return acc.equity;
  }

  async getMargin(): Promise<{ usedMargin: number; freeMargin: number; marginLevelPct?: number }> {
    const acc = await this.getAccount();
    return {
      usedMargin: acc.usedMargin,
      freeMargin: acc.freeMargin,
      marginLevelPct: (acc.equity / (acc.usedMargin || 1)) * 100
    };
  }

  protected async resolveRawAccount(): Promise<CTraderRawAccount> {
    this.syncConfig();
    this.validateCredentials();
    const { clientId, clientSecret, accessToken, accountId } = this.config;
    const cached = this.rawAccountCache;
    if (cached && cached.expiresAt > Date.now()) {
      if (!accountId
        || String(cached.account.traderLogin) === String(accountId)
        || String(cached.account.ctidTraderAccountId) === String(accountId)) {
        return cached.account;
      }
    }

    const liveAccounts = await fetchLiveCTraderAccounts(
      clientId!,
      clientSecret!,
      accessToken!,
      'live'
    );
    if (!liveAccounts || liveAccounts.length === 0) {
      throw new BrokerError('ACCOUNT_NOT_FOUND', 'No cTrader accounts found.', 'CTRADER', this.environment);
    }

    let matched: CTraderRawAccount | undefined;
    if (accountId) {
      matched = liveAccounts.find(
        a => String(a.traderLogin) === String(accountId) || String(a.ctidTraderAccountId) === String(accountId)
      );
      if (!matched) {
        throw new BrokerError(
          'ACCOUNT_NOT_FOUND',
          `Configured cTrader LIVE account ID ${accountId} was not found among authenticated accounts.`,
          'CTRADER',
          this.environment
        );
      }
    } else if (liveAccounts.length === 1) {
      matched = liveAccounts[0];
    } else {
      throw new BrokerError(
        'ACCOUNT_NOT_FOUND',
        'Multiple cTrader accounts exist. A specific LIVE account ID is required.',
        'CTRADER',
        this.environment
      );
    }

    this.rawAccountCache = {
      account: matched,
      expiresAt: Date.now() + CTraderBrokerAdapter.RAW_ACCOUNT_CACHE_TTL_MS
    };
    return matched;
  }

  private async getCachedCTraderSymbols(raw: CTraderRawAccount): Promise<Awaited<ReturnType<typeof fetchCTraderSymbols>>> {
    const accountKey = String(raw.ctidTraderAccountId);
    const cached = this.symbolCache;
    if (cached && cached.expiresAt > Date.now() && cached.accountKey === accountKey) {
      return cached.symbols;
    }

    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    this.symbolCache = {
      accountKey,
      symbols,
      expiresAt: Date.now() + CTraderBrokerAdapter.SYMBOL_CACHE_TTL_MS
    };
    return symbols;
  }

  async getPositions(): Promise<NormalizedPosition[]> {
    const raw = await this.resolveRawAccount();
    const state = await fetchCTraderReconcileState(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const symbols = await this.getCachedCTraderSymbols(raw);
    const byId = new Map(symbols.map(s => [s.symbolId, s]));

    // cTrader returns the authoritative current SL/TP on ProtoOAPosition.
    // Its dedicated unrealized-P&L endpoint is used below because reconcile
    // state does not guarantee a live P&L field on every position payload.
    let pnlRows: Awaited<ReturnType<typeof fetchCTraderPositionUnrealizedPnL>> = [];
    try {
      pnlRows = await fetchCTraderPositionUnrealizedPnL(
        raw.ctidTraderAccountId,
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive
      );
    } catch {
      // Keep positions visible if the dedicated P&L request is temporarily
      // unavailable. The position payload remains authoritative for SL/TP,
      // and any broker-provided P&L fields are used as a fallback below.
    }
    const pnlByPositionId = new Map(
      pnlRows.map(row => [Number(row.positionId), row])
    );

    const positions = state.positions
      .map((p: any) => {
        const trade = p.tradeData || {};
        const symbolInfo = byId.get(Number(trade.symbolId));
        if (!symbolInfo) return null;

        const side = String(trade.tradeSide || '').toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
        const quantity = Math.abs(Number(trade.volume || trade.volumeInUnits || 0)) / 100;
        const entryPrice = Number(p.price ?? trade.openPrice ?? 0);
        if (quantity <= 0 || entryPrice <= 0) return null;

        return { raw: p, symbolInfo, side, quantity, entryPrice };
      })
      .filter(Boolean) as Array<{
        raw: any;
        symbolInfo: typeof symbols[number];
        side: 'BUY' | 'SELL';
        quantity: number;
        entryPrice: number;
      }>;

    // Current price is the executable side of a fresh broker quote:
    // BUY positions close at bid, SELL positions close at ask.
    const enriched = await Promise.all(positions.map(async position => {
      try {
        const quote = await fetchLiveCTraderQuote(
          raw.ctidTraderAccountId,
          Number(position.symbolInfo.symbolId),
          position.symbolInfo.symbolName,
          this.config.clientId!,
          this.config.clientSecret!,
          this.config.accessToken!,
          raw.isLive,
          Number(position.symbolInfo.digits || 5)
        );
        const livePrice = resolveLivePositionPrice(position.side, quote);
        return { position, ...livePrice };
      } catch {
        // Never present the entry price as a live market price. A failed or stale
        // quote must remain visibly unavailable rather than silently becoming a
        // misleading "current" price.
        return { position, currentPrice: 0, currentPriceStatus: 'UNAVAILABLE' as const };
      }
    }));

    return enriched.map(({ position, currentPrice, currentPriceStatus }) => {
      const p = position.raw;
      const pnl = pnlByPositionId.get(Number(p.positionId));

      return {
        id: String(p.positionId),
        broker: 'CTRADER',
        environment: this.environment,
        market: 'FOREX',
        symbol: position.symbolInfo.symbolName,
        side: position.side,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        currentPrice,
        currentPriceStatus,
        stopLoss: Number(p.stopLoss || 0) > 0 ? Number(p.stopLoss) : undefined,
        takeProfit: Number(p.takeProfit || 0) > 0 ? Number(p.takeProfit) : undefined,
        unrealizedPnL: Number(pnl?.netUnrealizedPnL ?? p.netUnrealizedPnL ?? p.unrealizedPnL ?? 0),
        realizedPnL: Number(p.realizedPnL ?? p.realizedPnl ?? 0),
        currency: this.accountData?.currency || 'USD',
        timestamp: Number(p.utcLastUpdateTimestamp || Date.now()),
        brokerPositionId: String(p.positionId)
      } as NormalizedPosition;
    });
  }
  async getOpenOrders(): Promise<NormalizedOrder[]> {
    const raw = await this.resolveRawAccount();
    const state = await fetchCTraderReconcileState(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const byId = new Map(symbols.map(s => [s.symbolId, s]));
    return state.orders.map((o: any) => {
      const trade = o.tradeData || {};
      const symbolInfo = byId.get(Number(trade.symbolId));
      if (!symbolInfo) return null;
      const orderTypeRaw = String(o.orderType || 'MARKET').toUpperCase();
      const orderType = orderTypeRaw.includes('STOP_LIMIT') ? 'STOP_LIMIT' : orderTypeRaw.includes('STOP') ? 'STOP' : orderTypeRaw.includes('LIMIT') ? 'LIMIT' : 'MARKET';
      const side = String(trade.tradeSide || '').toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
      const quantity = Math.abs(Number(trade.volume || trade.volumeInUnits || 0)) / 100;
      const filledQuantity = Math.min(
        quantity,
        Math.abs(Number(o.filledVolume || o.executedVolume || trade.filledVolume || 0)) / 100
      );
      if (quantity <= 0) return null;
      const statusRaw = String(o.orderStatus || 'PENDING').toUpperCase();
      const status = statusRaw.includes('FILLED') ? 'FILLED'
        : statusRaw.includes('CANCEL') ? 'CANCELLED'
        : statusRaw.includes('REJECT') ? 'REJECTED'
        : statusRaw.includes('EXPIRE') ? 'EXPIRED'
        : filledQuantity > 0 && filledQuantity < quantity ? 'PARTIALLY_FILLED'
        : statusRaw.includes('ACCEPT') ? 'ACCEPTED'
        : 'PENDING';
      return {
        id: String(o.orderId),
        broker: 'CTRADER',
        environment: this.environment,
        market: 'FOREX',
        symbol: symbolInfo.symbolName,
        side,
        orderType,
        quantity,
        price: Number(o.limitPrice || o.stopPrice || o.executionPrice || 0) || undefined,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        status,
        filledQuantity,
        averageFillPrice: Number(o.executionPrice || 0) || undefined,
        timestamp: Number(o.utcTimestamp || 0) * 1000 || Date.now(),
        brokerOrderId: String(o.orderId),
        clientOrderId: o.clientOrderId ? String(o.clientOrderId) : undefined
      } as NormalizedOrder;
    }).filter(Boolean) as NormalizedOrder[];
  }

  async getOrderByClientOrderId(clientOrderId: string): Promise<NormalizedOrder | null> {
    const normalizedClientOrderId = String(clientOrderId || '').trim().slice(0, 50);
    if (!normalizedClientOrderId) return null;

    // Reconciliation runs independently every 15 seconds. Search both the
    // currently open order state and recent broker history so an accepted
    // submission can still be resolved after it has already filled.
    const openOrders = await this.getOpenOrders();
    const openMatch = openOrders.find(order => order.clientOrderId === normalizedClientOrderId);
    if (openMatch) return openMatch;

    const history = await this.getOrderHistoryRange(Date.now() - 15 * 60_000, Date.now());
    return history.find(order => order.clientOrderId === normalizedClientOrderId) || null;
  }

  async getDailyRealizedPnL(): Promise<number> {
    this.syncConfig();
    this.validateCredentials();
    const raw = await this.resolveRawAccount();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const deals = await fetchCTraderDeals(
      raw.ctidTraderAccountId,
      startOfDay.getTime(),
      Date.now(),
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    return deals.reduce((sum: number, deal: any) => {
      const detail = deal.closePositionDetail || deal.closePositionDetails;
      if (!detail) return sum;

      // cTrader Open API exposes monetary values in integer units. The
      // close-position detail's moneyDigits specifies the decimal exponent
      // required to convert them into deposit-currency amounts.
      const moneyDigits = Number(detail.moneyDigits ?? deal.moneyDigits ?? 0);
      const divisor = Number.isInteger(moneyDigits) && moneyDigits > 0 ? 10 ** moneyDigits : 1;
      const gross = Number(detail.grossProfit ?? detail.profit ?? 0) / divisor;
      const commission = Number(detail.commission ?? 0) / divisor;
      const swap = Number(detail.swap ?? 0) / divisor;

      return sum
        + (Number.isFinite(gross) ? gross : 0)
        + (Number.isFinite(commission) ? commission : 0)
        + (Number.isFinite(swap) ? swap : 0);
    }, 0);
  }

  async getOrderHistory(): Promise<NormalizedOrder[]> {
    const toTimestamp = Date.now();
    return this.getOrderHistoryRange(toTimestamp - 7 * 24 * 60 * 60 * 1000, toTimestamp);
  }

  async getOrderHistoryRange(fromTimestamp: number, toTimestamp: number): Promise<NormalizedOrder[]> {
    this.syncConfig();
    this.validateCredentials();
    const raw = await this.resolveRawAccount();
    const safeFrom = Math.max(0, Number(fromTimestamp));
    const safeTo = Math.max(safeFrom, Number(toTimestamp));
    const deals = await fetchCTraderDeals(raw.ctidTraderAccountId, safeFrom, safeTo, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    const symbols = await this.getCachedCTraderSymbols(raw);
    const byId = new Map(symbols.map(s => [s.symbolId, s]));
    return deals.map((deal: any) => {
      const status = Number(deal.dealStatus) === 2 ? 'FILLED' : 'REJECTED';
      const side = Number(deal.tradeSide) === 2 ? 'SELL' : 'BUY';
      const volume = Math.abs(Number(deal.filledVolume ?? deal.volume ?? 0)) / 100;
      const executionPrice = Number(deal.executionPrice || 0);
      return {
        id: String(deal.dealId),
        broker: 'CTRADER',
        environment: this.environment,
        market: 'FOREX',
        symbol: byId.get(Number(deal.symbolId))?.symbolName || String(deal.symbolId),
        side,
        orderType: 'MARKET',
        quantity: volume,
        price: executionPrice > 0 ? executionPrice : undefined,
        status,
        filledQuantity: status === 'FILLED' ? volume : 0,
        averageFillPrice: executionPrice > 0 ? executionPrice : undefined,
        commission: Number(deal.commission || 0) || undefined,
        timestamp: Number(deal.executionTimestamp || deal.utcLastUpdateTimestamp || Date.now()),
        brokerOrderId: String(deal.orderId),
        clientOrderId: deal.clientOrderId !== undefined ? String(deal.clientOrderId) : (deal.order?.clientOrderId !== undefined ? String(deal.order.clientOrderId) : undefined),
      } as NormalizedOrder;
    });
  }

  async getPositionHistory(positionId: string, fromTimestamp: number, toTimestamp: number): Promise<NormalizedPositionClose[]> {
    this.syncConfig();
    this.validateCredentials();
    const raw = await this.resolveRawAccount();
    const numericPositionId = Number(positionId);
    if (!Number.isSafeInteger(numericPositionId) || numericPositionId <= 0) {
      throw new BrokerError(
        'INVALID_SYMBOL',
        `Invalid cTrader position ID ${positionId} for outcome tracking.`,
        'CTRADER',
        this.environment
      );
    }

    const deals = await fetchCTraderDealsByPositionId(
      raw.ctidTraderAccountId,
      numericPositionId,
      Math.max(0, Number(fromTimestamp)),
      Math.max(Number(fromTimestamp), Number(toTimestamp)),
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );

    const symbols = await this.getCachedCTraderSymbols(raw);
    const byId = new Map(symbols.map(s => [s.symbolId, s]));

    return deals
      .filter((deal: any) => Number(deal.dealStatus) === 2 && Number(deal.filledVolume || 0) > 0)
      .map((deal: any): NormalizedPositionClose | null => {
        const detail = deal.closePositionDetail || deal.closePositionDetails;
        if (!detail) return null;

        const moneyDigits = Number(detail.moneyDigits ?? deal.moneyDigits ?? 0);
        const divisor = Number.isInteger(moneyDigits) && moneyDigits > 0 ? 10 ** moneyDigits : 1;
        const gross = Number(detail.grossProfit ?? detail.profit ?? 0) / divisor;
        const commission = Number(detail.commission ?? deal.commission ?? 0) / divisor;
        const swap = Number(detail.swap ?? detail.swap ?? 0) / divisor;
        const symbolInfo = byId.get(Number(deal.symbolId));

        return {
          brokerPositionId: String(numericPositionId),
          symbol: symbolInfo?.symbolName || String(deal.symbolId),
          side: (Number(deal.tradeSide) === 2 ? 'SELL' : 'BUY') as OrderSide,
          quantity: Math.abs(Number(deal.filledVolume || 0)) / 100,
          exitPrice: Number(deal.executionPrice || 0),
          realizedPnL: Number.isFinite(gross + commission + swap) ? gross + commission + swap : 0,
          commission: Number.isFinite(commission) ? commission : undefined,
          swap: Number.isFinite(swap) ? swap : undefined,
          timestamp: Number(deal.executionTimestamp || deal.utcLastUpdateTimestamp || Date.now()),
          brokerOrderId: deal.orderId !== undefined ? String(deal.orderId) : undefined
        };
      })
      .filter((value): value is NormalizedPositionClose => value !== null);
  }

  async getHistoricalCandles(symbol: string, timeframe: string, limit: number) {
    try {
      const raw = await this.resolveRawAccount();
      const instruments = await this.getCachedCTraderSymbols(raw);
      const normalized = symbol.replace('/', '').toUpperCase();
      const match = instruments.find(s => s.symbolName.replace('/', '').toUpperCase() === normalized);
      if (!match) throw new BrokerError('INVALID_SYMBOL', `cTrader symbol ${symbol} was not found in the authenticated account symbol list.`, 'CTRADER', this.environment);
      return await fetchCTraderTrendbars(
        raw.ctidTraderAccountId,
        match.symbolId,
        timeframe,
        limit,
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive,
        match.digits
      );
    } catch (err: any) {
      throw normalizeBrokerError(err, 'CTRADER', this.environment);
    }
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    try {
      const raw = await this.resolveRawAccount();
      const symbols = await this.getCachedCTraderSymbols(raw);
      const normalized = symbol.replace('/', '').toUpperCase();
      const match = symbols.find(s => s.symbolName.replace('/', '').toUpperCase() === normalized);
      if (!match) {
        throw new BrokerError('INVALID_SYMBOL', `cTrader symbol ${symbol} was not found in the authenticated account symbol list.`, 'CTRADER', this.environment);
      }

      let bid: number | undefined;
      let ask: number | undefined;
      let timestamp = Date.now();
      let quoteStatus: NormalizedQuote['status'] = 'STALE';

      try {
        const quote = await fetchLiveCTraderQuote(
          raw.ctidTraderAccountId,
          match.symbolId,
          match.symbolName,
          this.config.clientId!,
          this.config.clientSecret!,
          this.config.accessToken!,
          raw.isLive,
          match.digits
        );
        if (quote.bid !== undefined && quote.ask !== undefined && quote.bid > 0 && quote.ask >= quote.bid) {
          bid = quote.bid;
          ask = quote.ask;
          timestamp = quote.timestamp || Date.now();
          quoteStatus = 'FRESH';
        }
      } catch {
        // Real-time spot event unavailable (e.g. closed/quiet market session) - fallback to authoritative latest trendbar
        const bars = await fetchCTraderTrendbars(
          raw.ctidTraderAccountId,
          match.symbolId,
          '1M',
          5,
          this.config.clientId!,
          this.config.clientSecret!,
          this.config.accessToken!,
          raw.isLive,
          match.digits
        );
        if (bars.length > 0) {
          const lastBar = bars[bars.length - 1];
          const spreadDiff = match.digits === 3 || match.digits === 5 ? 0.00015 : 0.0015;
          bid = lastBar.close;
          ask = Number((lastBar.close + spreadDiff).toFixed(match.digits));
          timestamp = lastBar.timestamp || Date.now();
          // Historical trendbar fallback is display/analysis data only.
          // It must never be labeled FRESH because the live order safety gate
          // requires an actual executable spot quote.
          quoteStatus = 'DELAYED';
        }
      }

      if (bid === undefined || ask === undefined || bid <= 0 || ask <= 0 || ask < bid) {
        throw new BrokerError('STALE_DATA', `cTrader did not provide a valid bid/ask for ${symbol}.`, 'CTRADER', this.environment);
      }

      return {
        symbol,
        bid: Number(bid.toFixed(match.digits)),
        ask: Number(ask.toFixed(match.digits)),
        spread: Number((ask - bid).toFixed(match.digits)),
        timestamp,
        source: quoteStatus === 'FRESH' ? 'CTRADER_OPEN_API' : 'CTRADER_HISTORICAL_CLOSE',
        environment: this.environment,
        status: quoteStatus
      };
    } catch (err: any) {
      throw normalizeBrokerError(err, 'CTRADER', this.environment);
    }
  }

  async getInstruments(): Promise<BrokerInstrument[]> {
    const raw = await this.resolveRawAccount();
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const allowed = new Set(FOREX_PAIRS.map(p => p.symbol.replace('/', '').toUpperCase()));
    return symbols.filter(s => allowed.has(s.symbolName.replace('/', '').toUpperCase())).map(s => {
      const p = FOREX_PAIRS.find(x => x.symbol.replace('/', '').toUpperCase() === s.symbolName.replace('/', '').toUpperCase());
      if (!p) throw new BrokerError('INVALID_SYMBOL', `Unsupported cTrader symbol ${s.symbolName}`, 'CTRADER', this.environment);
      // cTrader Open API represents Forex volume in protocol cents:
      // 1 protocol unit = 0.01 base-currency unit.
      // Example: protocol volume 1000 = 10.00 base-currency units.
      // Normalize the broker's authoritative min/max/step values into the
      // common base-currency-unit representation used by Goldcrest.
      //
      // When cTrader omits a boundary, use the API's smallest representable
      // unit (0.01) for min/step and an unbounded maximum. No fabricated
      // 1000-unit minimum is introduced.
      const minQuantity = s.minVolume
        ? Number(s.minVolume) / 100
        : 0.01;
      const maxQuantity = s.maxVolume
        ? Number(s.maxVolume) / 100
        : Number.MAX_SAFE_INTEGER;
      const stepQuantity = s.stepVolume
        ? Number(s.stepVolume) / 100
        : 0.01;

      return {
      symbol: p.symbol,
      market: 'FOREX',
      pipSize: p.pipSize,
      minQuantity,
      maxQuantity,
      stepQuantity,
      // Use the broker's authoritative symbol precision when available.
      // The static instrument catalog is only a fallback; cTrader may expose
      // 3 digits for JPY crosses and 5 for most non-JPY FX pairs.
      digits: Number.isInteger(Number(s.digits)) && Number(s.digits) >= 0
        ? Number(s.digits)
        : p.digits,
      supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP'],
      baseCurrency: p.symbol.split('/')[0],
      quoteCurrency: p.symbol.split('/')[1],
      brokerInstrumentId: String(s.symbolId)
    };
    });
  }

  async getInstrument(symbol: string): Promise<BrokerInstrument | null> {
    const instruments = await this.getInstruments();
    const normalized = symbol.replace('/', '').toUpperCase();
    return instruments.find(i => i.symbol.replace('/', '').toUpperCase() === normalized) || null;
  }

  /**
   * Guarded capability used exclusively by the autonomous execution engine.
   * The engine performs the shared live safety/readiness gates before calling
   * this method; the adapter still enforces LIVE-only execution and reuses the
   * authoritative cTrader order submission path.
   */
  async placeAutonomousOrder(order: OrderRequest): Promise<NormalizedOrder> {
    if (!this.isLive) {
      throw new BrokerError('ENVIRONMENT_MISMATCH', 'Autonomous execution is available only for cTrader LIVE.', 'CTRADER', this.environment);
    }
    return this.placeOrder(order);
  }

  async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    this.syncConfig();
    this.validateCredentials();

    if (!this.isLive) {
      throw new BrokerError('ENVIRONMENT_MISMATCH', 'Autonomous execution is available only for cTrader LIVE.', 'CTRADER', this.environment);
    }
    this.validateOrderTypeSupport(order.orderType, ['MARKET', 'LIMIT', 'STOP']);

    if (order.market !== 'FOREX') {
      throw new BrokerError(
        'INVALID_SYMBOL',
        `cTrader adapter only supports FOREX market, attempted ${order.market}`,
        'CTRADER',
        this.environment
      );
    }

    const account = await this.getAccount();
    const effectivePermissions = account.permissions || [];
    if (!effectivePermissions.includes('TRADE')) {
      const scopeDescription = effectivePermissions.includes('CLOSE_ONLY')
        ? 'the cTrader account is CLOSE_ONLY'
        : 'the cTrader access token/account is view-only';
      throw new BrokerError(
        'PERMISSION_DENIED',
        `cTrader TRADE permission required: ${scopeDescription}. Re-authorize Goldcrest with the cTrader "trading" scope and ensure the account has FULL_ACCESS trading rights.`,
        'CTRADER',
        this.environment
      );
    }

    const raw = await this.resolveRawAccount();
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const normalizedSymbol = order.symbol.replace('/', '').toUpperCase();
    const symbol = symbols.find(s => s.symbolName.replace('/', '').toUpperCase() === normalizedSymbol);
    if (!symbol) {
      throw new BrokerError('INVALID_SYMBOL', `cTrader symbol ${order.symbol} was not found in the authenticated account symbol list.`, 'CTRADER', this.environment);
    }

    const clientOrderId = (order.signalId || order.strategyId || `gc-${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 50) || `gc-${Date.now()}`;
    const submitted = await submitLiveCTraderOrder(
      raw.ctidTraderAccountId,
      symbol.symbolId,
      order.symbol,
      order.orderType as 'MARKET' | 'LIMIT' | 'STOP',
      order.side,
      order.quantity,
      order.price,
      order.stopLoss,
      order.takeProfit,
      clientOrderId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );

    if (submitted.status === 'REJECTED') {
      throw new BrokerError('ORDER_REJECTED', 'cTrader rejected the live order.', 'CTRADER', this.environment);
    }

    const brokerOrderId = String(submitted.orderId);
    const normalized: NormalizedOrder = {
      id: `ctrader-${brokerOrderId}`,
      broker: 'CTRADER',
      environment: this.environment,
      market: 'FOREX',
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      quantity: order.quantity,
      price: submitted.executionPrice ?? order.price,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      status: submitted.status,
      filledQuantity: submitted.executedVolume ?? 0,
      averageFillPrice: submitted.executionPrice,
      commission: undefined,
      timestamp: Date.now(),
      brokerOrderId,
      clientOrderId,
      strategyId: order.strategyId,
      signalId: order.signalId
    };

    this.logAction('PLACE_ORDER', 'SUCCESS', this.config.accountId || '', {
      symbol: order.symbol,
      quantity: order.quantity
    });

    return normalized;
  }

  async modifyOrder(orderId: string, modifications: OrderModification): Promise<NormalizedOrder> {
    this.syncConfig();
    this.validateCredentials();
    if (!this.isLive) throw new BrokerError('ENVIRONMENT_MISMATCH', 'cTrader lifecycle actions require LIVE.', 'CTRADER', this.environment);
    const raw = await this.resolveRawAccount();
    const brokerId = Number(String(orderId).replace(/^ctrader-/, ''));
    if (!Number.isSafeInteger(brokerId) || brokerId <= 0) throw new BrokerError('ORDER_REJECTED', 'Invalid cTrader broker order ID.', 'CTRADER', this.environment);

    const state = await fetchCTraderReconcileState(raw.ctidTraderAccountId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    const brokerOrder = state.orders.find((o: any) => Number(o.orderId) === brokerId);
    if (!brokerOrder) throw new BrokerError('ORDER_REJECTED', 'cTrader pending order was not found in authoritative broker state.', 'CTRADER', this.environment);

    const brokerOrderType = String(brokerOrder.orderType || '').toUpperCase();
    const result = await amendLiveCTraderOrder(raw.ctidTraderAccountId, brokerId, {
      volume: modifications.quantity,
      limitPrice: brokerOrderType.includes('LIMIT') && modifications.price !== undefined
        ? normalizePriceToThreeDigits(Number(modifications.price))
        : undefined,
      stopPrice: brokerOrderType.includes('STOP') && modifications.price !== undefined
        ? normalizePriceToThreeDigits(Number(modifications.price))
        : undefined,
      stopLoss: modifications.stopLoss !== undefined && modifications.stopLoss > 0
        ? normalizePriceToThreeDigits(Number(modifications.stopLoss))
        : modifications.stopLoss,
      takeProfit: modifications.takeProfit !== undefined && modifications.takeProfit > 0
        ? normalizePriceToThreeDigits(Number(modifications.takeProfit))
        : modifications.takeProfit
    }, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);

    if (![2,3,4].includes(result.executionType)) {
      throw new BrokerError('ORDER_REJECTED', 'cTrader did not confirm the order amendment.', 'CTRADER', this.environment);
    }

    const refreshed = await this.getOpenOrders();
    const updated = refreshed.find(o => Number(o.brokerOrderId) === brokerId);
    if (updated) return updated;
    throw new BrokerError('ORDER_REJECTED', 'cTrader accepted the amendment but authoritative order state did not contain the order.', 'CTRADER', this.environment);
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    this.syncConfig();
    this.validateCredentials();
    if (!this.isLive) throw new BrokerError('ENVIRONMENT_MISMATCH', 'cTrader lifecycle actions require LIVE.', 'CTRADER', this.environment);
    const raw = await this.resolveRawAccount();
    const brokerId = Number(String(orderId).replace(/^ctrader-/, ''));
    if (!Number.isSafeInteger(brokerId) || brokerId <= 0) throw new BrokerError('ORDER_REJECTED', 'Invalid cTrader broker order ID.', 'CTRADER', this.environment);

    const state = await fetchCTraderReconcileState(raw.ctidTraderAccountId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    if (!state.orders.some((o: any) => Number(o.orderId) === brokerId)) return false;

    const result = await cancelLiveCTraderOrder(raw.ctidTraderAccountId, brokerId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    if (result.executionType !== 5) throw new BrokerError('ORDER_REJECTED', 'cTrader did not confirm order cancellation.', 'CTRADER', this.environment);
    return true;
  }

  async closePosition(positionId: string, quantity?: number): Promise<boolean> {
    this.syncConfig();
    this.validateCredentials();
    if (!this.isLive) throw new BrokerError('ENVIRONMENT_MISMATCH', 'cTrader lifecycle actions require LIVE.', 'CTRADER', this.environment);
    const raw = await this.resolveRawAccount();
    const brokerId = Number(String(positionId).replace(/^ctrader-/, ''));
    if (!Number.isSafeInteger(brokerId) || brokerId <= 0) throw new BrokerError('ORDER_REJECTED', 'Invalid cTrader position ID.', 'CTRADER', this.environment);

    const state = await fetchCTraderReconcileState(raw.ctidTraderAccountId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    const position = state.positions.find((p: any) => Number(p.positionId) === brokerId);
    if (!position) return false;
    const rawVolume = Number(position.tradeData?.volume ?? position.volume ?? 0);
    const available = rawVolume / 100;
    const closeQty = quantity === undefined ? available : Math.min(Number(quantity), available);
    if (!Number.isFinite(closeQty) || closeQty <= 0) throw new BrokerError('INVALID_QUANTITY', 'Invalid cTrader close quantity.', 'CTRADER', this.environment);

    const result = await closeLiveCTraderPosition(raw.ctidTraderAccountId, brokerId, closeQty, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    if (![2,3,11].includes(result.executionType)) throw new BrokerError('ORDER_REJECTED', 'cTrader did not confirm the position close request.', 'CTRADER', this.environment);
    return true;
  }


  async getOrderStatus(orderId: string, requestedQuantity?: number): Promise<NormalizedOrder> {
    this.syncConfig();
    this.validateCredentials();
    const raw = await this.resolveRawAccount();
    const brokerId = Number(String(orderId).replace(/^ctrader-/, ''));
    if (!Number.isSafeInteger(brokerId) || brokerId <= 0) {
      throw new BrokerError('ORDER_REJECTED', 'Invalid cTrader broker order ID.', 'CTRADER', this.environment);
    }

    const state = await fetchCTraderReconcileState(raw.ctidTraderAccountId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    const liveOrder = state.orders.find((o: any) => Number(o.orderId) === brokerId);
    if (liveOrder) {
      const orders = await this.getOpenOrders();
      const normalized = orders.find(o => Number(o.brokerOrderId) === brokerId);
      // A pending order has no execution events to reconcile. Once any volume
      // is filled, continue to the authoritative deal ledger so every broker
      // execution can be persisted by its native deal ID.
      if (normalized && Number(normalized.filledQuantity || 0) <= 0) return normalized;
    }

    let historicalOrderStatus: number | undefined;
    let historicalOrder: any | null = null;
    let matchingDeals: any[] = [];
    try {
      const details = await fetchCTraderOrderDetails(
        raw.ctidTraderAccountId,
        brokerId,
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive
      );
      if (details.order) {
        historicalOrder = details.order;
        historicalOrderStatus = Number(details.order.orderStatus);
        matchingDeals = Array.isArray(details.deals) ? details.deals : [];
      }
    } catch {
      // Fall back to the deal history endpoint below. The deal ledger still
      // provides authoritative fill quantities and prices when order details
      // are temporarily unavailable.
    }

    if (matchingDeals.length === 0 && !historicalOrder) {
      const deals = await fetchCTraderDeals(
        raw.ctidTraderAccountId,
        Date.now() - 7 * 24 * 60 * 60 * 1000,
        Date.now(),
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive
      );
      matchingDeals = deals
        .filter((d: any) => Number(d.orderId) === brokerId)
        .sort((a: any, b: any) => Number(a.executionTimestamp || a.createTimestamp || 0) - Number(b.executionTimestamp || b.createTimestamp || 0));
    }

    if (matchingDeals.length === 0 && !historicalOrder) {
      throw new BrokerError('ORDER_REJECTED', `cTrader order ${brokerId} was not found in authoritative broker state.`, 'CTRADER', this.environment);
    }

    // One cTrader order can produce multiple execution deals when liquidity
    // fills it in pieces. Aggregate the authoritative deals rather than using
    // only the latest deal, otherwise a later partial fill can overwrite the
    // cumulative fill with a smaller quantity.
    const brokerReportedVolume = matchingDeals.reduce(
      (sum: number, deal: any) => sum + Math.max(0, Number(deal.volume || 0)),
      0
    ) / 100;
    const requestedVolume = Number(requestedQuantity || 0) > 0
      ? Number(requestedQuantity)
      : brokerReportedVolume;
    const filledVolume = matchingDeals.reduce(
      (sum: number, deal: any) => sum + Math.max(0, Number(deal.filledVolume || 0)),
      0
    ) / 100;
    const weightedPriceNumerator = matchingDeals.reduce(
      (sum: number, deal: any) => {
        const filled = Math.max(0, Number(deal.filledVolume || 0)) / 100;
        const executionPrice = Number(deal.executionPrice || 0);
        return sum + (filled > 0 && executionPrice > 0 ? filled * executionPrice : 0);
      },
      0
    );
    const averageFillPrice = filledVolume > 0 && weightedPriceNumerator > 0
      ? weightedPriceNumerator / filledVolume
      : undefined;
    const latestDeal = matchingDeals.length > 0
      ? matchingDeals[matchingDeals.length - 1]
      : {
          symbolId: historicalOrder?.tradeData?.symbolId,
          tradeSide: historicalOrder?.tradeData?.tradeSide,
          executionPrice: historicalOrder?.executionPrice,
          executionTimestamp: historicalOrder?.utcLastUpdateTimestamp || historicalOrder?.tradeData?.openTimestamp,
          dealStatus: historicalOrderStatus,
          dealId: undefined,
          commission: undefined
        };
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const symbolInfo = symbols.find(s => Number(s.symbolId) === Number(latestDeal.symbolId));
    const normalizedSymbol = symbolInfo?.symbolName || String(latestDeal.symbolId);
    const fillEvents: NormalizedFill[] = matchingDeals
      .filter((deal: any) => Number(deal.filledVolume || 0) > 0 && deal.dealId !== undefined && Number(deal.executionPrice || 0) > 0)
      .map((deal: any) => ({
        brokerFillId: String(deal.dealId),
        brokerOrderId: String(brokerId),
        brokerPositionId: deal.positionId !== undefined ? String(deal.positionId) : undefined,
        quantity: Math.max(0, Number(deal.filledVolume || 0)) / 100,
        price: Number(deal.executionPrice),
        commission: Number(deal.commission || 0) || undefined,
        timestamp: Number(deal.executionTimestamp || deal.utcLastUpdateTimestamp || deal.createTimestamp || Date.now())
      }));
    const hasFilledDeal = matchingDeals.some((d: any) => Number(d.dealStatus) === 2 || Number(d.filledVolume || 0) > 0);
    const hasRejectedDeal = matchingDeals.some((d: any) => [4, 5, 6, 7].includes(Number(d.dealStatus)));
    const statusFromOrder = historicalOrderStatus === 2
      ? 'FILLED'
      : historicalOrderStatus === 3
        ? 'REJECTED'
        : historicalOrderStatus === 4
          ? 'EXPIRED'
          : historicalOrderStatus === 5
            ? 'CANCELLED'
            : historicalOrderStatus === 1
              ? 'ACCEPTED'
              : undefined;
    const status = statusFromOrder || (
      requestedVolume > 0 && filledVolume >= requestedVolume
        ? 'FILLED'
        : filledVolume > 0
          ? 'PARTIALLY_FILLED'
          : hasRejectedDeal
            ? 'REJECTED'
            : hasFilledDeal
              ? 'PARTIALLY_FILLED'
              : 'ACCEPTED'
    );

    return {
      id: String(brokerId),
      broker: 'CTRADER',
      environment: this.environment,
      market: 'FOREX',
      symbol: normalizedSymbol,
      side: Number(latestDeal.tradeSide) === 2 ? 'SELL' : 'BUY',
      orderType: 'MARKET',
      quantity: requestedVolume > 0 ? requestedVolume : filledVolume,
      price: Number(latestDeal.executionPrice || 0) > 0 ? Number(latestDeal.executionPrice) : undefined,
      status,
      filledQuantity: filledVolume,
      averageFillPrice,
      commission: matchingDeals.reduce((sum: number, deal: any) => sum + (Number(deal.commission || 0) || 0), 0) || undefined,
      timestamp: Number(latestDeal.executionTimestamp || latestDeal.utcLastUpdateTimestamp || Date.now()),
      brokerOrderId: String(brokerId),
      fillEvents
    };
  }
}
