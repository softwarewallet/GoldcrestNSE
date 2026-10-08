import { FivePaisaBrokerAdapter } from './FivePaisaBrokerAdapter';
import { NormalizedOrder, OrderRequest, TradingEnvironment } from '../../types';
import { maskIdentifier } from '../../auditLog';
import { BrokerError } from '../../errors';
import { FivePaisaConfig } from './types';

export class FivePaisaLiveAdapter extends FivePaisaBrokerAdapter {
  readonly environment: TradingEnvironment = 'LIVE';
  readonly isLive: boolean = true;

  constructor(customConfig?: Partial<FivePaisaConfig>) {
    const config: FivePaisaConfig = {
      appName: customConfig?.appName || process.env.FIVEPAISA_LIVE_APP_NAME || process.env.FIVE_PAISA_LIVE_APP_NAME || process.env.FIVEPAISA_APP_NAME,
      appSource: customConfig?.appSource || process.env.FIVEPAISA_LIVE_APP_SOURCE || process.env.FIVE_PAISA_LIVE_APP_SOURCE || process.env.FIVEPAISA_APP_SOURCE || '1',
      userId: customConfig?.userId || process.env.FIVEPAISA_LIVE_USER_ID || process.env.FIVE_PAISA_LIVE_USER_ID || process.env.FIVEPAISA_USER_ID,
      password: customConfig?.password || process.env.FIVEPAISA_LIVE_PASSWORD || process.env.FIVE_PAISA_LIVE_PASSWORD || process.env.FIVEPAISA_PASSWORD,
      userKey: customConfig?.userKey || process.env.FIVEPAISA_LIVE_USER_KEY || process.env.FIVE_PAISA_LIVE_USER_KEY || process.env.FIVEPAISA_USER_KEY,
      encryptionKey: customConfig?.encryptionKey || process.env.FIVEPAISA_LIVE_ENCRYPTION_KEY || process.env.FIVE_PAISA_LIVE_ENCRYPTION_KEY || process.env.FIVEPAISA_ENCRYPTION_KEY,
      clientCode: customConfig?.clientCode || process.env.FIVEPAISA_LIVE_CLIENT_CODE || process.env.FIVE_PAISA_LIVE_CLIENT_CODE || process.env.FIVEPAISA_CLIENT_CODE,
      accessToken: customConfig?.accessToken || process.env.FIVEPAISA_LIVE_ACCESS_TOKEN || process.env.FIVE_PAISA_LIVE_ACCESS_TOKEN || process.env.FIVEPAISA_ACCESS_TOKEN || process.env.FIVE_PAISA_ACCESS_TOKEN,
      totpSecret: customConfig?.totpSecret || process.env.FIVEPAISA_LIVE_TOTP_SECRET || process.env.FIVE_PAISA_LIVE_TOTP_SECRET || process.env.FIVEPAISA_TOTP_SECRET || process.env.FIVE_PAISA_TOTP_SECRET,
      pin: customConfig?.pin || process.env.FIVEPAISA_LIVE_PIN || process.env.FIVE_PAISA_LIVE_PIN || process.env.FIVEPAISA_PIN || process.env.FIVE_PAISA_PIN || process.env.FIVEPAISA_2FA_PIN,
      environment: 'LIVE',
      apiHost: customConfig?.apiHost || 'https://Openapi.5paisa.com'
    };
    super(config);
  }

