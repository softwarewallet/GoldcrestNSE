import { executeQuery, getDatabaseInitializationState, getDatabasePersistenceStatus } from '../database/db';
import { brokerRegistry } from '../brokers/registry';
import { getLiveRuntimeLogStatus } from './liveRuntimeLog';
import { runtimeLifecycle, RuntimeLifecycleStatus } from './runtimeLifecycle';
import { autoTradingService } from './autoTradingService';
import { getMarketHistorySchedulerStatus } from './marketHistoryService';
import { getCurrentPairPredictionCollectionStatus } from './currentPairPredictionCollectionService';
import { getLiveTradeResearchOutcomeTrackerStatus } from './liveTradeResearchOutcomeService';
import { getAccountBalanceSnapshotSchedulerStatus } from './accountBalanceSnapshotService';
import { EXECUTION_RECONCILIATION_MAX_AGE_MS } from './executionReconciliationService';

export type ObservabilityHealth = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
export type RecoveryAction = 'NONE' | 'RESTART_APPLICATION' | 'CHECK_BROKER_CONNECTION' | 'REVIEW_RECONCILIATION' | 'RESTART_SCHEDULER';

export interface RuntimeComponentHealth {
  name: string;
  health: ObservabilityHealth;
  detail: string;
  lastActivityAt: number | null;
}

export interface RuntimeObservabilitySnapshot {
  generatedAt: number;
  runtimeId: string;
  environment: string;
  tradingMode: 'LIVE_ONLY';
  lifecycle: RuntimeLifecycleStatus;
  overallHealth: ObservabilityHealth;
  components: RuntimeComponentHealth[];
  brokers: Array<{ broker: string; environment: 'LIVE'; reportedStatus: string; isLive: boolean }>;
  executionIntents: {
    pending: number;
    inFlight: number;
    reconciliationTimeout: number;
    operatorActionRequired: number;
    staleUnresolved: number;
    oldestUnresolvedCreatedAt: number | null;
  };
  autoTrading: ReturnType<typeof autoTradingService.getStatus>;
  auditLog: ReturnType<typeof getLiveRuntimeLogStatus>;
  schedulers: {
    marketHistory: ReturnType<typeof getMarketHistorySchedulerStatus>;
    currentPairPrediction: ReturnType<typeof getCurrentPairPredictionCollectionStatus>;
    liveTradeResearchOutcome: ReturnType<typeof getLiveTradeResearchOutcomeTrackerStatus>;
    accountBalanceSnapshot: ReturnType<typeof getAccountBalanceSnapshotSchedulerStatus>;
  };
  database: ReturnType<typeof getDatabaseInitializationState>;
  databasePersistence: ReturnType<typeof getDatabasePersistenceStatus>;
}

export function combineObservabilityHealth(values: ObservabilityHealth[]): ObservabilityHealth {
  if (values.includes('CRITICAL')) return 'CRITICAL';
  if (values.includes('DEGRADED')) return 'DEGRADED';
  return 'HEALTHY';
}

export function evaluateRuntimeObservabilityHealth(input: {
  lifecycleState: RuntimeLifecycleStatus['state'];
  databaseReady: boolean;
  auditLogReady: boolean;
  brokerStatuses: Array<{ status: string; live: boolean }>;
  operatorActionRequired: number;
  staleUnresolved: number;
  schedulerFailures: number;
  persistenceError?: string | null;
}): ObservabilityHealth {
  const health: ObservabilityHealth[] = [];
  health.push(input.databaseReady ? 'HEALTHY' : 'CRITICAL');
  health.push(input.auditLogReady ? 'HEALTHY' : 'CRITICAL');
  health.push(input.lifecycleState === 'RUNNING' ? 'HEALTHY' : input.lifecycleState === 'DEGRADED' ? 'DEGRADED' : 'CRITICAL');
  if (input.brokerStatuses.some(item => item.status === 'ERROR' || item.status === 'AUTHENTICATION_FAILED')) health.push('CRITICAL');
  else if (input.brokerStatuses.some(item => !item.live || item.status !== 'CONNECTED')) health.push('DEGRADED');
  else health.push('HEALTHY');
  health.push(input.operatorActionRequired > 0 || input.staleUnresolved > 0 ? 'DEGRADED' : 'HEALTHY');
  health.push(input.schedulerFailures > 0 ? 'DEGRADED' : 'HEALTHY');
  health.push(input.persistenceError ? 'CRITICAL' : 'HEALTHY');
  return combineObservabilityHealth(health);
}

