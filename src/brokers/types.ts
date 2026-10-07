// Normalized types and interfaces for Phase 2B & 2C Broker Integration

export type TradingEnvironment = 'LIVE';

export type BrokerType = 'CTRADER' | 'FIVE_PAISA';

export type BrokerStatus =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'STALE'
  | 'ERROR'
  | 'UNKNOWN';

export type BrokerErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_DATA_UNAVAILABLE'
  | 'ACCOUNT_IDENTITY_MISMATCH'
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'EMERGENCY_STOP_ACTIVE'
  | 'ENVIRONMENT_MISMATCH'
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_MARGIN'
  | 'INVALID_SYMBOL'
  | 'INVALID_QUANTITY'
  | 'MARKET_CLOSED'
  | 'ORDER_REJECTED'
  | 'BROKER_REJECTED'
  | 'RATE_LIMITED'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'BROKER_UNAVAILABLE'
  | 'STALE_DATA'
  | 'UNAVAILABLE'
  | 'SAFETY_GATE_REJECTED'
  | 'AUTONOMOUS_LIVE_EXECUTION_DISABLED'
  | 'INVALID_PRICE'
  | 'INVALID_STOP'
  | 'NOT_SUPPORTED'
  | 'LIVE_ORDER_BLOCKED_BY_DRY_RUN'
  | 'UNKNOWN_ERROR';

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';

export type OrderSide = 'BUY' | 'SELL';

export type OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export interface BrokerAccountInfo {
  accountId: string;
  accountType: 'LIVE' | 'DEMO';
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  freeMargin: number;
  currency: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  connectionStatus: BrokerStatus;
  server?: string;
  permissions?: string[];
  lastUpdate: number;
  isLiveAccount?: boolean;
}

export interface NormalizedPosition {
  id: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  market: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  /** Whether currentPrice came from a fresh broker quote or a broker-position fallback. */
  currentPriceStatus?: 'LIVE' | 'FALLBACK' | 'UNAVAILABLE';
  stopLoss?: number;
  takeProfit?: number;
  unrealizedPnL: number;
  realizedPnL: number;
  currency: string;
  timestamp: number;
  brokerPositionId?: string;
}

export interface NormalizedFill {
  brokerFillId: string;
  brokerOrderId?: string;
  /** Authoritative cTrader position ID associated with this fill, when available. */
  brokerPositionId?: string;
  quantity: number;
  price: number;
  commission?: number;
  timestamp: number;
}

export interface NormalizedPositionClose {
  brokerPositionId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  exitPrice: number;
  realizedPnL: number;
  commission?: number;
  swap?: number;
  timestamp: number;
  brokerOrderId?: string;
}

export interface NormalizedOrder {
  id: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  market: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  /** Broker-reported original/requested quantity when available; useful for partial-fill reconciliation. */
  requestedQuantity?: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  status: OrderStatus;
  filledQuantity: number;
  averageFillPrice?: number;
  commission?: number;
  timestamp: number;
  brokerOrderId?: string;
  /** Broker-native client order identity used for exact submission reconciliation. */
  clientOrderId?: string;
  strategyId?: string;
  signalId?: string;
  rejectionReason?: string;
  /** Broker-native execution events when the adapter can expose them authoritatively. */
  fillEvents?: NormalizedFill[];
}

export interface OrderRequest {
  market: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Hardcoded broker execution control: trailing stop loss is always enabled. */
  trailingStopLoss?: true;
  strategyId?: string;
  signalId?: string;
  comment?: string;
}

export interface OrderModification {
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  quantity?: number;
}

export interface NormalizedQuote {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  source: string;
  environment: TradingEnvironment;
  status: 'FRESH' | 'DELAYED' | 'STALE';
}

export interface BrokerInstrument {
  symbol: string;
  market: string;
  pipSize: number;
  minQuantity: number;
  maxQuantity: number;
  stepQuantity: number;
  digits: number;
  supportedOrderTypes: OrderType[];
  baseCurrency?: string;
  quoteCurrency?: string;
  brokerInstrumentId?: string;
}

export interface ConnectionTestResult {
  broker: BrokerType;
  environment: TradingEnvironment;
  connected: boolean;
  /** cTrader Open API transport mode used by the connection test, when applicable. */
  apiMode?: 'LIVE' | 'DEMO';
  /** cTrader Open API WebSocket endpoint used by the connection test, when applicable. */
  apiEndpoint?: string;
  account?: string;
  accountType?: string;
  balance?: number;
  equity?: number;
  availableMargin?: number;
  currency?: string;
  server?: string;
  permissions?: string[];
  timestamp: number;
  latency?: number;
  error?: string;
}