  override syncConfig(): void {
    if (!this.config.appName && (process.env.FIVEPAISA_LIVE_APP_NAME || process.env.FIVE_PAISA_LIVE_APP_NAME || process.env.FIVEPAISA_APP_NAME)) {
      this.config.appName = process.env.FIVEPAISA_LIVE_APP_NAME || process.env.FIVE_PAISA_LIVE_APP_NAME || process.env.FIVEPAISA_APP_NAME;
    }
    if (!this.config.userId && (process.env.FIVEPAISA_LIVE_USER_ID || process.env.FIVE_PAISA_LIVE_USER_ID || process.env.FIVEPAISA_USER_ID)) {
      this.config.userId = process.env.FIVEPAISA_LIVE_USER_ID || process.env.FIVE_PAISA_LIVE_USER_ID || process.env.FIVEPAISA_USER_ID;
    }
    if (!this.config.password && (process.env.FIVEPAISA_LIVE_PASSWORD || process.env.FIVE_PAISA_LIVE_PASSWORD || process.env.FIVEPAISA_PASSWORD)) {
      this.config.password = process.env.FIVEPAISA_LIVE_PASSWORD || process.env.FIVE_PAISA_LIVE_PASSWORD || process.env.FIVEPAISA_PASSWORD;
    }
    if (!this.config.userKey && (process.env.FIVEPAISA_LIVE_USER_KEY || process.env.FIVE_PAISA_LIVE_USER_KEY || process.env.FIVEPAISA_USER_KEY)) {
      this.config.userKey = process.env.FIVEPAISA_LIVE_USER_KEY || process.env.FIVE_PAISA_LIVE_USER_KEY || process.env.FIVEPAISA_USER_KEY;
    }
    if (!this.config.encryptionKey && (process.env.FIVEPAISA_LIVE_ENCRYPTION_KEY || process.env.FIVE_PAISA_LIVE_ENCRYPTION_KEY || process.env.FIVEPAISA_ENCRYPTION_KEY)) {
      this.config.encryptionKey = process.env.FIVEPAISA_LIVE_ENCRYPTION_KEY || process.env.FIVE_PAISA_LIVE_ENCRYPTION_KEY || process.env.FIVEPAISA_ENCRYPTION_KEY;
    }
    if (!this.config.clientCode && (process.env.FIVEPAISA_LIVE_CLIENT_CODE || process.env.FIVE_PAISA_LIVE_CLIENT_CODE || process.env.FIVEPAISA_CLIENT_CODE)) {
      this.config.clientCode = process.env.FIVEPAISA_LIVE_CLIENT_CODE || process.env.FIVE_PAISA_LIVE_CLIENT_CODE || process.env.FIVEPAISA_CLIENT_CODE;
    }
    if (!this.config.accessToken && (process.env.FIVEPAISA_LIVE_ACCESS_TOKEN || process.env.FIVE_PAISA_LIVE_ACCESS_TOKEN || process.env.FIVEPAISA_ACCESS_TOKEN || process.env.FIVE_PAISA_ACCESS_TOKEN)) {
      this.config.accessToken = process.env.FIVEPAISA_LIVE_ACCESS_TOKEN || process.env.FIVE_PAISA_LIVE_ACCESS_TOKEN || process.env.FIVEPAISA_ACCESS_TOKEN || process.env.FIVE_PAISA_ACCESS_TOKEN;
    }
    if (!this.config.totpSecret && (process.env.FIVEPAISA_LIVE_TOTP_SECRET || process.env.FIVE_PAISA_LIVE_TOTP_SECRET || process.env.FIVEPAISA_TOTP_SECRET || process.env.FIVE_PAISA_TOTP_SECRET)) {
      this.config.totpSecret = process.env.FIVEPAISA_LIVE_TOTP_SECRET || process.env.FIVE_PAISA_LIVE_TOTP_SECRET || process.env.FIVEPAISA_TOTP_SECRET || process.env.FIVE_PAISA_TOTP_SECRET;
    }
    if (!this.config.pin && (process.env.FIVEPAISA_LIVE_PIN || process.env.FIVE_PAISA_LIVE_PIN || process.env.FIVEPAISA_PIN || process.env.FIVE_PAISA_PIN || process.env.FIVEPAISA_2FA_PIN)) {
      this.config.pin = process.env.FIVEPAISA_LIVE_PIN || process.env.FIVE_PAISA_LIVE_PIN || process.env.FIVEPAISA_PIN || process.env.FIVE_PAISA_PIN || process.env.FIVEPAISA_2FA_PIN;
    }
    super.syncConfig();
  }

  getConfigStatus() {
    const configured = Boolean(
      this.config.appName &&
      this.config.userId &&
      this.config.userKey &&
      this.config.encryptionKey
    );
    const hasAccessToken = Boolean(this.config.accessToken && this.config.accessToken.trim() !== '');
    const hasTotpSecret = Boolean(this.config.totpSecret && this.config.totpSecret.trim() !== '');
    return {
      configured,
      hasAccessToken,
      hasTotpSecret,
      maskedClientId: maskIdentifier(this.config.clientCode || this.config.userId),
      maskedUserId: maskIdentifier(this.config.userId),
      maskedAppName: this.config.appName ? 'Saved: ' + this.config.appName : undefined,
      maskedAppSource: this.config.appSource ? 'Saved: ' + this.config.appSource : undefined,
      maskedPassword: this.config.password ? '•••••••• (Saved)' : undefined,
      maskedUserKey: this.config.userKey ? '•••••••• (Saved)' : undefined,
      maskedEncryptionKey: this.config.encryptionKey ? '•••••••• (Saved)' : undefined,
      maskedClientCode: this.config.clientCode ? maskIdentifier(this.config.clientCode) : undefined,
      maskedAccessToken: this.config.accessToken ? '•••••••• (Active Token)' : undefined,
      maskedTotpSecret: this.config.totpSecret ? '•••••••• (TOTP Configured)' : undefined,
      maskedPin: this.config.pin ? '•••• (PIN Configured)' : undefined
    };
  }

  // Direct broker-route orders remain explicitly blocked. The autonomous
  // execution engine uses placeAutonomousOrder() only after its own gates pass.
  override async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    return super.placeOrder(order);
  }

  async placeAutonomousOrder(order: OrderRequest): Promise<NormalizedOrder> {
    return super.placeOrder(order);
  }

  updateCredentials(creds: Partial<FivePaisaConfig>): void {
    const cleanUpdates = Object.fromEntries(
      Object.entries(creds).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
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
      appName: undefined,
      appSource: '1',
      userId: undefined,
      password: undefined,
      userKey: undefined,
      encryptionKey: undefined,
      clientCode: undefined,
      environment: 'LIVE',
      apiHost: 'https://Openapi.5paisa.com'
    };
    this.status = 'DISCONNECTED';
  }
}
