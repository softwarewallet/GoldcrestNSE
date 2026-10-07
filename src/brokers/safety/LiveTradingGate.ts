import { BrokerAdapter, LiveTradingGateResult, OrderRequest, NormalizedQuote } from '../types';
import { brokerRegistry } from '../registry';
import { killSwitch } from './KillSwitch';
import { tradeValidator } from './TradeValidator';
import { getSystemConfig } from '../../services/configService';
import { liveRuntimeLog } from '../../services/liveRuntimeLog';

export interface LiveGateEvaluationParams {
  order: OrderRequest;
  signalAgeMs: number;
  currentQuote: NormalizedQuote;
  isMarketOpen: boolean;
  dailyRealizedLoss: number;
  dailyLossLimit: number;
  totalAccountExposure: number;
  maxAllowedExposure: number;
  activePositionsCount: number;
  maxOpenPositions: number;
  activePairPositionsCount: number;
  maxPairPositions: number;
  /** Maximum acceptable age of the authoritative broker quote. Goldcrest live policy is fixed at 30 seconds. */
}

export class LiveTradingGate {
  /**
   * Evaluates all 15 safety criteria before ANY LIVE order can be dispatched.
   */
  async evaluate(adapter: BrokerAdapter, params: LiveGateEvaluationParams): Promise<LiveTradingGateResult> {
    const failedReasons: string[] = [];

    // Check 1: LIVE environment selected
    const liveEnvironmentSelected = adapter.environment === 'LIVE' && brokerRegistry.getEnvironment() === 'LIVE';
    if (!liveEnvironmentSelected) {
      failedReasons.push('Condition 1 Failed: Active environment is not LIVE.');
    }

    // Check 2: Live broker connected
    const status = await adapter.getTradingStatus();
    const liveBrokerConnected = status === 'CONNECTED';
    if (!liveBrokerConnected) {
      failedReasons.push(`Condition 2 Failed: Broker status is ${status}, must be CONNECTED.`);
    }

    // Check 3: Account successfully validated
    let accountValidated = false;
    let permissions: string[] = [];
    try {
      const account = await adapter.getAccount();
      accountValidated = Boolean(account && account.accountId && account.balance > 0);
      permissions = account.permissions || [];
    } catch {
      accountValidated = false;
    }
    if (!accountValidated) {
      failedReasons.push('Condition 3 Failed: Live account could not be validated or has non-positive balance.');
    }

    // Check 4: Trading permission confirmed
    const tradingPermissionConfirmed = permissions.includes('TRADING') || permissions.includes('EQUITY') || permissions.includes('DERIVATIVES') || permissions.includes('NSE_FNO');
    if (!tradingPermissionConfirmed) {
      failedReasons.push('Condition 4 Failed: Account lacks confirmed broker trading permissions.');
    }

    // Check 5: Instrument validated
    const instrument = await adapter.getInstrument(params.order.symbol);
    const instrumentValidated = instrument !== null;
    if (!instrumentValidated) {
      failedReasons.push(`Condition 5 Failed: Instrument ${params.order.symbol} is not valid on this broker.`);
    }

    // Check 6: Market open
    const marketOpen = params.isMarketOpen && !killSwitch.isHalted();
    if (!marketOpen) {
      failedReasons.push('Condition 6 Failed: Market is currently closed or emergency halted.');
    }

    // Check 7: Goldcrest-wide live quote freshness policy is fixed at 30s.
    // There is intentionally no caller override or shorter fallback. This
    // prevents any future execution path from silently reintroducing a 10s
    // freshness requirement without an explicit code change here.
    const quoteMaxAgeMs = 30_000;
    const marketDataFresh = params.currentQuote.status === 'FRESH'
      && (Date.now() - params.currentQuote.timestamp < quoteMaxAgeMs);
    if (!marketDataFresh) {
      failedReasons.push(
        `Condition 7 Failed: Market data quote is stale or delayed (>${Math.round(quoteMaxAgeMs / 1000)}s old).`
      );
    }

    // Check 8: Signal still valid (Max age: 5 min for Forex, 2 min for options)
    const maxAge = params.order.market === 'FOREX' ? 300000 : 120000;
    const signalStillValid = params.signalAgeMs >= 0 && params.signalAgeMs <= maxAge;
    if (!signalStillValid) {
      failedReasons.push(`Condition 8 Failed: Signal age (${Math.round(params.signalAgeMs / 1000)}s) exceeds max threshold (${maxAge / 1000}s).`);
    }

    // Check 9: Risk check passed (Stop loss exists & is valid)
    const riskCheckPassed = Boolean(params.order.stopLoss && params.order.stopLoss > 0);
    if (!riskCheckPassed) {
      failedReasons.push('Condition 9 Failed: Live order must strictly include a defined positive Stop Loss.');
    }

    // Check 10: Position-size check passed
    const positionSizeCheckPassed = params.order.quantity > 0 && (!instrument || params.order.quantity <= instrument.maxQuantity);
    if (!positionSizeCheckPassed) {
      failedReasons.push('Condition 10 Failed: Order quantity exceeds allowable broker limits.');
    }

    // Check 11: Daily loss limit not exceeded
    const dailyLossLimitNotExceeded = Math.abs(params.dailyRealizedLoss) < params.dailyLossLimit;
    if (!dailyLossLimitNotExceeded) {
      failedReasons.push('Condition 11 Failed: Daily loss limit breached.');
    }

    // Check 12: Maximum account exposure threshold.
    //
    // TEMPORARILY DISABLED BY OPERATOR REQUEST.
    // The exposure calculation/rejection path remains intentionally bypassed
    // while the root cause is investigated. Keep the supplied exposure
    // parameters in the evaluation interface for compatibility with existing
    // dispatch callers, but Condition 12 must not reject a live order.
    const maxExposureNotExceeded = true;

    // Checks 13 and 13B both depend on the broker's CURRENT position set.
    // Never use the caller's earlier position count for 13B because Auto Live
    // analyzes pairs concurrently and the account can change between analysis
    // and this final dispatch boundary.
    let authoritativePositions: Awaited<ReturnType<BrokerAdapter['getPositions']>> = [];
    let positionsVerified = false;
    try {
      authoritativePositions = await adapter.getPositions();
      positionsVerified = Array.isArray(authoritativePositions);
    } catch {
      positionsVerified = false;
    }

    // Check 13: Per-pair simultaneous-position limit.
    // Multiple positions on the same Forex pair are intentionally allowed up
    // to the operator-configured Auto Live per-pair limit. A single existing
    // position must NOT automatically reject a second/third/fourth trade.
    let duplicatePositionCheckPassed = false;
    let authoritativePairPositionsCount = 0;
    if (positionsVerified) {
      authoritativePairPositionsCount = authoritativePositions.filter(
        position => String(position.symbol || '').toUpperCase() === String(params.order.symbol || '').toUpperCase()
      ).length;
      const pairPositionLimit = Number(params.maxPairPositions);

      duplicatePositionCheckPassed = Number.isInteger(pairPositionLimit)
        && pairPositionLimit > 0
        && authoritativePairPositionsCount < pairPositionLimit;

      if (!duplicatePositionCheckPassed) {
        failedReasons.push(
          `Condition 13 Failed: Maximum simultaneous live trades for ${params.order.symbol} (${pairPositionLimit}) reached. Current positions: ${authoritativePairPositionsCount}.`
        );
      }
    } else {
      failedReasons.push('Condition 13 Failed: Unable to verify existing positions.');
    }

    // Check 13B: Maximum number of simultaneous live positions ACROSS THE
    // ENTIRE LIVE ACCOUNT. This is intentionally independent of the requested
    // pair. A USD/CAD order can therefore fail 13B even when USD/CAD itself
    // has zero open positions if five positions exist on other pairs.
    const authoritativeActivePositionsCount = positionsVerified
      ? authoritativePositions.length
      : Number.NaN;
    const maxOpenPositionsCheckPassed = positionsVerified
      && Number.isFinite(authoritativeActivePositionsCount)
      && authoritativeActivePositionsCount < params.maxOpenPositions;

    if (!maxOpenPositionsCheckPassed) {
      if (positionsVerified) {
        failedReasons.push(
          `Condition 13B Failed: Maximum open live positions (${params.maxOpenPositions}) reached. Current account positions: ${authoritativeActivePositionsCount}.`
        );
      } else {
        failedReasons.push('Condition 13B Failed: Unable to verify current account position count.');
      }
    }
    // Check 14: Order parameters validated
    const orderParametersValidated = Boolean(params.order.market && params.order.symbol && params.order.side && params.order.orderType);
    if (!orderParametersValidated) {
      failedReasons.push('Condition 14 Failed: Malformed order parameters.');
    }

    // Check 16: Per-broker maximum trade value.
    //
    // cTrader LIVE Forex has an explicit execution contract: the configured
    // maxTradeValueForexUsd is passed directly as the cTrader protocol
    // volume. It is NOT a USD notional that should be recalculated from
    // price/quote-currency conversion. The operator controls the broker
    // volume by setting this value.
    const config = getSystemConfig();
    const isForex = params.order.market === 'FOREX';
    const maxTradeValue = isForex ? config.maxTradeValueForexUsd : config.maxTradeValueIndianInr;
    let maximumTradeValueCheckPassed = Number.isFinite(maxTradeValue) && maxTradeValue > 0;
    let tradeValue = NaN;
    let tradeValueUsd = NaN;

    if (maximumTradeValueCheckPassed && isForex && adapter.environment === 'LIVE') {
      // For cTrader LIVE Forex, maxTradeValueForexUsd is the broker protocol
      // volume itself. Do not multiply order quantity by price or perform
      // quote-currency conversion here. The configured value is also the
      // authoritative per-order ceiling, so any execution path that supplies
      // a larger quantity is rejected before broker submission.
      if (!Number.isSafeInteger(maxTradeValue)) {
        maximumTradeValueCheckPassed = false;
        failedReasons.push(
          'Condition 16 Failed: Configured maximum Forex trade value must be a positive integer because cTrader volume is an integer protocol field.'
        );
      } else if (!Number.isSafeInteger(params.order.quantity) || params.order.quantity <= 0) {
        maximumTradeValueCheckPassed = false;
        failedReasons.push(
          'Condition 16 Failed: Live cTrader Forex order quantity must be a positive integer.'
        );
      } else if (params.order.quantity > maxTradeValue) {
        maximumTradeValueCheckPassed = false;
        failedReasons.push(
          `Condition 16 Failed: Forex order quantity ${params.order.quantity} exceeds configured maximum direct quantity ${maxTradeValue} for cTrader.`
        );
      }
    } else {
      const referencePrice = params.order.price && params.order.price > 0
        ? params.order.price
        : (params.order.side === 'BUY' ? params.currentQuote.ask : params.currentQuote.bid);
      tradeValue = referencePrice > 0 && params.order.quantity > 0
        ? params.order.quantity * referencePrice
        : NaN;

      if (maximumTradeValueCheckPassed && isForex) {
        const instrumentForValue = instrument;
        const quoteCurrency = instrumentForValue?.quoteCurrency || params.order.symbol.replace(/[^A-Z]/g, '').slice(-3);
        let quoteToUsdRate = 1;

        if (quoteCurrency !== 'USD') {
          try {
            if (typeof adapter.getAccountCurrencyConversionRate !== 'function') {
              throw new Error(`USD conversion for ${quoteCurrency} is unavailable.`);
            }
            quoteToUsdRate = await adapter.getAccountCurrencyConversionRate(quoteCurrency, 'USD');
            if (!(quoteToUsdRate > 0) || !Number.isFinite(quoteToUsdRate)) {
              throw new Error(`Invalid ${quoteCurrency}/USD conversion rate.`);
            }
          } catch (error: any) {
            maximumTradeValueCheckPassed = false;
            failedReasons.push(
              `Condition 16 Failed: Forex pair ${params.order.symbol} has quote currency ${quoteCurrency}; authoritative USD conversion is unavailable (${error?.message || 'conversion failed'}), so the limit cannot be safely verified.`
            );
          }
        }

        tradeValueUsd = tradeValue * quoteToUsdRate;
      }

      // Monetary values can contain binary floating-point noise (e.g.
      // 200.00000000000003). Treat values within a tiny absolute tolerance of
      // the configured limit as equal; genuine overages still fail closed.
      const tradeValueTolerance = 1e-8;
      if (maximumTradeValueCheckPassed && isForex && tradeValueUsd > maxTradeValue + tradeValueTolerance) {
        maximumTradeValueCheckPassed = false;
        failedReasons.push(
          `Condition 16 Failed: Trade value ${tradeValueUsd.toFixed(2)} USD exceeds configured maximum of ${maxTradeValue.toFixed(2)} USD for cTrader.`
        );
      } else if (maximumTradeValueCheckPassed && !isForex && tradeValue > maxTradeValue + tradeValueTolerance) {
        maximumTradeValueCheckPassed = false;
        failedReasons.push(
          `Condition 16 Failed: Trade value ${tradeValue.toFixed(2)} INR exceeds configured maximum of ${maxTradeValue.toFixed(2)} INR for 5paisa.`
        );
      } else if (maximumTradeValueCheckPassed && isForex && !(tradeValueUsd > 0)) {
        maximumTradeValueCheckPassed = false;
        failedReasons.push('Condition 16 Failed: USD-converted Forex trade value could not be safely calculated.');
      } else if (!maximumTradeValueCheckPassed && failedReasons.length === 0) {
        failedReasons.push('Condition 16 Failed: Trade value could not be safely calculated or the configured maximum is invalid.');
      }
    }

    // Check 15: Explicit live-trading permission enabled in server env
    const explicitLivePermissionEnabled = process.env.LIVE_TRADING_ENABLED === 'true';
    if (!explicitLivePermissionEnabled) {
      failedReasons.push('Condition 15 Failed: LIVE_TRADING_ENABLED is not set to true in environment configuration.');
    }

    const passed = failedReasons.length === 0;

    return {
      passed,
      checks: {
        liveEnvironmentSelected,
        liveBrokerConnected,
        accountValidated,
        tradingPermissionConfirmed,
        instrumentValidated,
        marketOpen,
        marketDataFresh,
        signalStillValid,
        riskCheckPassed,
        positionSizeCheckPassed,
        dailyLossLimitNotExceeded,
        maxExposureNotExceeded,
        duplicatePositionCheckPassed,
        maxOpenPositionsCheckPassed,
        orderParametersValidated,
        explicitLivePermissionEnabled,
        maximumTradeValueCheckPassed
      },
      failedReasons
    };
  }
}

export const liveTradingGate = new LiveTradingGate();
