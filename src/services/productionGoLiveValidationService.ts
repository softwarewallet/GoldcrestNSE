export interface ProductionGoLiveValidationInput {
  productionEnvironment: boolean;
  releaseIntegrityOk: boolean;
  configurationIntegrityOk: boolean;
  tradingModeLiveOnly: boolean;
  databaseInitialized: boolean;
  databasePersistenceHealthy: boolean;
  runtimeLifecycleRunning: boolean;
  auditLogReady: boolean;
  operatorAuthConfigured: boolean;
  cTraderCredentialsConfigured: boolean;
  cTraderBrokerVerified: boolean;
  cTraderConnected: boolean;
  cTraderAccountIsLive: boolean;
  cTraderAccountIdPresent: boolean;
  cTraderCurrencyPresent: boolean;
  cTraderBalanceValid: boolean;
  cTraderEquityValid: boolean;
  cTraderTradingPermission: boolean;
  cTraderApiMode: 'LIVE' | 'DEMO';
  killSwitchClear: boolean;
  executionGateLocked: boolean;
  noUnresolvedExecutionIntents: boolean;
  cTraderAccountStateConsistent: boolean;
  validationSubmittedOrder: boolean;
}

export interface ProductionGoLiveValidationGate {
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface ProductionGoLiveValidationResult {
  ready: boolean;
  status: 'READY_FOR_ACTIVATION' | 'BLOCKED';
  statusCode: 200 | 409;
  checks: Record<string, ProductionGoLiveValidationGate>;
  failures: string[];
  orderSubmissionPerformed: false;
}

function gate(ok: boolean, passDetail: string, failDetail: string): ProductionGoLiveValidationGate {
  return { status: ok ? 'PASS' : 'FAIL', detail: ok ? passDetail : failDetail };
}

export function evaluateProductionGoLiveValidation(
  input: ProductionGoLiveValidationInput
): ProductionGoLiveValidationResult {
  const checks: Record<string, ProductionGoLiveValidationGate> = {
    productionEnvironment: gate(input.productionEnvironment, 'Production environment is active.', 'Production environment is required for go-live validation.'),
    releaseIntegrity: gate(input.releaseIntegrityOk, 'Production release integrity is valid.', 'Production release integrity failed.'),
    configurationIntegrity: gate(input.configurationIntegrityOk, 'System configuration passes integrity validation.', 'System configuration failed integrity validation.'),
    tradingMode: gate(input.tradingModeLiveOnly, 'Trading mode is LIVE_ONLY.', 'Trading mode is not LIVE_ONLY.'),
    database: gate(input.databaseInitialized, 'SQLite database is initialized.', 'SQLite database is not initialized.'),
    databasePersistence: gate(input.databasePersistenceHealthy, 'SQLite persistence is healthy.', 'SQLite persistence has a recorded error.'),
    runtimeLifecycle: gate(input.runtimeLifecycleRunning, 'Runtime lifecycle is RUNNING.', 'Runtime lifecycle is not RUNNING.'),
    auditLog: gate(input.auditLogReady, 'Durable audit logging is ready.', 'Durable audit logging is unavailable.'),
    operatorAuth: gate(input.operatorAuthConfigured, 'Operator authentication is configured.', 'Operator authentication is not configured.'),
    cTraderCredentials: gate(input.cTraderCredentialsConfigured, 'cTrader LIVE credentials are configured.', 'cTrader LIVE credentials are not configured.'),
    cTraderBrokerVerification: gate(input.cTraderBrokerVerified, 'cTrader LIVE broker verification passed.', 'cTrader LIVE broker verification did not pass.'),
    cTraderConnected: gate(input.cTraderConnected, 'cTrader LIVE account is connected.', 'cTrader LIVE account is not connected.'),
    cTraderAccountLive: gate(input.cTraderAccountIsLive, 'cTrader account is identified as LIVE.', 'cTrader account is not identified as LIVE.'),
    cTraderAccountId: gate(input.cTraderAccountIdPresent, 'cTrader LIVE account identity is available.', 'cTrader LIVE account identity is unavailable.'),
    cTraderCurrency: gate(input.cTraderCurrencyPresent, 'cTrader LIVE account currency is available.', 'cTrader LIVE account currency is unavailable.'),
    cTraderBalance: gate(input.cTraderBalanceValid, 'cTrader LIVE balance is valid and positive.', 'cTrader LIVE balance is invalid or non-positive.'),
    cTraderEquity: gate(input.cTraderEquityValid, 'cTrader LIVE equity is valid and positive.', 'cTrader LIVE equity is invalid or non-positive.'),
    cTraderTradingPermission: gate(input.cTraderTradingPermission, 'cTrader LIVE trading permission is available.', 'cTrader LIVE trading permission is unavailable.'),
    cTraderApiMode: gate(input.cTraderApiMode === 'LIVE', 'cTrader API mode is LIVE.', 'cTrader API mode must be LIVE for production autonomous execution.'),
    killSwitch: gate(input.killSwitchClear, 'Kill switch is clear.', 'Kill switch is halted.'),
    executionGate: gate(input.executionGateLocked, 'Autonomous execution remains locked during validation.', 'Autonomous execution must remain locked during go-live validation.'),
    unresolvedExecutionIntents: gate(input.noUnresolvedExecutionIntents, 'No unresolved execution intents require operator action.', 'Unresolved execution intents are present and require reconciliation.'),
    accountStateConsistency: gate(input.cTraderAccountStateConsistent, 'cTrader LIVE account state is aligned with persisted LIVE history.', 'cTrader LIVE account state is not aligned with persisted LIVE history.'),
    orderSubmission: gate(!input.validationSubmittedOrder, 'Validation performed without submitting a broker order.', 'Validation must never submit a broker order.')
  };
  const failures = Object.entries(checks).filter(([, value]) => value.status === 'FAIL').map(([name]) => name);
  const ready = failures.length === 0;
  return { ready, status: ready ? 'READY_FOR_ACTIVATION' : 'BLOCKED', statusCode: ready ? 200 : 409, checks, failures, orderSubmissionPerformed: false };
}
