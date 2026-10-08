import crypto from 'crypto';
import { generateFirstLiveFingerprint, maskReservationToken, hashReservationToken } from '../../../services/firstLiveService';
import { executeQuery } from '../../../database/db';
import { BaseBrokerAdapter } from '../BaseBrokerAdapter';
import { killSwitch } from '../../safety/KillSwitch';
import {
  BrokerAccountInfo,
  BrokerInstrument,
  BrokerStatus,
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
import {
  FivePaisaConfig,
  FivePaisaPlaceOrderRequest,
  FivePaisaPlaceOrderResponse,
  FivePaisaOrderBookEntry,
  FivePaisaNetPosition
} from './types';
import { getIndianUnderlyingConfig } from '../../../markets/india_equity/underlyings';
import { Candle, OptionChainStrikeRow, OptionChainSummary, OptionContract } from '../../../markets/common/types';
import { evaluateIndianUnderlying, IndianUnderlyingAnalysis } from '../../../markets/india_equity/indiaEngine';
import { calculateBlackScholesGreeks } from '../../../markets/india_options/greeks';
import { generateExpiries } from '../../../markets/india_options/expiryEngine';
import { getSystemConfig } from '../../../services/configService';

function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = base32.toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
  let bits = '';
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val === -1) throw new Error('Invalid base32 character in TOTP secret: ' + cleaned[i]);
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret: string, step = 30): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / step);
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;

  return code.toString().padStart(6, '0');
}

export abstract class FivePaisaBrokerAdapter extends BaseBrokerAdapter {
  readonly broker: BrokerType = 'FIVE_PAISA';
  abstract readonly environment: TradingEnvironment;
  abstract readonly isLive: boolean;

  protected config: FivePaisaConfig;
  protected openPositions: Map<string, NormalizedPosition> = new Map();
  protected openOrders: Map<string, NormalizedOrder> = new Map();

  private static rateLimitedUntil: number = 0;
  private static rateLimitState: {
    code: 'RATE_LIMITED';
    timestamp: number;
    retryAfterMs: number;
    provider: string;
    endpoint: string;
    correlationId: string;
    message: string;
  } | null = null;
  private static inFlightTotpPromise: Promise<string> | null = null;

  public static isRateLimited(): boolean {
    return Date.now() < FivePaisaBrokerAdapter.rateLimitedUntil;
  }

  public static getRateLimitState() {
    if (Date.now() < FivePaisaBrokerAdapter.rateLimitedUntil && FivePaisaBrokerAdapter.rateLimitState) {
      const remainingMs = FivePaisaBrokerAdapter.rateLimitedUntil - Date.now();
      return {
        ...FivePaisaBrokerAdapter.rateLimitState,
        remainingMs,
        remainingSeconds: Math.ceil(remainingMs / 1000)
      };
    }
    return null;
  }

