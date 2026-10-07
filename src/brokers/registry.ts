import {
  BrokerAdapter,
  BrokerType,
  TradingEnvironment,
  ConnectionTestResult,
  BrokerCredentialStatus
} from './types';
import { CTraderLiveAdapter } from './adapters/cTrader/CTraderLiveAdapter';
import { FivePaisaLiveAdapter } from './adapters/fivepaisa/FivePaisaLiveAdapter';
import { FivePaisaBrokerAdapter } from './adapters/fivepaisa/FivePaisaBrokerAdapter';
import { BrokerError } from './errors';

export class BrokerRegistry {
  private activeEnvironment: TradingEnvironment = 'LIVE';
  // Broker selection is retained only for backwards compatibility. Market routing
  // is authoritative and automatically selects the compatible live broker.
  private selectedBroker: BrokerType = 'CTRADER';

  private adapters: Map<string, BrokerAdapter> = new Map();
  private isInitialized: boolean = false;

  constructor() {}

  private ensureInitialized(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    // LIVE_ONLY: only authoritative live broker adapters are registered.
    const ctraderLive = new CTraderLiveAdapter();
    const fivePaisaLive = new FivePaisaLiveAdapter();
    this.adapters.set('CTRADER_LIVE', ctraderLive);
    this.adapters.set('FIVE_PAISA_LIVE', fivePaisaLive);
  }

  getEnvironment(): TradingEnvironment {
    return this.activeEnvironment;
  }

  setEnvironment(env: TradingEnvironment): void {
    if (env !== 'LIVE') {
      throw new Error('Goldcrest operates in LIVE_ONLY mode.');
    }
    this.activeEnvironment = 'LIVE';
  }

  getSelectedBroker(): BrokerType {
    return this.selectedBroker;
  }

  setSelectedBroker(broker: BrokerType): void {
    // Kept for API compatibility. It must not disable the other market broker.
    if (!['CTRADER', 'FIVE_PAISA'].includes(broker)) {
      throw new Error('Invalid broker. Allowed: CTRADER, FIVE_PAISA');
    }
    this.selectedBroker = broker;
  }

