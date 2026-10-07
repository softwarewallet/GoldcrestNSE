import type { BrokerType, ConnectionTestResult } from '../brokers/types';

export type BrokerVerificationStatus = 'VERIFIED' | 'CONFIGURED_UNAVAILABLE' | 'NOT_CONFIGURED';

export interface BrokerVerificationInput {
  broker: BrokerType;
  configured: boolean;
  connection?: ConnectionTestResult | null;
  expectedCTraderApiMode?: 'LIVE' | 'DEMO';
}

export interface BrokerVerificationResult {
  broker: BrokerType;
  status: BrokerVerificationStatus;
  connected: boolean;
  authoritativeAccountState: boolean;
  apiMode?: 'LIVE' | 'DEMO';
  apiEndpoint?: string;
  failures: string[];
}

function isFiniteNonNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function evaluateBrokerVerification(input: BrokerVerificationInput): BrokerVerificationResult {
  const failures: string[] = [];

  if (!input.configured) {
    return {
      broker: input.broker,
      status: 'NOT_CONFIGURED',
      connected: false,
      authoritativeAccountState: false,
      apiMode: input.connection?.apiMode,
      apiEndpoint: input.connection?.apiEndpoint,
      failures: ['CREDENTIALS_NOT_CONFIGURED']
    };
  }

  const connection = input.connection;
  if (!connection) {
    return {
      broker: input.broker,
      status: 'CONFIGURED_UNAVAILABLE',
      connected: false,
      authoritativeAccountState: false,
      apiMode: undefined,
      apiEndpoint: undefined,
      failures: ['CONNECTION_TEST_UNAVAILABLE']
    };
  }

  if (!connection.connected) failures.push('BROKER_NOT_CONNECTED');

  if (!String(connection.account || '').trim()) failures.push('ACCOUNT_ID_UNAVAILABLE');
  if (!String(connection.currency || '').trim()) failures.push('ACCOUNT_CURRENCY_UNAVAILABLE');
  if (!isFiniteNonNegative(connection.balance)) failures.push('BALANCE_UNAVAILABLE');
  if (!isFiniteNonNegative(connection.equity)) failures.push('EQUITY_UNAVAILABLE');
  if (!Number.isFinite(connection.timestamp) || connection.timestamp <= 0) failures.push('CONNECTION_TIMESTAMP_UNAVAILABLE');

  if (input.broker === 'CTRADER' && input.expectedCTraderApiMode) {
    if (connection.apiMode !== input.expectedCTraderApiMode) {
      failures.push('CTRADER_API_MODE_MISMATCH');
    }
    const expectedEndpoint = input.expectedCTraderApiMode === 'DEMO'
      ? 'wss://demo.ctraderapi.com:5036'
      : 'wss://live.ctraderapi.com:5036';
    if (connection.apiEndpoint !== expectedEndpoint) failures.push('CTRADER_API_ENDPOINT_MISMATCH');
  }

  const authoritativeAccountState = connection.connected
    && !failures.includes('ACCOUNT_ID_UNAVAILABLE')
    && !failures.includes('ACCOUNT_CURRENCY_UNAVAILABLE')
    && !failures.includes('BALANCE_UNAVAILABLE')
    && !failures.includes('EQUITY_UNAVAILABLE');

  return {
    broker: input.broker,
    status: failures.length === 0 ? 'VERIFIED' : 'CONFIGURED_UNAVAILABLE',
    connected: Boolean(connection.connected),
    authoritativeAccountState,
    apiMode: connection.apiMode,
    apiEndpoint: connection.apiEndpoint,
    failures
  };
}

export function summarizeBrokerVerification(results: BrokerVerificationResult[]): {
  anyConfigured: boolean;
  anyConnected: boolean;
  allConfiguredBrokersVerified: boolean;
} {
  const configured = results.filter(result => result.status !== 'NOT_CONFIGURED');
  return {
    anyConfigured: configured.length > 0,
    anyConnected: results.some(result => result.connected),
    allConfiguredBrokersVerified: configured.length > 0 && configured.every(result => result.status === 'VERIFIED')
  };
}
