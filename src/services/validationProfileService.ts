export type ValidationProfile = 'CTRADER' | '5PAISA' | 'FIVE_PAISA';

export interface CommonValidationInput {
  productionEnvironment: boolean;
  releaseIntegrityOk: boolean;
  configurationIntegrityOk: boolean;
  tradingModeLiveOnly: boolean;
  databaseInitialized: boolean;
  databasePersistenceHealthy: boolean;
  runtimeLifecycleRunning: boolean;
  auditLogReady: boolean;
  operatorAuthConfigured: boolean;
  killSwitchClear: boolean;
  executionGateLocked: boolean;
  noUnresolvedExecutionIntents: boolean;
  validationSubmittedOrder: boolean;
}

export interface CTraderValidationInput {
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
  cTraderAccountStateConsistent: boolean;
}

export interface FivePaisaValidationInput {
  fivePaisaConnected: boolean;
  fivePaisaAccountIsLive: boolean;
  fivePaisaAccountIdPresent: boolean;
  fivePaisaCurrencyPresent: boolean;
  fivePaisaBalanceValid: boolean;
  fivePaisaEquityValid: boolean;
  fivePaisaTradingPermission: boolean;
  fivePaisaAccountStateConsistent: boolean;
}

export interface ProductionGoLiveValidationInput {
  profile: ValidationProfile;
  common: CommonValidationInput;
  ctradr?: CTraderValidationInput;
  fivePaisa?: FivePaisaValidationInput;
}
