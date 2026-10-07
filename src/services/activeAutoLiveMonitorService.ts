export interface ActiveAutoLiveMonitorInput {
  configurationIntegrityOk: boolean;
  tradingModeLiveOnly: boolean;
  databasePersistenceHealthy: boolean;
  runtimeLifecycleRunning: boolean;
  auditLogReady: boolean;
  cTraderConnected: boolean;
  cTraderAccountIsLive: boolean;
  cTraderAccountIdPresent: boolean;
  cTraderCurrencyPresent: boolean;
  cTraderBalanceValid: boolean;
  cTraderEquityValid: boolean;
  cTraderTradingPermission: boolean;
  cTraderApiModeLive: boolean;
  killSwitchClear: boolean;
  executionGateUnlocked: boolean;
  autoTradingStateOperational: boolean;
  noUnresolvedExecutionIntents: boolean;
  cTraderAccountStateConsistent: boolean;
}

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

const CRITICAL_GATES = new Set([
  'configurationIntegrity',
  'tradingMode',
  'databasePersistence',
  'runtimeLifecycle',
  'auditLog',
  'cTraderConnected',
  'cTraderAccountLive',
  'cTraderTradingPermission',
  'cTraderApiMode',
  'killSwitch',
  'executionGate',
  'unresolvedExecutionIntents',
  'accountStateConsistency'
]);

export function evaluateActiveAutoLiveMonitor(input: ActiveAutoLiveMonitorInput): ActiveAutoLiveMonitorResult {
  const checks: Record<string, ActiveAutoLiveMonitorGate> = {
    configurationIntegrity: gate(input.configurationIntegrityOk, 'Configuration integrity is valid.', 'Configuration integrity failed.'),
    tradingMode: gate(input.tradingModeLiveOnly, 'Trading mode is LIVE_ONLY.', 'Trading mode is not LIVE_ONLY.'),
    databasePersistence: gate(input.databasePersistenceHealthy, 'SQLite persistence is healthy.', 'SQLite persistence has a recorded error.'),
    runtimeLifecycle: gate(input.runtimeLifecycleRunning, 'Runtime lifecycle is RUNNING.', 'Runtime lifecycle is not RUNNING.'),
    auditLog: gate(input.auditLogReady, 'Durable audit logging is available.', 'Durable audit logging is unavailable.'),
    cTraderConnected: gate(input.cTraderConnected, 'cTrader LIVE account is connected.', 'cTrader LIVE account is not connected.'),
    cTraderAccountLive: gate(input.cTraderAccountIsLive, 'cTrader account is identified as LIVE.', 'cTrader account is not identified as LIVE.'),
    cTraderAccountId: gate(input.cTraderAccountIdPresent, 'cTrader LIVE account identity is present.', 'cTrader LIVE account identity is unavailable.'),
    cTraderCurrency: gate(input.cTraderCurrencyPresent, 'cTrader LIVE account currency is present.', 'cTrader LIVE account currency is unavailable.'),
    cTraderBalance: gate(input.cTraderBalanceValid, 'cTrader LIVE balance is valid.', 'cTrader LIVE balance is invalid.'),
    cTraderEquity: gate(input.cTraderEquityValid, 'cTrader LIVE equity is valid.', 'cTrader LIVE equity is invalid.'),
    cTraderTradingPermission: gate(input.cTraderTradingPermission, 'cTrader LIVE trading permission is available.', 'cTrader LIVE trading permission is unavailable.'),
    cTraderApiMode: gate(input.cTraderApiModeLive, 'cTrader API mode is LIVE.', 'cTrader API mode is not LIVE.'),
    killSwitch: gate(input.killSwitchClear, 'Kill switch is clear.', 'Kill switch is halted.'),
    executionGate: gate(input.executionGateUnlocked, 'Execution gate is unlocked for the active operator session.', 'Execution gate is not unlocked.'),
    autoTradingState: gate(input.autoTradingStateOperational, 'Auto Live runtime is in an operational state.', 'Auto Live runtime is not in an operational state.'),
    unresolvedExecutionIntents: gate(input.noUnresolvedExecutionIntents, 'No unresolved execution intents require operator action.', 'Unresolved execution intents are present.'),
    accountStateConsistency: gate(input.cTraderAccountStateConsistent, 'cTrader account state is aligned with persisted LIVE history.', 'cTrader account state is not aligned with persisted LIVE history.')
  };

  const failures = Object.entries(checks).filter(([, value]) => value.status === 'FAIL').map(([name]) => name);
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
