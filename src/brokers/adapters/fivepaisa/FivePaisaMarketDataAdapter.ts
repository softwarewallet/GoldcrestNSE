import { NormalizedQuote, TradingEnvironment } from '../../types';
import { FivePaisaMarketFeedItem } from './types';
import { getIndianUnderlyingConfig } from '../../../markets/india_equity/underlyings';

export interface UnderlyingMarketData {
  symbol: string;
  name: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  change: number;
  changePercent: number;
  volume: number;
  vwap: number;
  prevDayHigh: number;
  prevDayLow: number;
  prevWeekHigh: number;
  prevWeekLow: number;
  dataSource: string;
  dataEnvironment: TradingEnvironment;
  dataFreshness: 'FRESH' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';
  timestamp: number;
  error?: string;
}

export class FivePaisaMarketDataAdapter {
  private environment: TradingEnvironment;

  constructor(environment: TradingEnvironment = 'LIVE') {
    this.environment = environment;
  }

  setEnvironment(env: TradingEnvironment): void {
    this.environment = env;
  }

  normalizeQuote(feed: FivePaisaMarketFeedItem): NormalizedQuote {
    const bid = Number(feed.BidPrice);
    const ask = Number(feed.AskPrice);

    if (!feed.Symbol || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
      throw new Error('INVALID_MARKET_DATA: 5Paisa quote is missing valid authoritative bid/ask values');
    }

    const spread = Number((ask - bid).toFixed(2));

    return {
      symbol: feed.Symbol,
      bid,
      ask,
      spread,
      timestamp: Date.now(),
      source: '5PAISA_FEED',
      environment: this.environment,
      status: 'FRESH'
    };
  }

  getUnderlyingData(symbol: string, spotPrice?: number): UnderlyingMarketData {
    const config = getIndianUnderlyingConfig(symbol);

    if (spotPrice !== undefined) {
      if (!Number.isFinite(spotPrice) || spotPrice <= 0) {
        throw new Error('INVALID_MARKET_DATA: supplied spot price is invalid');
      }

      return {
        symbol: config.symbol,
        name: config.name,
        ltp: spotPrice,
        open: spotPrice,
        high: spotPrice,
        low: spotPrice,
        close: spotPrice,
        prevClose: spotPrice,
        change: 0,
        changePercent: 0,
        volume: 0,
        vwap: spotPrice,
        prevDayHigh: spotPrice,
        prevDayLow: spotPrice,
        prevWeekHigh: spotPrice,
        prevWeekLow: spotPrice,
        dataSource: '5PAISA_XSTREAM',
        dataEnvironment: this.environment,
        dataFreshness: 'FRESH',
        timestamp: Date.now()
      };
    }

    return {
      symbol: config.symbol,
      name: config.name,
      ltp: 0,
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      prevClose: 0,
      change: 0,
      changePercent: 0,
      volume: 0,
      vwap: 0,
      prevDayHigh: 0,
      prevDayLow: 0,
      prevWeekHigh: 0,
      prevWeekLow: 0,
      dataSource: '5PAISA_XSTREAM',
      dataEnvironment: this.environment,
      dataFreshness: 'UNAVAILABLE',
      timestamp: Date.now(),
      error: 'MARKET_DATA_UNAVAILABLE: no authoritative 5Paisa underlying snapshot was supplied'
    };
  }
}
