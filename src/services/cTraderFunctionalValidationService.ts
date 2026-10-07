export type CTraderFunctionalValidationMode = 'LIVE' | 'DEMO';

export interface CTraderFunctionalValidationInput {
  configured: boolean;
  selectedApiMode: CTraderFunctionalValidationMode;
  connection: {
    connected: boolean;
    apiMode?: CTraderFunctionalValidationMode;
    apiEndpoint?: string;
    account?: string;
    accountType?: string;
    balance?: number;
    equity?: number;
    currency?: string;
    permissions?: string[];
  } | null;
  instrumentAvailable: boolean;
  quoteFresh: boolean;
  quoteBidAskValid: boolean;
  historicalDataAvailable: boolean;
  positionsReadSuccessful: boolean;
  openOrdersReadSuccessful: boolean;
  orderPacketValid: boolean;
  validationSubmittedOrder: boolean;
}

export interface CTraderFunctionalValidationGate {
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface CTraderFunctionalValidationResult {
  ready: boolean;
  status: 'FUNCTIONAL' | 'BLOCKED';
  statusCode: 200 | 409;
  mode: CTraderFunctionalValidationMode;
  checks: Record<string, CTraderFunctionalValidationGate>;
  failures: string[];
  orderSubmissionPerformed: false;
}

function gate(ok: boolean, passDetail: string, failDetail: string): CTraderFunctionalValidationGate {
  return { status: ok ? 'PASS' : 'FAIL', detail: ok ? passDetail : failDetail };
}

function expectedEndpoint(mode: CTraderFunctionalValidationMode): string {
  return mode === 'DEMO'
    ? 'wss://demo.ctraderapi.com:5036'
    : 'wss://live.ctraderapi.com:5036';
}

/**
 * Validates the same authoritative cTrader account/data/order-construction
 * capabilities used by Goldcrest without submitting a broker order.
 *
 * DEMO is an authoritative functional test environment here: account,
 * permission, instrument, quote, history, positions, orders, and order-packet
 * checks are executed against the selected cTrader API mode. Production
 * autonomous activation remains a separate LIVE-only decision.
 */
export function evaluateCTraderFunctionalValidation(
  input: CTraderFunctionalValidationInput
): CTraderFunctionalValidationResult {
  const failures: string[] = [];
  const connection = input.connection;
  const expectedMode = input.selectedApiMode;
  const expectedAccountType = expectedMode === 'DEMO' ? 'DEMO' : 'LIVE';

  const accountIdPresent = Boolean(String(connection?.account || '').trim());
  const currencyPresent = Boolean(String(connection?.currency || '').trim());
  const balanceValid = typeof connection?.balance === 'number'
    && Number.isFinite(connection.balance)
    && connection.balance >= 0;
  const equityValid = typeof connection?.equity === 'number'
    && Number.isFinite(connection.equity)
    && connection.equity >= 0;
  const permissions = Array.isArray(connection?.permissions) ? connection.permissions : [];
  const tradingPermission = permissions.includes('TRADING')
    || permissions.includes('EQUITY')
    || permissions.includes('DERIVATIVES')
    || permissions.includes('NSE_FNO');

  const accountTypeMatches = String(connection?.accountType || '').toUpperCase() === expectedAccountType;

  const checks: Record<string, CTraderFunctionalValidationGate> = {
    credentials: gate(input.configured, 'cTrader credentials are configured.', 'cTrader credentials are not configured.'),
    connection: gate(Boolean(connection?.connected), 'cTrader account connection is healthy.', 'cTrader account connection is unavailable.'),
    apiMode: gate(connection?.apiMode === expectedMode, 'cTrader API mode is ' + expectedMode + '.', 'cTrader API mode does not match selected ' + expectedMode + '.'),
    apiEndpoint: gate(connection?.apiEndpoint === expectedEndpoint(expectedMode), 'cTrader endpoint matches ' + expectedMode + '.', 'cTrader endpoint does not match selected ' + expectedMode + ' endpoint.'),
    accountType: gate(accountTypeMatches, 'cTrader account type matches ' + expectedAccountType + '.', 'cTrader account type does not match selected ' + expectedMode + ' mode.'),
    accountId: gate(accountIdPresent, 'Authoritative cTrader account identity is available.', 'Authoritative cTrader account identity is unavailable.'),
    currency: gate(currencyPresent, 'Authoritative cTrader account currency is available.', 'Authoritative cTrader account currency is unavailable.'),
    balance: gate(balanceValid, 'Authoritative cTrader balance is valid.', 'Authoritative cTrader balance is invalid.'),
    equity: gate(equityValid, 'Authoritative cTrader equity is valid.', 'Authoritative cTrader equity is invalid.'),
    tradingPermission: gate(tradingPermission, 'cTrader account exposes a confirmed trading permission.', 'cTrader account does not expose a confirmed trading permission.'),
    instrument: gate(input.instrumentAvailable, 'Broker instrument metadata is available.', 'Broker instrument metadata is unavailable.'),
    quote: gate(
      input.quoteFresh && input.quoteBidAskValid,
      'Fresh authoritative bid/ask quote is available.',
      'A fresh authoritative bid/ask quote is unavailable.'
    ),
    historicalData: gate(input.historicalDataAvailable, 'Authoritative historical candle data is available.', 'Authoritative historical candle data is unavailable.'),
    positionsRead: gate(input.positionsReadSuccessful, 'Authoritative open-position read succeeded.', 'Authoritative open-position read failed.'),
    openOrdersRead: gate(input.openOrdersReadSuccessful, 'Authoritative open-order read succeeded.', 'Authoritative open-order read failed.'),
    orderPacket: gate(input.orderPacketValid, 'Shared Auto Live order-packet validation passed.', 'Shared Auto Live order-packet validation failed.'),
    orderSubmission: gate(!input.validationSubmittedOrder, 'Functional validation submitted no broker order.', 'Functional validation must never submit a broker order.')
  };

  failures.push(...Object.entries(checks).filter(([, value]) => value.status === 'FAIL').map(([name]) => name));
  const ready = failures.length === 0;
  return {
    ready,
    status: ready ? 'FUNCTIONAL' : 'BLOCKED',
    statusCode: ready ? 200 : 409,
    mode: expectedMode,
    checks,
    failures,
    orderSubmissionPerformed: false
  };
}