  getAdapter(broker?: BrokerType, environment?: TradingEnvironment): BrokerAdapter {
    this.ensureInitialized();
    const targetBroker = broker || this.selectedBroker;
    const targetEnv: TradingEnvironment = 'LIVE';

    if (environment !== undefined && environment !== 'LIVE') {
      throw new Error('Goldcrest operates in LIVE_ONLY mode.');
    }

    const key = `${targetBroker}_${targetEnv}`;
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new BrokerError(
        'UNKNOWN_ERROR',
        `No live adapter registered for ${targetBroker}`,
        targetBroker,
        'LIVE'
      );
    }
    return adapter;
  }

  /**
   * Resolve the authoritative live broker from the requested market.
   * FOREX -> cTrader
   * Indian equity/futures/options -> 5paisa
   */
  getAdapterForMarket(market: string): BrokerAdapter {
    this.ensureInitialized();

    if (market === 'FOREX') {
      return this.getAdapter('CTRADER', 'LIVE');
    }

    if (market === 'INDIAN_EQUITY' || market === 'INDIAN_FUTURES' || market === 'INDIAN_OPTIONS') {
      return this.getAdapter('FIVE_PAISA', 'LIVE');
    }

    throw new BrokerError(
      'INVALID_SYMBOL',
      `No live broker route is configured for market ${market}`,
      'CTRADER',
      'LIVE'
    );
  }

  /**
   * Both live broker adapters are active simultaneously.
   * This is the canonical source for dashboard/account aggregation.
   */
  getActiveLiveAdapters(): BrokerAdapter[] {
    this.ensureInitialized();
    return [
      this.getAdapter('CTRADER', 'LIVE'),
      this.getAdapter('FIVE_PAISA', 'LIVE')
    ];
  }

  getFivePaisaAdapter(): FivePaisaBrokerAdapter | null {
    this.ensureInitialized();
    const live = this.adapters.get('FIVE_PAISA_LIVE') as FivePaisaBrokerAdapter | undefined;
    if (live && live.hasActiveSession()) return live;
    return live || null;
  }

  registerAdapter(broker: BrokerType, environment: TradingEnvironment, adapter: BrokerAdapter): void {
    this.ensureInitialized();
    const key = `${broker}_${environment}`;
    this.adapters.set(key, adapter);
  }

  validateMarketCompatibility(market: string, broker: BrokerType): { compatible: boolean; reason?: string } {
    if (broker === 'CTRADER') {
      if (market === 'FOREX') return { compatible: true };
      return {
        compatible: false,
        reason: `cTrader broker only supports FOREX market. Cannot route ${market} to cTrader.`
      };
    }

    if (broker === 'FIVE_PAISA') {
      if (market === 'INDIAN_EQUITY' || market === 'INDIAN_OPTIONS' || market === 'INDIAN_FUTURES') {
        return { compatible: true };
      }
      return {
        compatible: false,
        reason: `5paisa broker only supports Indian markets (INDIAN_EQUITY, INDIAN_OPTIONS, INDIAN_FUTURES). Cannot route ${market} to 5paisa.`
      };
    }

    return { compatible: false, reason: `Unknown broker ${broker}` };
  }

  async testBrokerConnection(broker: BrokerType, environment: TradingEnvironment): Promise<ConnectionTestResult> {
    const adapter = this.getAdapter(broker, environment);
    return adapter.testConnection();
  }

  getCredentialStatuses(): BrokerCredentialStatus[] {
    this.ensureInitialized();
    const ctraderLive = this.adapters.get('CTRADER_LIVE') as CTraderLiveAdapter;
    const fivePaisaLive = this.adapters.get('FIVE_PAISA_LIVE') as FivePaisaLiveAdapter;

    const cLiveStatus = ctraderLive.getConfigStatus();
    const fpLiveStatus = fivePaisaLive.getConfigStatus();

    return [
      {
        broker: 'CTRADER',
        environment: 'LIVE',
        configured: cLiveStatus.configured,
        maskedAccountId: cLiveStatus.maskedAccountId,
        maskedClientId: cLiveStatus.maskedClientId,
        status: cLiveStatus.configured ? 'CONNECTED' : 'DISCONNECTED'
      },
      {
        broker: 'FIVE_PAISA',
        environment: 'LIVE',
        configured: fpLiveStatus.configured,
        hasAccessToken: fpLiveStatus.hasAccessToken,
        hasTotpSecret: fpLiveStatus.hasTotpSecret,
        maskedClientId: fpLiveStatus.maskedClientId,
        maskedAccessToken: fpLiveStatus.maskedAccessToken,
        maskedTotpSecret: fpLiveStatus.maskedTotpSecret,
        maskedPin: fpLiveStatus.maskedPin,
        status: fpLiveStatus.configured ? 'CONNECTED' : 'DISCONNECTED'
      }
    ];
  }


  updateLiveCredentials(broker: BrokerType, creds: Record<string, any>): void {
    this.ensureInitialized();
    if (broker === 'CTRADER') {
      (this.adapters.get('CTRADER_LIVE') as CTraderLiveAdapter).updateCredentials(creds);
    } else if (broker === 'FIVE_PAISA') {
      (this.adapters.get('FIVE_PAISA_LIVE') as FivePaisaLiveAdapter).updateCredentials(creds);
    }
  }

  deleteCredentials(broker: BrokerType, environment: TradingEnvironment): void {
    this.ensureInitialized();
    const key = `${broker}_${environment}`;
    const adapter = this.adapters.get(key) as any;
    if (adapter && typeof adapter.clearCredentials === 'function') {
      adapter.clearCredentials();
    }
  }
}

export const brokerRegistry = new BrokerRegistry();
