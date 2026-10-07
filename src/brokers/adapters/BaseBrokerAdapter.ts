import {
  BrokerAdapter,
  BrokerAccountInfo,
  BrokerInstrument,
  BrokerStatus,
  BrokerType,
  ConnectionTestResult,
  NormalizedOrder,
  NormalizedPosition,
  NormalizedQuote,
  OrderModification,
  OrderRequest,
  TradingEnvironment,
  OrderType
} from '../types';
import { BrokerError, normalizeBrokerError } from '../errors';
import { logBrokerAction, maskIdentifier } from '../auditLog';

export abstract class BaseBrokerAdapter implements BrokerAdapter {
  abstract readonly broker: BrokerType;
  abstract readonly environment: TradingEnvironment;
  abstract readonly isLive: boolean;

  protected status: BrokerStatus = 'DISCONNECTED';
  protected lastError?: string;
  protected lastConnectionTest?: ConnectionTestResult;

  abstract authenticate(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract testConnection(): Promise<ConnectionTestResult>;
  abstract getAccount(): Promise<BrokerAccountInfo>;
  abstract getBalance(): Promise<number>;
  abstract getEquity(): Promise<number>;
  abstract getMargin(): Promise<{ usedMargin: number; freeMargin: number; marginLevelPct?: number }>;
  abstract getPositions(): Promise<NormalizedPosition[]>;
  abstract getOpenOrders(): Promise<NormalizedOrder[]>;
  abstract getOrderHistory(): Promise<NormalizedOrder[]>;
  abstract getQuote(symbol: string): Promise<NormalizedQuote>;
  abstract getInstrument(symbol: string): Promise<BrokerInstrument | null>;
  abstract getInstruments(): Promise<BrokerInstrument[]>;
  abstract placeOrder(order: OrderRequest): Promise<NormalizedOrder>;
  abstract modifyOrder(orderId: string, modifications: OrderModification): Promise<NormalizedOrder>;
  abstract cancelOrder(orderId: string): Promise<boolean>;
  abstract closePosition(positionId: string, quantity?: number): Promise<boolean>;
  abstract getOrderStatus(orderId: string): Promise<NormalizedOrder>;

  async getTradingStatus(): Promise<BrokerStatus> {
    return this.status;
  }

  protected validateOrderTypeSupport(requestedType: OrderType, supportedTypes: OrderType[]): void {
    if (!supportedTypes.includes(requestedType)) {
      throw new BrokerError(
        'NOT_SUPPORTED',
        `Order type ${requestedType} is not supported by ${this.broker} (${this.environment}). Supported: ${supportedTypes.join(', ')}`,
        this.broker,
        this.environment
      );
    }
  }

  protected logAction(
    action: string,
    result: 'SUCCESS' | 'FAILURE' | 'BLOCKED',
    account: string,
    details?: {
      symbol?: string;
      quantity?: number;
      price?: number;
      orderId?: string;
      signalId?: string;
      strategyId?: string;
      error?: string;
    }
  ) {
    logBrokerAction({
      source: `ADAPTER_${this.broker}_${this.environment}`,
      broker: this.broker,
      environment: this.environment,
      account,
      action,
      result,
      ...details
    });
  }
}