  public static setRateLimitedCooldown(cooldownMs: number = 60_000, message?: string): void {
    FivePaisaBrokerAdapter.rateLimitedUntil = Date.now() + cooldownMs;
    FivePaisaBrokerAdapter.rateLimitState = {
      code: 'RATE_LIMITED',
      timestamp: Date.now(),
      retryAfterMs: cooldownMs,
      provider: '5paisa',
      endpoint: '/VendorsAPI/Service1.svc/TOTPLogin',
      correlationId: `rl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      message: message || '5paisa OpenAPI rate limited login attempts (HTTP 429).'
    };
  }

  public static resetRateLimitForTesting(): void {
    FivePaisaBrokerAdapter.rateLimitedUntil = 0;
    FivePaisaBrokerAdapter.rateLimitState = null;
    FivePaisaBrokerAdapter.inFlightTotpPromise = null;
  }
  private scripMasterCache: { expiresAt: number; rows: any[] } | null = null;
  private static readonly SCRIP_MASTER_TTL_MS = 10 * 60 * 1000;
  private scripMasterFetchInFlight: Promise<any[]> | null = null;

  private static readonly BUILT_IN_SCRIP_MASTER: any[] = [
    // NSE Cash Indices
    { ScripCode: 999920000, ScripData: 'NIFTY', Name: 'NIFTY', Root: 'NIFTY', FullName: 'NIFTY 50', Exch: 'N', ExchType: 'C', LotSize: 75 },
    { ScripCode: 999920005, ScripData: 'BANKNIFTY', Name: 'BANKNIFTY', Root: 'BANKNIFTY', FullName: 'NIFTY BANK', Exch: 'N', ExchType: 'C', LotSize: 30 },
    { ScripCode: 999920041, ScripData: 'FINNIFTY', Name: 'FINNIFTY', Root: 'FINNIFTY', FullName: 'NIFTY FINANCIAL SERVICES', Exch: 'N', ExchType: 'C', LotSize: 65 },
    { ScripCode: 999920043, ScripData: 'MIDCPNifty', Name: 'MIDCPNifty', Root: 'MIDCPNIFTY', FullName: 'NIFTY MIDCAP SELECT', Exch: 'N', ExchType: 'C', LotSize: 120 },
    // BSE Cash Index
    { ScripCode: 999901, ScripData: 'SENSEX', Name: 'SENSEX', Root: 'SENSEX', FullName: 'BSE SENSEX 30', Exch: 'B', ExchType: 'C', LotSize: 10 },

    // Core NSE Cash Equities
    { ScripCode: 2885, ScripData: 'RELIANCE', Name: 'RELIANCE', Root: 'RELIANCE', FullName: 'RELIANCE INDUSTRIES LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 1333, ScripData: 'HDFCBANK', Name: 'HDFCBANK', Root: 'HDFCBANK', FullName: 'HDFC BANK LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 11536, ScripData: 'TCS', Name: 'TCS', Root: 'TCS', FullName: 'TATA CONSULTANCY SERVICES LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 1594, ScripData: 'INFY', Name: 'INFY', Root: 'INFY', FullName: 'INFOSYS LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 4963, ScripData: 'ICICIBANK', Name: 'ICICIBANK', Root: 'ICICIBANK', FullName: 'ICICI BANK LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 3045, ScripData: 'SBIN', Name: 'SBIN', Root: 'SBIN', FullName: 'STATE BANK OF INDIA', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 10604, ScripData: 'BHARTIARTL', Name: 'BHARTIARTL', Root: 'BHARTIARTL', FullName: 'BHARTI AIRTEL LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 1660, ScripData: 'ITC', Name: 'ITC', Root: 'ITC', FullName: 'ITC LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 1922, ScripData: 'KOTAKBANK', Name: 'KOTAKBANK', Root: 'KOTAKBANK', FullName: 'KOTAK MAHINDRA BANK LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 11483, ScripData: 'LT', Name: 'LT', Root: 'LT', FullName: 'LARSEN & TOUBRO LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },
    { ScripCode: 5900, ScripData: 'AXISBANK', Name: 'AXISBANK', Root: 'AXISBANK', FullName: 'AXIS BANK LTD', Exch: 'N', ExchType: 'C', LotSize: 1 },

    // Core BSE Cash Equities
    { ScripCode: 500325, ScripData: 'RELIANCE', Name: 'RELIANCE', Root: 'RELIANCE', FullName: 'RELIANCE INDUSTRIES LTD', Exch: 'B', ExchType: 'C', LotSize: 1 },
    { ScripCode: 500180, ScripData: 'HDFCBANK', Name: 'HDFCBANK', Root: 'HDFCBANK', FullName: 'HDFC BANK LTD', Exch: 'B', ExchType: 'C', LotSize: 1 },
    { ScripCode: 532540, ScripData: 'TCS', Name: 'TCS', Root: 'TCS', FullName: 'TATA CONSULTANCY SERVICES LTD', Exch: 'B', ExchType: 'C', LotSize: 1 },
    { ScripCode: 500209, ScripData: 'INFY', Name: 'INFY', Root: 'INFY', FullName: 'INFOSYS LTD', Exch: 'B', ExchType: 'C', LotSize: 1 }
  ];
  private accountData: BrokerAccountInfo | null = null;
  private static readonly ACCOUNT_DATA_CACHE_TTL_MS = 60 * 1000;
  private accountFetchInFlight: Promise<BrokerAccountInfo> | null = null;

  constructor(config: FivePaisaConfig) {
    super();
    this.config = config;
  }

  protected getApiHost(): string {
    if (this.config.apiHost) return this.config.apiHost;
    return this.isLive
      ? 'https://Openapi.5paisa.com'
      : 'https://dev-openapi.5paisa.com';
  }

  protected syncConfig(): void {
    // Subclasses can implement dynamic configuration synchronization.
  }

  protected validateCredentials(): void {
    this.syncConfig();
    const { appName, appSource, userId, userKey, encryptionKey } = this.config;
    if (!appName || !appSource || !userId || !userKey || !encryptionKey) {
      this.status = 'DISCONNECTED';
      throw new BrokerError(
        'AUTHENTICATION_FAILED',
        `5paisa ${this.environment} credentials missing. Required: App Name, App Source, User ID, User Key, and Encryption Key.`,
        'FIVE_PAISA',
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
      throw normalizeBrokerError(err, 'FIVE_PAISA', this.environment);
    }
  }

  async disconnect(): Promise<void> {
    this.status = 'DISCONNECTED';
    this.logAction('DISCONNECT', 'SUCCESS', this.config.clientCode || this.config.userId || '');
  }

  /**
   * Authenticates with 5paisa using TOTP (Time-based One-Time Password) and 2FA PIN
   * Follows official 5paisa OAuth flow: TOTPLogin -> GetAccessToken
   */
  async loginWithTotp(totpCode?: string, pinCode?: string): Promise<string> {
    const now = Date.now();
    if (FivePaisaBrokerAdapter.isRateLimited()) {
      const state = FivePaisaBrokerAdapter.getRateLimitState();
      const remainingSec = state?.remainingSeconds || 60;
      this.status = 'RATE_LIMITED';
      throw new Error(`RATE_LIMITED: 5paisa authentication is temporarily rate-limited. Cooldown active for another ${remainingSec}s. Please wait before attempting authentication again.`);
    }

    if (FivePaisaBrokerAdapter.inFlightTotpPromise) {
      return FivePaisaBrokerAdapter.inFlightTotpPromise;
    }

    const authPromise = this.performTotpLogin(totpCode, pinCode);
    FivePaisaBrokerAdapter.inFlightTotpPromise = authPromise;
    try {
      return await authPromise;
    } finally {
      FivePaisaBrokerAdapter.inFlightTotpPromise = null;
    }
  }

  private async performTotpLogin(totpCode?: string, pinCode?: string): Promise<string> {
    this.validateCredentials();

    let totp = totpCode !== undefined ? totpCode : undefined;
    if (!totp && this.config.totpSecret) {
      try {
        totp = generateTOTP(this.config.totpSecret);
      } catch (e: any) {
        throw new Error(`Failed to generate TOTP from secret: ${e.message}`);
      }
    }

    const pin = pinCode !== undefined ? pinCode : (this.config.pin || this.config.password);

    if (!totp) {
      throw new Error('TOTP 6-digit code or TOTP Secret is required for 5paisa authentication');
    }
    if (!pin) {
      throw new Error('2FA PIN is required for 5paisa authentication');
    }

    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/TOTPLogin`;
    const payload = {
      head: {
        Key: this.config.userKey
      },
      body: {
        Email_ID: this.config.clientCode || this.config.userId,
        TOTP: totp,
        PIN: pin
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 429) {
      FivePaisaBrokerAdapter.setRateLimitedCooldown(60_000, '5paisa OpenAPI rate limited login attempts (HTTP 429).');
      this.status = 'RATE_LIMITED';
      throw new Error('RATE_LIMITED: 5paisa OpenAPI is rate-limiting login attempts (HTTP 429). Please wait 30–60 seconds before submitting a new TOTP code.');
    }

    if (!res.ok) {
      throw new Error(`5paisa TOTPLogin HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json().catch(() => ({}));
    const message = data?.body?.Message || data?.Message || '';
    if (data?.body?.Status === false && (String(message).toUpperCase().includes('RATE') || String(message).toUpperCase().includes('LIMIT') || String(message).toUpperCase().includes('TOO MANY'))) {
      FivePaisaBrokerAdapter.setRateLimitedCooldown(60_000, `5paisa API rate limited: ${message}`);
      this.status = 'RATE_LIMITED';
      throw new Error(`RATE_LIMITED: 5paisa API rate limited: ${message}`);
    }

    if (data?.body?.RequestToken) {
      const token = await this.exchangeRequestToken(data.body.RequestToken);
      FivePaisaBrokerAdapter.rateLimitedUntil = 0;
      FivePaisaBrokerAdapter.rateLimitState = null;
      this.status = 'CONNECTED';
      return token;
    }
    throw new Error(message || 'Failed to obtain RequestToken from 5paisa TOTPLogin');
  }

  /**
   * Exchanges a 5paisa RequestToken for a daily AccessToken
   */
  async exchangeRequestToken(requestToken: string): Promise<string> {
    this.validateCredentials();

    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/GetAccessToken`;
    const payload = {
      head: {
        Key: this.config.userKey
      },
      body: {
        RequestToken: requestToken,
        EncryKey: this.config.encryptionKey,
        UserId: this.config.userId
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`5paisa GetAccessToken HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (data?.body?.AccessToken) {
      this.config.accessToken = data.body.AccessToken;
      this.status = 'CONNECTED';
      return data.body.AccessToken;
    }
    throw new Error(data?.body?.Message || 'Failed to exchange RequestToken for 5paisa AccessToken');
  }

  /**
   * Fetches real account margin and balances from 5paisa OpenAPI /V4/Margin
   */
  async fetchMarginFromApi(): Promise<{
    balance: number;
    equity: number;
    availableMargin: number;
    usedMargin: number;
    freeMargin: number;
    raw: any;
  }> {
    this.syncConfig();

    // If no access token, try auto-login if totpSecret and pin are present and not rate-limited
    if (!this.config.accessToken && this.config.totpSecret && !FivePaisaBrokerAdapter.isRateLimited()) {
      try {
        await this.loginWithTotp();
      } catch (authErr: any) {
        throw new Error(`5paisa automated TOTP login failed: ${authErr.message}`);
      }
    }

    if (!this.config.accessToken) {
      throw new Error(
        '5paisa API requires an Access Token or TOTP session to fetch actual balance. Please configure your Access Token or TOTP Secret in Settings.'
      );
    }

    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V4/Margin`;
    const payload = {
      head: {
        appName: this.config.appName,
        appVer: '1.0',
        key: this.config.userKey,
        osName: 'WEB',
        requestCode: '5PMarginV3',
        userId: this.config.userId,
        password: this.config.password
      },
      body: {
        ClientCode: this.config.clientCode || this.config.userId
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.accessToken}`,
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      if (res.status === 401) {
        this.config.accessToken = undefined;
        if (this.config.totpSecret && !FivePaisaBrokerAdapter.isRateLimited()) {
          await this.loginWithTotp();
          return this.fetchMarginFromApi();
        }
        throw new Error('5paisa Access Token has expired or is invalid (HTTP 401). Please update your Access Token or TOTP session in Settings.');
      }
      throw new Error(`5paisa Margin API HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (data?.head?.Status !== 0 && data?.head?.StatusDescription) {
      const desc = data.head.StatusDescription.toLowerCase();
      if (desc.includes('token') || desc.includes('session') || desc.includes('unauthorized')) {
        this.config.accessToken = undefined;
        if (this.config.totpSecret && !FivePaisaBrokerAdapter.isRateLimited()) {
          await this.loginWithTotp();
          return this.fetchMarginFromApi();
        }
      }
      throw new Error(`5paisa Margin API Error: ${data.head.StatusDescription}`);
    }

    const equityMargin = data?.body?.EquityMargin;
    if (!equityMargin) {
      throw new Error(data?.body?.Message || 'No margin data returned from 5paisa API');
    }

    const m = Array.isArray(equityMargin) ? equityMargin[0] : equityMargin;
    const availableMargin = Number(m?.MarginAvailable ?? m?.NetAvailableMargin ?? m?.EquityMargin ?? 0);
    const usedMargin = Number(m?.MarginUtilized ?? 0);
    const cash = Number(m?.Cash ?? availableMargin);
    const collateral = Number(m?.Collateral ?? 0);
    const balance = cash;
    const equity = balance + collateral;

    return {
      balance,
      equity,
      availableMargin,
      usedMargin,
      freeMargin: availableMargin,
      raw: m
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      this.validateCredentials();

      const maskedClient = maskIdentifier(this.config.clientCode || this.config.userId);

      // Attempt to fetch actual live margin from 5paisa API
      let balance = 0;
      let equity = 0;

      try {
        const marginData = await this.fetchMarginFromApi();
        balance = marginData.balance;
        equity = marginData.equity;
        this.status = 'CONNECTED';
      } catch (marginErr: any) {
        this.status = 'AUTHENTICATION_FAILED';
        throw new Error(`5paisa API authentication required: ${marginErr.message}`);
      }

      const res: ConnectionTestResult = {
        broker: 'FIVE_PAISA',
        environment: this.environment,
        connected: true,
        account: maskedClient,
        accountType: 'LIVE',
        balance,
        equity,
        currency: 'INR',
        server: '5paisa-Xstream-OpenAPI-Live',
        permissions: ['NSE_EQUITY', 'NSE_FNO', 'BSE_EQUITY', 'BSE_FNO', 'MCX_COMMODITY'],
        timestamp: Date.now()
      };

      this.lastConnectionTest = res;
      this.logAction('TEST_CONNECTION', 'SUCCESS', this.config.clientCode || this.config.userId || '', {
        orderId: `ping_${Date.now() - start}ms`
      });

      return res;
    } catch (err: any) {
      const maskedClient = maskIdentifier(this.config.clientCode || this.config.userId);
      this.status = 'AUTHENTICATION_FAILED';
      this.lastError = err.message;
      const res: ConnectionTestResult = {
        broker: 'FIVE_PAISA',
        environment: this.environment,
        connected: false,
        account: maskedClient,
        accountType: 'LIVE',
        error: err.message,
        timestamp: Date.now(),
        latency: Date.now() - start
      };
      this.lastConnectionTest = res;
      this.logAction('TEST_CONNECTION', 'FAILURE', this.config.clientCode || this.config.userId || '', { error: err.message });
      return res;
    }
  }

  async getAccount(): Promise<BrokerAccountInfo> {
    const now = Date.now();
    if (
      this.accountData
      && now - Number(this.accountData.lastUpdate || 0) < FivePaisaBrokerAdapter.ACCOUNT_DATA_CACHE_TTL_MS
    ) {
      return this.accountData;
    }

    if (this.accountFetchInFlight) {
      return this.accountFetchInFlight;
    }

    this.accountFetchInFlight = (async () => {
      await this.authenticate();

      try {
        const margin = await this.fetchMarginFromApi();
        this.status = 'CONNECTED';

        const account: BrokerAccountInfo = {
          accountId: maskIdentifier(this.config.clientCode || this.config.userId || '5P_ACC'),
          accountType: 'LIVE',
          balance: margin.balance,
          equity: margin.equity,
          availableMargin: margin.availableMargin,
          usedMargin: margin.usedMargin,
          freeMargin: margin.freeMargin,
          currency: 'INR',
          broker: 'FIVE_PAISA',
          environment: this.environment,
          connectionStatus: this.status,
          server: '5paisa-Xstream-OpenAPI-Live',
          permissions: ['NSE_EQUITY', 'NSE_FNO', 'BSE_EQUITY', 'BSE_FNO'],
          lastUpdate: Date.now(),
          isLiveAccount: this.isLive
        };

        this.accountData = account;
        return account;
      } catch (err: any) {
        this.lastError = err.message;
        throw normalizeBrokerError(err, 'FIVE_PAISA', this.environment);
      }
    })().finally(() => {
      this.accountFetchInFlight = null;
    });

    return this.accountFetchInFlight;
  }
  async getBalance(): Promise<number> {
    const account = await this.getAccount();
    return account.balance;
  }

  async getEquity(): Promise<number> {
    const account = await this.getAccount();
    return account.equity;
  }

  async getMargin(): Promise<{ usedMargin: number; freeMargin: number; marginLevelPct?: number }> {
    const account = await this.getAccount();
    return {
      usedMargin: account.usedMargin,
      freeMargin: account.freeMargin,
      marginLevelPct: account.usedMargin > 0 ? (account.equity / account.usedMargin) * 100 : 999
    };
  }

  async getPositions(): Promise<NormalizedPosition[]> {
    await this.ensureActiveSession();
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/NetPositionNetWise`;
    const data = await this.postUserApi(url, '5PNPNWV1', { ClientCode: this.config.clientCode || this.config.userId });
    const rows: FivePaisaNetPosition[] = data?.body?.NetPositionDetail || [];
    if (!Array.isArray(rows)) throw new BrokerError('BROKER_UNAVAILABLE', '5paisa returned an invalid net-position response.', 'FIVE_PAISA', this.environment);
    return rows
      .filter(pos => Number(pos.NetQty || 0) !== 0)
      .map(pos => ({
        id: `5P_${pos.ScripCode}_${pos.OrderFor || 'C'}`,
        broker: 'FIVE_PAISA',
        environment: this.environment,
        market: (pos.ScripName?.includes('CE') || pos.ScripName?.includes('PE'))
          ? 'INDIAN_OPTIONS'
          : (pos.ExchType === 'D' ? 'INDIAN_FUTURES' : 'INDIAN_EQUITY'),
        symbol: pos.ScripName || String(pos.ScripCode),
        side: Number(pos.NetQty || 0) >= 0 ? 'BUY' : 'SELL',
        quantity: Math.abs(Number(pos.NetQty || 0)),
        entryPrice: Number(pos.NetQty || 0) >= 0 ? Number(pos.BuyAvgRate || 0) : Number(pos.SellAvgRate || 0),
        currentPrice: Number(pos.LTP || 0),
        unrealizedPnL: Number(pos.MTM || 0),
        realizedPnL: Number(pos.BookedPL || 0),
        currency: 'INR',
        timestamp: Date.now(),
        brokerPositionId: String(pos.ScripCode)
      }));
  }

  async getDailyRealizedPnL(): Promise<number> {
    await this.ensureActiveSession();
    const positions = await this.getPositions();
    return positions.reduce((sum, position) => {
      const value = Number(position.realizedPnL || 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }

  /**
   * Authoritative read-only helper to fetch order book details from 5paisa OpenAPI V4 OrderBook.
   * Strictly read-only; never touches order modification or cancellation endpoints.
   */
  private async fetchAuthoritativeOrderBook(): Promise<any[]> {
    await this.ensureActiveSession();
    if (!this.config.accessToken) {
      throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    }

    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V4/OrderBook`;
    const clientCode = this.config.clientCode || this.config.userId || '';
    const userKey = this.config.userKey || '';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify({
        head: {
          key: userKey,
          Key: userKey
        },
        body: {
          ClientCode: clientCode
        }
      })
    });

    if (!res.ok) {
      throw new BrokerError('BROKER_UNAVAILABLE', `5paisa OrderBook HTTP ${res.status}: ${res.statusText}`, 'FIVE_PAISA', this.environment);
    }

    const data = await res.json().catch(() => ({}));

    // Normalize head status
    const headStatusRaw = data?.head?.status ?? data?.head?.Status;
    if (headStatusRaw !== undefined && headStatusRaw !== null) {
      const headStatusNum = Number(headStatusRaw);
      if (Number.isFinite(headStatusNum) && headStatusNum !== 0) {
        const desc = data?.head?.statusDescription ?? data?.head?.StatusDescription ?? data?.head?.Message ?? '5paisa OrderBook request rejected.';
        throw new BrokerError('BROKER_UNAVAILABLE', String(desc), 'FIVE_PAISA', this.environment);
      }
    }

    const bodyStatusRaw = data?.body?.Status ?? data?.body?.status;
    const bodyStatus = bodyStatusRaw !== undefined && bodyStatusRaw !== null ? Number(bodyStatusRaw) : 0;
    const message = String(data?.body?.Message ?? data?.body?.message ?? '');

    // body.Status = 9 means invalid session / session expired
    if (bodyStatus === 9) {
      throw new BrokerError('AUTHENTICATION_FAILED', `5paisa session invalid or expired: ${message || 'Status 9'}`, 'FIVE_PAISA', this.environment);
    }

    // body.Status = 1 means no orders found for this client (valid successful empty order book)
    if (bodyStatus === 1) {
      return [];
    }

    // body.Status = 0 means success
    if (bodyStatus === 0) {
      const orders = data?.body?.OrderBookDetail;
      if (Array.isArray(orders)) {
        return orders;
      }
      if (orders === null || orders === undefined) {
        return [];
      }
      throw new BrokerError('BROKER_UNAVAILABLE', '5paisa returned an invalid order-book response structure.', 'FIVE_PAISA', this.environment);
    }

    // Defensive fallback: if message indicates no orders, return []
    if (message.toLowerCase().includes('no order')) {
      return [];
    }

    throw new BrokerError('BROKER_UNAVAILABLE', message || `5paisa OrderBook returned unexpected status ${bodyStatus}`, 'FIVE_PAISA', this.environment);
  }

  async getOpenOrders(): Promise<NormalizedOrder[]> {
    const orders = await this.fetchAuthoritativeOrderBook();
    return orders.map(o => this.normalizeBrokerOrder(o)).filter(o => o.status === 'PENDING' || o.status === 'ACCEPTED' || o.status === 'PARTIALLY_FILLED');
  }

  async getOrderHistory(): Promise<NormalizedOrder[]> {
    await this.ensureActiveSession();
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);

    // The order book is current order state. Historical execution records come
    // from 5paisa's TradeBook endpoint (5PTrdBkV1).
    const url = this.getApiHost() + '/VendorsAPI/Service1.svc/V1/TradeBook';
    const data = await this.postUserApi(url, '5PTrdBkV1', {
      ClientCode: this.config.clientCode || this.config.userId
    });
    const trades: any[] =
      data?.body?.TradeBookDetail ||
      data?.body?.TradeBook ||
      data?.body?.TradeBookDetailList ||
      [];
    if (!Array.isArray(trades)) {
      throw new BrokerError('BROKER_UNAVAILABLE', '5paisa returned an invalid trade-book response.', 'FIVE_PAISA', this.environment);
    }

    return trades.map((trade: any) => this.normalizeBrokerTrade(trade));
  }

  async getOrderHistoryRange(fromTimestamp: number, toTimestamp: number): Promise<NormalizedOrder[]> {
    const rows = await this.getOrderHistory();
    const from = Math.max(0, Number(fromTimestamp));
    const to = Math.max(from, Number(toTimestamp));
    return rows.filter(row => Number(row.timestamp) >= from && Number(row.timestamp) <= to);
  }

  private normalizeBrokerTrade(trade: any): NormalizedOrder {
    const price = Number(trade.TradePrice ?? trade.AveragePrice ?? trade.Price ?? trade.Rate ?? 0);
    const quantity = Math.abs(Number(trade.TradedQty ?? trade.TradeQty ?? trade.Quantity ?? trade.Qty ?? 0));
    const requestedQuantityRaw = Number(trade.OrderedQty ?? trade.OrderQty ?? trade.OrderQuantity ?? trade.RequestedQty ?? trade.QtyOrdered ?? 0);
    const requestedQuantity = Number.isFinite(requestedQuantityRaw) && requestedQuantityRaw > 0
      ? requestedQuantityRaw
      : undefined;
    const side = String(trade.BuySell ?? trade.OrderType ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const exchangeType = String(trade.ExchType ?? trade.ExchangeType ?? '').toUpperCase();
    const symbol = String(trade.ScripName ?? trade.ScripData ?? trade.ScripCode ?? '');
    const timestampRaw = trade.TradeTime ?? trade.OrderDateTime ?? trade.ExchangeTime;
    const parsedTimestamp = typeof timestampRaw === 'number'
      ? timestampRaw
      : Date.parse(String(timestampRaw || ''));
    const brokerFillId = String(trade.TradeID ?? trade.TradeId ?? trade.ExchTradeID ?? '');
    const brokerOrderId = String(trade.ExchOrderID ?? trade.OrderID ?? trade.RemoteOrderID ?? '');
    const fillEvents: NormalizedFill[] = brokerFillId && quantity > 0 && price > 0
      ? [{
          brokerFillId,
          brokerOrderId: brokerOrderId || undefined,
          quantity,
          price,
          commission: Number(trade.Brokerage ?? trade.BrokerageAmount ?? 0) || undefined,
          timestamp: Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 ? parsedTimestamp : Date.now()
        }]
      : [];
    return {
      id: brokerFillId || brokerOrderId || ('5P_TRADE_' + Date.now()),
      broker: 'FIVE_PAISA',
      environment: this.environment,
      market: symbol.includes('CE') || symbol.includes('PE')
        ? 'INDIAN_OPTIONS'
        : exchangeType === 'D' ? 'INDIAN_FUTURES' : 'INDIAN_EQUITY',
      symbol,
      side,
      orderType: 'MARKET',
      quantity,
      requestedQuantity,
      price: price > 0 ? price : undefined,
      status: requestedQuantity && quantity < requestedQuantity ? 'PARTIALLY_FILLED' : 'FILLED',
      filledQuantity: quantity,
      averageFillPrice: price > 0 ? price : undefined,
      commission: Number(trade.Brokerage ?? trade.BrokerageAmount ?? 0) || undefined,
      timestamp: Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 ? parsedTimestamp : Date.now(),
      brokerOrderId,
      fillEvents
    };
  }

  private async postUserApi(url: string, requestCode: string, body: Record<string, unknown>): Promise<any> {
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify({ head: this.getApiHead(requestCode), body })
    });
    if (!res.ok) throw new BrokerError('BROKER_UNAVAILABLE', `5paisa API HTTP ${res.status}: ${res.statusText}`, 'FIVE_PAISA', this.environment);
    const data = await res.json();
    const headStatusRaw = data?.head?.Status ?? data?.head?.status;
    if (headStatusRaw !== undefined && headStatusRaw !== null) {
      const headStatusNum = Number(headStatusRaw);
      if (Number.isFinite(headStatusNum) && headStatusNum !== 0) {
        const desc = data?.head?.StatusDescription || data?.head?.statusDescription || data?.head?.Message || '5paisa API request failed.';
        throw new BrokerError('BROKER_UNAVAILABLE', String(desc), 'FIVE_PAISA', this.environment);
      }
    }
    return data;
  }

  private normalizeBrokerOrder(o: any): NormalizedOrder {
    const side = String(o.OrderType || o.BuySell || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const qty = Number(o.Qty ?? o.OrderedQty ?? o.Quantity ?? 0);
    const filled = Number(o.TradedQty ?? o.FilledQty ?? o.TradedQuantity ?? 0);
    const statusText = String(o.OrderStatus || o.Status || '').toUpperCase();
    const status = statusText.includes('CANCEL') ? 'CANCELLED'
      : statusText.includes('REJECT') ? 'REJECTED'
      : statusText.includes('COMPLETE') || statusText.includes('TRADED') || statusText.includes('EXECUT') ? 'FILLED'
      : filled > 0 && qty > filled ? 'PARTIALLY_FILLED'
      : statusText.includes('PENDING') || statusText.includes('OPEN') ? 'PENDING'
      : 'ACCEPTED';
    const price = Number(o.Price ?? o.Rate ?? o.AveragePrice ?? 0);
    return {
      id: String(o.RemoteOrderID ?? o.OrderID ?? o.ExchOrderID ?? `5P_${Date.now()}`),
      broker: 'FIVE_PAISA',
      environment: this.environment,
      market: o.ExchType === 'D' ? 'INDIAN_FUTURES' : 'INDIAN_EQUITY',
      symbol: String(o.ScripName ?? o.ScripCode ?? ''),
      side,
      orderType: price > 0 ? 'LIMIT' : 'MARKET',
      quantity: qty,
      price,
      status,
      filledQuantity: filled,
      averageFillPrice: Number(o.AveragePrice ?? o.TradedPrice ?? price) || undefined,
      commission: Number(o.Brokerage ?? 0) || undefined,
      timestamp: Date.now(),
      brokerOrderId: String(o.ExchOrderID ?? o.OrderID ?? o.RemoteOrderID ?? ''),
    };
  }

  async getHistoricalCandles(symbol: string, timeframe = '15m', limit = 60) {
    await this.ensureActiveSession();
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    const allowed = new Set(['1m','5m','10m','15m','30m','60m','1d']);
    if (!allowed.has(timeframe)) throw new BrokerError('INVALID_SYMBOL', `Unsupported 5paisa timeframe ${timeframe}.`, 'FIVE_PAISA', this.environment);
    const master = await this.getScripMasterRows();
    const normalized = symbol.replace(/^NSE:|^BSE:/, '').toUpperCase();
    const row = master.find((r: any) => String(r.ScripData || r.Name || r.Root || '').replace(/_EQ$/,'').toUpperCase() === normalized);
    if (!row) throw new BrokerError('INVALID_SYMBOL', `5paisa ScripMaster has no authoritative instrument for ${symbol}.`, 'FIVE_PAISA', this.environment);
    const minutes = timeframe === '1d' ? 1440 : Number(timeframe.replace('m',''));
    const days = Math.max(2, Math.ceil((Math.max(1, limit) * minutes) / 375) + 1);
    const end = new Date();
    const from = new Date(end.getTime() - days * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0,10);
    const url = `https://openapi.5paisa.com/V2/historical/${row.Exch}/${row.ExchType}/${row.ScripCode}/${timeframe}?from=${fmt(from)}&end=${fmt(end)}`;
    const res = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': 'c89fab8d895a426d9e00db380b433027',
        'x-clientcode': this.config.clientCode || this.config.userId || '',
        'x-auth-token': this.config.accessToken
      }
    });
    if (!res.ok) throw new BrokerError('BROKER_UNAVAILABLE', `5paisa historical API HTTP ${res.status}: ${res.statusText}`, 'FIVE_PAISA', this.environment);
    const body = await res.json();
    const candles = body?.data?.candles;
    if (!Array.isArray(candles)) throw new BrokerError('BROKER_UNAVAILABLE', '5paisa historical API returned no candle data.', 'FIVE_PAISA', this.environment);
    return candles.slice(-Math.max(1, limit)).map((c: any[]) => ({
      timestamp: typeof c[0] === 'number' ? c[0] : Date.parse(String(c[0])),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5] || 0)
    })).filter((c: any) => Number.isFinite(c.timestamp) && c.open > 0 && c.high >= c.low && c.close > 0);
  }

  private async getScripMasterRows(): Promise<any[]> {
    const now = Date.now();
    if (this.scripMasterCache && this.scripMasterCache.expiresAt > now) {
      return this.scripMasterCache.rows;
    }

    if (this.scripMasterFetchInFlight) {
      return this.scripMasterFetchInFlight;
    }

    this.scripMasterFetchInFlight = (async () => {
      try {
        const candidateUrls = [
          'https://images.5paisa.com/website/scripmaster-csv-format.csv',
          `${this.getApiHost()}/VendorsAPI/Service1.svc/ScripMaster/segment/All`
        ];

        let fetchedRows: any[] = [];

        for (const url of candidateUrls) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);

            if (!res.ok) continue;

            const csv = await res.text();
            const lines = csv.split(/\r?\n/).filter(Boolean);
            if (lines.length < 2) continue;

            const headers = lines[0].split(',').map(v => v.trim());
            const idx = (name: string) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

            const iCode = idx('ScripCode') >= 0 ? idx('ScripCode') : idx('Scripcode');
            const iExch = idx('Exch');
            const iType = idx('ExchType');
            const iLot = idx('LotSize');
            const iName = idx('Name');
            const iRoot = idx('Root');
            const iScripData = idx('ScripData');
            const iFullName = idx('FullName');

            if (iCode < 0 || iExch < 0 || iType < 0) continue;

            const parsed = lines.slice(1).map(line => {
              const cols = line.split(',');
              const nameVal = iName >= 0 ? cols[iName]?.trim() : '';
              const rootVal = iRoot >= 0 ? cols[iRoot]?.trim() : '';
              const scripDataVal = iScripData >= 0 ? cols[iScripData]?.trim() : '';
              const fullNameVal = iFullName >= 0 ? cols[iFullName]?.trim() : '';
              const effectiveSymbol = scripDataVal || nameVal || rootVal || '';

              return {
                ScripCode: Number(cols[iCode] || 0),
                Exch: String(cols[iExch] || '').trim().toUpperCase(),
                ExchType: String(cols[iType] || '').trim().toUpperCase(),
                LotSize: Number(cols[iLot] || 1),
                ScripData: effectiveSymbol,
                Name: nameVal || effectiveSymbol,
                Root: rootVal || nameVal || effectiveSymbol,
                FullName: fullNameVal
              };
            }).filter(r => r.ScripCode > 0 && r.ScripData);

            if (parsed.length > 0) {
              fetchedRows = parsed;
              break;
            }
          } catch {
            // try next candidate URL
          }
        }

        // Merge fetched instruments with built-in authoritative master rows
        const mergedMap = new Map<string, any>();
        for (const row of FivePaisaBrokerAdapter.BUILT_IN_SCRIP_MASTER) {
          mergedMap.set(`${row.Exch}:${row.ExchType}:${row.ScripCode}`, row);
        }
        for (const row of fetchedRows) {
          const key = `${row.Exch}:${row.ExchType}:${row.ScripCode}`;
          if (!mergedMap.has(key)) {
            mergedMap.set(key, row);
          }
        }

        const finalRows = Array.from(mergedMap.values());
        this.scripMasterCache = {
          rows: finalRows,
          expiresAt: now + FivePaisaBrokerAdapter.SCRIP_MASTER_TTL_MS
        };
        return finalRows;
      } catch (err: any) {
        console.warn('5paisa ScripMaster remote fetch failed, using built-in authoritative instruments:', err?.message || err);
        const fallback = [...FivePaisaBrokerAdapter.BUILT_IN_SCRIP_MASTER];
        this.scripMasterCache = {
          rows: fallback,
          expiresAt: now + 60 * 1000
        };
        return fallback;
      } finally {
        this.scripMasterFetchInFlight = null;
      }
    })();

    return this.scripMasterFetchInFlight;
  }

  private normalizeScripLookupKey(value: unknown): string {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  private async findExactScripMasterRow(symbol: string, exchangeType?: string): Promise<any | null> {
    const normalized = this.normalizeScripLookupKey(symbol);
    if (!normalized) return null;

    const rows = await this.getScripMasterRows();
    return rows.find((row: any) => {
      if (exchangeType && String(row.ExchType || '').toUpperCase() !== exchangeType) return false;

      return [
        row.ScripData,
        row.Name,
        row.TradingSymbol,
        row.Symbol,
        row.FullName
      ].some(value => this.normalizeScripLookupKey(value) === normalized);
    }) || null;
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    await this.ensureActiveSession();

    if (!this.config.accessToken) {
      throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    }

    const rawSymbol = String(symbol || '').trim();
    const isBse = rawSymbol.toUpperCase().startsWith('BSE:');
    const cleanSymbol = rawSymbol.replace(/^NSE:|^BSE:/i, '').trim();
    const looksLikeOption = /(?:^|[_\s-])(CE|PE)$|(?:CE|PE)$/i.test(cleanSymbol);

    try {
      // 4. Resolve exact instrument through existing authoritative ScripMaster
      const targetExchType = looksLikeOption ? 'D' : 'C';
      let row = await this.findExactScripMasterRow(cleanSymbol, targetExchType);
      if (!row) {
        row = await this.findExactScripMasterRow(cleanSymbol);
      }

      // 5. Determine exchange, exchange type, scrip code, and scrip data
      const exch = String(row?.Exch || (isBse ? 'B' : 'N')).toUpperCase();
      const exchType = String(row?.ExchType || targetExchType).toUpperCase();
      const rawScripCode = row?.ScripCode ?? (/^\d+$/.test(cleanSymbol) ? Number(cleanSymbol) : 0);
      const scripCode = Number.isFinite(Number(rawScripCode)) ? Number(rawScripCode) : 0;
      const scripData = String(row?.ScripData || row?.Name || (scripCode > 0 ? '' : cleanSymbol));

      // 6. Call V2 MarketDepth endpoint
      const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V2/MarketDepth`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
          '5Paisa-API-Uid': 'ka7SFqAU6SC'
        },
        body: JSON.stringify({
          head: {
            key: this.config.userKey || '',
            Key: this.config.userKey || ''
          },
          body: {
            ClientCode: this.config.clientCode || this.config.userId || '',
            Exch: exch,
            ExchType: exchType,
            ScripCode: scripCode,
            ScripData: scripCode > 0 ? '' : scripData
          }
        })
      });

      if (!res.ok) {
        throw new BrokerError(
          'BROKER_UNAVAILABLE',
          `5paisa MarketDepth HTTP ${res.status}: ${res.statusText}`,
          'FIVE_PAISA',
          this.environment
        );
      }

      const data = await res.json().catch(() => ({}));

      // Normalize head status
      const headStatusRaw = data?.head?.status ?? data?.head?.Status;
      if (headStatusRaw !== undefined && headStatusRaw !== null) {
        const headStatusNum = Number(headStatusRaw);
        if (Number.isFinite(headStatusNum) && headStatusNum !== 0) {
          const desc = data?.head?.statusDescription ?? data?.head?.StatusDescription ?? data?.head?.Message ?? '5paisa MarketDepth request failed.';
          throw new BrokerError('BROKER_UNAVAILABLE', String(desc), 'FIVE_PAISA', this.environment);
        }
      }

      // Normalize body status
      const bodyStatusRaw = data?.body?.Status ?? data?.body?.status;
      if (bodyStatusRaw !== undefined && bodyStatusRaw !== null) {
        const bodyStatusNum = Number(bodyStatusRaw);
        if (bodyStatusNum === 9) {
          throw new BrokerError('AUTHENTICATION_FAILED', '5paisa session invalid or expired for MarketDepth.', 'FIVE_PAISA', this.environment);
        }
        if (Number.isFinite(bodyStatusNum) && bodyStatusNum !== 0) {
          const msg = data?.body?.Message ?? data?.body?.message ?? '5paisa MarketDepth failed.';
          throw new BrokerError('UNAVAILABLE', String(msg), 'FIVE_PAISA', this.environment);
        }
      }

      // 7. Parse body.MarketDepthData
      const candidates = [
        data?.body?.MarketDepthData,
        data?.MarketDepthData,
        data?.body?.Data,
        data?.Data
      ];
      const depthArray: any[] = candidates.flatMap(v => Array.isArray(v) ? v : v ? [v] : []);

      // 8. Separate:
      // BbBuySellFlag = 66 -> BUY/BID side
      // BbBuySellFlag = 83 -> SELL/ASK side
      const buyPrices: number[] = [];
      const sellPrices: number[] = [];

      for (const item of depthArray) {
        const flagRaw = item?.BbBuySellFlag ?? item?.BuySellFlag ?? item?.Flag;
        const flagStr = String(flagRaw ?? '').trim().toUpperCase();
        const price = Number(item?.Price ?? item?.Rate ?? 0);

        if (!Number.isFinite(price) || price <= 0) continue;

        if (flagStr === '66' || flagStr === 'B' || flagRaw === 66) {
          buyPrices.push(price);
        } else if (flagStr === '83' || flagStr === 'S' || flagRaw === 83) {
          sellPrices.push(price);
        }
      }

      // Fallback: Check MarketFeedData or items with BidPrice/AskPrice
      if (buyPrices.length === 0 || sellPrices.length === 0) {
        const feedCandidates = [
          data?.body?.MarketFeedData,
          data?.MarketFeedData,
          data?.body?.Data,
          data?.Data
        ];
        const feedArray: any[] = feedCandidates.flatMap(v => Array.isArray(v) ? v : v ? [v] : []);
        for (const item of feedArray) {
          const bp = Number(item?.BidPrice ?? item?.BidRate ?? item?.bestBid ?? 0);
          const ap = Number(item?.AskPrice ?? item?.AskRate ?? item?.bestAsk ?? 0);
          if (Number.isFinite(bp) && bp > 0 && buyPrices.length === 0) buyPrices.push(bp);
          if (Number.isFinite(ap) && ap > 0 && sellPrices.length === 0) sellPrices.push(ap);
        }
      }

      // 9. Best bid is highest valid buy-side price
      const bestBid = buyPrices.length > 0 ? Math.max(...buyPrices) : 0;
      // 10. Best ask is lowest valid sell-side price
      const bestAsk = sellPrices.length > 0 ? Math.min(...sellPrices) : 0;

      // 11. Requires: bid > 0, ask > 0, ask >= bid
      if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0 || bestAsk < bestBid) {
        throw new BrokerError(
          'UNAVAILABLE',
          `5paisa returned no authoritative bid/ask market depth for ${symbol} (bestBid: ${bestBid}, bestAsk: ${bestAsk}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      // 12. Return NormalizedQuote
      return {
        symbol,
        bid: bestBid,
        ask: bestAsk,
        spread: Math.max(0, bestAsk - bestBid),
        timestamp: Date.now(),
        source: '5PAISA_LIVE_MARKET_DEPTH',
        environment: 'LIVE',
        status: 'FRESH'
      };
    } catch (err: any) {
      if (err instanceof BrokerError) throw err;
      throw new BrokerError('BROKER_UNAVAILABLE', `5paisa authoritative quote retrieval failed: ${err?.message || String(err)}`, 'FIVE_PAISA', this.environment, err);
    }
  }


  async getInstruments(): Promise<BrokerInstrument[]> {
    await this.ensureActiveSession();
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    const rows = await this.getScripMasterRows();
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BrokerError('BROKER_UNAVAILABLE', '5paisa ScripMaster returned no instruments.', 'FIVE_PAISA', this.environment);
    }
    const target = new Set(['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','SENSEX','RELIANCE','HDFCBANK','TCS','INFY']);
    return rows.filter((r: any) => {
      const rawSymbol = String(r.ScripData || r.Name || r.Root || '').replace(/_EQ$/,'').toUpperCase();
      const baseSymbol = rawSymbol.split(/[ _]/)[0];
      return target.has(rawSymbol) || target.has(baseSymbol);
    }).map((r: any) => {
      const symbol = String(r.ScripData || r.Name || r.Root || '').replace(/_EQ$/,'');
      const market = String(r.ExchType || '').toUpperCase() === 'D'
        ? (/_CE$|_PE$/.test(symbol) ? 'INDIAN_OPTIONS' : 'INDIAN_FUTURES')
        : 'INDIAN_EQUITY';
      const lot = Math.max(1, Number(r.LotSize || 1));
      return {
        symbol,
        market,
        pipSize: 0.05,
        minQuantity: lot,
        maxQuantity: lot * 100,
        stepQuantity: lot,
        digits: 2,
        supportedOrderTypes: ['MARKET','LIMIT','STOP','STOP_LIMIT'],
        baseCurrency: 'INR',
        quoteCurrency: 'INR',
        brokerInstrumentId: String(r.ScripCode || '')
      } as BrokerInstrument;
    });
  }

  async getInstrument(symbol: string): Promise<BrokerInstrument | null> {
    const normalized = symbol.replace(/^NSE:|^BSE:/, '').trim().toUpperCase();

    // Resolve exact derivative contracts directly from the authoritative
    // ScripMaster. getInstruments() intentionally returns only the small
    // terminal universe, not every option contract.
    if (/(?:CE|PE)$/i.test(normalized)) {
      const row = await this.findExactScripMasterRow(normalized, 'D');
      if (!row) return null;

      const optionTypeText = String(
        row.OptionType ?? row.ScripType ?? row.CPType ?? row.Option ?? row.Type ?? ''
      ).toUpperCase();
      const rawSymbol = String(row.ScripData || row.Name || row.TradingSymbol || row.Symbol || normalized);

      return {
        symbol: rawSymbol,
        market: 'INDIAN_OPTIONS',
        pipSize: Number(row.TickSize || row.Tick || 0.05),
        minQuantity: Math.max(1, Number(row.LotSize || row.Lot || row.Quantity || 1)),
        maxQuantity: Math.max(1, Number(row.LotSize || row.Lot || row.Quantity || 1)) * 100,
        stepQuantity: Math.max(1, Number(row.LotSize || row.Lot || row.Quantity || 1)),
        digits: 2,
        supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'],
        baseCurrency: 'INR',
        quoteCurrency: 'INR',
        brokerInstrumentId: String(row.ScripCode || '')
      };
    }

    const instruments = await this.getInstruments();
    return instruments.find(i => i.symbol.replace(/^NSE:|^BSE:/, '').toUpperCase() === normalized) || null;
  }

  async preflightOrder(order: OrderRequest): Promise<void> {
    if (killSwitch.isHalted()) {
      throw new BrokerError(
        'EMERGENCY_STOP_ACTIVE',
        'EMERGENCY_STOP_ACTIVE: Emergency stop is active. Clear emergency stop before preflight.',
        'FIVE_PAISA',
        this.environment
      );
    }
    const systemConfig = getSystemConfig();
    const executionMode = systemConfig.executionMode || 'LIVE_DRY_RUN';

    // Validate First-Live reservation token if present
    const reservationToken = order.firstLiveReservationToken || (order as any)._firstLiveReservationToken;
    let isAuthorizedFirstLive = false;

    if (reservationToken) {
      const tokenHash = hashReservationToken(reservationToken);
      const rows = await executeQuery<any>(
        'SELECT * FROM first_live_ledger WHERE id = ? OR reservation_token = ? LIMIT 1',
        [tokenHash, tokenHash]
      );

      const reservation = rows[0];
      const maskedToken = maskReservationToken(reservationToken);
      if (!reservation) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation token '${maskedToken}' is invalid.`,
          'FIVE_PAISA',
          this.environment
        );
      }

      if (reservation.status !== 'RESERVED') {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation token '${maskedToken}' has already been finalized/consumed (Status: ${reservation.status}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      if (reservation.broker !== 'FIVE_PAISA') {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation broker mismatch (Expected: FIVE_PAISA, Reservation: ${reservation.broker}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      if (reservation.environment !== 'LIVE') {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation environment mismatch (Expected: LIVE, Reservation: ${reservation.environment}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      if (reservation.symbol !== order.symbol) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation symbol mismatch (Expected: ${reservation.symbol}, Order: ${order.symbol}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      if (reservation.side !== order.side) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation side mismatch (Expected: ${reservation.side}, Order: ${order.side}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      if (Number(reservation.quantity) !== Number(order.quantity)) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation quantity mismatch (Expected: ${reservation.quantity}, Order: ${order.quantity}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      const reqIdempotencyKey = order._firstLiveIdempotencyKey || '';
      if (reservation.idempotency_key !== reqIdempotencyKey) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation idempotency key mismatch (Expected: ${reservation.idempotency_key}, Order: ${reqIdempotencyKey}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      const reqCorrelationId = order._firstLiveCorrelationId || '';
      if (reservation.correlation_id !== reqCorrelationId) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation correlation ID mismatch (Expected: ${reservation.correlation_id}, Order: ${reqCorrelationId}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      // Explicit stopLoss and takeProfit validation
      let reservedSL: number | undefined = undefined;
      let reservedTP: number | undefined = undefined;
      try {
        if (reservation.payload_json) {
          const payload = JSON.parse(reservation.payload_json);
          reservedSL = payload.orderRequest?.stopLoss;
          reservedTP = payload.orderRequest?.takeProfit;
        }
      } catch (e) {
        // payload_json is invalid, fail closed
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED: Malformed payload in reservation record.',
          'FIVE_PAISA',
          this.environment
        );
      }

      if (reservedSL !== order.stopLoss) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation stopLoss mismatch (Expected: ${reservedSL}, Order: ${order.stopLoss}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      if (reservedTP !== order.takeProfit) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          `FIRST_LIVE_ORDER_NOT_AUTHORIZED: Reservation takeProfit mismatch (Expected: ${reservedTP}, Order: ${order.takeProfit}).`,
          'FIVE_PAISA',
          this.environment
        );
      }

      // Cryptographic Order Fingerprint Validation
      const expectedFingerprint = generateFirstLiveFingerprint(order, reqIdempotencyKey, reqCorrelationId);
      const dbFingerprint = reservation.fingerprint;

      if (!dbFingerprint || typeof dbFingerprint !== 'string' || dbFingerprint.length !== 64 || expectedFingerprint.length !== 64) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED: Fingerprint is missing or malformed.',
          'FIVE_PAISA',
          this.environment
        );
      }

      const expectedBuf = Buffer.from(expectedFingerprint, 'hex');
      const dbBuf = Buffer.from(dbFingerprint, 'hex');

      if (expectedBuf.length !== dbBuf.length || !crypto.timingSafeEqual(expectedBuf, dbBuf)) {
        throw new BrokerError(
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
          'FIRST_LIVE_ORDER_NOT_AUTHORIZED: Cryptographic order fingerprint mismatch. The order details have been tampered with or do not match the reservation context.',
          'FIVE_PAISA',
          this.environment
        );
      }

      isAuthorizedFirstLive = true;
    }

    if (executionMode === 'FIRST_LIVE_CERTIFICATION' && !isAuthorizedFirstLive) {
      throw new BrokerError(
        'FIRST_LIVE_ORDER_NOT_AUTHORIZED',
        'FIRST_LIVE_ORDER_NOT_AUTHORIZED: Direct broker order call blocked in FIRST_LIVE_CERTIFICATION mode without a valid server reservation token.',
        'FIVE_PAISA',
        this.environment
      );
    }

    if (executionMode === 'LIVE_DRY_RUN' && !isAuthorizedFirstLive) {
      throw new BrokerError(
        'LIVE_ORDER_BLOCKED_BY_DRY_RUN',
        'LIVE_ORDER_BLOCKED_BY_DRY_RUN: Order placement is blocked because GoldcrestNSE is running in LIVE_DRY_RUN mode. No real broker orders are transmitted.',
        'FIVE_PAISA',
        this.environment
      );
    }

    await this.ensureActiveSession();

    if (!this.isLive) {
      throw new BrokerError('ENVIRONMENT_MISMATCH', 'Autonomous execution is available only for 5paisa LIVE.', 'FIVE_PAISA', this.environment);
    }

    const instrument = await this.getInstrument(order.symbol);
    if (!instrument?.brokerInstrumentId) {
      throw new BrokerError('INVALID_SYMBOL', `5paisa authoritative scrip code is unavailable for ${order.symbol}.`, 'FIVE_PAISA', this.environment);
    }
  }

  async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    await this.preflightOrder(order);
    
    // Proceed with order construction and transmission...
    const isDeriv = order.market === 'INDIAN_OPTIONS' || order.market === 'INDIAN_FUTURES';
    const exchange = order.symbol.toUpperCase().startsWith('SENSEX') ? 'B' : 'N';
    const exchangeType = isDeriv ? 'D' : 'C';
    const remoteOrderId = (order.signalId || order.strategyId || `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);
    const instrument = await this.getInstrument(order.symbol);
    if (!instrument?.brokerInstrumentId) {
      throw new BrokerError('INVALID_SYMBOL', `5paisa authoritative scrip code is unavailable for ${order.symbol}.`, 'FIVE_PAISA', this.environment);
    }

    const payload = {
      head: {
        key: this.config.userKey
      },
      body: {
        Exchange: exchange,
        ExchangeType: exchangeType,
        ScripCode: instrument.brokerInstrumentId,
        Price: order.orderType === 'MARKET' ? 0 : Number(order.price || 0),
        StopLossPrice: Number(order.stopLoss || 0),
        OrderType: order.side === 'BUY' ? 'Buy' : 'Sell',
        Qty: Number(order.quantity),
        DisQty: 0,
        AtMarket: order.orderType === 'MARKET' ? 'Y' : 'N',
        IsIntraday: true,
        IOCOrder: order.orderType === 'MARKET' ? false : false,
        IsStopLossOrder: order.orderType === 'STOP' || order.orderType === 'STOP_LIMIT',
        RemoteOrderID: remoteOrderId,
        ClientCode: this.config.clientCode || this.config.userId
      }
    };

    if (!this.config.accessToken) {
      throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable for live order submission.', 'FIVE_PAISA', this.environment);
    }

    // INTERNAL CERTIFICATION BOUNDARY HOOK
    // This hook is strictly for automated zero-transmission certification.
    if ((global as any).__GOLDCREST_CERT_BOUNDARY_HOOK) {
      if (process.env.NODE_ENV !== 'test') {
        throw new BrokerError('SECURITY_VIOLATION', '5paisa certification boundary hook detected in non-test environment. Order submission aborted for safety.', 'FIVE_PAISA', this.environment);
      }
      return (global as any).__GOLDCREST_CERT_BOUNDARY_HOOK({ type: 'PLACE_ORDER', payload });
    }

    const response = await fetch(`${this.getApiHost()}/VendorsAPI/Service1.svc/V1/PlaceOrderRequest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.accessToken}`,
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new BrokerError('NETWORK_ERROR', `5paisa PlaceOrderRequest HTTP ${response.status}: ${response.statusText}`, 'FIVE_PAISA', this.environment);
    }

    const data = await response.json();
    const body = data?.body;
    const headStatus = String(data?.head?.status ?? '');
    const bodyStatus = Number(body?.Status ?? -1);

    if (headStatus !== '0' || bodyStatus !== 0 || !body?.BrokerOrderID) {
      const message = body?.Message || data?.head?.statusDescription || '5paisa rejected the live order.';
      throw new BrokerError('ORDER_REJECTED', `5paisa live order rejected: ${message}`, 'FIVE_PAISA', this.environment);
    }

    const brokerOrderId = String(body.BrokerOrderID);
    const normalized: NormalizedOrder = {
      id: `5paisa-${brokerOrderId}`,
      broker: 'FIVE_PAISA',
      environment: this.environment,
      market: order.market,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      quantity: order.quantity,
      price: order.orderType === 'MARKET' ? undefined : order.price,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      status: 'ACCEPTED',
      filledQuantity: 0,
      averageFillPrice: undefined,
      commission: undefined,
      timestamp: Date.now(),
      brokerOrderId,
      strategyId: order.strategyId,
      signalId: order.signalId
    };

    this.logAction('PLACE_ORDER', 'SUCCESS', this.config.clientCode || this.config.userId || '', {
      symbol: order.symbol,
      quantity: order.quantity,
      orderId: brokerOrderId
    });

    return normalized;
  }

  async modifyOrder(orderId: string, modifications: OrderModification): Promise<NormalizedOrder> {
    await this.ensureActiveSession();
    if (!this.isLive) throw new BrokerError('ENVIRONMENT_MISMATCH', '5paisa lifecycle actions require LIVE.', 'FIVE_PAISA', this.environment);

    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/OrderBook`;
    const data = await this.postUserApi(url, '5POB', { ClientCode: this.config.clientCode || this.config.userId });
    const orders: any[] = data?.body?.OrderBookDetail || [];
    const target = orders.find(o =>
      String(o.ExchOrderID ?? '') === String(orderId) ||
      String(o.BrokerOrderID ?? '') === String(orderId) ||
      String(o.RemoteOrderID ?? '') === String(orderId) ||
      String(o.OrderID ?? '') === String(orderId)
    );
    if (!target?.ExchOrderID) throw new BrokerError('ORDER_REJECTED', '5paisa authoritative order book did not contain the requested exchange order ID.', 'FIVE_PAISA', this.environment);

    const payload: Record<string, unknown> = {
      ExchangeOrderID: undefined,
      ExchOrderID: String(target.ExchOrderID)
    };
    if (modifications.price !== undefined) payload.Price = Number(modifications.price);
    if (modifications.quantity !== undefined) payload.Qty = Number(modifications.quantity);
    if (modifications.stopLoss !== undefined) payload.StopLossPrice = Number(modifications.stopLoss);
    payload.DisQty = 0;

    // INTERNAL CERTIFICATION BOUNDARY HOOK
    if ((global as any).__GOLDCREST_CERT_BOUNDARY_HOOK) {
      if (process.env.NODE_ENV !== 'test') {
        throw new BrokerError('SECURITY_VIOLATION', '5paisa certification boundary hook detected in non-test environment. Order modification aborted for safety.', 'FIVE_PAISA', this.environment);
      }
      return (global as any).__GOLDCREST_CERT_BOUNDARY_HOOK({ type: 'MODIFY_ORDER', orderId, modifications, payload });
    }

    const response = await this.postUserApi(
      `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/ModifyOrderRequest`,
      '5PModifyOrdReqV1',
      payload
    );
    const body = response?.body;
    const headStatus = String(response?.head?.status ?? response?.head?.Status ?? '0');
    const status = Number(body?.Status ?? 0);
    if (headStatus !== '0' || status !== 0) {
      throw new BrokerError('ORDER_REJECTED', body?.Message || response?.head?.statusDescription || '5paisa rejected the order modification.', 'FIVE_PAISA', this.environment);
    }

    const refreshed = await this.getOpenOrders();
    const updated = refreshed.find(o => String(o.brokerOrderId) === String(target.ExchOrderID));
    if (!updated) throw new BrokerError('ORDER_REJECTED', '5paisa accepted the modification but the order was not present in the refreshed broker state.', 'FIVE_PAISA', this.environment);
    return updated;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    await this.ensureActiveSession();
    if (!this.isLive) throw new BrokerError('ENVIRONMENT_MISMATCH', '5paisa lifecycle actions require LIVE.', 'FIVE_PAISA', this.environment);

    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/OrderBook`;
    const data = await this.postUserApi(url, '5POB', { ClientCode: this.config.clientCode || this.config.userId });
    const orders: any[] = data?.body?.OrderBookDetail || [];
    const target = orders.find(o =>
      String(o.ExchOrderID ?? '') === String(orderId) ||
      String(o.BrokerOrderID ?? '') === String(orderId) ||
      String(o.RemoteOrderID ?? '') === String(orderId) ||
      String(o.OrderID ?? '') === String(orderId)
    );
    if (!target?.ExchOrderID) return false;

    const payload = { ExchOrderID: String(target.ExchOrderID) };

    // INTERNAL CERTIFICATION BOUNDARY HOOK
    if ((global as any).__GOLDCREST_CERT_BOUNDARY_HOOK) {
      if (process.env.NODE_ENV !== 'test') {
        throw new BrokerError('SECURITY_VIOLATION', '5paisa certification boundary hook detected in non-test environment. Order cancellation aborted for safety.', 'FIVE_PAISA', this.environment);
      }
      return (global as any).__GOLDCREST_CERT_BOUNDARY_HOOK({ type: 'CANCEL_ORDER', orderId, payload });
    }

    const response = await this.postUserApi(
      `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/CancelOrderRequest`,
      '5PCancelOrdReqV1',
      payload
    );
    const body = response?.body;
    const headStatus = String(response?.head?.status ?? response?.head?.Status ?? '0');
    const status = Number(body?.Status ?? 0);
    if (headStatus !== '0' || status !== 0) {
      throw new BrokerError('ORDER_REJECTED', body?.Message || response?.head?.statusDescription || '5paisa rejected the order cancellation.', 'FIVE_PAISA', this.environment);
    }
    return true;
  }

  async closePosition(positionId: string, quantity?: number): Promise<boolean> {
    await this.ensureActiveSession();
    if (!this.isLive) throw new BrokerError('ENVIRONMENT_MISMATCH', '5paisa lifecycle actions require LIVE.', 'FIVE_PAISA', this.environment);

    const positions = await this.getPositions();
    const position = positions.find(p => p.id === positionId || p.brokerPositionId === positionId);
    if (!position) return false;
    const closeQty = quantity === undefined ? position.quantity : Math.min(Number(quantity), position.quantity);
    if (!Number.isFinite(closeQty) || closeQty <= 0) throw new BrokerError('INVALID_QUANTITY', 'Invalid 5paisa close quantity.', 'FIVE_PAISA', this.environment);

    const result = await this.placeOrder({
      market: position.market,
      symbol: position.symbol,
      side: position.side === 'BUY' ? 'SELL' : 'BUY',
      orderType: 'MARKET',
      quantity: closeQty,
      strategyId: 'POSITION_CLOSE'
    });
    return result.status === 'ACCEPTED' || result.status === 'FILLED';
  }


  async getOrderStatus(orderId: string): Promise<NormalizedOrder> {
    await this.ensureActiveSession();
    const url = this.getApiHost() + '/VendorsAPI/Service1.svc/V1/OrderBook';
    const data = await this.postUserApi(url, '5POB', { ClientCode: this.config.clientCode || this.config.userId });
    const orders: any[] = data?.body?.OrderBookDetail || [];
    const target = orders.find(o =>
      String(o.ExchOrderID ?? '') === String(orderId) ||
      String(o.BrokerOrderID ?? '') === String(orderId) ||
      String(o.RemoteOrderID ?? '') === String(orderId) ||
      String(o.OrderID ?? '') === String(orderId)
    );
    if (target) {
      const normalizedTarget = this.normalizeBrokerOrder(target);
      if (normalizedTarget.filledQuantity <= 0) return normalizedTarget;
      const history = await this.getOrderHistory();
      const rawFills = history.filter(o => String(o.brokerOrderId ?? '') === String(orderId) || String(o.id ?? '') === String(orderId));
      if (rawFills.length === 0) return normalizedTarget;

      // TradeBook is an execution ledger, but defensive deduplication is still
      // required because the same broker trade can be surfaced more than once.
      const seenFillIds = new Set<string>();
      const fills = rawFills.filter(fill => {
        const nativeIds = (fill.fillEvents || []).map(event => String(event.brokerFillId)).filter(Boolean);
        const key = nativeIds.length === 1
          ? nativeIds[0]
          : String(fill.id || [fill.brokerOrderId || orderId, fill.timestamp, fill.filledQuantity, fill.averageFillPrice].join('|'));
        if (seenFillIds.has(key)) return false;
        seenFillIds.add(key);
        return true;
      });

      const fillEvents = fills
        .flatMap(fill => fill.fillEvents || [])
        .filter((event, index, events) => {
          const id = String(event.brokerFillId);
          return id && events.findIndex(candidate => String(candidate.brokerFillId) === id) === index;
        });
      const filledQuantity = fillEvents.length > 0
        ? fillEvents.reduce((sum, fill) => sum + Math.max(0, Number(fill.quantity || 0)), 0)
        : fills.reduce((sum, fill) => sum + Math.max(0, Number(fill.filledQuantity || 0)), 0);
      const weightedPrice = fillEvents.length > 0
        ? fillEvents.reduce((sum, fill) => {
            const quantity = Math.max(0, Number(fill.quantity || 0));
            const price = Number(fill.price || 0);
            return sum + (quantity > 0 && price > 0 ? quantity * price : 0);
          }, 0)
        : fills.reduce((sum, fill) => {
            const quantity = Math.max(0, Number(fill.filledQuantity || 0));
            const price = Number(fill.averageFillPrice || fill.price || 0);
            return sum + (quantity > 0 && price > 0 ? quantity * price : 0);
          }, 0);
      const commission = fillEvents.length > 0
        ? fillEvents.reduce((sum, fill) => sum + (Number(fill.commission || 0) || 0), 0)
        : fills.reduce((sum, fill) => sum + (Number(fill.commission || 0) || 0), 0);
      const requestedQuantity = Math.max(
        Number(normalizedTarget.requestedQuantity || 0),
        Number(normalizedTarget.quantity || 0),
        filledQuantity
      );
      return {
        ...normalizedTarget,
        quantity: requestedQuantity,
        requestedQuantity,
        status: normalizedTarget.status === 'REJECTED' || normalizedTarget.status === 'CANCELLED' || normalizedTarget.status === 'EXPIRED'
          ? normalizedTarget.status
          : filledQuantity >= requestedQuantity && requestedQuantity > 0
            ? 'FILLED'
            : filledQuantity > 0
              ? 'PARTIALLY_FILLED'
              : normalizedTarget.status,
        filledQuantity,
        averageFillPrice: filledQuantity > 0 && weightedPrice > 0 ? weightedPrice / filledQuantity : normalizedTarget.averageFillPrice,
        commission: commission || normalizedTarget.commission,
        fillEvents
      };
    }

    // TradeBook is the authoritative execution ledger. Multiple trade rows
    // can belong to one order when it is partially filled. Aggregate those
    // executions rather than returning whichever trade row happens to match first.
    const history = await this.getOrderHistory();
    const rawFills = history.filter(o =>
      String(o.brokerOrderId ?? '') === String(orderId) ||
      String(o.id ?? '') === String(orderId)
    );
    if (rawFills.length === 0) {
      throw new BrokerError('UNKNOWN_ERROR', '5paisa authoritative order state did not contain order ' + orderId, 'FIVE_PAISA', this.environment);
    }

    const seenFillIds = new Set<string>();
    const fills = rawFills.filter(fill => {
      const nativeIds = (fill.fillEvents || []).map(event => String(event.brokerFillId)).filter(Boolean);
      const key = nativeIds.length === 1
        ? nativeIds[0]
        : String(fill.id || [fill.brokerOrderId || orderId, fill.timestamp, fill.filledQuantity, fill.averageFillPrice].join('|'));
      if (seenFillIds.has(key)) return false;
      seenFillIds.add(key);
      return true;
    });
    const first = fills[0];
    const fillEvents = fills
      .flatMap(fill => fill.fillEvents || [])
      .filter((event, index, events) => {
        const id = String(event.brokerFillId);
        return id && events.findIndex(candidate => String(candidate.brokerFillId) === id) === index;
      });
    const filledQuantity = fillEvents.length > 0
      ? fillEvents.reduce((sum, fill) => sum + Math.max(0, Number(fill.quantity || 0)), 0)
      : fills.reduce((sum, fill) => sum + Math.max(0, Number(fill.filledQuantity || 0)), 0);
    const weightedPrice = fillEvents.length > 0
      ? fillEvents.reduce((sum, fill) => {
          const quantity = Math.max(0, Number(fill.quantity || 0));
          const price = Number(fill.price || 0);
          return sum + (quantity > 0 && price > 0 ? quantity * price : 0);
        }, 0)
      : fills.reduce((sum, fill) => {
          const quantity = Math.max(0, Number(fill.filledQuantity || 0));
          const price = Number(fill.averageFillPrice || fill.price || 0);
          return sum + (quantity > 0 && price > 0 ? quantity * price : 0);
        }, 0);
    const averageFillPrice = filledQuantity > 0 && weightedPrice > 0 ? weightedPrice / filledQuantity : undefined;
    const commission = fillEvents.length > 0
      ? fillEvents.reduce((sum, fill) => sum + (Number(fill.commission || 0) || 0), 0)
      : fills.reduce((sum, fill) => sum + (Number(fill.commission || 0) || 0), 0);
    const requestedQuantity = Math.max(
      Number(first.requestedQuantity || 0),
      Number(first.quantity || 0),
      filledQuantity
    );

    return {
      ...first,
      id: String(orderId),
      brokerOrderId: String(orderId),
      quantity: requestedQuantity,
      requestedQuantity,
      status: filledQuantity >= requestedQuantity && requestedQuantity > 0 ? 'FILLED' : 'PARTIALLY_FILLED',
      filledQuantity,
      averageFillPrice,
      commission,
      fillEvents
    };
  }

  async getTradingStatus(): Promise<BrokerStatus> {
    if (FivePaisaBrokerAdapter.isRateLimited()) {
      return 'RATE_LIMITED';
    }
    return this.status;
  }

  /**
   * Helper to construct complete standard 5paisa OpenAPI request header
   */
  protected getApiHead(requestCode: string = '5PMarkV1') {
    return {
      appName: this.config.appName || '',
      appVer: '1.0',
      key: this.config.userKey || '',
      osName: 'WEB',
      requestCode,
      userId: this.config.userId || '',
      password: this.config.password || '',
      Key: this.config.userKey || ''
    };
  }

  /**
   * Checks whether the 5paisa session is configured and has an active access token
   */
  public hasActiveSession(): boolean {
    this.syncConfig();
    const hasBaseCreds = Boolean(
      this.config.appName &&
      this.config.userId &&
      this.config.userKey &&
      this.config.encryptionKey
    );
    const hasActiveToken = Boolean(
      this.config.accessToken && this.config.accessToken.trim() !== ''
    );
    return hasBaseCreds && hasActiveToken;
  }

  /**
   * Ensures an active access token is available, logging in with TOTP if needed
   */
  public async ensureActiveSession(totpCode?: string, pinCode?: string): Promise<boolean> {
    this.syncConfig();
    if (this.config.accessToken && this.config.accessToken.trim() !== '') {
      return true;
    }

    if (FivePaisaBrokerAdapter.isRateLimited()) {
      return false;
    }

    if (totpCode || this.config.totpSecret) {
      try {
        await this.loginWithTotp(totpCode, pinCode);
        return Boolean(this.config.accessToken && this.config.accessToken.trim() !== '');
      } catch (err: any) {
        console.warn('5paisa ensureActiveSession loginWithTotp error:', err?.message || err);
      }
    }

    return false;
  }

  /**
   * Fetches real-time Indian underlying quotes directly from 5paisa MarketFeed / MarketSnapshot API.
   * If 5paisa connection is not available, returns an empty array (blank data).
   */
  async fetchIndianUnderlyingsFrom5Paisa(respectConfiguredUniverse: boolean = true): Promise<IndianUnderlyingAnalysis[]> {
    const hasSession = await this.ensureActiveSession();
    if (!hasSession) {
      return [];
    }

    const configuredUniverse = getSystemConfig().autoLiveIndianUnderlyings;
    const activeSymbols = respectConfiguredUniverse && Array.isArray(configuredUniverse)
      ? new Set(configuredUniverse.map(symbol => String(symbol).toUpperCase().trim()))
      : new Set<string>();

    const requested = [
      {
        symbol: 'NIFTY',
        name: 'Nifty 50',
        exchange: 'N',
        aliases: ['NIFTY', 'NIFTY50', 'NIFTY50INDEX']
      },
      {
        symbol: 'BANKNIFTY',
        name: 'Nifty Bank',
        exchange: 'N',
        aliases: ['BANKNIFTY', 'NIFTYBANK', 'NIFTYBANKINDEX']
      },
      {
        symbol: 'FINNIFTY',
        name: 'Nifty Financial Services',
        exchange: 'N',
        aliases: ['FINNIFTY', 'NIFTYFIN', 'NIFTYFINANCIALSERVICES', 'NIFTYFINANCIAL']
      },
      {
        symbol: 'MIDCPNIFTY',
        name: 'Nifty Midcap Select',
        exchange: 'N',
        aliases: ['MIDCPNIFTY', 'NIFTYMIDCAPSELECT', 'MIDCAPSELECT', 'NIFTYMIDCAP']
      },
      {
        symbol: 'SENSEX',
        name: 'BSE SENSEX',
        exchange: 'B',
        aliases: ['SENSEX', 'BSESENSEX', 'SENSEX30']
      }
    ].filter(item => activeSymbols.size === 0 || activeSymbols.has(item.symbol));

    const master = await this.getScripMasterRows();
    const normalizeInstrumentKey = (value: unknown) => String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    const scrips = requested.map(request => {
      const aliases = new Set(request.aliases.map(normalizeInstrumentKey));
      const row = master.find(item => {
        const exchange = String(item.Exch || '').toUpperCase();
        const exchangeType = String(item.ExchType || '').toUpperCase();
        if (exchange !== request.exchange || exchangeType !== 'C') return false;

        const dataKey = normalizeInstrumentKey(item.ScripData);
        const nameKey = normalizeInstrumentKey(item.Name);
        const rootKey = normalizeInstrumentKey(item.Root);

        return aliases.has(dataKey)
          || aliases.has(dataKey.replace(/EQ$/, ''))
          || aliases.has(rootKey)
          || [...aliases].some(alias =>
            nameKey === alias
            || nameKey.includes(alias)
            || dataKey.includes(alias)
            || rootKey.includes(alias)
          );
      });

      if (!row) return null;
      return {
        Exch: String(row.Exch).toUpperCase(),
        ExchType: String(row.ExchType).toUpperCase(),
        ScripCode: Number(row.ScripCode || 0),
        ScripData: String(row.ScripData || row.Name || row.Root || ''),
        symbol: request.symbol,
        name: request.name
      };
    }).filter(Boolean) as Array<{
      Exch: string;
      ExchType: string;
      ScripCode: number;
      ScripData: string;
      symbol: string;
      name: string;
    }>;

    if (scrips.length === 0) return [];

    const scripPayload = scrips.map(s => ({
      Exch: s.Exch,
      ExchType: s.ExchType,
      ScripCode: s.ScripCode || 0,
      ScripData: s.ScripData || ''
    }));

    // 5paisa documents MarketFeed and MarketSnapshot as separate request
    // contracts. Use the documented MarketFeedData field for MarketFeed and
    // the documented Data field for MarketSnapshot.
    const requests = [
      {
        url: `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/MarketFeed`,
        body: {
          head: { key: this.config.userKey || '' },
          body: {
            ClientCode: this.config.clientCode || this.config.userId,
            MarketFeedData: scripPayload
          }
        }
      },
      {
        url: `${this.getApiHost()}/VendorsAPI/Service1.svc/MarketSnapshot`,
        body: {
          head: { key: this.config.userKey || '' },
          body: {
            ClientCode: this.config.clientCode || this.config.userId,
            Data: scripPayload
          }
        }
      }
    ];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      '5Paisa-API-Uid': 'ka7SFqAU6SC'
    };
    if (this.config.accessToken) {
      headers['Authorization'] = `Bearer ${this.config.accessToken}`;
    }

    for (const request of requests) {
      try {
        const res = await fetch(request.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(request.body)
        });

        if (res.status === 401 && this.config.totpSecret) {
          this.config.accessToken = undefined;
          await this.loginWithTotp();
          if (this.config.accessToken) {
            headers['Authorization'] = `Bearer ${this.config.accessToken}`;
          }
          continue;
        }

        if (!res.ok) continue;

        const data = await res.json();
        const items = data?.body?.Data || data?.body?.MarketFeedData || data?.Data || data?.MarketFeedData || [];
        if (!Array.isArray(items) || items.length === 0) continue;

        const results: IndianUnderlyingAnalysis[] = [];
        for (const scrip of scrips) {
          const match = items.find((it: any) =>
            String(it.ScripCode) === String(scrip.ScripCode) ||
            it.Symbol === scrip.symbol ||
            it.ScripData === scrip.ScripData
          );

          if (match) {
            // When NSE/BSE is closed, MarketFeed may omit a current LastRate/Bid/Ask
            // while still returning Previous Close. Use that broker-reported close
            // for the terminal rather than blanking a perfectly valid last price.
            const spot = Number(
              match.LastRate
              ?? match.LTP
              ?? match.Rate
              ?? match.PClose
              ?? match.PrevClose
              ?? 0
            );
            if (spot <= 0) continue;
            const prevClose = Number(match.PClose ?? match.PrevClose ?? spot);
            const change = Number((match.Chg !== undefined ? match.Chg : (spot - prevClose)).toFixed(2));
            const changePercent = Number((match.ChgPrcnt !== undefined ? match.ChgPrcnt : ((change / (prevClose || 1)) * 100)).toFixed(2));
            const high = Number(match.High || spot);
            const low = Number(match.Low || spot);
            const vwap = Number(match.AvgRate || match.VWAP || spot);
            const vwapDistance = Number((spot - vwap).toFixed(2));
            const vwapStatus = vwapDistance > 0 ? 'ABOVE_VWAP' : vwapDistance < 0 ? 'BELOW_VWAP' : 'AT_VWAP';

            const candles: Candle[] = [
              { timestamp: Date.now() - 3600000, open: prevClose, high: Math.max(prevClose, high), low: Math.min(prevClose, low), close: prevClose, volume: 100000, vwap },
              { timestamp: Date.now(), open: prevClose, high, low, close: spot, volume: Number(match.TotalQty || 500000), vwap }
            ];

            const analysis = evaluateIndianUnderlying(scrip.symbol, candles, spot, 13.8, 1.05);
            results.push({
              ...analysis,
              name: scrip.name,
              spot,
              change,
              changePercent,
              intradayHigh: high,
              intradayLow: low,
              vwap,
              vwapDistance,
              vwapStatus
            });
          }
        }

        if (results.length > 0) {
          return results;
        }
      } catch (err) {
        // try next endpoint
      }
    }

    // MarketFeed/MarketSnapshot can legitimately return no current tick data
    // outside market hours. In that case, recover the broker-reported closing
    // price from authoritative V2 historical candles so the closed-market
    // terminal remains populated.
    const historicalFallback = await Promise.all(
      scrips.map(async scrip => {
        try {
          const candles = await this.getHistoricalCandles(scrip.symbol, '1d', 2);
          if (!Array.isArray(candles) || candles.length === 0) return null;

          const latest = candles[candles.length - 1];
          const previous = candles[candles.length - 2] || latest;
          const spot = Number(latest.close);
          const prevClose = Number(previous.close);
          if (!(spot > 0)) return null;

          const high = Number(latest.high || spot);
          const low = Number(latest.low || spot);
          const change = Number((spot - prevClose).toFixed(2));
          const changePercent = Number(((change / (prevClose || spot)) * 100).toFixed(2));
          const vwap = spot;
          const vwapDistance = 0;

          const analysis = evaluateIndianUnderlying(
            scrip.symbol,
            candles,
            spot,
            13.8,
            1.05
          );

          return {
            ...analysis,
            name: scrip.name,
            spot,
            change,
            changePercent,
            intradayHigh: high,
            intradayLow: low,
            vwap,
            vwapDistance,
            vwapStatus: 'AT_VWAP' as const
          };
        } catch {
          return null;
        }
      })
    );

    const recovered = historicalFallback.filter(Boolean) as IndianUnderlyingAnalysis[];
    return recovered;
  }

  /**
   * Fetches historical candles from 5paisa API.
   * If 5paisa connection is not available, returns an empty array.
   */
  async fetchHistoricalCandlesFrom5Paisa(symbol: string, count: number = 60): Promise<Candle[]> {
    const hasSession = await this.ensureActiveSession();
    if (!hasSession) {
      return [];
    }

    try {
      const instrument = await this.resolve5PaisaInstrument(symbol);
      const scripCode = instrument.scripCode;
      const toDate = new Date().toISOString().split('T')[0];
      const fromDateObj = new Date(Date.now() - 7 * 86400000);
      const fromDate = fromDateObj.toISOString().split('T')[0];

      const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/HistoricalCandles`;
      const payload = {
        head: this.getApiHead('5PCandV1'),
        body: {
          ClientCode: this.config.clientCode || this.config.userId,
          Exch: instrument.exchange,
          ExchType: instrument.exchangeType,
          ScripCode: scripCode,
          FromDate: fromDate,
          ToDate: toDate,
          Interval: '15m'
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
          '5Paisa-API-Uid': 'ka7SFqAU6SC'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        const candlesRaw = data?.body?.Candles || data?.Candles || [];
        if (Array.isArray(candlesRaw) && candlesRaw.length > 0) {
          return candlesRaw.slice(-count).map((c: any) => ({
            timestamp: new Date(c[0] || c.Date || c.Timestamp).getTime() || Date.now(),
            open: Number(c[1] || c.Open || 0),
            high: Number(c[2] || c.High || 0),
            low: Number(c[3] || c.Low || 0),
            close: Number(c[4] || c.Close || 0),
            volume: Number(c[5] || c.Volume || 0),
            vwap: Number(c[4] || c.Close || 0)
          }));
        }
      }
    } catch (e) {
      console.error('5paisa HistoricalCandles error:', e);
    }

    return [];
  }

  /**
   * Fetches real-time Option Chain data from 5paisa API.
   * If 5paisa connection is not available, returns null (or blank structure).
   */
  async fetchOptionChainFrom5Paisa(symbol: string, selectedExpiryDate?: string, strikeDepth: number = 7): Promise<OptionChainSummary | null> {
    const hasSession = await this.ensureActiveSession();
    if (!hasSession) return null;
    const clean = symbol.toUpperCase().replace(/\s+/g, '');
    const config = getIndianUnderlyingConfig(clean);
    const expiries = generateExpiries(config.expiryDayOfWeek);
    const currentExpiry = selectedExpiryDate || expiries[0]?.dateString || '';
    try {
      const underlyings = await this.fetchIndianUnderlyingsFrom5Paisa();
      const matched = underlyings.find(u => u.symbol === clean);
      let spotPrice = matched ? Number(matched.spot) : 0;
      const exchange = clean === 'SENSEX' ? 'B' : 'N';
      const headers: Record<string, string> = { 'Content-Type': 'application/json', '5Paisa-API-Uid': 'ka7SFqAU6SC' };
      if (this.config.accessToken) headers.Authorization = 'Bearer ' + this.config.accessToken;

      // 5paisa's supported option-chain flow is GetExpiryForSymbolOptions -> GetOptionsForSymbol.
      const postOptionApi = async (path: string, body: Record<string, unknown>) => {
        const response = await fetch(this.getApiHost() + '/VendorsAPI/Service1.svc/' + path, { method: 'POST', headers, body: JSON.stringify({ head: { key: this.config.userKey }, body }) });
        if (!response.ok) throw new Error('5paisa option-chain API HTTP ' + response.status + ': ' + response.statusText);
        const data = await response.json();
        const status = data?.head?.Status ?? data?.head?.status ?? data?.body?.Status;
        if (status !== undefined && Number(status) !== 0) throw new Error(data?.head?.StatusDescription || data?.head?.statusDescription || data?.body?.Message || '5paisa option-chain API rejected the request.');
        return data;
      };
      const parseExpiry = (value: unknown): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) return value < 100000000000 ? value * 1000 : value;
        const text = String(value ?? '').trim();
        if (!text) return null;
        const dotNet = text.match(/\/Date\((-?\d+)(?:[+-]\d{4})?\)\//);
        if (dotNet) return Number(dotNet[1]);
        const n = Number(text);
        if (Number.isFinite(n) && n > 0) return n < 100000000000 ? n * 1000 : n;
        const parsed = Date.parse(text);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      };

      const expiryResponse = await postOptionApi('V2/GetExpiryForSymbolOptions', { Exch: exchange, Symbol: clean });
      const expiryContainer = expiryResponse?.body?.Data || expiryResponse?.body?.ExpiryData || expiryResponse?.body?.Expiry || expiryResponse?.body?.ExpiryDates || expiryResponse?.body?.ExpiryList || expiryResponse?.body;
      const expiryItems = Array.isArray(expiryContainer) ? expiryContainer : expiryContainer && typeof expiryContainer === 'object' ? Object.values(expiryContainer) : [];
      const liveExpiries = expiryItems.map((item: any) => { const raw = item?.ExpiryDate ?? item?.Expiry ?? item?.Date ?? item?.ExpiryDateTime ?? item; const timestamp = parseExpiry(raw); return timestamp ? { timestamp, date: new Date(timestamp).toISOString().slice(0, 10) } : null; }).filter(Boolean) as Array<{ timestamp: number; date: string }>;
      const uniqueExpiries = Array.from(new Map(liveExpiries.filter(e => e.timestamp >= Date.now() - 86400000).map(e => [e.date, e])).values()).sort((a, b) => a.timestamp - b.timestamp);
      const selected = currentExpiry ? uniqueExpiries.find(e => e.date === currentExpiry) : undefined;
      const expiryEntry = selected || uniqueExpiries[0];
      if (!expiryEntry) throw new Error('5paisa returned no active option expiries for ' + clean + '.');

      const chainResponse = await postOptionApi('GetOptionsForSymbol', { Exch: exchange, Symbol: clean, ExpiryDate: '/Date(' + expiryEntry.timestamp + ')/' });
      const rawContainer = chainResponse?.body?.Data || chainResponse?.body?.Options || chainResponse?.body?.OptionChain || chainResponse?.body?.OptionChainData || chainResponse?.body?.OptionsForSymbol || chainResponse?.body;
      const rawOptions = Array.isArray(rawContainer) ? rawContainer : rawContainer && typeof rawContainer === 'object' ? Object.values(rawContainer).flatMap((v: any) => Array.isArray(v) ? v : []) : [];
      if (rawOptions.length === 0) throw new Error('5paisa returned no option contracts for ' + clean + ' ' + expiryEntry.date + '.');
      if (!(spotPrice > 0)) spotPrice = Number(chainResponse?.body?.LastRate || chainResponse?.body?.SpotPrice || chainResponse?.SpotPrice || 0);
      if (!(spotPrice > 0)) throw new Error('Authoritative 5paisa spot price is unavailable for ' + clean + '.');

      const numeric = (row: any, keys: string[], fallback = 0): number => { for (const key of keys) { const value = Number(row?.[key]); if (Number.isFinite(value)) return value; } return fallback; };
      const textValue = (row: any, keys: string[]): string => { for (const key of keys) { const value = row?.[key]; if (value !== undefined && value !== null && String(value).trim() !== '') return String(value); } return ''; };
      const optionType = (row: any): 'CALL' | 'PUT' | null => { const value = textValue(row, ['OptionType', 'ScripType', 'CPType', 'Option', 'Type']).toUpperCase(); if (value === 'CE' || value === 'CALL' || value.endsWith('CE')) return 'CALL'; if (value === 'PE' || value === 'PUT' || value.endsWith('PE')) return 'PUT'; const s = textValue(row, ['ScripData', 'ScripName', 'Symbol', 'TradingSymbol']).toUpperCase(); if (/_?CE$/.test(s)) return 'CALL'; if (/_?PE$/.test(s)) return 'PUT'; return null; };
      const grouped = new Map<number, { call?: any; put?: any }>();
      for (const item of rawOptions) { const strike = numeric(item, ['StrikePrice', 'StrikeRate', 'Strike', 'StrikeValue']); const type = optionType(item); if (!(strike > 0) || !type) continue; const pair = grouped.get(strike) || {}; pair[type === 'CALL' ? 'call' : 'put'] = item; grouped.set(strike, pair); }
      const strikes = Array.from(grouped.keys()).sort((a, b) => a - b);
      if (strikes.length === 0) throw new Error('5paisa returned option data without valid strikes for ' + clean + '.');
      const atmStrike = strikes.reduce((closest, strike) => Math.abs(strike - spotPrice) < Math.abs(closest - spotPrice) ? strike : closest, strikes[0]);
      const atmIndex = strikes.indexOf(atmStrike);
      const depth = Math.max(1, Number(strikeDepth) || 7);
      const selectedStrikes = strikes.slice(Math.max(0, atmIndex - depth), Math.min(strikes.length, atmIndex + depth + 1));
      const timeInYears = Math.max(0.5 / 365, (expiryEntry.timestamp - Date.now()) / (365 * 24 * 60 * 60 * 1000));

      const contract = (row: any | undefined, type: 'CALL' | 'PUT', strike: number): OptionContract => {
        const ltp = Math.max(0, numeric(row, ['LastRate', 'LTP', 'LastTradedPrice', 'LastPrice', 'Rate']));
        const bid = Math.max(0, numeric(row, ['BidPrice', 'BidRate', 'BestBidPrice']));
        const ask = Math.max(0, numeric(row, ['AskPrice', 'OfferRate', 'OffRate', 'BestAskPrice']));
        const prev = numeric(row, ['PrevClose', 'PreviousClose', 'PreviousClosingPrice']);
        const change = numeric(row, ['Change', 'PriceChange'], prev > 0 ? ltp - prev : 0);
        const changePercent = numeric(row, ['ChangePercent', 'PercentChange'], prev > 0 ? change / prev * 100 : 0);
        const oi = Math.max(0, numeric(row, ['OpenInterest', 'OI', 'OpenInt']));
        const changeOI = numeric(row, ['ChangeInOI', 'ChangeOI', 'OIChange']);
        const volume = Math.max(0, numeric(row, ['Volume', 'Vol', 'TotalVolume']));
        const ivRaw = numeric(row, ['IV', 'ImpliedVolatility', 'ImpliedVol', 'IVPercent']);
        const iv = ivRaw > 1 ? ivRaw : ivRaw * 100;
        const ivDecimal = iv > 0 ? iv / 100 : 0.138;
        const brokerDelta = numeric(row, ['Delta']);
        const model = calculateBlackScholesGreeks(spotPrice, strike, timeInYears, 0.068, ivDecimal, type);
        const greeks = { delta: brokerDelta !== 0 ? brokerDelta : model.greeks.delta, gamma: numeric(row, ['Gamma'], model.greeks.gamma), theta: numeric(row, ['Theta'], model.greeks.theta), vega: numeric(row, ['Vega'], model.greeks.vega), rho: numeric(row, ['Rho'], model.greeks.rho), iv, modelDerived: brokerDelta === 0 };
        const spread = Math.max(config.tickSize, ltp > 0 ? ltp * 0.01 : config.tickSize);
        const effectiveBid = bid > 0 ? bid : Math.max(0, ltp - spread / 2);
        const effectiveAsk = ask > 0 ? ask : Math.max(effectiveBid, ltp + spread / 2);
        return { symbol: textValue(row, ['ScripData', 'ScripName', 'TradingSymbol', 'Symbol']) || (clean + '_' + expiryEntry.date + '_' + strike + '_' + (type === 'CALL' ? 'CE' : 'PE')), underlying: clean, expiry: expiryEntry.date, strike, optionType: type, lotSize: numeric(row, ['LotSize', 'Lot', 'Quantity'], config.lotSize), tickSize: numeric(row, ['TickSize', 'Tick'], config.tickSize), contractMultiplier: 1, ltp, change, changePercent, oi, changeOI, volume, bid: effectiveBid, ask: effectiveAsk, spread: Math.max(0, effectiveAsk - effectiveBid), iv, greeks, isATM: strike === atmStrike, isITM: type === 'CALL' ? strike < spotPrice : strike > spotPrice };
      };
      const rows: OptionChainStrikeRow[] = selectedStrikes.map(strike => { const pair = grouped.get(strike) || {}; return { strike, isATM: strike === atmStrike, distanceFromAtm: strikes.indexOf(strike) - atmIndex, call: contract(pair.call, 'CALL', strike), put: contract(pair.put, 'PUT', strike) }; });
      const totalCallOI = strikes.reduce((sum, strike) => sum + numeric(grouped.get(strike)?.call, ['OpenInterest', 'OI', 'OpenInt']), 0);
      const totalPutOI = strikes.reduce((sum, strike) => sum + numeric(grouped.get(strike)?.put, ['OpenInterest', 'OI', 'OpenInt']), 0);
      let callResistanceStrike = atmStrike; let putSupportStrike = atmStrike; let maxCallOI = -1; let maxPutOI = -1;
      for (const strike of strikes) { const callOI = numeric(grouped.get(strike)?.call, ['OpenInterest', 'OI', 'OpenInt']); const putOI = numeric(grouped.get(strike)?.put, ['OpenInterest', 'OI', 'OpenInt']); if (strike >= atmStrike && callOI > maxCallOI) { maxCallOI = callOI; callResistanceStrike = strike; } if (strike <= atmStrike && putOI > maxPutOI) { maxPutOI = putOI; putSupportStrike = strike; } }
      return { underlying: clean, spotPrice, atmStrike, expiry: expiryEntry.date, availableExpiries: uniqueExpiries.map(e => e.date), totalCallOI, totalPutOI, pcr: totalCallOI > 0 ? Number((totalPutOI / totalCallOI).toFixed(2)) : 0, callResistanceStrike, putSupportStrike, highOIStrikeCall: callResistanceStrike, highOIStrikePut: putSupportStrike, rows, timestamp: Date.now() };
    } catch (err: any) {
      console.error('5paisa OptionChain fetch error:', err?.message || err);
      return null;
    }
  }
  /**
   * Helper to map underlying symbols and option contracts to 5paisa Scrip Codes
   */
  protected async resolve5PaisaInstrument(symbol: string): Promise<{ scripCode: number; scripData: string; exchange: string; exchangeType: string }> {
    const normalized = String(symbol || '')
      .replace(/^NSE:|^BSE:/, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    const aliasesBySymbol: Record<string, string[]> = {
      NIFTY: ['NIFTY', 'NIFTY50', 'NIFTY50INDEX'],
      BANKNIFTY: ['BANKNIFTY', 'NIFTYBANK', 'NIFTYBANKINDEX'],
      FINNIFTY: ['FINNIFTY', 'NIFTYFIN', 'NIFTYFINANCIALSERVICES', 'NIFTYFINANCIAL'],
      MIDCPNIFTY: ['MIDCPNIFTY', 'NIFTYMIDCAPSELECT', 'MIDCAPSELECT', 'NIFTYMIDCAP'],
      SENSEX: ['SENSEX', 'BSESENSEX', 'SENSEX30']
    };

    const aliases = new Set(
      aliasesBySymbol[normalized]
      || Object.entries(aliasesBySymbol).find(([, values]) => values.includes(normalized))?.[1]
      || [normalized]
    );

    const expectedExchange = normalized === 'SENSEX' || aliases.has('SENSEX') ? 'B' : 'N';
    const rows = await this.getScripMasterRows();

    const normalizeKey = (value: unknown) =>
      String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    const row = rows.find((item: any) => {
      if (String(item.Exch || '').toUpperCase() !== expectedExchange) return false;
      if (String(item.ExchType || '').toUpperCase() !== 'C') return false;

      const dataKey = normalizeKey(item.ScripData);
      const nameKey = normalizeKey(item.Name);
      const rootKey = normalizeKey(item.Root);

      return aliases.has(dataKey)
        || aliases.has(dataKey.replace(/EQ$/, ''))
        || aliases.has(rootKey)
        || [...aliases].some(alias =>
          nameKey === alias
          || nameKey.includes(alias)
          || dataKey.includes(alias)
          || rootKey.includes(alias)
        );
    });

    if (!row) {
      throw new BrokerError(
        'INVALID_SYMBOL',
        `No authoritative 5paisa ScripMaster instrument is configured for ${symbol}.`,
        'FIVE_PAISA',
        this.environment
      );
    }

    return {
      scripCode: Number(row.ScripCode || 0),
      scripData: String(row.ScripData || row.Name || row.Root || ''),
      exchange: String(row.Exch || '').toUpperCase(),
      exchangeType: String(row.ExchType || '').toUpperCase()
    };
  }
}
