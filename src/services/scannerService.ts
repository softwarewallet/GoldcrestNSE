import { TradingSignal } from '../markets/common/types';
import { brokerRegistry } from '../brokers/registry';
import { calculateStrategyPayoff, OptionStrategyType } from '../markets/india_options/strategySkeleton';
import { getSystemConfig } from './configService';

export interface OptionsOpportunityCandidate {
  id: string;
  underlying: string;
  spot: number;
  strategyType: OptionStrategyType;
  title: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  mlProbability: number | null;
  entryPremium: number;
  maxLoss: number;
  maxProfit: number;
  breakeven: number[];
  riskReward: number;
  status: 'LONG_CALL' | 'LONG_PUT' | 'BULL_CALL_SPREAD' | 'BEAR_PUT_SPREAD' | 'WAIT' | 'NO_TRADE';
  reasons: string[];
  invalidation: string[];
  expiry: string;
  optionType: 'CALL' | 'PUT';
  strike: number;
  contractSymbol: string;
  lotSize: number;
  liveBid: number;
  liveAsk: number;
  liveLtp: number;
  brokerInstrumentId?: string;
}

export class ScannerService {
  private getFivePaisaAdapter() {
    const adapter = brokerRegistry.getFivePaisaAdapter();
    if (!adapter) throw new Error('5paisa LIVE adapter is unavailable.');
    return adapter;
  }

  async getForexScanner(_pairs?: string[]) {
    return [];
  }

  async getIndianMarketScanner() {
    const adapter = this.getFivePaisaAdapter();
    return adapter.fetchIndianUnderlyingsFrom5Paisa();
  }

