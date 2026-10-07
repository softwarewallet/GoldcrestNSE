export interface ForexPairConfig {
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  pipSize: number;
  digits: number;
  standardLotSize: number;
  typicalSpreadPips: number;
  description: string;
}

export const FOREX_PAIRS: ForexPairConfig[] = [
  {
    symbol: 'EUR/USD',
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    digits: 5,
    standardLotSize: 100000,
    typicalSpreadPips: 0.8,
    description: 'Euro / US Dollar'
  },
  {
    symbol: 'GBP/USD',
    baseCurrency: 'GBP',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    digits: 5,
    standardLotSize: 100000,
    typicalSpreadPips: 1.2,
    description: 'British Pound / US Dollar'
  },
  {
    symbol: 'USD/JPY',
    baseCurrency: 'USD',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    digits: 3,
    standardLotSize: 100000,
    typicalSpreadPips: 0.9,
    description: 'US Dollar / Japanese Yen'
  },
  {
    symbol: 'USD/CHF',
    baseCurrency: 'USD',
    quoteCurrency: 'CHF',
    pipSize: 0.0001,
    digits: 5,
    standardLotSize: 100000,
    typicalSpreadPips: 1.4,
    description: 'US Dollar / Swiss Franc'
  },
  {
    symbol: 'AUD/USD',
    baseCurrency: 'AUD',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    digits: 5,
    standardLotSize: 100000,
    typicalSpreadPips: 1.1,
    description: 'Australian Dollar / US Dollar'
  },
  {
    symbol: 'USD/CAD',
    baseCurrency: 'USD',
    quoteCurrency: 'CAD',
    pipSize: 0.0001,
    digits: 5,
    standardLotSize: 100000,
    typicalSpreadPips: 1.3,
    description: 'US Dollar / Canadian Dollar'
  },
  {
    symbol: 'NZD/USD',
    baseCurrency: 'NZD',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    digits: 5,
    standardLotSize: 100000,
    typicalSpreadPips: 1.6,
    description: 'New Zealand Dollar / US Dollar'
  },
  {
    symbol: 'EUR/GBP',
    baseCurrency: 'EUR',
    quoteCurrency: 'GBP',
    pipSize: 0.0001,
    digits: 5,
    standardLotSize: 100000,
    typicalSpreadPips: 1.2,
    description: 'Euro / British Pound'
  },
  {
    symbol: 'EUR/JPY',
    baseCurrency: 'EUR',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    digits: 3,
    standardLotSize: 100000,
    typicalSpreadPips: 1.4,
    description: 'Euro / Japanese Yen'
  },
  {
    symbol: 'GBP/JPY',
    baseCurrency: 'GBP',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    digits: 3,
    standardLotSize: 100000,
    typicalSpreadPips: 1.8,
    description: 'British Pound / Japanese Yen'
  },
  {
    symbol: 'AUD/JPY',
    baseCurrency: 'AUD',
    quoteCurrency: 'JPY',
    pipSize: 0.01,
    digits: 3,
    standardLotSize: 100000,
    typicalSpreadPips: 1.5,
    description: 'Australian Dollar / Japanese Yen'
  },
  {
    symbol: 'EUR/AUD',
    baseCurrency: 'EUR',
    quoteCurrency: 'AUD',
    pipSize: 0.0001,
    digits: 5,
    standardLotSize: 100000,
    typicalSpreadPips: 1.8,
    description: 'Euro / Australian Dollar'
  },
  {
    symbol: 'GBP/AUD',
    baseCurrency: 'GBP',
    quoteCurrency: 'AUD',
    pipSize: 0.0001,
    digits: 5,
    standardLotSize: 100000,
    typicalSpreadPips: 2.1,
    description: 'British Pound / Australian Dollar'
  },
  {
    symbol: 'XAU/USD',
    baseCurrency: 'XAU',
    quoteCurrency: 'USD',
    pipSize: 0.1,
    digits: 2,
    standardLotSize: 100,
    typicalSpreadPips: 2.5,
    description: 'Gold / US Dollar'
  }
];

export function getForexPairConfig(symbol: string): ForexPairConfig {
  const found = FOREX_PAIRS.find(p => p.symbol.toUpperCase() === symbol.toUpperCase() || p.symbol.replace('/', '').toUpperCase() === symbol.replace('/', '').toUpperCase());
  if (found) return found;

  // Fallback default
  const isJpy = symbol.toUpperCase().includes('JPY');
  const compact = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  return {
    symbol,
    baseCurrency: compact.slice(0, 3),
    quoteCurrency: compact.slice(3, 6) || 'USD',
    pipSize: isJpy ? 0.01 : 0.0001,
    digits: isJpy ? 3 : 5,
    standardLotSize: 100000,
    typicalSpreadPips: 1.5,
    description: `${symbol} Currency Pair`
  };
}

export function calculatePipDistance(price1: number, price2: number, pipSize: number): number {
  return Math.abs(price1 - price2) / pipSize;
}
