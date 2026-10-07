export type OperationalReadinessStatus = 'READY' | 'BLOCKED';

export interface OperationalReadinessInput {
  releaseIntegrityOk: boolean;
  configurationIntegrityOk: boolean;
  tradingModeLiveOnly: boolean;
  databaseInitialized: boolean;
  databasePersistenceHealthy: boolean;
  runtimeLifecycleRunning: boolean;
  auditLogReady: boolean;
  operatorAuthConfigured: boolean;
  liveBrokerConfigured: boolean;
  liveBrokerConnected: boolean;
  autonomousExecutionAllowed: boolean;
}

export interface OperationalReadinessGate {
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface OperationalReadinessResult {
  ready: boolean;
  status: OperationalReadinessStatus;
  statusCode: 200 | 503;
  gates: Record<string, OperationalReadinessGate>;
  failures: string[];
}

function gate(ok: boolean, passDetail: string, failDetail: string): OperationalReadinessGate {
  return {
    status: ok ? 'PASS' : 'FAIL',
    detail: ok ? passDetail : failDetail
  };
}

export function evaluateOperationalReadiness(input: OperationalReadinessInput): OperationalReadinessResult {
  const gates: Record<string, OperationalReadinessGate> = {
    releaseIntegrity: gate(input.releaseIntegrityOk, 'Production release integrity is valid.', 'Production release integrity failed.'),
    configurationIntegrity: gate(input.configurationIntegrityOk, 'System configuration passes integrity validation.', 'System configuration failed integrity validation.'),
    tradingMode: gate(input.tradingModeLiveOnly, 'Trading mode is LIVE_ONLY.', 'Trading mode is not LIVE_ONLY.'),
    database: gate(input.databaseInitialized, 'SQLite database is initialized.', 'SQLite database is not initialized.'),
    databasePersistence: gate(input.databasePersistenceHealthy, 'SQLite persistence has no recorded error.', 'SQLite persistence has a recorded error.'),
    runtimeLifecycle: gate(input.runtimeLifecycleRunning, 'Runtime lifecycle is RUNNING.', 'Runtime lifecycle is not RUNNING.'),
    auditLog: gate(input.auditLogReady, 'Durable audit log is enabled and available.', 'Durable audit log is unavailable.'),
    operatorAuth: gate(input.operatorAuthConfigured, 'Operator authentication is configured.', 'Operator authentication is not configured.'),
    liveBrokerConfigured: gate(input.liveBrokerConfigured, 'At least one LIVE broker credential set is configured.', 'No LIVE broker credential set is configured.'),
    liveBrokerConnected: gate(input.liveBrokerConnected, 'At least one LIVE broker reports CONNECTED.', 'No configured LIVE broker currently reports CONNECTED.'),
    autonomousExecutionLocked: gate(!input.autonomousExecutionAllowed, 'Autonomous live execution is locked.', 'Autonomous live execution is currently permitted.')
  };

  const failures = Object.entries(gates)
    .filter(([, value]) => value.status === 'FAIL')
    .map(([name]) => name);

  const ready = failures.length === 0;
  return {
    ready,
    status: ready ? 'READY' : 'BLOCKED',
    statusCode: ready ? 200 : 503,
    gates,
    failures
  };
}
