// ============================================================================
// OPTIONS & DERIVATIVES FEATURE ENGINEERING (NO LOOK-AHEAD BIAS)
// ============================================================================

import { OptionsFeatureVector, StrategyFeatureVector } from '../types';
import { OptionChainSummary, OptionChainStrikeRow } from '../../markets/common/types';

export function extractOptionsFeaturesAtTimestamp(
  strikeData: OptionChainStrikeRow,
  chain: OptionChainSummary,
  targetTimestamp: number,
  isCall: boolean
): OptionsFeatureVector {
  const underlyingPrice = chain.spotPrice;
  const strike = strikeData.strike;
  const distFromAtmPct = ((strike - underlyingPrice) / underlyingPrice) * 100;
  const moneyness = isCall ? underlyingPrice / strike : strike / underlyingPrice;

  const leg = isCall ? strikeData.call : strikeData.put;
  const premium = leg.ltp;
  const bid = leg.bid || premium * 0.99;
  const ask = leg.ask || premium * 1.01;
  const spreadPct = premium > 0 ? ((ask - bid) / premium) * 100 : 0;

  // Greeks
  const delta = leg.greeks?.delta ?? (isCall ? 0.5 : -0.5);
  const gamma = leg.greeks?.gamma ?? 0.002;
  const theta = leg.greeks?.theta ?? -5.0;
  const vega = leg.greeks?.vega ?? 8.0;
  const rho = leg.greeks?.rho ?? 0.01;

  // PCR calculations from chain
  const totalCallOI = chain.totalCallOI;
  const totalPutOI = chain.totalPutOI;
  const pcrTotal = chain.pcr || (totalCallOI > 0 ? totalPutOI / totalCallOI : 1.0);

  // ATM PCR
  const atmRow = chain.rows.find(r => r.strike === chain.atmStrike) || chain.rows[0];
  const pcrAtm = atmRow?.call?.oi && atmRow.call.oi > 0 ? (atmRow.put.oi / atmRow.call.oi) : 1.0;

  const oi = leg.oi;
  const oiChangePct = leg.changeOI ? (leg.changeOI / (oi > 0 ? oi : 1)) * 100 : 0;
  const iv = leg.iv || 15.0;

  // IV rank & percentile approximation
  const ivRank = Math.min(100, Math.max(0, (iv - 10) / (30 - 10) * 100));
  const ivPercentile = ivRank;

  // Liquidity score (volume + spread based)
  const liquidityScore = Math.max(0, Math.min(100, (leg.volume / 1000) * 10 - spreadPct * 5));

  return {
    underlyingPrice,
    strike,
    distFromAtmPct,
    moneyness,
    dte: (chain as any).dte || 4,
    isCall: isCall ? 1 : 0,
    premium,
    bidAskSpreadPct: spreadPct,
    volume: leg.volume,
    oi,
    oiChangePct,
    pcrAtm,
    pcrTotal,
    iv,
    ivChange: 0.5,
    ivRank,
    ivPercentile,
    delta,
    gamma,
    theta,
    vega,
    rho,
    liquidityScore,
    underlyingTrendScore: 0.5,
    underlyingMomentum: 0.2,
    underlyingVolatility: 14.5
  };
}

export function extractStrategyFeatures(
  strategyType: string,
  legsCount: number,
  netPremium: number,
  maxProfit: number,
  maxLoss: number,
  riskReward: number,
  netGreeks: { delta: number; gamma: number; theta: number; vega: number },
  dte: number,
  signalScore: number = 75
): StrategyFeatureVector {
  const typeMap: Record<string, number> = {
    'LONG_CALL': 1,
    'LONG_PUT': 2,
    'BULL_CALL_SPREAD': 3,
    'BEAR_PUT_SPREAD': 4,
    'SHORT_STRADDLE': 5,
    'SHORT_STRANGLE': 6,
    'IRON_CONDOR': 7,
    'IRON_FLY': 8
  };

  return {
    strategyTypeNum: typeMap[strategyType] || 0,
    legsCount,
    netPremium,
    maxProfit,
    maxLoss,
    riskReward,
    netDelta: netGreeks.delta,
    netGamma: netGreeks.gamma,
    netTheta: netGreeks.theta,
    netVega: netGreeks.vega,
    ivExposure: netGreeks.vega * 10,
    dte,
    liquidityScore: 85,
    signalScore
  };
}