function component(name: string, health: ObservabilityHealth, detail: string, lastActivityAt: number | null = null): RuntimeComponentHealth {
  return { name, health, detail, lastActivityAt };
}

export async function getRuntimeObservabilitySnapshot(options: {
  runtimeId: string;
  environment?: string;
  now?: number;
}): Promise<RuntimeObservabilitySnapshot> {
  const generatedAt = Number(options.now || Date.now());
  const lifecycle = runtimeLifecycle.getStatus();
  const database = getDatabaseInitializationState();
  const databasePersistence = getDatabasePersistenceStatus();
  const auditLog = getLiveRuntimeLogStatus();
  const autoTrading = autoTradingService.getStatus();
  const marketHistory = getMarketHistorySchedulerStatus();
  const currentPairPrediction = getCurrentPairPredictionCollectionStatus();
  const liveTradeResearchOutcome = getLiveTradeResearchOutcomeTrackerStatus();
  const accountBalanceSnapshot = getAccountBalanceSnapshotSchedulerStatus();

  const intentRows = await executeQuery<any>(
    'SELECT state, created_at, result_json FROM execution_intents WHERE state IN (?, ?, ?) ORDER BY created_at ASC',
    ['PENDING', 'IN_FLIGHT', 'RECONCILIATION_TIMEOUT']
  );

  let pending = 0;
  let inFlight = 0;
  let reconciliationTimeout = 0;
  let operatorActionRequired = 0;
  let staleUnresolved = 0;
  let oldestUnresolvedCreatedAt: number | null = null;
  for (const row of intentRows) {
    const state = String(row.state);
    if (state === 'PENDING') pending += 1;
    if (state === 'IN_FLIGHT') inFlight += 1;
    if (state === 'RECONCILIATION_TIMEOUT') reconciliationTimeout += 1;
    try {
      const result = row.result_json ? JSON.parse(row.result_json) : {};
      if (result?.operatorActionRequired === true) operatorActionRequired += 1;
    } catch {
      // Ignore malformed historical result payloads; the execution state remains authoritative.
    }
    const createdAt = Number(row.created_at);
    if (Number.isFinite(createdAt) && createdAt > 0) {
      oldestUnresolvedCreatedAt = oldestUnresolvedCreatedAt === null ? createdAt : Math.min(oldestUnresolvedCreatedAt, createdAt);
      if (generatedAt - createdAt >= EXECUTION_RECONCILIATION_MAX_AGE_MS) staleUnresolved += 1;
    }
  }

  const brokers = await Promise.all(
    brokerRegistry.getActiveLiveAdapters().map(async adapter => ({
      broker: adapter.broker,
      environment: 'LIVE' as const,
      reportedStatus: await adapter.getTradingStatus(),
      isLive: adapter.isLive
    }))
  );

  const schedulerFailures = Number(Boolean(currentPairPrediction.lastError)) + Number(Boolean(liveTradeResearchOutcome.lastError));
  const overallHealth = evaluateRuntimeObservabilityHealth({
    lifecycleState: lifecycle.state,
    databaseReady: database.initialized,
    auditLogReady: auditLog.enabled && auditLog.exists,
    brokerStatuses: brokers.map(item => ({ status: item.reportedStatus, live: item.isLive })),
    operatorActionRequired,
    staleUnresolved,
    schedulerFailures,
    persistenceError: databasePersistence.lastPersistenceError
  });

  const components: RuntimeComponentHealth[] = [
    component('database', !database.initialized || databasePersistence.lastPersistenceError ? 'CRITICAL' : 'HEALTHY', databasePersistence.lastPersistenceError ? 'persistenceError=' + databasePersistence.lastPersistenceError : database.initialized ? 'initialized' : 'initialization incomplete'),
    component('runtime-lifecycle', lifecycle.state === 'RUNNING' ? 'HEALTHY' : lifecycle.state === 'DEGRADED' ? 'DEGRADED' : 'CRITICAL', 'state=' + lifecycle.state, lifecycle.lastTransitionAt),
    component('audit-log', auditLog.enabled && auditLog.exists ? 'HEALTHY' : 'CRITICAL', auditLog.enabled ? 'enabled' : 'disabled', auditLog.lastModifiedAt ? Date.parse(auditLog.lastModifiedAt) : null),
    ...brokers.map(item => component(item.broker, item.reportedStatus === 'CONNECTED' ? 'HEALTHY' : item.reportedStatus === 'ERROR' || item.reportedStatus === 'AUTHENTICATION_FAILED' ? 'CRITICAL' : 'DEGRADED', 'LIVE status=' + item.reportedStatus)),
    component('market-history', marketHistory.running ? 'HEALTHY' : 'DEGRADED', 'running=' + marketHistory.running + ' syncInFlight=' + marketHistory.syncInFlight, marketHistory.lastGlobalSyncAt),
    component('current-pair-prediction', currentPairPrediction.running ? 'HEALTHY' : 'DEGRADED', 'running=' + currentPairPrediction.running + ' lastError=' + (currentPairPrediction.lastError || 'none'), currentPairPrediction.lastCompletedAt),
    component('live-trade-research-outcome', liveTradeResearchOutcome.running ? 'HEALTHY' : 'DEGRADED', 'running=' + liveTradeResearchOutcome.running + ' lastError=' + (liveTradeResearchOutcome.lastError || 'none'), liveTradeResearchOutcome.lastSyncAt),
    component('account-balance-snapshot', accountBalanceSnapshot.running ? 'HEALTHY' : 'DEGRADED', 'running=' + accountBalanceSnapshot.running, accountBalanceSnapshot.nextRunAt),
    component('execution-intents', operatorActionRequired > 0 || staleUnresolved > 0 ? 'DEGRADED' : 'HEALTHY', 'unresolved=' + intentRows.length + ' operatorActionRequired=' + operatorActionRequired + ' staleUnresolved=' + staleUnresolved, oldestUnresolvedCreatedAt),
  ];

  return {
    generatedAt,
    runtimeId: options.runtimeId,
    environment: options.environment || process.env.NODE_ENV || 'development',
    tradingMode: 'LIVE_ONLY',
    lifecycle,
    overallHealth,
    components,
    brokers,
    executionIntents: { pending, inFlight, reconciliationTimeout, operatorActionRequired, staleUnresolved, oldestUnresolvedCreatedAt },
    autoTrading,
    auditLog,
    schedulers: { marketHistory, currentPairPrediction, liveTradeResearchOutcome, accountBalanceSnapshot },
    database,
    databasePersistence
  };
}

