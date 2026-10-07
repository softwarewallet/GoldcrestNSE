import { OptionChainSummary } from '../../../markets/common/types';
import { TradingEnvironment } from '../../types';
import { brokerRegistry } from '../../registry';
import { FivePaisaBrokerAdapter } from './FivePaisaBrokerAdapter';

export class FivePaisaOptionsDataAdapter {
  private environment: TradingEnvironment;

  constructor(environment: TradingEnvironment = 'LIVE') {
    this.environment = environment;
  }

  setEnvironment(env: TradingEnvironment): void {
    this.environment = env;
  }

  /**
   * Fetches real-time option chain data from the active 5paisa adapter.
   * If 5paisa connection is not available, returns blank data (no dummy/simulated data).
   */
  async getOptionChain(
    symbol: string,
    spotPrice?: number,
    selectedExpiryDate?: string,
    strikeDepth: number = 7
  ): Promise<OptionChainSummary> {
    try {
      const adapter = brokerRegistry.getFivePaisaAdapter();
      if (adapter && typeof adapter.fetchOptionChainFrom5Paisa === 'function') {
        const liveChain = await adapter.fetchOptionChainFrom5Paisa(symbol, selectedExpiryDate, strikeDepth);
        if (liveChain) {
          return liveChain;
        }
      }
    } catch (e) {
      // 5paisa adapter unavailable
    }

    // Return strictly blank data when 5paisa API is unavailable
    return {
      underlying: symbol,
      spotPrice: 0,
      atmStrike: 0,
      expiry: selectedExpiryDate || '',
      availableExpiries: [],
      totalCallOI: 0,
      totalPutOI: 0,
      pcr: 0,
      callResistanceStrike: 0,
      putSupportStrike: 0,
      highOIStrikeCall: 0,
      highOIStrikePut: 0,
      rows: [],
      isBlank: true,
      error: '5paisa API Connection Required. Authenticate 5paisa in Broker Settings to stream live option chains.',
      timestamp: Date.now()
    };
  }
}