  async getOptionsScanner(
    symbol: string = 'NIFTY',
    selectedExpiryDate?: string,
    strikeDepth: number = getSystemConfig().strikeDepth
  ): Promise<{
    underlying: string;
    spot: number;
    bias: 'Bullish' | 'Bearish' | 'Range-bound';
    pcr: number;
    opportunities: OptionsOpportunityCandidate[];
    isBlank?: boolean;
    error?: string;
  }> {
    const clean = symbol.toUpperCase().replace(/\s+/g, '');
    const adapter = this.getFivePaisaAdapter();
    const [chain, underlyings] = await Promise.all([
      adapter.fetchOptionChainFrom5Paisa(clean, selectedExpiryDate, strikeDepth),
      // Option analysis is independent of the Auto Live working-universe
      // selection so every supported Indian index can be inspected here.
      adapter.fetchIndianUnderlyingsFrom5Paisa(false)
    ]);
    const underlyingData = underlyings.find(u => u.symbol === clean);

    if (!underlyingData || !chain || chain.rows.length === 0 || chain.spotPrice <= 0) {
      return {
        underlying: clean,
        spot: 0,
        bias: 'Range-bound',
        pcr: 0,
        opportunities: [],
        isBlank: true,
        error: '5paisa LIVE option data is unavailable for this instrument.'
      };
    }

    const spot = chain.spotPrice;
    const atm = chain.atmStrike;
    const atmRow = chain.rows.find(r => r.strike === atm);
    const otmCallRow = chain.rows.find(r => r.distanceFromAtm === 1);
    const otmPutRow = chain.rows.find(r => r.distanceFromAtm === -1);

    const isBullish = underlyingData.vwapStatus === 'ABOVE_VWAP';
    const isBearish = underlyingData.vwapStatus === 'BELOW_VWAP';
    const bias = isBullish ? 'Bullish' : isBearish ? 'Bearish' : 'Range-bound';
    const liveScore = Number(underlyingData.signal?.score || 0);
    const liveProbability = underlyingData.signal?.mlProbability ?? null;
    const expiryMs = chain.expiry ? Date.parse(chain.expiry) : NaN;
    const daysLeft = Number.isFinite(expiryMs) ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : null;

    const opportunities: OptionsOpportunityCandidate[] = [];

    if (atmRow && otmCallRow) {
      const payoff = calculateStrategyPayoff({
        strategyType: 'BULL_CALL_SPREAD',
        underlying: clean,
        spotPrice: spot,
        strike1: atm,
        premium1: atmRow.call.ltp,
        strike2: otmCallRow.strike,
        premium2: otmCallRow.call.ltp
      });
      opportunities.push({
        id: `opt_bcs_${clean}`,
        underlying: clean,
        spot,
        strategyType: 'BULL_CALL_SPREAD',
        title: `${clean} ${atm} CE / ${otmCallRow.strike} CE Bull Call Spread`,
        bias: 'BULLISH',
        score: isBullish ? liveScore : Math.min(liveScore, 60),
        mlProbability: liveProbability,
        entryPremium: Math.max(0, atmRow.call.ltp - otmCallRow.call.ltp),
        maxLoss: payoff.maxLoss,
        maxProfit: payoff.maxProfit,
        breakeven: payoff.breakeven,
        riskReward: payoff.riskRewardRatio,
        status: isBullish ? 'BULL_CALL_SPREAD' : 'NO_TRADE',
        reasons: isBullish
          ? [
              `Underlying live VWAP distance: ${underlyingData.vwapDistance}`,
              `Live put OI support: ${chain.putSupportStrike}`,
              'Defined-risk spread from live option quotes'
            ]
          : ['Live underlying bias is not bullish.'],
        invalidation: [
          `Spot breaks below live VWAP ${underlyingData.vwap.toFixed(1)}`,
          `Call OI resistance at live strike ${atm}`
        ],
        expiry: chain.expiry,
        optionType: 'CALL',
        strike: atmRow.strike,
        contractSymbol: atmRow.call.symbol,
        lotSize: atmRow.call.lotSize,
        liveBid: atmRow.call.bid,
        liveAsk: atmRow.call.ask,
        liveLtp: atmRow.call.ltp,
        brokerInstrumentId: atmRow.call.brokerInstrumentId
      });
    }

    if (atmRow) {
      const payoff = calculateStrategyPayoff({
        strategyType: 'LONG_CALL',
        underlying: clean,
        spotPrice: spot,
        strike1: atm,
        premium1: atmRow.call.ltp
      });
      const hasHighIV = atmRow.call.iv > 20;
      const expiryAvailable = daysLeft !== null;
      const favorable = isBullish && !hasHighIV && (!expiryAvailable || daysLeft > 2);
      opportunities.push({
        id: `opt_lc_${clean}`,
        underlying: clean,
        spot,
        strategyType: 'LONG_CALL',
        title: `${clean} ${atm} CE Naked Long Call`,
        bias: 'BULLISH',
        score: favorable ? liveScore : Math.min(liveScore, 55),
        mlProbability: liveProbability,
        entryPremium: atmRow.call.ask > 0 ? atmRow.call.ask : atmRow.call.ltp,
        maxLoss: payoff.maxLoss,
        maxProfit: payoff.maxProfit,
        breakeven: payoff.breakeven,
        riskReward: payoff.riskRewardRatio,
        status: favorable ? 'LONG_CALL' : 'WAIT',
        reasons: favorable
          ? [`Live underlying is above VWAP; expiry remaining: ${daysLeft ?? 'unknown'} days`]
          : ['Live options inputs do not satisfy the long-call filters.'],
        invalidation: [
          `Spot falls below live VWAP ${underlyingData.vwap.toFixed(1)}`,
          'Live IV expands or market structure invalidates the setup'
        ],
        expiry: chain.expiry,
        optionType: 'CALL',
        strike: atmRow.strike,
        contractSymbol: atmRow.call.symbol,
        lotSize: atmRow.call.lotSize,
        liveBid: atmRow.call.bid,
        liveAsk: atmRow.call.ask,
        liveLtp: atmRow.call.ltp,
        brokerInstrumentId: atmRow.call.brokerInstrumentId
      });
    }

    if (atmRow && otmPutRow) {
      const payoff = calculateStrategyPayoff({
        strategyType: 'BEAR_PUT_SPREAD',
        underlying: clean,
        spotPrice: spot,
        strike1: otmPutRow.strike,
        premium1: otmPutRow.put.ltp,
        strike2: atm,
        premium2: atmRow.put.ltp
      });
      opportunities.push({
        id: `opt_bps_${clean}`,
        underlying: clean,
        spot,
        strategyType: 'BEAR_PUT_SPREAD',
        title: `${clean} ${atm} PE / ${otmPutRow.strike} PE Bear Put Spread`,
        bias: 'BEARISH',
        score: isBearish ? liveScore : Math.min(liveScore, 55),
        mlProbability: liveProbability,
        entryPremium: Math.max(0, atmRow.put.ltp - otmPutRow.put.ltp),
        maxLoss: payoff.maxLoss,
        maxProfit: payoff.maxProfit,
        breakeven: payoff.breakeven,
        riskReward: payoff.riskRewardRatio,
        status: isBearish ? 'BEAR_PUT_SPREAD' : 'NO_TRADE',
        reasons: isBearish
          ? [
              'Underlying live price is below VWAP',
              `Live call OI resistance: ${chain.callResistanceStrike}`
            ]
          : ['Live underlying bias is not bearish.'],
        invalidation: ['Spot crosses above live VWAP equilibrium'],
        expiry: chain.expiry,
        optionType: 'PUT',
        strike: atmRow.strike,
        contractSymbol: atmRow.put.symbol,
        lotSize: atmRow.put.lotSize,
        liveBid: atmRow.put.bid,
        liveAsk: atmRow.put.ask,
        liveLtp: atmRow.put.ltp,
        brokerInstrumentId: atmRow.put.brokerInstrumentId
      });
    }

    if (atmRow) {
      const payoff = calculateStrategyPayoff({
        strategyType: 'LONG_PUT',
        underlying: clean,
        spotPrice: spot,
        strike1: atm,
        premium1: atmRow.put.ltp
      });
      const hasHighIV = atmRow.put.iv > 20;
      const expiryAvailable = daysLeft !== null;
      const favorable = isBearish && !hasHighIV && (!expiryAvailable || daysLeft > 2);
      opportunities.push({
        id: `opt_lp_${clean}`,
        underlying: clean,
        spot,
        strategyType: 'LONG_PUT',
        title: `${clean} ${atm} PE Long Put`,
        bias: 'BEARISH',
        score: favorable ? liveScore : Math.min(liveScore, 55),
        mlProbability: liveProbability,
        entryPremium: atmRow.put.ask > 0 ? atmRow.put.ask : atmRow.put.ltp,
        maxLoss: payoff.maxLoss,
        maxProfit: payoff.maxProfit,
        breakeven: payoff.breakeven,
        riskReward: payoff.riskRewardRatio,
        status: favorable ? 'LONG_PUT' : 'WAIT',
        reasons: favorable
          ? [
              `Live underlying is below VWAP; expiry remaining: ${daysLeft ?? 'unknown'} days`,
              `Call OI resistance: ${chain.callResistanceStrike}`
            ]
          : ['Live options inputs do not satisfy the long-put filters.'],
        invalidation: [
          `Spot rises above live VWAP ${underlyingData.vwap.toFixed(1)}`,
          'Live IV expands or market structure invalidates the setup'
        ],
        expiry: chain.expiry,
        optionType: 'PUT',
        strike: atmRow.strike,
        contractSymbol: atmRow.put.symbol,
        lotSize: atmRow.put.lotSize,
        liveBid: atmRow.put.bid,
        liveAsk: atmRow.put.ask,
        liveLtp: atmRow.put.ltp,
        brokerInstrumentId: atmRow.put.brokerInstrumentId
      });
    }

    return { underlying: clean, spot, bias, pcr: chain.pcr, opportunities };
  }

  async getAllSignals(): Promise<TradingSignal[]> {
    const india = await this.getIndianMarketScanner();
    return india
      .map(item => item.signal)
      .filter((s): s is TradingSignal => Boolean(s));
  }
}
