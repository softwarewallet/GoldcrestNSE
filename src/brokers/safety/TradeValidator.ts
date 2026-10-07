import { OrderRequest, TradingEnvironment, BrokerType, BrokerInstrument } from '../types';
import { BrokerError } from '../errors';
import { brokerRegistry } from '../registry';
import { killSwitch } from './KillSwitch';
import { getSystemConfig } from '../../services/configService';

export interface SignalValidationInput {
  signalId?: string;
  strategyId?: string;
  market: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  signalTimestamp: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  spread: number;
  broker: BrokerType;
  environment: TradingEnvironment;
}

export interface TradeValidationResult {
  valid: boolean;
  rejectionReason?: string;
  checks: {
    emergencyHaltPassed: boolean;
    marketCompatibilityPassed: boolean;
    signalAgePassed: boolean;
    priceProximityPassed: boolean;
    riskRewardPassed: boolean;
    spreadPassed: boolean;
    duplicateCheckPassed: boolean;
    orderParametersPassed: boolean;
    maximumTradeValuePassed: boolean;
  };
}

export class TradeValidator {
  // Configurable maximum signal age (Requirement 27)
  private maxSignalAgeForexMs: number = 5 * 60 * 1000; // 5 minutes default
  private maxSignalAgeOptionsMs: number = 2 * 60 * 1000; // 2 minutes default

  // Active positions tracker for duplicate protection (Requirement 28)
  private activeStrategyPositions: Map<string, { symbol: string; side: string; strategyId?: string; signalId?: string }> = new Map();

  setMaxSignalAge(forexMinutes: number, optionsMinutes: number): void {
    this.maxSignalAgeForexMs = forexMinutes * 60 * 1000;
    this.maxSignalAgeOptionsMs = optionsMinutes * 60 * 1000;
  }

  getMaxSignalAgeConfig() {
    return {
      forexMinutes: this.maxSignalAgeForexMs / 60000,
      optionsMinutes: this.maxSignalAgeOptionsMs / 60000
    };
  }

  registerActivePosition(id: string, symbol: string, side: string, strategyId?: string, signalId?: string) {
    this.activeStrategyPositions.set(id, { symbol, side, strategyId, signalId });
  }

  unregisterActivePosition(id: string) {
    this.activeStrategyPositions.delete(id);
  }

  resetTracking(): void {
    this.activeStrategyPositions.clear();
  }

  isDuplicatePosition(symbol: string, side: string, strategyId?: string, signalId?: string): { isDuplicate: boolean; reason?: string } {
    const config = getSystemConfig();
    const maxTradesPerPair = Number(config.autoLiveMaxTradesPerPair);
    const samePairCount = [...this.activeStrategyPositions.values()]
      .filter(pos => String(pos.symbol || '').toUpperCase() === String(symbol || '').toUpperCase())
      .length;

    if (Number.isInteger(maxTradesPerPair) && maxTradesPerPair > 0 && samePairCount >= maxTradesPerPair) {
      return {
        isDuplicate: true,
        reason: `Maximum simultaneous trades for ${symbol} reached (${samePairCount}/${maxTradesPerPair}).`
      };
    }

    return { isDuplicate: false };
  }

