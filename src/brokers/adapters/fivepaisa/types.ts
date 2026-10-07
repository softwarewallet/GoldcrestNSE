export interface FivePaisaConfig {
  appName?: string;
  appSource?: string;
  userId?: string;
  password?: string;
  userKey?: string;
  encryptionKey?: string;
  accessToken?: string;
  totpSecret?: string;
  pin?: string;
  clientCode?: string;
  environment: 'LIVE';
  apiHost?: string;
}

export interface FivePaisaHeader {
  appName: string;
  appSource: string;
  userId: string;
  password?: string;
  userKey: string;
  encryptionKey: string;
}

export interface FivePaisaMarginResponse {
  EquityMargin: number;
  MFMargin: number;
  NetAvailableMargin: number;
  MarginUtilized: number;
  Cash: number;
  Status: number;
  Message: string;
}

export interface FivePaisaNetPosition {
  ScripCode: number | string;
  ScripName: string;
  Exch: string; // 'N' | 'B'
  ExchType: string; // 'C' | 'D'
  BuyQty: number;
  SellQty: number;
  NetQty: number;
  BuyAvgRate: number;
  SellAvgRate: number;
  LTP: number;
  BookedPL: number;
  MTM: number;
  OrderFor: string;
}

export interface FivePaisaOrderBookEntry {
  BrokerOrderID: string;
  RemoteOrderID: string;
  Exch: string;
  ExchType: string;
  ScripCode: number | string;
  ScripName: string;
  BuySell: 'B' | 'S';
  Qty: number;
  Rate: number;
  AtMarket: boolean;
  OrderStatus: string;
  OrderDateTime: string;
  PendingQty: number;
  Reason?: string;
}

export interface FivePaisaPlaceOrderRequest {
  Exchange: 'N' | 'B' | 'M';
  ExchangeType: 'C' | 'D';
  ScripCode: number | string;
  Price: number;
  OrderType: 'BUY' | 'SELL';
  Qty: number;
  AtMarket: boolean;
  RemoteOrderID: string;
  IsStopLossOrder?: boolean;
  StopLossPrice?: number;
  IsIntraday?: boolean;
  IOCOrder?: boolean;
  DisQty?: number;
  ClientCode?: string;
}

export interface FivePaisaPlaceOrderResponse {
  BrokerOrderID: string;
  ClientCode: string;
  Exch: string;
  ExchOrderID: string;
  ExchType: string;
  LocalOrderID: number;
  Message: string;
  RMSResponseCode: number;
  ScripCode: number;
  Status: number;
  Time: string;
}

export interface FivePaisaMarketFeedItem {
  Exch: string;
  ExchType: string;
  ScripCode: number | string;
  Symbol: string;
  LastTradedPrice: number;
  High: number;
  Low: number;
  Open: number;
  Close: number;
  TotalQtyTraded: number;
  BidPrice: number;
  BidQty: number;
  AskPrice: number;
  AskQty: number;
  Change: number;
  ChangePercent: number;
  Time: string;
}

export interface FivePaisaOptionChainStrike {
  StrikePrice: number;
  CallOI: number;
  CallChangeOI: number;
  CallLTP: number;
  CallIV: number;
  CallVolume: number;
  PutOI: number;
  PutChangeOI: number;
  PutLTP: number;
  PutIV: number;
  PutVolume: number;
}