export interface BrokerAdapter {
  readonly broker: BrokerType;
  readonly environment: TradingEnvironment;
  readonly isLive: boolean;

  authenticate(): Promise<boolean>;
  disconnect(): Promise<void>;
  testConnection(): Promise<ConnectionTestResult>;
  getAccount(): Promise<BrokerAccountInfo>;
  getAccounts?(): Promise<BrokerAccountInfo[]>; // Optional discovery method
  getBalance(): Promise<number>;
  getEquity(): Promise<number>;
  getMargin(): Promise<{ usedMargin: number; freeMargin: number; marginLevelPct?: number }>;
  getPositions(): Promise<NormalizedPosition[]>;
  getOpenOrders(): Promise<NormalizedOrder[]>;
  getOrderHistory(): Promise<NormalizedOrder[]>;
  getOrderHistoryRange?(fromTimestamp: number, toTimestamp: number): Promise<NormalizedOrder[]>;
  /** Optional authoritative closed-position outcome history. */
  getPositionHistory?(positionId: string, fromTimestamp: number, toTimestamp: number): Promise<NormalizedPositionClose[]>;
  getQuote(symbol: string): Promise<NormalizedQuote>;
  /** Optional broker-native conversion path for multi-currency exposure checks. */
  getAccountCurrencyConversionRate?(fromCurrency: string, toCurrency: string): Promise<number>;
  getHistoricalCandles?(symbol: string, timeframe: string, limit: number): Promise<Array<{ open: number; high: number; low: number; close: number; volume: number; timestamp: number }>>;
  getInstrument(symbol: string): Promise<BrokerInstrument | null>;
  getInstruments(): Promise<BrokerInstrument[]>;
  placeOrder(order: OrderRequest): Promise<NormalizedOrder>;
  modifyOrder(orderId: string, modifications: OrderModification): Promise<NormalizedOrder>;
  cancelOrder(orderId: string): Promise<boolean>;
  closePosition(positionId: string, quantity?: number): Promise<boolean>;
  getOrderStatus(orderId: string, requestedQuantity?: number): Promise<NormalizedOrder>;
  /** Optional broker-native lookup using the client order identity submitted with an order. */
  getOrderByClientOrderId?(clientOrderId: string): Promise<NormalizedOrder | null>;
  getTradingStatus(): Promise<BrokerStatus>;
  getDailyRealizedPnL?(): Promise<number>;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  source: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  account: string;
  action: string;
  symbol?: string;
  quantity?: number;
  price?: number;
  orderId?: string;
  signalId?: string;
  strategyId?: string;
  result: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  error?: string;
  riskValidation?: {
    passed: boolean;
    checks: Record<string, boolean>;
    reason?: string;
  };
  executionValidation?: {
    passed: boolean;
    reason?: string;
  };
}

export interface LiveTradingGateResult {
  passed: boolean;
  checks: {
    liveEnvironmentSelected: boolean;
    liveBrokerConnected: boolean;
    accountValidated: boolean;
    tradingPermissionConfirmed: boolean;
    instrumentValidated: boolean;
    marketOpen: boolean;
    marketDataFresh: boolean;
    signalStillValid: boolean;
    riskCheckPassed: boolean;
    positionSizeCheckPassed: boolean;
    dailyLossLimitNotExceeded: boolean;
    maxExposureNotExceeded: boolean;
    duplicatePositionCheckPassed: boolean;
    maxOpenPositionsCheckPassed: boolean;
    orderParametersValidated: boolean;
    explicitLivePermissionEnabled: boolean;
    maximumTradeValueCheckPassed?: boolean;
  };
  failedReasons: string[];
}

export interface LiveControlsConfig {
  liveConnectionEnabled: boolean;
  liveTradingEnabled: boolean;
  autoExecutionEnabled: boolean;
  emergencyHalted: boolean;
}

export interface BrokerCredentialStatus {
  broker: BrokerType;
  environment: TradingEnvironment;
  configured: boolean;
  hasAccessToken?: boolean;
  hasTotpSecret?: boolean;
  maskedAccountId?: string;
  maskedClientId?: string;
  maskedClientSecret?: string;
  maskedAccessToken?: string;
  maskedTotpSecret?: string;
  maskedPin?: string;
  maskedAppName?: string;
  maskedAppSource?: string;
  maskedUserId?: string;
  maskedPassword?: string;
  maskedUserKey?: string;
  maskedEncryptionKey?: string;
  maskedClientCode?: string;
  status: BrokerStatus;
  lastTestResult?: ConnectionTestResult;
}
