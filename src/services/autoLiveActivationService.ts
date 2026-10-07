export interface AutoLiveActivationInput {
  productionEnvironment: boolean;
  releaseIntegrityOk: boolean;
  configurationIntegrityOk: boolean;
  tradingModeLiveOnly: boolean;
  runtimeLifecycleRunning: boolean;
  cTraderCredentialsConfigured: boolean;
  cTraderConnected: boolean;
  cTraderAccountIsLive: boolean;
  cTraderAccountIdPresent: boolean;
  cTraderCurrencyPresent: boolean;
  cTraderBalanceValid: boolean;
  cTraderEquityValid: boolean;
  cTraderTradingPermission: boolean;
  cTraderApiMode: 'LIVE' | 'DEMO';
  allowDemoApiMode: boolean;
  killSwitchClear: boolean;
}

export interface AutoLiveActivationResult {
  ready: boolean;
  status: 'READY_TO_ARM' | 'BLOCKED';
  statusCode: 200 | 409;
  checks: Record<string, 'PASS' | 'FAIL'>;
  failures: string[];
}

export function evaluateAutoLiveActivation(input: AutoLiveActivationInput): AutoLiveActivationResult {
  const checks: Record<string, 'PASS' | 'FAIL'> = {};
  const failures: string[] = [];

  const check = (name: string, ok: boolean): void => {
    checks[name] = ok ? 'PASS' : 'FAIL';
    if (!ok) failures.push(name);
  };

  check('productionEnvironment', input.productionEnvironment);
  check('releaseIntegrity', input.releaseIntegrityOk);
  check('configurationIntegrity', input.configurationIntegrityOk);
  check('tradingMode', input.tradingModeLiveOnly);
  check('runtimeLifecycle', input.runtimeLifecycleRunning);
  check('cTraderCredentials', input.cTraderCredentialsConfigured);
  check('cTraderConnected', input.cTraderConnected);
  check('cTraderAccountLive', input.cTraderAccountIsLive);
  check('cTraderAccountId', input.cTraderAccountIdPresent);
  check('cTraderCurrency', input.cTraderCurrencyPresent);
  check('cTraderBalance', input.cTraderBalanceValid);
  check('cTraderEquity', input.cTraderEquityValid);
  check('cTraderTradingPermission', input.cTraderTradingPermission);
  check('cTraderApiMode', input.cTraderApiMode === 'LIVE' || (input.allowDemoApiMode && input.cTraderApiMode === 'DEMO'));
  check('killSwitch', input.killSwitchClear);

  const ready = failures.length === 0;
  return {
    ready,
    status: ready ? 'READY_TO_ARM' : 'BLOCKED',
    statusCode: ready ? 200 : 409,
    checks,
    failures
  };
}