export function getRecoveryRecommendation(snapshot: RuntimeObservabilitySnapshot): { action: RecoveryAction; reason: string } {
  if (snapshot.lifecycle.state === 'STOPPING' || snapshot.lifecycle.state === 'STOPPED') return { action: 'RESTART_APPLICATION', reason: 'Runtime lifecycle is not running.' };
  if (!snapshot.database.initialized || !(snapshot.auditLog.enabled && snapshot.auditLog.exists)) return { action: 'RESTART_APPLICATION', reason: 'A critical local runtime dependency is unavailable.' };
  if (snapshot.executionIntents.operatorActionRequired > 0 || snapshot.executionIntents.staleUnresolved > 0 || snapshot.executionIntents.reconciliationTimeout > 0) return { action: 'REVIEW_RECONCILIATION', reason: 'One or more execution intents require reconciliation review.' };
  if (snapshot.brokers.some(item => item.reportedStatus !== 'CONNECTED')) return { action: 'CHECK_BROKER_CONNECTION', reason: 'One or more LIVE brokers report a non-connected status.' };
  const stoppedSchedulers = [snapshot.schedulers.marketHistory.running, snapshot.schedulers.currentPairPrediction.running, snapshot.schedulers.liveTradeResearchOutcome.running, snapshot.schedulers.accountBalanceSnapshot.running].filter(running => !running).length;
  if (stoppedSchedulers > 0) return { action: 'RESTART_SCHEDULER', reason: String(stoppedSchedulers) + ' runtime scheduler(s) are stopped.' };
  return { action: 'NONE', reason: 'No immediate operator recovery action is indicated.' };
}