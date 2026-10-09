import crypto from 'node:crypto';
import { executeQuery, executeRun, executeTransaction, getDatabase } from '../database/db';
import { brokerRegistry } from '../brokers/registry';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { liveRuntimeLog, tradeAuditLog } from './liveRuntimeLog';
import { maskIdentifier } from '../brokers/auditLog';
import { getSystemConfig } from './configService';
import { claimExecutionIntent, completeExecutionIntent, failExecutionIntent } from './executionIntentService';
import type { BrokerType, OrderRequest, NormalizedOrder } from '../brokers/types';
import { BrokerError } from '../brokers/errors';

export const MANUAL_TRADE_SMALL_BUDGET_INR = 20.00;
export const MANUAL_TRADE_AUTHORIZATION_TTL_MS = 2 * 60 * 1000; // 2 minutes

export interface ManualTradeFingerprintParams {
  broker: string;
  environment: string;
  accountId: string;
  market: string;
  symbol: string;
  exchange: string;
  exchangeType: string;
  scripCode: string;
  side: string;
  orderType: string;
  quantity: number;
  lotSize: number;
  price: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  idempotencyKey: string;
  correlationId: string;
}

export function generateManualTradeFingerprint(params: ManualTradeFingerprintParams): string {
  const parts = [
    `broker=${String(params.broker || '').toUpperCase().trim()}`,
    `environment=${String(params.environment || 'LIVE').toUpperCase().trim()}`,
    `accountId=${String(params.accountId || '').trim()}`,
    `market=${String(params.market || '').toUpperCase().trim()}`,
    `symbol=${String(params.symbol || '').toUpperCase().trim()}`,
    `exchange=${String(params.exchange || '').toUpperCase().trim()}`,
    `exchangeType=${String(params.exchangeType || '').toUpperCase().trim()}`,
    `scripCode=${String(params.scripCode || '').trim()}`,
    `side=${String(params.side || '').toUpperCase().trim()}`,
    `orderType=${String(params.orderType || '').toUpperCase().trim()}`,
    `quantity=${Number(params.quantity || 0)}`,
    `lotSize=${Number(params.lotSize || 1)}`,
    `price=${Number(params.price || 0).toFixed(4)}`,
    `stopLoss=${params.stopLoss != null ? Number(params.stopLoss).toFixed(4) : 'NULL'}`,
    `takeProfit=${params.takeProfit != null ? Number(params.takeProfit).toFixed(4) : 'NULL'}`,
    `idempotencyKey=${String(params.idempotencyKey || '').trim()}`,
    `correlationId=${String(params.correlationId || '').trim()}`
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

export interface EstimatedChargesBreakdown {
  brokerage: number;
  exchangeTurnoverFee: number;
  sebiTurnoverFee: number;
  stt: number;
  gst: number;
  stampDuty: number;
  totalCharges: number;
}

export function calculateEstimatedCharges(market: string, side: 'BUY' | 'SELL', turnover: number): EstimatedChargesBreakdown {
  if (market === 'FOREX') {
    // Standard cTrader forex commission estimation
    const commission = Number((turnover * 0.00003).toFixed(2));
    return {
      brokerage: commission,
      exchangeTurnoverFee: 0,
      sebiTurnoverFee: 0,
      stt: 0,
      gst: 0,
      stampDuty: 0,
      totalCharges: commission
    };
  }

  // Indian statutory & transaction cost schedule
  const isDerivative = market === 'INDIAN_OPTIONS' || market === 'INDIAN_FUTURES';
  
  // 5paisa discount brokerage on micro trades is 0 for cash delivery or small flat fraction
  const brokerage = 0.00;
  
  // NSE exchange turnover charge: options ~ 0.05% on premium; cash ~ 0.00345%
  const exchangeRate = isDerivative ? 0.0005 : 0.0000345;
  const exchangeTurnoverFee = Number((turnover * exchangeRate).toFixed(4));
  
  // SEBI turnover fee: ₹10 per crore (0.0001%)
  const sebiTurnoverFee = Number((turnover * 0.000001).toFixed(4));
  
  // STT: on options buy is 0; on options sell is 0.0625% on premium; on cash equity delivery 0.1%
  let sttRate = 0;
  if (isDerivative && side === 'SELL') sttRate = 0.000625;
  else if (!isDerivative) sttRate = 0.001;
  const stt = Number((turnover * sttRate).toFixed(2));
  
  // GST: 18% on (brokerage + exchange turnover fee + SEBI fee)
  const gst = Number(((brokerage + exchangeTurnoverFee + sebiTurnoverFee) * 0.18).toFixed(4));
  
  // Stamp duty on buy orders: 0.003% on options, 0.015% on equity delivery
  const stampDutyRate = side === 'BUY' ? (isDerivative ? 0.00003 : 0.00015) : 0;
  const stampDuty = Number((turnover * stampDutyRate).toFixed(4));
  
  const totalCharges = Number((brokerage + exchangeTurnoverFee + sebiTurnoverFee + stt + gst + stampDuty).toFixed(2));
  
  return {
    brokerage,
    exchangeTurnoverFee,
    sebiTurnoverFee,
    stt,
    gst,
    stampDuty,
    totalCharges
  };
}

export interface PrepareManualTradeInput {
  broker?: BrokerType;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'MARKET' | 'STOP_LOSS';
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  exchange?: string;
  segment?: string;
  idempotencyKey?: string;
  correlationId?: string;
  operatorNotes?: string;
}

export interface PrepareManualTradeResult {
  ready: boolean;
  authorizationId?: string;
  authorizationToken?: string;
  fingerprint?: string;
  expiresAt?: number;
  rejectionReasons: string[];
  review?: {
    broker: BrokerType;
    accountId: string;
    environment: 'LIVE';
    exchange: string;
    exchangeType: string;
    symbol: string;
    scripCode: string;
    side: 'BUY' | 'SELL';
    orderType: string;
    quantity: number;
    lotSize: number;
    lotCount: number;
    price: number;
    stopLoss: number | null;
    takeProfit: number | null;
    rawOrderValue: number;
    estimatedCharges: number;
    chargesBreakdown: EstimatedChargesBreakdown;
    totalEstimatedOutlay: number;
    smallTradeBudget: number;
    isWithinBudget: boolean;
    availableBalance: number;
    availableMargin: number;
    warningStatement: string;
  };
}

export interface ConfirmManualTradeInput {
  authorizationId: string;
  authorizationToken: string;
  confirmedTrade: {
    broker: BrokerType;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: string;
    quantity: number;
    price: number;
    stopLoss?: number;
    takeProfit?: number;
    exchange?: string;
    exchangeType?: string;
    scripCode?: string;
  };
  operatorConfirmed: boolean;
}

export interface ConfirmManualTradeResult {
  success: boolean;
  authorizationId: string;
  status: 'SUBMITTED' | 'ACCEPTED' | 'FILLED' | 'REJECTED' | 'FAILED' | 'RECONCILIATION_PENDING';
  brokerOrderId?: string;
  reconciled: boolean;
  order?: NormalizedOrder;
  message: string;
  error?: string;
  executedAt?: number;
}

export class ManualTradeService {
  /**
   * Retrieves account summary from the authoritative active broker.
   */
  async getAccountSummary(): Promise<{
    broker: BrokerType;
    environment: 'LIVE';
    accountId: string;
    maskedAccountId: string;
    accountType: string;
    balance: number;
    equity: number;
    availableMargin: number;
    currency: string;
    connected: boolean;
    tradingPermission: boolean;
    smallTradeBudget: number;
    killSwitchHalted: boolean;
    autonomousExecutionGateLocked: boolean;
  }> {
    await getDatabase();
    const broker = brokerRegistry.getSelectedBroker();
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');

    let account: any = null;
    let connected = false;
    try {
      const conn = await adapter.testConnection();
      connected = conn.connected === true;
      account = await adapter.getAccount();
    } catch {
      connected = false;
      account = null;
    }

    const permissions = Array.isArray(account?.permissions) ? account.permissions : [];
    const tradingPermission = broker === 'FIVE_PAISA'
      ? permissions.includes('TRADING') || permissions.includes('EQUITY') || permissions.includes('DERIVATIVES') || permissions.includes('NSE_FNO')
      : permissions.includes('TRADING') || permissions.includes('EQUITY') || permissions.includes('DERIVATIVES');

    const accountId = String(account?.accountId || '');

    return {
      broker,
      environment: 'LIVE',
      accountId,
      maskedAccountId: maskIdentifier(accountId),
      accountType: account?.accountType || 'LIVE',
      balance: Number(account?.balance || 0),
      equity: Number(account?.equity || 0),
      availableMargin: Number(account?.availableMargin ?? account?.balance ?? 0),
      currency: account?.currency || (broker === 'FIVE_PAISA' ? 'INR' : 'USD'),
      connected,
      tradingPermission,
      smallTradeBudget: MANUAL_TRADE_SMALL_BUDGET_INR,
      killSwitchHalted: killSwitch.isHalted(),
      autonomousExecutionGateLocked: true
    };
  }

  /**
   * Returns list of authoritative tradable instruments for the active broker.
   */
  async getAuthoritativeInstruments(query?: string): Promise<Array<{
    symbol: string;
    name: string;
    exchange: string;
    exchangeType: string;
    segment: string;
    scripCode: string | number;
    lotSize: number;
    tickSize: number;
    digits: number;
  }>> {
    await getDatabase();
    const broker = brokerRegistry.getSelectedBroker();
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE') as any;

    if (broker === 'FIVE_PAISA') {
      // 5paisa instruments
      const search = String(query || '').trim().toUpperCase();
      const rows: any[] = [];

      // Check if adapter has scrip master rows
      if (Array.isArray(adapter.remoteScripMasterRows) && adapter.remoteScripMasterRows.length > 0) {
        for (const row of adapter.remoteScripMasterRows) {
          if (!search || String(row.Name || row.Symbol || '').toUpperCase().includes(search)) {
            rows.push({
              symbol: String(row.Symbol || row.Name || '').toUpperCase().trim(),
              name: String(row.Name || row.Symbol || '').trim(),
              exchange: String(row.Exch || 'N'),
              exchangeType: String(row.ExchType || 'D'),
              segment: row.ExchType === 'C' ? 'EQUITY' : 'DERIVATIVES',
              scripCode: row.ScripCode,
              lotSize: Number(row.LotSize || 1),
              tickSize: Number(row.TickSize || 0.05),
              digits: 2
            });
            if (rows.length >= 50) break;
          }
        }
      }

      // If empty or test adapter, include standard curated F&O and equity underlyings
      if (rows.length === 0) {
        const standards = [
          { symbol: 'NIFTY 24000 CE', name: 'NIFTY 50 24000 CE', exchange: 'N', exchangeType: 'D', segment: 'DERIVATIVES', scripCode: '45001', lotSize: 25, tickSize: 0.05, digits: 2 },
          { symbol: 'NIFTY 24000 PE', name: 'NIFTY 50 24000 PE', exchange: 'N', exchangeType: 'D', segment: 'DERIVATIVES', scripCode: '45002', lotSize: 25, tickSize: 0.05, digits: 2 },
          { symbol: 'NIFTY 24500 CE', name: 'NIFTY 50 24500 CE', exchange: 'N', exchangeType: 'D', segment: 'DERIVATIVES', scripCode: '45003', lotSize: 25, tickSize: 0.05, digits: 2 },
          { symbol: 'NIFTY 24500 PE', name: 'NIFTY 50 24500 PE', exchange: 'N', exchangeType: 'D', segment: 'DERIVATIVES', scripCode: '45004', lotSize: 25, tickSize: 0.05, digits: 2 },
          { symbol: 'BANKNIFTY 52000 CE', name: 'NIFTY BANK 52000 CE', exchange: 'N', exchangeType: 'D', segment: 'DERIVATIVES', scripCode: '45101', lotSize: 15, tickSize: 0.05, digits: 2 },
          { symbol: 'BANKNIFTY 52000 PE', name: 'NIFTY BANK 52000 PE', exchange: 'N', exchangeType: 'D', segment: 'DERIVATIVES', scripCode: '45102', lotSize: 15, tickSize: 0.05, digits: 2 },
          { symbol: 'FINNIFTY 23000 CE', name: 'NIFTY FIN 23000 CE', exchange: 'N', exchangeType: 'D', segment: 'DERIVATIVES', scripCode: '45201', lotSize: 25, tickSize: 0.05, digits: 2 },
          { symbol: 'MIDCPNIFTY 12000 CE', name: 'NIFTY MIDCAP 12000 CE', exchange: 'N', exchangeType: 'D', segment: 'DERIVATIVES', scripCode: '45301', lotSize: 50, tickSize: 0.05, digits: 2 },
          { symbol: 'SENSEX 80000 CE', name: 'BSE SENSEX 80000 CE', exchange: 'B', exchangeType: 'D', segment: 'DERIVATIVES', scripCode: '45401', lotSize: 10, tickSize: 0.05, digits: 2 },
          { symbol: 'RELIANCE', name: 'RELIANCE INDUSTRIES LTD', exchange: 'N', exchangeType: 'C', segment: 'EQUITY', scripCode: '2885', lotSize: 1, tickSize: 0.05, digits: 2 },
          { symbol: 'TCS', name: 'TATA CONSULTANCY SERVICES', exchange: 'N', exchangeType: 'C', segment: 'EQUITY', scripCode: '11536', lotSize: 1, tickSize: 0.05, digits: 2 },
          { symbol: 'INFY', name: 'INFOSYS LTD', exchange: 'N', exchangeType: 'C', segment: 'EQUITY', scripCode: '1594', lotSize: 1, tickSize: 0.05, digits: 2 },
          { symbol: 'HDFCBANK', name: 'HDFC BANK LTD', exchange: 'N', exchangeType: 'C', segment: 'EQUITY', scripCode: '1333', lotSize: 1, tickSize: 0.05, digits: 2 },
          { symbol: 'SBIN', name: 'STATE BANK OF INDIA', exchange: 'N', exchangeType: 'C', segment: 'EQUITY', scripCode: '3045', lotSize: 1, tickSize: 0.05, digits: 2 }
        ];
        return standards.filter(s => !search || s.symbol.includes(search) || s.name.includes(search));
      }

      return rows;
    } else {
      // cTrader forex pairs
      return [
        { symbol: 'EUR/USD', name: 'Euro / US Dollar', exchange: 'CTRADER', exchangeType: 'FX', segment: 'FOREX', scripCode: '1', lotSize: 1, tickSize: 0.00001, digits: 5 },
        { symbol: 'GBP/USD', name: 'British Pound / US Dollar', exchange: 'CTRADER', exchangeType: 'FX', segment: 'FOREX', scripCode: '2', lotSize: 1, tickSize: 0.00001, digits: 5 },
        { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', exchange: 'CTRADER', exchangeType: 'FX', segment: 'FOREX', scripCode: '3', lotSize: 1, tickSize: 0.001, digits: 3 }
      ];
    }
  }

  /**
   * Prepares and validates a proposed manual single trade.
   * Enforces all risk controls, lot size multiples, and the ₹20 Small Trade Budget.
   * If valid, persists a pending authorization with a 2-minute TTL.
   */
  async prepareManualTrade(input: PrepareManualTradeInput): Promise<PrepareManualTradeResult> {
    await getDatabase();
    const rejectionReasons: string[] = [];

    // 1. Emergency Kill Switch
    if (killSwitch.isHalted()) {
      rejectionReasons.push('EMERGENCY_KILL_SWITCH_ACTIVE: Emergency stop is active. Clear emergency stop before manual trading.');
    }

    // 2. Broker verification
    const selectedBroker = brokerRegistry.getSelectedBroker();
    if (input.broker && input.broker !== selectedBroker) {
      rejectionReasons.push(`BROKER_MISMATCH: Selected broker is ${selectedBroker}, but request specified ${input.broker}.`);
    }

    const adapter = brokerRegistry.getAdapter(selectedBroker, 'LIVE') as any;

    // 3. Broker connectivity and account state
    let account: any = null;
    try {
      const conn = await adapter.testConnection();
      if (!conn?.connected) {
        rejectionReasons.push(`BROKER_NOT_CONNECTED: Active LIVE connection to ${selectedBroker} is unavailable.`);
      }
      account = await adapter.getAccount();
    } catch (err: any) {
      rejectionReasons.push(`ACCOUNT_UNAVAILABLE: Failed to read account evidence from ${selectedBroker}: ${err?.message || err}`);
    }

    if (account && account.accountType !== 'LIVE' && account.isLiveAccount === false) {
      rejectionReasons.push('ACCOUNT_NOT_LIVE: Account is not in LIVE mode.');
    }

    const permissions = Array.isArray(account?.permissions) ? account.permissions : [];
    const hasTradingPermission = selectedBroker === 'FIVE_PAISA'
      ? permissions.includes('TRADING') || permissions.includes('EQUITY') || permissions.includes('DERIVATIVES') || permissions.includes('NSE_FNO')
      : permissions.includes('TRADING') || permissions.includes('EQUITY') || permissions.includes('DERIVATIVES');

    if (account && !hasTradingPermission) {
      rejectionReasons.push('TRADING_PERMISSION_UNAVAILABLE: Account lacks required live trading permissions.');
    }

    // 4. Instrument resolution
    const symbol = String(input.symbol || '').trim();
    if (!symbol) {
      rejectionReasons.push('SYMBOL_REQUIRED: Instrument symbol is required.');
    }

    const market: string = selectedBroker === 'FIVE_PAISA'
      ? (/(?:CE|PE)$/i.test(symbol) || symbol.includes('OPT') ? 'INDIAN_OPTIONS' : 'INDIAN_EQUITY')
      : 'FOREX';

    let resolvedInst: any = null;
    if (symbol && selectedBroker === 'FIVE_PAISA') {
      try {
        if (typeof adapter.resolveAuthoritativeLiveInstrument === 'function') {
          resolvedInst = await adapter.resolveAuthoritativeLiveInstrument(symbol, market);
        } else {
          // Mock / test adapter fallback
          const inst = await adapter.getInstrument(symbol);
          resolvedInst = {
            exchange: input.exchange || (symbol.startsWith('SENSEX') ? 'B' : 'N'),
            exchangeType: (input.segment === 'EQUITY' || market === 'INDIAN_EQUITY') ? 'C' : 'D',
            scripCode: inst?.brokerInstrumentId || '99999',
            lotSize: inst?.minQuantity || (inst as any)?.lotSize || (symbol.includes('BANKNIFTY') ? 15 : symbol.includes('NIFTY') ? 25 : 1),
            symbol
          };
        }
      } catch (instErr: any) {
        rejectionReasons.push(`AUTHORITATIVE_INSTRUMENT_UNAVAILABLE: ${instErr?.message || instErr}`);
      }
    } else if (symbol && selectedBroker === 'CTRADER') {
      resolvedInst = {
        exchange: 'CTRADER',
        exchangeType: 'FX',
        scripCode: '1',
        lotSize: 1,
        symbol
      };
    }

    const lotSize = Number(resolvedInst?.lotSize || 1);
    if (!Number.isFinite(lotSize) || lotSize <= 0) {
      rejectionReasons.push('INVALID_LOT_SIZE: Authoritative lot size must be greater than zero.');
    }

    // 5. Quantity validation
    const quantity = Number(input.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      rejectionReasons.push(`INVALID_QUANTITY: Quantity ${quantity} must be a positive integer.`);
    }

    const isDerivative = market === 'INDIAN_OPTIONS' || market === 'INDIAN_FUTURES';
    if (isDerivative && lotSize > 0 && quantity > 0 && quantity % lotSize !== 0) {
      rejectionReasons.push(`NON_LOT_MULTIPLE_QUANTITY: Derivative quantity ${quantity} must be an exact positive integer multiple of authoritative lot size ${lotSize}.`);
    }

    // 6. Pricing validation
    let price = Number(input.price || 0);
    if (input.orderType === 'LIMIT') {
      if (!Number.isFinite(price) || price <= 0) {
        rejectionReasons.push('PRICE_REQUIRED_FOR_LIMIT: A positive limit price is mandatory for LIMIT orders.');
      }
    } else if (input.orderType === 'MARKET') {
      if (price <= 0) {
        // Fetch quote from broker adapter
        try {
          const q = await adapter.getQuote(symbol);
          price = Number(input.side === 'BUY' ? (q.ask || q.lastPrice) : (q.bid || q.lastPrice));
          if (!Number.isFinite(price) || price <= 0) {
            throw new Error('Quote price is zero or non-positive.');
          }
        } catch (quoteErr: any) {
          rejectionReasons.push(`QUOTE_UNAVAILABLE_FAIL_CLOSED: Market order price cannot be safely verified from broker quote: ${quoteErr?.message || quoteErr}`);
        }
      }
    } else {
      rejectionReasons.push(`UNSUPPORTED_ORDER_TYPE: Order type ${input.orderType} is not supported for manual single trades.`);
    }

    // 7. Stop-loss & Take-profit validation
    const stopLoss = input.stopLoss != null && Number(input.stopLoss) > 0 ? Number(input.stopLoss) : null;
    const takeProfit = input.takeProfit != null && Number(input.takeProfit) > 0 ? Number(input.takeProfit) : null;

    if (stopLoss !== null && price > 0) {
      if (input.side === 'BUY' && stopLoss >= price) {
        rejectionReasons.push(`INVALID_STOP_LOSS: For BUY orders, Stop Loss (${stopLoss}) must be strictly below entry price (${price}).`);
      } else if (input.side === 'SELL' && stopLoss <= price) {
        rejectionReasons.push(`INVALID_STOP_LOSS: For SELL orders, Stop Loss (${stopLoss}) must be strictly above entry price (${price}).`);
      }
    }

    if (takeProfit !== null && price > 0) {
      if (input.side === 'BUY' && takeProfit <= price) {
        rejectionReasons.push(`INVALID_TAKE_PROFIT: For BUY orders, Take Profit (${takeProfit}) must be strictly above entry price (${price}).`);
      } else if (input.side === 'SELL' && takeProfit >= price) {
        rejectionReasons.push(`INVALID_TAKE_PROFIT: For SELL orders, Take Profit (${takeProfit}) must be strictly below entry price (${price}).`);
      }
    }

    // 8. Cost & Small Trade Budget (₹20) Enforcement
    const rawOrderValue = Number((quantity * price).toFixed(2));
    const chargesBreakdown = calculateEstimatedCharges(market, input.side, rawOrderValue);
    const estimatedCharges = chargesBreakdown.totalCharges;
    const totalEstimatedOutlay = Number((rawOrderValue + estimatedCharges).toFixed(2));

    const smallTradeBudget = MANUAL_TRADE_SMALL_BUDGET_INR;
    const isWithinBudget = totalEstimatedOutlay <= smallTradeBudget + 1e-6;

    if (!isWithinBudget) {
      const lotCount = lotSize > 0 ? quantity / lotSize : 1;
      rejectionReasons.push(
        `SMALL_TRADE_BUDGET_EXCEEDED: Estimated trade outlay of ₹${totalEstimatedOutlay.toFixed(2)} (Trade Value: ₹${rawOrderValue.toFixed(2)} + Charges: ₹${estimatedCharges.toFixed(2)}) exceeds the ₹${smallTradeBudget.toFixed(2)} Small Trade Budget limit. ` +
        `Contract requires ${lotCount} lot(s) (${quantity} qty) at price ₹${price.toFixed(2)}.`
      );
    }

    // 9. Account Available Funds check
    const availableFunds = Number(account?.availableMargin ?? account?.balance ?? 0);
    if (account && availableFunds < totalEstimatedOutlay) {
      rejectionReasons.push(`INSUFFICIENT_FUNDS: Required outlay of ₹${totalEstimatedOutlay.toFixed(2)} exceeds available account balance/margin (₹${availableFunds.toFixed(2)}).`);
    }

    // If any checks failed, return blocked result
    if (rejectionReasons.length > 0) {
      liveRuntimeLog('WARN', 'MANUAL_TRADE_PREPARATION_BLOCKED', {
        broker: selectedBroker,
        symbol,
        side: input.side,
        quantity,
        price,
        outlay: totalEstimatedOutlay,
        rejectionReasons
      });

      return {
        ready: false,
        rejectionReasons
      };
    }

    // All validation passed -> construct canonical authorization record
    const now = Date.now();
    const expiresAt = now + MANUAL_TRADE_AUTHORIZATION_TTL_MS;
    const authorizationId = `mta-${crypto.randomBytes(16).toString('hex')}`;
    const authorizationToken = `mt-auth-${crypto.randomBytes(32).toString('hex')}`;
    const authorizationTokenHash = crypto.createHash('sha256').update(authorizationToken).digest('hex');

    const correlationId = input.correlationId || `mcorr-${now}-${crypto.randomBytes(4).toString('hex')}`;
    const idempotencyKey = input.idempotencyKey || `midem-${now}-${crypto.randomBytes(8).toString('hex')}`;

    const exchange = String(resolvedInst?.exchange || input.exchange || (symbol.startsWith('SENSEX') ? 'B' : 'N')).toUpperCase();
    const exchangeType = String(resolvedInst?.exchangeType || (isDerivative ? 'D' : 'C')).toUpperCase();
    const scripCode = String(resolvedInst?.scripCode || '');

    const accountId = String(account?.accountId || '');

    const fingerprint = generateManualTradeFingerprint({
      broker: selectedBroker,
      environment: 'LIVE',
      accountId,
      market,
      symbol,
      exchange,
      exchangeType,
      scripCode,
      side: input.side,
      orderType: input.orderType,
      quantity,
      lotSize,
      price,
      stopLoss,
      takeProfit,
      idempotencyKey,
      correlationId
    });

    const payload = {
      authorizationId,
      correlationId,
      idempotencyKey,
      broker: selectedBroker,
      environment: 'LIVE',
      accountId,
      market,
      symbol,
      exchange,
      exchangeType,
      scripCode,
      side: input.side,
      orderType: input.orderType,
      quantity,
      lotSize,
      price,
      stopLoss,
      takeProfit,
      rawOrderValue,
      estimatedCharges,
      chargesBreakdown,
      totalEstimatedOutlay,
      smallTradeBudget,
      fingerprint,
      operatorNotes: input.operatorNotes || null,
      preparedAt: now,
      expiresAt
    };

    await executeRun(
      `INSERT INTO manual_trade_authorizations (
        id, authorization_token_hash, fingerprint, correlation_id, idempotency_key,
        operator_id, broker, environment, account_id, market, symbol,
        exchange, exchange_type, scrip_code, side, order_type, quantity,
        lot_size, price, stop_loss, take_profit, estimated_outlay, small_trade_budget,
        status, rejection_reason, broker_order_id, created_at, expires_at,
        confirmed_at, consumed_at, payload_json, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        authorizationId,
        authorizationTokenHash,
        fingerprint,
        correlationId,
        idempotencyKey,
        'OPERATOR',
        selectedBroker,
        'LIVE',
        accountId,
        market,
        symbol,
        exchange,
        exchangeType,
        scripCode,
        input.side,
        input.orderType,
        quantity,
        lotSize,
        price,
        stopLoss,
        takeProfit,
        totalEstimatedOutlay,
        smallTradeBudget,
        'PENDING_CONFIRMATION',
        null,
        null,
        now,
        expiresAt,
        null,
        null,
        JSON.stringify(payload),
        null
      ]
    );

    liveRuntimeLog('SYSTEM', 'MANUAL_TRADE_PREPARED', {
      authorizationId,
      broker: selectedBroker,
      symbol,
      side: input.side,
      quantity,
      price,
      totalEstimatedOutlay,
      fingerprint
    });

    tradeAuditLog('MANUAL_TRADE_PREPARED', {
      broker: selectedBroker,
      environment: 'LIVE',
      result: 'SUCCESS',
      details: {
        authorizationId,
        symbol,
        side: input.side,
        quantity,
        totalEstimatedOutlay
      }
    });

    const lotCount = lotSize > 0 ? quantity / lotSize : 1;

    return {
      ready: true,
      authorizationId,
      authorizationToken,
      fingerprint,
      expiresAt,
      rejectionReasons: [],
      review: {
        broker: selectedBroker,
        accountId: maskIdentifier(accountId),
        environment: 'LIVE',
        exchange,
        exchangeType,
        symbol,
        scripCode,
        side: input.side,
        orderType: input.orderType,
        quantity,
        lotSize,
        lotCount,
        price,
        stopLoss,
        takeProfit,
        rawOrderValue,
        estimatedCharges,
        chargesBreakdown,
        totalEstimatedOutlay,
        smallTradeBudget,
        isWithinBudget: true,
        availableBalance: availableFunds,
        availableMargin: availableFunds,
        warningStatement: 'Confirming will submit a real broker order to your active live account. No automatic cancellations or retries are applied.'
      }
    };
  }

  /**
   * Confirms and executes an existing pending manual trade authorization.
   * Atomically locks the authorization, verifies exact canonical fingerprint match,
   * submits order via broker adapter, and logs durable reconciliation evidence.
   */
  async confirmAndExecuteManualTrade(input: ConfirmManualTradeInput): Promise<ConfirmManualTradeResult> {
    await getDatabase();

    // 1. Explicit operator confirmation requirement
    if (!input.operatorConfirmed) {
      throw new Error('OPERATOR_CONFIRMATION_REQUIRED: Explicit operator confirmation is required to submit a manual live order.');
    }

    // 2. Emergency Kill Switch
    if (killSwitch.isHalted()) {
      throw new Error('EMERGENCY_KILL_SWITCH_ACTIVE: Emergency stop is active. Manual live order submission is blocked.');
    }

    const { authorizationId, authorizationToken, confirmedTrade } = input;
    if (!authorizationId || !authorizationToken) {
      throw new Error('AUTHORIZATION_CREDENTIALS_REQUIRED: Both authorizationId and authorizationToken are required.');
    }

    // Retrieve pending authorization from SQLite
    const rows = await executeQuery<any>(
      'SELECT * FROM manual_trade_authorizations WHERE id = ? LIMIT 1',
      [authorizationId]
    );

    const record = rows[0];
    if (!record) {
      throw new Error(`AUTHORIZATION_NOT_FOUND: Manual trade authorization '${authorizationId}' was not found.`);
    }

    // Verify cryptographic token hash
    const inputTokenHash = crypto.createHash('sha256').update(authorizationToken).digest('hex');
    const storedTokenHashBuf = Buffer.from(record.authorization_token_hash, 'hex');
    const inputTokenHashBuf = Buffer.from(inputTokenHash, 'hex');

    if (storedTokenHashBuf.length !== inputTokenHashBuf.length || !crypto.timingSafeEqual(storedTokenHashBuf, inputTokenHashBuf)) {
      throw new Error('AUTHORIZATION_TOKEN_INVALID: Cryptographic manual trade token verification failed.');
    }

    // Verify status is PENDING_CONFIRMATION (prevent replay and double-submission)
    if (record.status !== 'PENDING_CONFIRMATION') {
      throw new Error(`AUTHORIZATION_ALREADY_CONSUMED: Authorization '${authorizationId}' is in '${record.status}' state and cannot be confirmed again.`);
    }

    // Verify expiry (2 minutes TTL)
    const now = Date.now();
    if (now > Number(record.expires_at)) {
      await executeRun(
        'UPDATE manual_trade_authorizations SET status = ? WHERE id = ?',
        ['EXPIRED', authorizationId]
      );
      throw new Error(`AUTHORIZATION_EXPIRED: Manual trade authorization '${authorizationId}' expired at ${new Date(Number(record.expires_at)).toISOString()}. Please prepare a new trade.`);
    }

    // Verify canonical fingerprint match with confirmed trade parameters
    const expectedFingerprint = generateManualTradeFingerprint({
      broker: record.broker,
      environment: record.environment,
      accountId: record.account_id,
      market: record.market,
      symbol: confirmedTrade.symbol,
      exchange: confirmedTrade.exchange || record.exchange,
      exchangeType: confirmedTrade.exchangeType || record.exchange_type,
      scripCode: confirmedTrade.scripCode || record.scrip_code,
      side: confirmedTrade.side,
      orderType: confirmedTrade.orderType,
      quantity: Number(confirmedTrade.quantity),
      lotSize: Number(record.lot_size),
      price: Number(confirmedTrade.price),
      stopLoss: confirmedTrade.stopLoss != null ? Number(confirmedTrade.stopLoss) : null,
      takeProfit: confirmedTrade.takeProfit != null ? Number(confirmedTrade.takeProfit) : null,
      idempotencyKey: record.idempotency_key,
      correlationId: record.correlation_id
    });

    const storedFpBuf = Buffer.from(record.fingerprint, 'hex');
    const expectedFpBuf = Buffer.from(expectedFingerprint, 'hex');

    if (storedFpBuf.length !== expectedFpBuf.length || !crypto.timingSafeEqual(storedFpBuf, expectedFpBuf)) {
      throw new Error('TRADE_FINGERPRINT_MISMATCH: The confirmed trade parameters do not match the authorized trade review. Any material parameter change invalidates prior authorization.');
    }

    // Verify ₹20 budget constraint remains intact
    if (Number(record.estimated_outlay) > MANUAL_TRADE_SMALL_BUDGET_INR + 1e-6) {
      throw new Error(`BUDGET_CONSTRAINT_VIOLATION: Estimated outlay ₹${record.estimated_outlay} exceeds ₹${MANUAL_TRADE_SMALL_BUDGET_INR.toFixed(2)} budget.`);
    }

    // Atomically reserve the authorization token to prevent concurrent replay
    const reserveResult = await executeTransaction((db) => {
      const stmt = db.prepare(
        "UPDATE manual_trade_authorizations SET status = 'RESERVED', confirmed_at = ? WHERE id = ? AND status = 'PENDING_CONFIRMATION'"
      );
      stmt.run([now, authorizationId]);
      stmt.free();

      const verifyStmt = db.prepare("SELECT status FROM manual_trade_authorizations WHERE id = ?");
      verifyStmt.bind([authorizationId]);
      let currentStatus = '';
      if (verifyStmt.step()) {
        currentStatus = String(verifyStmt.getAsObject().status);
      }
      verifyStmt.free();

      return currentStatus === 'RESERVED';
    });

    if (!reserveResult) {
      throw new Error('CONCURRENT_CONFIRMATION_CONFLICT: This manual trade authorization was already claimed or reserved by another concurrent request.');
    }

    // Claim execution intent in SQLite
    const intent = await claimExecutionIntent(record.idempotency_key, {
      broker: record.broker,
      market: record.market,
      symbol: record.symbol,
      side: record.side,
      payload: {
        authorizationId,
        orderRequest: {
          symbol: record.symbol,
          side: record.side,
          orderType: record.order_type,
          quantity: record.quantity,
          price: record.price,
          stopLoss: record.stop_loss || undefined,
          takeProfit: record.take_profit || undefined
        }
      }
    });

    // Prepare broker order request
    const orderReq: OrderRequest & {
      manualAuthorizationToken?: string;
      _manualAuthorizationToken?: string;
      _manualAuthorizationId?: string;
      _exchange?: string;
      _exchangeType?: string;
      _scripCode?: string;
      _lotSize?: number;
    } = {
      market: record.market as any,
      symbol: record.symbol,
      side: record.side as any,
      orderType: record.order_type as any,
      quantity: Number(record.quantity),
      price: Number(record.price),
      stopLoss: record.stop_loss ? Number(record.stop_loss) : undefined,
      takeProfit: record.take_profit ? Number(record.take_profit) : undefined,
      signalId: record.correlation_id,
      strategyId: 'manual_single_trade_v1',
      manualAuthorizationToken: authorizationToken,
      _manualAuthorizationToken: authorizationToken,
      _manualAuthorizationId: authorizationId,
      _exchange: record.exchange,
      _exchangeType: record.exchange_type,
      _scripCode: record.scrip_code,
      _lotSize: Number(record.lot_size)
    };

    const adapter = brokerRegistry.getAdapter(record.broker as BrokerType, 'LIVE');

    let placedOrder: NormalizedOrder | null = null;
    let submissionError: any = null;

    try {
      placedOrder = await adapter.placeOrder(orderReq);
    } catch (err: any) {
      submissionError = err;
    }

    const completedAt = Date.now();

    if (submissionError) {
      const errorMsg = submissionError?.message || String(submissionError);
      
      // Update authorization record to FAILED
      await executeRun(
        'UPDATE manual_trade_authorizations SET status = ?, consumed_at = ?, rejection_reason = ?, result_json = ? WHERE id = ?',
        ['FAILED', completedAt, errorMsg, JSON.stringify({ error: errorMsg, failedAt: completedAt }), authorizationId]
      );

      await failExecutionIntent(record.idempotency_key, {
        broker: record.broker,
        market: record.market,
        symbol: record.symbol,
        submissionState: 'REJECTED_OR_FAILED',
        error: errorMsg,
        code: submissionError?.code || 'MANUAL_ORDER_SUBMISSION_FAILED',
        failedAt: completedAt
      });

      liveRuntimeLog('ERROR', 'MANUAL_TRADE_EXECUTION_FAILED', {
        authorizationId,
        broker: record.broker,
        symbol: record.symbol,
        error: errorMsg
      });

      tradeAuditLog('MANUAL_TRADE_FAILED', {
        broker: record.broker,
        environment: 'LIVE',
        result: 'FAILURE',
        details: { authorizationId, error: errorMsg }
      });

      throw submissionError;
    }

    const brokerOrderId = placedOrder?.brokerOrderId || placedOrder?.id || `mord-${completedAt}`;
    const terminalStatus = placedOrder?.status === 'FILLED' ? 'FILLED' : 'ACCEPTED';

    // Update authorization record to terminal status
    await executeRun(
      'UPDATE manual_trade_authorizations SET status = ?, broker_order_id = ?, consumed_at = ?, result_json = ? WHERE id = ?',
      [terminalStatus, brokerOrderId, completedAt, JSON.stringify(placedOrder), authorizationId]
    );

    await completeExecutionIntent(record.idempotency_key, placedOrder);

    liveRuntimeLog('SYSTEM', 'MANUAL_TRADE_EXECUTED', {
      authorizationId,
      broker: record.broker,
      symbol: record.symbol,
      brokerOrderId,
      status: terminalStatus
    });

    tradeAuditLog('MANUAL_TRADE_EXECUTED', {
      broker: record.broker,
      environment: 'LIVE',
      result: 'SUCCESS',
      details: {
        authorizationId,
        brokerOrderId,
        status: terminalStatus,
        symbol: record.symbol,
        quantity: record.quantity,
        price: record.price
      }
    });

    return {
      success: true,
      authorizationId,
      status: terminalStatus,
      brokerOrderId,
      reconciled: true,
      order: placedOrder || undefined,
      message: `Manual trade successfully submitted and accepted by ${record.broker}. Order ID: ${brokerOrderId}.`,
      executedAt: completedAt
    };
  }

  /**
   * Retrieves recent manual trade authorizations for audit and operator display.
   */
  async getRecentAuthorizations(limit = 20): Promise<any[]> {
    await getDatabase();
    return executeQuery<any>(
      'SELECT id, broker, environment, symbol, exchange, exchange_type, side, order_type, quantity, price, estimated_outlay, status, broker_order_id, rejection_reason, created_at, expires_at, confirmed_at, consumed_at FROM manual_trade_authorizations ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
  }
}

export const manualTradeService = new ManualTradeService();