  validateSignalAndOrder(
    input: SignalValidationInput,
    order: OrderRequest,
    instrument?: BrokerInstrument | null
  ): TradeValidationResult {
    const config = getSystemConfig();
    const checks = {
      emergencyHaltPassed: !killSwitch.isHalted(),
      marketCompatibilityPassed: true,
      signalAgePassed: true,
      priceProximityPassed: true,
      riskRewardPassed: true,
      spreadPassed: true,
      duplicateCheckPassed: true,
      orderParametersPassed: true,
      maximumTradeValuePassed: true
    };

    // 1. Emergency Stop Check
    if (!checks.emergencyHaltPassed) {
      return {
        valid: false,
        rejectionReason: 'TRADING HALTED: Emergency Kill Switch is currently active.',
        checks
      };
    }

    // 2. Market / Broker Compatibility
    const compat = brokerRegistry.validateMarketCompatibility(input.market, input.broker);
    if (!compat.compatible) {
      checks.marketCompatibilityPassed = false;
      return {
        valid: false,
        rejectionReason: compat.reason || 'Market and broker combination is incompatible.',
        checks
      };
    }

    // 3. Signal Age Check (Requirement 27)
    const now = Date.now();
    const ageMs = now - input.signalTimestamp;
    const maxAge = input.market === 'FOREX' ? this.maxSignalAgeForexMs : this.maxSignalAgeOptionsMs;

    if (ageMs > maxAge) {
      checks.signalAgePassed = false;
      return {
        valid: false,
        rejectionReason: `SIGNAL EXPIRED: Signal age (${Math.round(ageMs / 1000)}s) exceeded maximum threshold (${maxAge / 1000}s).`,
        checks
      };
    }

    // 4. Per-pair simultaneous trade limit.
    // Multiple trades on the same pair are allowed while the operator-configured
    // Auto Live limit has not been reached. The authoritative broker position
    // check in LiveTradingGate performs the final server-side enforcement.
    const maxTradesPerPair = Number(config.autoLiveMaxTradesPerPair);
    const samePairPositions = [...this.activeStrategyPositions.values()]
      .filter(pos => String(pos.symbol || '').toUpperCase() === String(input.symbol || '').toUpperCase())
      .length;
    if (!Number.isInteger(maxTradesPerPair) || maxTradesPerPair < 1 || samePairPositions >= maxTradesPerPair) {
      checks.duplicateCheckPassed = false;
      return {
        valid: false,
        rejectionReason: `PAIR_POSITION_LIMIT: ${input.symbol} has ${samePairPositions} tracked position(s); configured Auto Live maximum is ${maxTradesPerPair}.`,
        checks
      };
    }

    // 5. Risk / Reward and Stop Loss validation
    if (order.stopLoss !== undefined && order.stopLoss !== null) {
      const riskDistance = Math.abs(input.currentPrice - order.stopLoss);
      if (riskDistance <= 0) {
        checks.riskRewardPassed = false;
        return {
          valid: false,
          rejectionReason: 'INVALID STOP: Stop Loss cannot be equal to current entry price.',
          checks
        };
      }

      if (order.takeProfit !== undefined && order.takeProfit !== null) {
        const rewardDistance = Math.abs(order.takeProfit - input.currentPrice);
        const rrRatio = rewardDistance / riskDistance;
        if (rrRatio < 0.8) {
          checks.riskRewardPassed = false;
          return {
            valid: false,
            rejectionReason: `POOR RISK/REWARD: Calculated R:R ratio (${rrRatio.toFixed(2)}) is below minimal safety threshold (0.80).`,
            checks
          };
        }
      }
    }

    // 6. Quantity and Order Parameters
    if (order.quantity <= 0) {
      checks.orderParametersPassed = false;
      return {
        valid: false,
        rejectionReason: 'INVALID_QUANTITY: Order quantity must be greater than zero.',
        checks
      };
    }

    if (instrument) {
      if (order.quantity < instrument.minQuantity) {
        checks.orderParametersPassed = false;
        return {
          valid: false,
          rejectionReason: `INVALID_QUANTITY: Quantity ${order.quantity} is below instrument minimum (${instrument.minQuantity}).`,
          checks
        };
      }
    }

    // 6. Per-broker maximum trade value hard limit.
    // This check runs in TradeValidator because the signal-driven execution
    // pipeline must enforce the same limit even when it does not invoke the
    // HTTP broker route /api/brokers/order.
    const isForex = input.market === 'FOREX';
    const maxTradeValue = isForex ? config.maxTradeValueForexUsd : config.maxTradeValueIndianInr;
    const referencePrice = order.price && order.price > 0 ? order.price : input.currentPrice;
    const quoteCurrency = isForex ? input.symbol.replace(/[^A-Z]/g, '').slice(-3) : 'INR';
    const tradeValue = Number(order.quantity) * Number(referencePrice);
    let maximumTradeValuePassed = Number.isFinite(maxTradeValue) && maxTradeValue > 0 && Number.isFinite(tradeValue) && tradeValue > 0;

    if (maximumTradeValuePassed && isForex && quoteCurrency !== 'USD') {
      maximumTradeValuePassed = false;
      return {
        valid: false,
        rejectionReason: `MAX_TRADE_VALUE_UNVERIFIABLE: Forex pair ${input.symbol} is quoted in ${quoteCurrency}; USD conversion is unavailable, so the configured USD limit cannot be safely verified.`,
        checks: { ...checks, maximumTradeValuePassed }
      };
    }

    if (maximumTradeValuePassed && tradeValue > maxTradeValue) {
      maximumTradeValuePassed = false;
      return {
        valid: false,
        rejectionReason: `MAX_TRADE_VALUE_EXCEEDED: Trade value ${tradeValue.toFixed(2)} ${isForex ? 'USD' : 'INR'} exceeds the configured maximum of ${maxTradeValue.toFixed(2)} ${isForex ? 'USD' : 'INR'} for ${isForex ? 'cTrader' : '5paisa'}.`,
        checks: { ...checks, maximumTradeValuePassed }
      };
    }

    if (!maximumTradeValuePassed) {
      return {
        valid: false,
        rejectionReason: 'MAX_TRADE_VALUE_INVALID: Maximum trade value could not be safely calculated or configured limit is invalid.',
        checks: { ...checks, maximumTradeValuePassed }
      };
    }

    return {
      valid: true,
      checks
    };
  }
}

export const tradeValidator = new TradeValidator();
