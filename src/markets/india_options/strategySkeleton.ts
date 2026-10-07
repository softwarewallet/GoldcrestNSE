import { StrategyPayoff, StrategyPayoffPoint } from '../common/types';
import { getIndianUnderlyingConfig } from '../india_equity/underlyings';

export type OptionStrategyType =
  | 'LONG_CALL'
  | 'LONG_PUT'
  | 'BULL_CALL_SPREAD'
  | 'BEAR_PUT_SPREAD'
  | 'BULL_PUT_SPREAD'
  | 'BEAR_CALL_SPREAD';

export interface StrategyParameters {
  strategyType: OptionStrategyType;
  underlying: string;
  spotPrice: number;
  strike1: number; // For single leg or spread lower leg
  premium1: number; // Premium for leg 1
  strike2?: number; // For spread upper leg
  premium2?: number; // Premium for leg 2
  contractsCount?: number;
}

export function calculateStrategyPayoff(params: StrategyParameters): StrategyPayoff {
  const config = getIndianUnderlyingConfig(params.underlying);
  const lotSize = config.lotSize * (params.contractsCount ?? 1);
  const S = params.spotPrice;
  const K1 = params.strike1;
  const P1 = params.premium1;
  const K2 = params.strike2 ?? K1 + config.strikeStep;
  const P2 = params.premium2 ?? P1 * 0.4;

  let maxProfit = 0;
  let maxLoss = 0;
  let breakeven: number[] = [];
  let riskRewardRatio = 0;
  let netDebitOrCredit = 0;
  let capitalRequired = 0;

  const pointsCount = 40;
  const rangeSpan = config.strikeStep * 6;
  const minPrice = Math.max(0, S - rangeSpan);
  const maxPrice = S + rangeSpan;
  const step = (maxPrice - minPrice) / pointsCount;
  const payoffPoints: StrategyPayoffPoint[] = [];

  switch (params.strategyType) {
    case 'LONG_CALL': {
      netDebitOrCredit = P1 * lotSize;
      maxLoss = P1 * lotSize;
      maxProfit = Infinity; // Theoretically uncapped
      breakeven = [K1 + P1];
      capitalRequired = maxLoss;
      riskRewardRatio = 3.5; // Model-targeted R:R

      for (let p = minPrice; p <= maxPrice; p += step) {
        const payoff = Math.max(0, p - K1) - P1;
        payoffPoints.push({ underlyingPrice: Number(p.toFixed(1)), pnl: Math.round(payoff * lotSize) });
      }
      break;
    }

    case 'LONG_PUT': {
      netDebitOrCredit = P1 * lotSize;
      maxLoss = P1 * lotSize;
      maxProfit = (K1 - P1) * lotSize;
      breakeven = [K1 - P1];
      capitalRequired = maxLoss;
      riskRewardRatio = 3.2;

      for (let p = minPrice; p <= maxPrice; p += step) {
        const payoff = Math.max(0, K1 - p) - P1;
        payoffPoints.push({ underlyingPrice: Number(p.toFixed(1)), pnl: Math.round(payoff * lotSize) });
      }
      break;
    }

    case 'BULL_CALL_SPREAD': {
      // Buy lower strike call K1 (pay P1), sell higher strike call K2 (receive P2)
      const netDebit = P1 - P2;
      netDebitOrCredit = netDebit * lotSize;
      maxLoss = Math.max(0, netDebit * lotSize);
      const strikeWidth = K2 - K1;
      maxProfit = Math.max(0, (strikeWidth - netDebit) * lotSize);
      breakeven = [K1 + netDebit];
      riskRewardRatio = maxLoss > 0 ? Number((maxProfit / maxLoss).toFixed(2)) : 0;
      capitalRequired = maxLoss;

      for (let p = minPrice; p <= maxPrice; p += step) {
        const longCallVal = Math.max(0, p - K1);
        const shortCallVal = Math.max(0, p - K2);
        const pnl = (longCallVal - shortCallVal - netDebit) * lotSize;
        payoffPoints.push({ underlyingPrice: Number(p.toFixed(1)), pnl: Math.round(pnl) });
      }
      break;
    }

    case 'BEAR_PUT_SPREAD': {
      // Buy higher strike put K2 (pay P2), sell lower strike put K1 (receive P1)
      const netDebit = P2 - P1;
      netDebitOrCredit = netDebit * lotSize;
      maxLoss = Math.max(0, netDebit * lotSize);
      const strikeWidth = K2 - K1;
      maxProfit = Math.max(0, (strikeWidth - netDebit) * lotSize);
      breakeven = [K2 - netDebit];
      riskRewardRatio = maxLoss > 0 ? Number((maxProfit / maxLoss).toFixed(2)) : 0;
      capitalRequired = maxLoss;

      for (let p = minPrice; p <= maxPrice; p += step) {
        const longPutVal = Math.max(0, K2 - p);
        const shortPutVal = Math.max(0, K1 - p);
        const pnl = (longPutVal - shortPutVal - netDebit) * lotSize;
        payoffPoints.push({ underlyingPrice: Number(p.toFixed(1)), pnl: Math.round(pnl) });
      }
      break;
    }

    case 'BULL_PUT_SPREAD': {
      // Credit spread: Sell higher strike put K2 (receive P2), buy lower strike put K1 (pay P1)
      const netCredit = P2 - P1;
      netDebitOrCredit = -netCredit * lotSize;
      maxProfit = netCredit * lotSize;
      const strikeWidth = K2 - K1;
      maxLoss = (strikeWidth - netCredit) * lotSize;
      breakeven = [K2 - netCredit];
      riskRewardRatio = maxLoss > 0 ? Number((maxProfit / maxLoss).toFixed(2)) : 0;
      capitalRequired = (strikeWidth * lotSize);

      for (let p = minPrice; p <= maxPrice; p += step) {
        const shortPutVal = Math.max(0, K2 - p);
        const longPutVal = Math.max(0, K1 - p);
        const pnl = (netCredit - (shortPutVal - longPutVal)) * lotSize;
        payoffPoints.push({ underlyingPrice: Number(p.toFixed(1)), pnl: Math.round(pnl) });
      }
      break;
    }

    case 'BEAR_CALL_SPREAD': {
      // Credit spread: Sell lower strike call K1 (receive P1), buy higher strike call K2 (pay P2)
      const netCredit = P1 - P2;
      netDebitOrCredit = -netCredit * lotSize;
      maxProfit = netCredit * lotSize;
      const strikeWidth = K2 - K1;
      maxLoss = (strikeWidth - netCredit) * lotSize;
      breakeven = [K1 + netCredit];
      riskRewardRatio = maxLoss > 0 ? Number((maxProfit / maxLoss).toFixed(2)) : 0;
      capitalRequired = (strikeWidth * lotSize);

      for (let p = minPrice; p <= maxPrice; p += step) {
        const shortCallVal = Math.max(0, p - K1);
        const longCallVal = Math.max(0, p - K2);
        const pnl = (netCredit - (shortCallVal - longCallVal)) * lotSize;
        payoffPoints.push({ underlyingPrice: Number(p.toFixed(1)), pnl: Math.round(pnl) });
      }
      break;
    }
  }

  return {
    strategyName: params.strategyType.replace(/_/g, ' '),
    underlying: params.underlying,
    maxProfit: maxProfit === Infinity ? 999999 : Math.round(maxProfit),
    maxLoss: Math.round(maxLoss),
    breakeven: breakeven.map(b => Number(b.toFixed(1))),
    riskRewardRatio,
    netDebitOrCredit: Math.round(netDebitOrCredit),
    capitalRequired: Math.round(capitalRequired),
    payoffPoints
  };
}
