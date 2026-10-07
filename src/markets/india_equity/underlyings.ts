export interface IndianUnderlyingConfig {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  lotSize: number;
  strikeStep: number;
  tickSize: number;
  expiryDayOfWeek: number; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri
  standardExpiryDayName: string;
  indexType: 'BROAD_MARKET' | 'SECTORAL';
  description: string;
}

export const INDIAN_UNDERLYINGS: IndianUnderlyingConfig[] = [
  {
    symbol: 'NIFTY',
    name: 'NIFTY 50',
    exchange: 'NSE',
    lotSize: 25,
    strikeStep: 50,
    tickSize: 0.05,
    expiryDayOfWeek: 4, // Thursday
    standardExpiryDayName: 'Thursday',
    indexType: 'BROAD_MARKET',
    description: 'National Stock Exchange Benchmark Index'
  },
  {
    symbol: 'BANKNIFTY',
    name: 'NIFTY BANK',
    exchange: 'NSE',
    lotSize: 15,
    strikeStep: 100,
    tickSize: 0.05,
    expiryDayOfWeek: 3, // Wednesday
    standardExpiryDayName: 'Wednesday',
    indexType: 'SECTORAL',
    description: '12 Liquid Indian Banking Stocks Index'
  },
  {
    symbol: 'FINNIFTY',
    name: 'NIFTY FINANCIAL SERVICES',
    exchange: 'NSE',
    lotSize: 25,
    strikeStep: 50,
    tickSize: 0.05,
    expiryDayOfWeek: 2, // Tuesday
    standardExpiryDayName: 'Tuesday',
    indexType: 'SECTORAL',
    description: 'Indian Financial Services Sector Index'
  },
  {
    symbol: 'MIDCPNIFTY',
    name: 'NIFTY MIDCAP SELECT',
    exchange: 'NSE',
    lotSize: 50,
    strikeStep: 25,
    tickSize: 0.05,
    expiryDayOfWeek: 1, // Monday
    standardExpiryDayName: 'Monday',
    indexType: 'BROAD_MARKET',
    description: 'Top 25 Liquid Midcap Stocks'
  },
  {
    symbol: 'SENSEX',
    name: 'BSE SENSEX 30',
    exchange: 'BSE',
    lotSize: 10,
    strikeStep: 100,
    tickSize: 0.05,
    expiryDayOfWeek: 5, // Friday
    standardExpiryDayName: 'Friday',
    indexType: 'BROAD_MARKET',
    description: 'Bombay Stock Exchange 30 Leading Companies'
  }
];

export function getIndianUnderlyingConfig(symbol: string): IndianUnderlyingConfig {
  const clean = symbol.toUpperCase().replace(/\s+/g, '');
  const exact = INDIAN_UNDERLYINGS.find(u => u.symbol === clean);
  if (exact) return exact;

  const found = INDIAN_UNDERLYINGS.find(u => clean.includes(u.symbol) && u.symbol !== 'NIFTY') ||
                INDIAN_UNDERLYINGS.find(u => clean.includes(u.symbol));
  if (found) return found;

  return {
    symbol: clean,
    name: `${clean} Index`,
    exchange: 'NSE',
    lotSize: 25,
    strikeStep: 50,
    tickSize: 0.05,
    expiryDayOfWeek: 4,
    standardExpiryDayName: 'Thursday',
    indexType: 'BROAD_MARKET',
    description: 'Indian Derivative Index'
  };
}
