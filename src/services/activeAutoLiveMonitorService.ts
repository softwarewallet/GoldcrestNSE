import { BrokerType } from '../brokers/types';

export interface CommonInput {
  configurationIntegrityOk: boolean;
  tradingModeLiveOnly: boolean;
  databasePersistenceHealthy: boolean;
  runtimeLifecycleRunning: boolean;
  auditLogReady: boolean;
  killSwitchClear: boolean;
  executionGateUnlocked: boolean;
  autoTradingStateOperational: boolean;
  noUnresolvedExecutionIntents: boolean;
}

export interface CTraderInput extends CommonInput {
  brokerType: 'CTRADER';
  connected: boolean;
  accountIsLive: boolean;
  accountIdPresent: boolean;
  currencyPresent: boolean;
  balanceValid: boolean;
  equityValid: boolean;
  tradingPermission: boolean;
  apiModeLive: boolean;
  accountStateConsistent: boolean;
}

export interface FivePaisaInput extends CommonInput {
  brokerType: 'FIVE_PAISA';
  connected: boolean;
  accountIsLive: boolean;
  accountIdPresent: boolean;
  tradingPermission: boolean;
  balanceValid: boolean;
  accountStateConsistent: boolean;
}

export type ActiveAutoLiveMonitorInput = CTraderInput | FivePaisaInput;

export interface ActiveAutoLiveMonitorGate {
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface ActiveAutoLiveMonitorResult {
  healthy: boolean;
  status: 'HEALTHY' | 'DEGRADED' | 'BLOCKED';
  statusCode: 200 | 409;
  checks: Record<string, ActiveAutoLiveMonitorGate>;
  failures: string[];
  criticalFailures: string[];
}

function gate(ok: boolean, passDetail: string, failDetail: string): ActiveAutoLiveMonitorGate {
  return { status: ok ? 'PASS' : 'FAIL', detail: ok ? passDetail : failDetail };
}

export function evaluateActiveAutoLiveMonitor(input: ActiveAutoLiveMonitorInput): ActiveAutoLiveMonitorResult {
  const checks: Record<string, ActiveAutoLiveMonitorGate> = {
    configurationIntegrity: gate(input.configurationIntegrityOk, 'Configuration integrity is valid.', 'Configuration integrity failed.'),
    tradingMode: gate(input.tradingModeLiveOnly, 'Trading mode is LIVE_ONLY.', 'Trading mode is not LIVE_ONLY.'),
    databasePersistence: gate(input.databasePersistenceHealthy, 'SQLite persistence is healthy.', 'SQLite persistence has a recorded error.'),
    runtimeLifecycle: gate(input.runtimeLifecycleRunning, 'Runtime lifecycle is RUNNING.', 'Runtime lifecycle is not RUNNING.'),
    auditLog: gate(input.auditLogReady, 'Durable audit logging is available.', 'Durable audit logging is unavailable.'),
    killSwitch: gate(input.killSwitchClear, 'Kill switch is clear.', 'Kill switch is halted.'),
    executionGate: gate(input.executionGateUnlocked, 'Execution gate is unlocked for the active operator session.', 'Execution gate is not unlocked.'),
    autoTradingState: gate(input.autoTradingStateOperational, 'Auto Live runtime is in an operational state.', 'Auto Live runtime is not in an operational state.'),
    unresolvedExecutionIntents: gate(input.noUnresolvedExecutionIntents, 'No unresolved execution intents require operator action.', 'Unresolved execution intents are present.'),
  };

  if (input.brokerType === 'CTRADER') {
    checks.cTraderConnected = gate(input.connected, 'cTrader LIVE account is connected.', 'cTrader LIVE account is not connected.');
    checks.cTraderAccountLive = gate(input.accountIsLive, 'cTrader account is identified as LIVE.', 'cTrader account is not identified as LIVE.');
    checks.cTraderAccountId = gate(input.accountIdPresent, 'cTrader LIVE account identity is present.', 'cTrader LIVE account identity is unavailable.');
    checks.cTraderCurrency = gate(input.currencyPresent, 'cTrader LIVE account currency is present.', 'cTrader LIVE account currency is unavailable.');
    checks.cTraderBalance = gate(input.balanceValid, 'cTrader LIVE balance is valid.', 'cTrader LIVE balance is invalid.');
    checks.cTraderEquity = gate(input.equityValid, 'cTrader LIVE equity is valid.', 'cTrader LIVE equity is invalid.');
    checks.cTraderTradingPermission = gate(input.tradingPermission, 'cTrader LIVE trading permission is available.', 'cTrader LIVE trading permission is unavailable.');
    checks.cTraderApiMode = gate(input.apiModeLive, 'cTrader API mode is LIVE.', 'cTrader API mode is not LIVE.');
    checks.accountStateConsistency = gate(input.accountStateConsistent, 'cTrader account state is aligned with persisted LIVE history.', 'cTrader account state is not aligned with persisted LIVE history.');
  } else {
    checks.fivePaisaConnected = gate(input.connected, '5paisa LIVE account is connected.', '5paisa LIVE account is not connected.');
    checks.fivePaisaAccountLive = gate(input.accountIsLive, '5paisa account is identified as LIVE.', '5paisa account is not identified as LIVE.');
    checks.fivePaisaAccountId = gate(input.accountIdPresent, '5paisa LIVE account identity is present.', '5paisa LIVE account identity is unavailable.');
    checks.fivePaisaBalance = gate(input.balanceValid, '5paisa LIVE balance is valid.', '5paisa LIVE balance is invalid.');
    checks.fivePaisaTradingPermission = gate(input.tradingPermission, '5paisa LIVE trading permission is available.', '5paisa LIVE trading permission is unavailable.');
    checks.accountStateConsistency = gate(input.accountStateConsistent, '5paisa account state is aligned with persisted LIVE history.', '5paisa account state is not aligned with persisted LIVE history.');
  }

  const failures = Object.entries(checks).filter(([, value]) => value.status === 'FAIL').map(([name]) => name);
  
  const CRITICAL_GATES = new Set([
    'configurationIntegrity',
    'tradingMode',
    'databasePersistence',
    'runtimeLifecycle',
    'auditLog',
    'killSwitch',
    'executionGate',
    'unresolvedExecutionIntents',
    'accountStateConsistency',
    input.brokerType === 'CTRADER' ? 'cTraderConnected' : 'fivePaisaConnected',
    input.brokerType === 'CTRADER' ? 'cTraderAccountLive' : 'fivePaisaAccountLive',
    input.brokerType === 'CTRADER' ? 'cTraderTradingPermission' : 'fivePaisaTradingPermission',
  ]);

  const criticalFailures = failures.filter(name => CRITICAL_GATES.has(name));
  const healthy = failures.length === 0;
  
  return {
    healthy,
    status: healthy ? 'HEALTHY' : criticalFailures.length > 0 ? 'BLOCKED' : 'DEGRADED',
    statusCode: healthy ? 200 : 409,
    checks,
    failures,
    criticalFailures
  };
}
