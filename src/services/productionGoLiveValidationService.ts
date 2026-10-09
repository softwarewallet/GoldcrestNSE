import { 
  ValidationProfile, 
  CommonValidationInput, 
  CTraderValidationInput, 
  FivePaisaValidationInput 
} from './validationProfileService';

export interface ProductionGoLiveValidationInput {
  profile: ValidationProfile;
  common: CommonValidationInput;
  ctradr?: CTraderValidationInput;
  fivePaisa?: FivePaisaValidationInput;
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
    productionEnvironment: gate(input.common.productionEnvironment, 'Production environment is active.', 'Production environment is required for go-live validation.'),
    releaseIntegrity: gate(input.common.releaseIntegrityOk, 'Production release integrity is valid.', 'Production release integrity failed.'),
    configurationIntegrity: gate(input.common.configurationIntegrityOk, 'System configuration passes integrity validation.', 'System configuration failed integrity validation.'),
    tradingMode: gate(input.common.tradingModeLiveOnly, 'Trading mode is LIVE_ONLY.', 'Trading mode is not LIVE_ONLY.'),
    database: gate(input.common.databaseInitialized, 'SQLite database is initialized.', 'SQLite database is not initialized.'),
    databasePersistence: gate(input.common.databasePersistenceHealthy, 'SQLite persistence is healthy.', 'SQLite persistence has a recorded error.'),
    runtimeLifecycle: gate(input.common.runtimeLifecycleRunning, 'Runtime lifecycle is RUNNING.', 'Runtime lifecycle is not RUNNING.'),
    auditLog: gate(input.common.auditLogReady, 'Durable audit logging is ready.', 'Durable audit logging is unavailable.'),
    operatorAuth: gate(input.common.operatorAuthConfigured, 'Operator authentication is configured.', 'Operator authentication is not configured.'),
    killSwitch: gate(input.common.killSwitchClear, 'Kill switch is clear.', 'Kill switch is halted.'),
    executionGate: gate(input.common.executionGateLocked, 'Autonomous execution remains locked during validation.', 'Autonomous execution must remain locked during go-live validation.'),
    unresolvedExecutionIntents: gate(input.common.noUnresolvedExecutionIntents, 'No unresolved execution intents require operator action.', 'Unresolved execution intents are present and require reconciliation.'),
    orderSubmission: gate(!input.common.validationSubmittedOrder, 'Validation performed without submitting a broker order.', 'Validation must never submit a broker order.')
  };

  if (input.profile === 'CTRADER' && input.ctradr) {
    checks.cTraderCredentials = gate(input.ctradr.cTraderCredentialsConfigured, 'cTrader LIVE credentials are configured.', 'cTrader LIVE credentials are not configured.');
    checks.cTraderBrokerVerification = gate(input.ctradr.cTraderBrokerVerified, 'cTrader LIVE broker verification passed.', 'cTrader LIVE broker verification did not pass.');
    checks.cTraderConnected = gate(input.ctradr.cTraderConnected, 'cTrader LIVE account is connected.', 'cTrader LIVE account is not connected.');
    checks.cTraderAccountLive = gate(input.ctradr.cTraderAccountIsLive, 'cTrader account is identified as LIVE.', 'cTrader account is not identified as LIVE.');
    checks.cTraderAccountId = gate(input.ctradr.cTraderAccountIdPresent, 'cTrader LIVE account identity is available.', 'cTrader LIVE account identity is unavailable.');
    checks.cTraderCurrency = gate(input.ctradr.cTraderCurrencyPresent, 'cTrader LIVE account currency is available.', 'cTrader LIVE account currency is unavailable.');
    checks.cTraderBalance = gate(input.ctradr.cTraderBalanceValid, 'cTrader LIVE balance is valid and positive.', 'cTrader LIVE balance is invalid or non-positive.');
    checks.cTraderEquity = gate(input.ctradr.cTraderEquityValid, 'cTrader LIVE equity is valid and positive.', 'cTrader LIVE equity is invalid or non-positive.');
    checks.cTraderTradingPermission = gate(input.ctradr.cTraderTradingPermission, 'cTrader LIVE trading permission is available.', 'cTrader LIVE trading permission is unavailable.');
    checks.cTraderApiMode = gate(input.ctradr.cTraderApiMode === 'LIVE', 'cTrader API mode is LIVE.', 'cTrader API mode must be LIVE for production autonomous execution.');
    checks.cTraderAccountStateConsistent = gate(input.ctradr.cTraderAccountStateConsistent, 'cTrader LIVE account state is aligned with persisted LIVE history.', 'cTrader LIVE account state is not aligned with persisted LIVE history.');
  } else if (input.profile === '5PAISA' && input.fivePaisa) {
    checks.fivePaisaConnected = gate(input.fivePaisa.fivePaisaConnected, '5paisa LIVE account is connected.', '5paisa LIVE account is not connected.');
    checks.fivePaisaAccountLive = gate(input.fivePaisa.fivePaisaAccountIsLive, '5paisa account is identified as LIVE.', '5paisa account is not identified as LIVE.');
    checks.fivePaisaAccountId = gate(input.fivePaisa.fivePaisaAccountIdPresent, '5paisa LIVE account identity is available.', '5paisa LIVE account identity is unavailable.');
    checks.fivePaisaCurrency = gate(input.fivePaisa.fivePaisaCurrencyPresent, '5paisa LIVE account currency is available.', '5paisa LIVE account currency is unavailable.');
    checks.fivePaisaBalance = gate(input.fivePaisa.fivePaisaBalanceValid, '5paisa LIVE balance is valid and positive.', '5paisa LIVE balance is invalid or non-positive.');
    checks.fivePaisaEquity = gate(input.fivePaisa.fivePaisaEquityValid, '5paisa LIVE equity is valid and positive.', '5paisa LIVE equity is invalid or non-positive.');
    checks.fivePaisaTradingPermission = gate(input.fivePaisa.fivePaisaTradingPermission, '5paisa LIVE trading permission is available.', '5paisa LIVE trading permission is unavailable.');
    checks.fivePaisaAccountStateConsistent = gate(input.fivePaisa.fivePaisaAccountStateConsistent, '5paisa LIVE account state is aligned with persisted LIVE history.', '5paisa LIVE account state is not aligned with persisted LIVE history.');
  } else {
    checks.profileMismatch = gate(false, 'Validation profile is valid.', `Validation profile ${input.profile} is not configured correctly for this broker.`);
  }

  const failures = Object.entries(checks).filter(([, value]) => value.status === 'FAIL').map(([name]) => name);
  const ready = failures.length === 0;
  return { ready, status: ready ? 'READY_FOR_ACTIVATION' : 'BLOCKED', statusCode: ready ? 200 : 409, checks, failures, orderSubmissionPerformed: false };
}
