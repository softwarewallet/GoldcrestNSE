import { BrokerErrorCode } from './types';

export class BrokerError extends Error {
  public readonly code: BrokerErrorCode;
  public readonly broker: string;
  public readonly environment: string;
  public readonly originalError?: any;

  constructor(
    code: BrokerErrorCode,
    message: string,
    broker: string,
    environment: string,
    originalError?: any
  ) {
    super(message);
    this.name = 'BrokerError';
    this.code = code;
    this.broker = broker;
    this.environment = environment;
    this.originalError = originalError;
  }
}

export function normalizeBrokerError(err: any, broker: string, environment: string): BrokerError {
  if (err instanceof BrokerError) {
    return err;
  }

  const msg = (err?.message || String(err)).toLowerCase();

  let code: BrokerErrorCode = 'UNKNOWN_ERROR';

  if (msg.includes('cant_route_request') || msg.includes('cannot route request') || msg.includes('no environment connection')) {
    code = 'BROKER_UNAVAILABLE';
  } else if (msg.includes('autonomous_live_execution_disabled') || msg.includes('live execution disabled') || msg.includes('autonomous execution')) {
    code = 'AUTONOMOUS_LIVE_EXECUTION_DISABLED';
  } else if (msg.includes('account_identity_mismatch') || msg.includes('identity mismatch')) {
    code = 'ACCOUNT_IDENTITY_MISMATCH';
  } else if (msg.includes('account_not_found') || msg.includes('account not found') || msg.includes('ch_ctid_trader_account_not_found') || msg.includes('trader account with id')) {
    code = 'ACCOUNT_NOT_FOUND';
  } else if (msg.includes('account_data_unavailable') || msg.includes('data unavailable')) {
    code = 'ACCOUNT_DATA_UNAVAILABLE';
  } else if (msg.includes('token_expired') || msg.includes('token expired')) {
    code = 'TOKEN_EXPIRED';
  } else if (msg.includes('safety_gate_rejected') || msg.includes('gate rejected')) {
    code = 'SAFETY_GATE_REJECTED';
  } else if (msg.includes('auth') || msg.includes('token') || msg.includes('invalid credentials') || msg.includes('unauthorized') || msg.includes('401') || msg.includes('403')) {
    code = 'AUTHENTICATION_FAILED';
  } else if (msg.includes('insufficient funds') || msg.includes('balance')) {
    code = 'INSUFFICIENT_FUNDS';
  } else if (msg.includes('margin')) {
    code = 'INSUFFICIENT_MARGIN';
  } else if (msg.includes('symbol') || msg.includes('instrument not found')) {
    code = 'INVALID_SYMBOL';
  } else if (msg.includes('quantity') || msg.includes('lot size') || msg.includes('volume')) {
    code = 'INVALID_QUANTITY';
  } else if (msg.includes('market closed') || msg.includes('outside market hours') || msg.includes('trading halted')) {
    code = 'MARKET_CLOSED';
  } else if (msg.includes('stale')) {
    code = 'STALE_DATA';
  } else if (msg.includes('rejected')) {
    code = 'BROKER_REJECTED';
  } else if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('429')) {
    code = 'RATE_LIMITED';
  } else if (msg.includes('timeout') || msg.includes('timed out')) {
    code = 'TIMEOUT';
  } else if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('socket')) {
    code = 'NETWORK_ERROR';
  } else if (msg.includes('unavailable') || msg.includes('503') || msg.includes('502')) {
    code = 'UNAVAILABLE';
  } else if (msg.includes('price')) {
    code = 'INVALID_PRICE';
  } else if (msg.includes('stop') || msg.includes('sl') || msg.includes('tp')) {
    code = 'INVALID_STOP';
  } else if (msg.includes('not supported') || msg.includes('unsupported')) {
    code = 'NOT_SUPPORTED';
  }

  return new BrokerError(code, err?.message || 'Unknown broker error', broker, environment, err);
}
