import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { timingSafeEqual } from 'node:crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { apiRateLimit, blockLegacyTradingModes, operatorAuthConfigured, operatorAuthRequired, requestId, securityHeaders, issueOperatorSession, setOperatorSessionCookie, clearOperatorSessionCookie, isOperatorSessionValid } from './src/server/security';

import { getDatabase, getDatabaseStats, executeQuery, executeRun, persistDatabase } from './src/database/db';
import { buildRuntimeHealthPayload, evaluateRuntimeReadiness } from './src/services/runtimeReadiness';
import { getIndianSessionState } from './src/markets/common/session';
import { INDIAN_UNDERLYINGS } from './src/markets/india_equity/underlyings';
import { ScannerService } from './src/services/scannerService';
import { getSystemConfig, updateSystemConfig, applyPersistedSystemConfig, prepareSystemConfigUpdate, persistSystemConfig } from './src/services/configService';
import { getCTraderApiMode } from './src/services/configService';
import { evaluateBrokerVerification } from './src/services/brokerVerificationService';
import { loadPersistedSystemConfigFromDatabase, persistSystemConfigToDatabase } from './src/services/configPersistenceService';
import { calculateStrategyPayoff } from './src/markets/india_options/strategySkeleton';

// Broker Integration & Safety
import { BrokerError } from './src/brokers/errors';
import { brokerRouter } from './src/brokers/brokerRoutes';
import { killSwitch } from './src/brokers/safety/KillSwitch';
import { LIVE_AUTO_EXECUTION_ALLOWED, refreshAutonomousExecutionPermission, armAutonomousExecutionGate, lockAutonomousExecutionGate, validateAutoLiveOrderPacket } from './src/brokers/safety/AutoExecutionEngine';
import { autoTradingService } from './src/services/autoTradingService';
import { initializeLiveRuntimeLog, getLiveRuntimeLogStatus, startLiveRuntimeLog, stopLiveRuntimeLog, getLiveRuntimeLogFile, listLiveRuntimeLogFiles, logApplicationAction, liveRuntimeLog } from './src/services/liveRuntimeLog';
import { fetchIndianMarketNews } from './src/services/indianMarketNewsService';
import {
  getMarketHistorySchedulerStatus,
  getMarketHistorySummary,
  getMarketHistorySyncStatus,
  startMarketHistoryScheduler,
  stopMarketHistoryScheduler,
  syncMarketHistory
} from './src/services/marketHistoryService';
import {
  getLiveTradeResearch,
} from './src/services/liveTradeResearchService';
import { getLiveTradeResearchAnalytics } from './src/services/liveTradeResearchAnalyticsService';
import { getLiveTradeResearchFeatures, materializeLiveTradeResearchFeatures } from './src/services/liveTradeResearchFeatureService';
import { evaluateLiveTradeResearch, getLiveTradeResearchEvaluations } from './src/services/liveTradeResearchEvaluationService';
import {
  generateResearchPredictions,
  getLiveTradeResearchPredictions,
  getCurrentPairPredictions,
  getResearchPrediction,
  LlamaGatewayPredictionModel,
  SignalDirectionBaselineModel
} from './src/services/liveTradeResearchPredictionService';
import { evaluatePendingResearchPredictions, getResearchPredictionAnalytics } from './src/services/liveTradeResearchPredictionEvaluationService';
import { generateCurrentPairPredictions } from './src/services/pairPredictionService';
import { evaluatePendingCurrentPairPredictions, getCurrentPairPredictionAnalytics, getCurrentPairPredictionModelComparison, getCurrentPairPairedModelComparison, getCurrentPairPairedModelComparisonRolling, getCurrentPairPairedContextComparison, getCurrentPairPredictionWalkForwardAnalytics, type CurrentPairPredictionHorizon } from './src/services/currentPairPredictionOutcomeService';
import { getCurrentPairPredictionCollectionStatus, runCurrentPairPredictionCollectionCycle, startCurrentPairPredictionCollectionScheduler, stopCurrentPairPredictionCollectionScheduler } from './src/services/currentPairPredictionCollectionService';
import { getCurrentPairResearchValidationReport } from './src/services/currentPairResearchValidationService';
import { getCurrentPairOosDriftReport } from './src/services/currentPairOosDriftService';
import { getCurrentPairCalibrationMatrix } from './src/services/currentPairCalibrationMatrixService';
import { getCurrentPairCrossModelContextCalibration } from './src/services/currentPairCrossModelContextCalibrationService';
import { getCurrentPairCrossModelCalibration } from './src/services/currentPairCrossModelCalibrationService';
import { getCurrentPairCrossModelTemporalCalibration } from './src/services/currentPairCrossModelTemporalCalibrationService';
import { getCurrentPairCrossModelContextTemporalCalibration } from './src/services/currentPairCrossModelContextTemporalCalibrationService';
import { getCurrentPairResearchReadinessLedger } from './src/services/currentPairResearchReadinessLedgerService';
import { getCurrentPairTemporalCalibrationMatrix } from './src/services/currentPairTemporalCalibrationService';
import {
  getResearchAiServerConfig,
  saveResearchAiServerConfig,
  testResearchAiServerConnection,
  testResearchAiServerPrediction
} from './src/services/researchAiServerService';
import {
  getLiveTradeResearchOutcomeTrackerStatus,
  startLiveTradeResearchOutcomeTracker,
  stopLiveTradeResearchOutcomeTracker
} from './src/services/liveTradeResearchOutcomeService';

// Phase 3 Machine Learning Engine is retained for internal model compatibility;
// the public research/training API is retired while the research program is closed.

// Phase 5 Governance Engine
import { governanceRouter } from './src/governance/governanceRoutes';
import { reconciliationService } from './src/services/reconciliationService';
import { reconcileInFlightExecutionIntents } from './src/services/executionReconciliationService';
import { captureAccountBalanceSnapshots, getAccountBalanceSnapshots, startAccountBalanceSnapshotScheduler, stopAccountBalanceSnapshotScheduler } from './src/services/accountBalanceSnapshotService';

// Legacy demo execution is retired; LIVE_ONLY production mode is enforced by the server safety layer.
import { brokerRegistry } from './src/brokers/registry';
import { runtimeLifecycle } from './src/services/runtimeLifecycle';
import { getRecoveryRecommendation, getRuntimeObservabilitySnapshot } from './src/services/runtimeObservabilityService';
import { buildProductionReleaseIntegrityInput, evaluateProductionReleaseIntegrity } from './src/services/productionReleaseIntegrityService';
import { evaluateSystemConfigIntegrity } from './src/services/configIntegrityService';
import { evaluateOperationalReadiness } from './src/services/operationalReadinessService';
import { evaluateAccountStateConsistency } from './src/services/accountStateConsistencyService';
import { evaluateAutoLiveActivation } from './src/services/autoLiveActivationService';
import { evaluateProductionGoLiveValidation } from './src/services/productionGoLiveValidationService';
import { evaluateActiveAutoLiveMonitor } from './src/services/activeAutoLiveMonitorService';
import { evaluateCTraderFunctionalValidation } from './src/services/cTraderFunctionalValidationService';
import { maskIdentifier } from './src/brokers/auditLog';

const invokedByNpmDev = process.env.npm_lifecycle_event === 'dev';
// npm run dev is an explicit local development command. Do not let a stale
// NODE_ENV=production value in .env accidentally switch this process into the
// production preflight path.
if (invokedByNpmDev) {
  process.env.NODE_ENV = 'development';
}

dotenv.config();

// Start durable audit logging before the application initializes any broker,
// database, reconciliation, or Auto Live services. Credentials and secrets are
// sanitized by the logging service.
const startupAudit = initializeLiveRuntimeLog('APPLICATION_START');
logApplicationAction('APPLICATION_BOOT', {
  pid: process.pid,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  auditFile: startupAudit.file
});

process.on('uncaughtException', (error) => {
  liveRuntimeLog('ERROR', 'PROCESS_UNCAUGHT_EXCEPTION', {
    message: error?.message || String(error),
    stack: error?.stack
  });
});

process.on('unhandledRejection', (reason) => {
  liveRuntimeLog('ERROR', 'PROCESS_UNHANDLED_REJECTION', {
    reason: reason instanceof Error
      ? { message: reason.message, stack: reason.stack }
      : reason
  });
});

// Local development uses the same LIVE execution pipeline for end-to-end
// broker testing, but the autonomous arm is still operator-triggered.
// Keep the required arm flags enabled in development so START AUTO LIVE does
// not depend on stale .env values. Production remains explicitly gated.
if (process.env.NODE_ENV !== 'production') {
  process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'true';
  process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'true';
  process.env.LIVE_TRADING_ENABLED = 'true';
  process.env.GOLDCREST_PRODUCTION_STRATEGY_ID = 'fx_structure_v2a';
  process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'true';
  updateSystemConfig({
    liveTradingEnabled: true,
    tradingMode: 'LIVE_ONLY'
  });
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const GOLDCREST_RUNTIME_ID = `goldcrest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let databaseReady = false;
let reconciliationTimer: ReturnType<typeof setInterval> | null = null;
let executionLifecycleTimer: ReturnType<typeof setInterval> | null = null;

function productionPreflight(enforce = false): { ok: boolean; checks: Record<string, string> } {
  const checks: Record<string, string> = {};
  refreshAutonomousExecutionPermission();
  const configIntegrity = evaluateSystemConfigIntegrity(getSystemConfig());
  const autoTradingRequested = process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true';
  const autonomousRequested = process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true';
  const operatorKey = process.env.GOLDCREST_OPERATOR_API_KEY?.trim();
  const ctraderConfigured = Boolean(
    process.env.CTRADER_LIVE_CLIENT_ID?.trim() &&
    process.env.CTRADER_LIVE_CLIENT_SECRET?.trim() &&
    process.env.CTRADER_LIVE_ACCESS_TOKEN?.trim() &&
    process.env.CTRADER_LIVE_ACCOUNT_ID?.trim()
  );
  const fivePaisaConfigured = Boolean(
    process.env.FIVEPAISA_LIVE_APP_NAME?.trim() &&
    process.env.FIVEPAISA_LIVE_USER_ID?.trim() &&
    process.env.FIVEPAISA_LIVE_USER_KEY?.trim() &&
    process.env.FIVEPAISA_LIVE_CLIENT_CODE?.trim()
  );
  checks.operatorAuth = operatorKey ? 'CONFIGURED' : 'MISSING';
  checks.liveBroker = ctraderConfigured || fivePaisaConfigured ? 'CONFIGURED' : 'MISSING';
  checks.autonomousExecution = LIVE_AUTO_EXECUTION_ALLOWED
    ? 'ENABLED'
    : (autoTradingRequested || autonomousRequested ? 'BLOCKED' : 'DISABLED');
  const productionStrategyApproved = process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED === 'true'
    && String(process.env.GOLDCREST_PRODUCTION_STRATEGY_ID || 'fx_structure_v2a').trim() === 'fx_structure_v2a';
  checks.autoTradingBroker = (autoTradingRequested || autonomousRequested)
    ? (ctraderConfigured ? 'CONFIGURED' : 'MISSING')
    : 'NOT_REQUESTED';
  checks.productionStrategy = productionStrategyApproved ? 'APPROVED' : 'NOT_APPROVED';
  checks.tradingMode = getSystemConfig().tradingMode;
  checks.configIntegrity = configIntegrity.ok ? 'VALID' : 'INVALID';
  const autoConfigValid = !autoTradingRequested && !autonomousRequested
    ? true
    : LIVE_AUTO_EXECUTION_ALLOWED;
  const ok = Boolean(operatorKey)
    && (ctraderConfigured || fivePaisaConfigured)
    && autoConfigValid
    && getSystemConfig().tradingMode === 'LIVE_ONLY'
    && configIntegrity.ok;
  if (!ok && enforce && process.env.NODE_ENV === 'production') {
    throw new Error(`Production preflight failed: ${Object.entries(checks).filter(([, value]) => value !== 'CONFIGURED' && value !== 'DISABLED' && value !== 'LIVE_ONLY').map(([key]) => key).join(', ') || 'invalid safety configuration'}`);
  }
  return { ok, checks };
}

app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(requestId);
app.use(apiRateLimit);
app.use(blockLegacyTradingModes);
app.use(express.json({ limit: '512kb' }));

// Durable audit trail for every API action. Request bodies are deliberately
// excluded so credentials/tokens/passwords can never be persisted by this
// middleware. Detailed trade actions are recorded separately by auditLog.ts.
app.use((req: Request, res: Response, next) => {
  const startedAt = Date.now();
  const shouldAudit = req.path.startsWith('/api/');
  if (shouldAudit) {
    liveRuntimeLog('SYSTEM', 'API_REQUEST_STARTED', {
      method: req.method,
      path: req.path,
      query: req.query
    });
  }

  res.on('finish', () => {
    if (!shouldAudit) return;
    liveRuntimeLog(
      res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'SYSTEM',
      'API_REQUEST_COMPLETED',
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      }
    );
  });

  next();
});

// Identify the actual Goldcrest backend process on every API response. This prevents
// a stale Vite/proxy process from being mistaken for the current server.
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Goldcrest-Runtime', GOLDCREST_RUNTIME_ID);
  res.setHeader('X-Goldcrest-Api', 'express-live');
  next();
});

app.get('/api/runtime', (_req: Request, res: Response) => {
  const productionRuntime = process.env.NODE_ENV === 'production';
  const releaseIntegrity = productionRuntime
    ? evaluateProductionReleaseIntegrity(buildProductionReleaseIntegrityInput({
        tradingMode: getSystemConfig().tradingMode,
        operatorAuthConfigured: operatorAuthConfigured(),
        liveBrokerConfigured: Boolean(
          process.env.CTRADER_LIVE_CLIENT_ID?.trim() &&
          process.env.CTRADER_LIVE_CLIENT_SECRET?.trim() &&
          process.env.CTRADER_LIVE_ACCESS_TOKEN?.trim() &&
          process.env.CTRADER_LIVE_ACCOUNT_ID?.trim()
        ) || Boolean(
          process.env.FIVEPAISA_LIVE_APP_NAME?.trim() &&
          process.env.FIVEPAISA_LIVE_USER_ID?.trim() &&
          process.env.FIVEPAISA_LIVE_USER_KEY?.trim() &&
          process.env.FIVEPAISA_LIVE_CLIENT_CODE?.trim()
        ),
        packageVersion: process.env.GOLDCREST_RELEASE_VERSION || undefined
      }))
    : null;

  res.type('application/json').json({
    service: 'goldcrest',
    runtime: GOLDCREST_RUNTIME_ID,
    nodeEnv: process.env.NODE_ENV || 'development',
    port: PORT,
    tradingMode: 'LIVE_ONLY',
    lifecycle: runtimeLifecycle.getStatus(),
    releaseIntegrity,
    timestamp: Date.now()
  });
});

app.get('/api/operations/account-consistency', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const brokers = ['CTRADER', 'FIVE_PAISA'] as const;
    const results = await Promise.all(
      brokers.map(async (broker) => {
        let liveAccount = null;
        try {
          liveAccount = await brokerRegistry.getAdapter(broker, 'LIVE').getAccount();
        } catch {
          liveAccount = null;
        }

        const snapshots = await getAccountBalanceSnapshots({
          broker,
          limit: 1
        });
        const result = evaluateAccountStateConsistency(
          broker,
          liveAccount,
          snapshots[0] || null
        );

        return {
          ...result,
          liveAccount: liveAccount
            ? {
                accountId: maskIdentifier(String(liveAccount.accountId || '')),
                currency: liveAccount.currency,
                balance: liveAccount.balance,
                equity: liveAccount.equity,
                usedMargin: liveAccount.usedMargin,
                freeMargin: liveAccount.freeMargin,
                lastUpdate: liveAccount.lastUpdate,
                connectionStatus: liveAccount.connectionStatus
              }
            : null,
          latestSnapshot: snapshots[0]
            ? {
                capturedAt: snapshots[0].capturedAt,
                accountId: maskIdentifier(String(snapshots[0].accountId || '')),
                currency: snapshots[0].currency,
                balance: snapshots[0].balance,
                equity: snapshots[0].equity,
                usedMargin: snapshots[0].usedMargin,
                freeMargin: snapshots[0].freeMargin,
                status: snapshots[0].status
              }
            : null
        };
      })
    );

    const consistent = results.length > 0
      && results.every(result => result.consistent)
      && results.some(result => result.liveAccountValid);

    res.status(consistent ? 200 : 503).json({
      generatedAt: Date.now(),
      environment: 'LIVE',
      tradingMode: 'LIVE_ONLY',
      consistent,
      brokers: results
    });
  } catch (error: any) {
    liveRuntimeLog('ERROR', 'ACCOUNT_STATE_CONSISTENCY_FAILED', {
      error: error?.message || String(error)
    });
    res.status(503).json({
      error: 'ACCOUNT_STATE_CONSISTENCY_UNAVAILABLE',
      message: error?.message || 'LIVE account state consistency is unavailable.'
    });
  }
});

app.get('/api/operations/brokers/verify', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    const credentialStatuses = brokerRegistry.getCredentialStatuses();

    const results = await Promise.all(
      (['CTRADER', 'FIVE_PAISA'] as const).map(async (broker) => {
        const credentials = credentialStatuses.find(item => item.broker === broker && item.environment === 'LIVE');
        if (!credentials?.configured) {
          return evaluateBrokerVerification({
            broker,
            configured: false
          });
        }

        try {
          const connection = await brokerRegistry.testBrokerConnection(broker, 'LIVE');
          return evaluateBrokerVerification({
            broker,
            configured: true,
            connection,
            expectedCTraderApiMode: broker === 'CTRADER' ? getCTraderApiMode() : undefined
          });
        } catch {
          return evaluateBrokerVerification({
            broker,
            configured: true
          });
        }
      })
    );

    const anyConfigured = results.some(result => result.status !== 'NOT_CONFIGURED');
    const anyConnected = results.some(result => result.connected);

    res.status(anyConfigured ? (anyConnected ? 200 : 503) : 503).json({
      generatedAt: Date.now(),
      environment: 'LIVE',
      tradingMode: 'LIVE_ONLY',
      cTraderApiMode: getCTraderApiMode(),
      anyConfigured,
      anyConnected,
      brokers: results
    });
  } catch (error: any) {
    liveRuntimeLog('ERROR', 'BROKER_VERIFICATION_FAILED', {
      error: error?.message || String(error)
    });
    res.status(503).json({
      error: 'BROKER_VERIFICATION_UNAVAILABLE',
      message: error?.message || 'LIVE broker verification is unavailable.'
    });
  }
});

app.get('/api/operations/readiness', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    const snapshot = await getRuntimeObservabilitySnapshot({
      runtimeId: GOLDCREST_RUNTIME_ID,
      environment: process.env.NODE_ENV || 'development'
    });

    const releaseIntegrity = process.env.NODE_ENV === 'production'
      ? evaluateProductionReleaseIntegrity(buildProductionReleaseIntegrityInput({
          tradingMode: getSystemConfig().tradingMode,
          operatorAuthConfigured: operatorAuthConfigured(),
          liveBrokerConfigured: Boolean(
            process.env.CTRADER_LIVE_CLIENT_ID?.trim() &&
            process.env.CTRADER_LIVE_CLIENT_SECRET?.trim() &&
            process.env.CTRADER_LIVE_ACCESS_TOKEN?.trim() &&
            process.env.CTRADER_LIVE_ACCOUNT_ID?.trim()
          ) || Boolean(
            process.env.FIVEPAISA_LIVE_APP_NAME?.trim() &&
            process.env.FIVEPAISA_LIVE_USER_ID?.trim() &&
            process.env.FIVEPAISA_LIVE_USER_KEY?.trim() &&
            process.env.FIVEPAISA_LIVE_CLIENT_CODE?.trim()
          ),
          packageVersion: process.env.GOLDCREST_RELEASE_VERSION || undefined
        }))
      : null;

    const result = evaluateOperationalReadiness({
      releaseIntegrityOk: releaseIntegrity?.ok === true,
      configurationIntegrityOk: evaluateSystemConfigIntegrity(getSystemConfig()).ok,
      tradingModeLiveOnly: getSystemConfig().tradingMode === 'LIVE_ONLY',
      databaseInitialized: snapshot.database.initialized,
      databasePersistenceHealthy: !snapshot.databasePersistence.lastPersistenceError,
      runtimeLifecycleRunning: snapshot.lifecycle.state === 'RUNNING',
      auditLogReady: snapshot.auditLog.enabled && snapshot.auditLog.exists,
      operatorAuthConfigured: operatorAuthConfigured(),
      liveBrokerConfigured: Boolean(
        process.env.CTRADER_LIVE_CLIENT_ID?.trim() &&
        process.env.CTRADER_LIVE_CLIENT_SECRET?.trim() &&
        process.env.CTRADER_LIVE_ACCESS_TOKEN?.trim() &&
        process.env.CTRADER_LIVE_ACCOUNT_ID?.trim()
      ) || Boolean(
        process.env.FIVEPAISA_LIVE_APP_NAME?.trim() &&
        process.env.FIVEPAISA_LIVE_USER_ID?.trim() &&
        process.env.FIVEPAISA_LIVE_USER_KEY?.trim() &&
        process.env.FIVEPAISA_LIVE_CLIENT_CODE?.trim()
      ),
      liveBrokerConnected: snapshot.brokers.some(item => item.isLive && item.reportedStatus === 'CONNECTED'),
      autonomousExecutionAllowed: LIVE_AUTO_EXECUTION_ALLOWED
    });

    res.status(result.statusCode).json({
      ...result,
      runtimeId: GOLDCREST_RUNTIME_ID,
      generatedAt: Date.now(),
      environment: process.env.NODE_ENV || 'development',
      releaseVersion: releaseIntegrity?.version || null,
      brokers: snapshot.brokers.map(item => ({
        broker: item.broker,
        status: item.reportedStatus,
        live: item.isLive
      }))
    });
  } catch (error: any) {
    liveRuntimeLog('ERROR', 'OPERATIONAL_READINESS_EVALUATION_FAILED', {
      error: error?.message || String(error)
    });
    res.status(503).json({
      error: 'OPERATIONAL_READINESS_UNAVAILABLE',
      message: error?.message || 'Operational readiness is unavailable.'
    });
  }
});

app.get('/api/operations/go-live-validation', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;

    const productionEnvironment = process.env.NODE_ENV === 'production';
    const config = getSystemConfig();
    const configIntegrity = evaluateSystemConfigIntegrity(config);
    const releaseIntegrity = productionEnvironment
      ? evaluateProductionReleaseIntegrity(buildProductionReleaseIntegrityInput({
          tradingMode: config.tradingMode,
          operatorAuthConfigured: operatorAuthConfigured(),
          liveBrokerConfigured: Boolean(
            process.env.CTRADER_LIVE_CLIENT_ID?.trim() &&
            process.env.CTRADER_LIVE_CLIENT_SECRET?.trim() &&
            process.env.CTRADER_LIVE_ACCESS_TOKEN?.trim() &&
            process.env.CTRADER_LIVE_ACCOUNT_ID?.trim()
          ) || Boolean(
            process.env.FIVEPAISA_LIVE_APP_NAME?.trim() &&
            process.env.FIVEPAISA_LIVE_USER_ID?.trim() &&
            process.env.FIVEPAISA_LIVE_USER_KEY?.trim() &&
            process.env.FIVEPAISA_LIVE_CLIENT_CODE?.trim()
          ),
          packageVersion: process.env.GOLDCREST_RELEASE_VERSION || undefined
        }))
      : { ok: false, version: undefined };

    const credentialStatus = brokerRegistry.getCredentialStatuses();
    const cTraderCredentialsConfigured = credentialStatus.some(
      item => item.broker === 'CTRADER' && item.environment === 'LIVE' && item.configured
    );

    let connection = null;
    let account = null;
    if (cTraderCredentialsConfigured) {
      try {
        connection = await brokerRegistry.testBrokerConnection('CTRADER', 'LIVE');
        account = await brokerRegistry.getAdapter('CTRADER', 'LIVE').getAccount();
      } catch {
        connection = null;
        account = null;
      }
    }

    const brokerVerification = evaluateBrokerVerification({
      broker: 'CTRADER',
      configured: cTraderCredentialsConfigured,
      connection,
      expectedCTraderApiMode: getCTraderApiMode()
    });

    const snapshots = await getAccountBalanceSnapshots({
      broker: 'CTRADER',
      limit: 1
    });
    const accountConsistency = evaluateAccountStateConsistency(
      'CTRADER',
      account,
      snapshots[0] || null
    );

    const permissions = Array.isArray(account?.permissions) ? account.permissions : [];
    const accountIsLive = account?.accountType === 'LIVE' && account?.isLiveAccount !== false;
    const accountIdPresent = Boolean(String(account?.accountId || '').trim());
    const currencyPresent = Boolean(String(account?.currency || '').trim());
    const balanceValid = typeof account?.balance === 'number'
      && Number.isFinite(account.balance)
      && account.balance > 0;
    const equityValid = typeof account?.equity === 'number'
      && Number.isFinite(account.equity)
      && account.equity > 0;
    const tradingPermission = permissions.includes('TRADING')
      || permissions.includes('EQUITY')
      || permissions.includes('DERIVATIVES')
      || permissions.includes('NSE_FNO');

    const observability = await getRuntimeObservabilitySnapshot({
      runtimeId: GOLDCREST_RUNTIME_ID,
      environment: process.env.NODE_ENV || 'development'
    });
    const noUnresolvedExecutionIntents =
      observability.executionIntents.pending === 0
      && observability.executionIntents.inFlight === 0
      && observability.executionIntents.reconciliationTimeout === 0;

    const broker = brokerRegistry.getSelectedBroker();
    const commonInput = {
      productionEnvironment,
      releaseIntegrityOk: releaseIntegrity.ok === true,
      configurationIntegrityOk: configIntegrity.ok,
      tradingModeLiveOnly: config.tradingMode === 'LIVE_ONLY',
      databaseInitialized: observability.database.initialized,
      databasePersistenceHealthy: !observability.databasePersistence.lastPersistenceError,
      runtimeLifecycleRunning: observability.lifecycle.state === 'RUNNING',
      auditLogReady: observability.auditLog.enabled && observability.auditLog.exists,
      operatorAuthConfigured: operatorAuthConfigured(),
      killSwitchClear: !killSwitch.isHalted(),
      executionGateLocked: !LIVE_AUTO_EXECUTION_ALLOWED,
      noUnresolvedExecutionIntents,
      validationSubmittedOrder: false
    };

    let validationInput: any = { profile: broker, common: commonInput };

    if (broker === 'CTRADER') {
      validationInput.ctradr = {
        cTraderCredentialsConfigured,
        cTraderBrokerVerified: brokerVerification.status === 'VERIFIED',
        cTraderConnected: connection?.connected === true && account?.connectionStatus === 'CONNECTED',
        cTraderAccountIsLive: accountIsLive,
        cTraderAccountIdPresent: accountIdPresent,
        cTraderCurrencyPresent: currencyPresent,
        cTraderBalanceValid: balanceValid,
        cTraderEquityValid: equityValid,
        cTraderTradingPermission: tradingPermission,
        cTraderApiMode: getCTraderApiMode(),
        cTraderAccountStateConsistent: accountConsistency.consistent
      };
    } else if (broker === 'FIVE_PAISA') {
      const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
      const account = await adapter.getAccount().catch(() => null);
      const connection = await adapter.testConnection().catch(() => ({ connected: false }));

      validationInput.fivePaisa = {
        fivePaisaConnected: connection?.connected === true,
        fivePaisaAccountIsLive: account?.accountType === 'LIVE' || account?.isLiveAccount === true,
        fivePaisaAccountIdPresent: Boolean(String(account?.accountId || '').trim()),
        fivePaisaCurrencyPresent: Boolean(String(account?.currency || '').trim()),
        fivePaisaBalanceValid: typeof account?.balance === 'number' && Number.isFinite(account.balance) && account.balance > 0,
        fivePaisaEquityValid: typeof account?.equity === 'number' && Number.isFinite(account.equity) && account.equity > 0,
        fivePaisaTradingPermission: Array.isArray(account?.permissions) && account.permissions.includes('TRADING'),
        fivePaisaAccountStateConsistent: account?.connectionStatus === 'CONNECTED'
      };
    }
    
    const validation = evaluateProductionGoLiveValidation(validationInput);

    liveRuntimeLog(
      validation.ready ? 'SYSTEM' : 'WARN',
      validation.ready ? 'PRODUCTION_GO_LIVE_VALIDATION_READY' : 'PRODUCTION_GO_LIVE_VALIDATION_BLOCKED',
      {
        failures: validation.failures,
        cTraderApiMode: getCTraderApiMode(),
        brokerVerification: brokerVerification.status,
        accountConsistency: accountConsistency.status,
        unresolvedExecutionIntents: observability.executionIntents
      }
    );

    return res.status(validation.statusCode).json({
      phase: '9.5',
      generatedAt: Date.now(),
      runtimeId: GOLDCREST_RUNTIME_ID,
      environment: process.env.NODE_ENV || 'development',
      tradingMode: 'LIVE_ONLY',
      status: validation.status,
      ready: validation.ready,
      checks: validation.checks,
      failures: validation.failures,
      orderSubmissionPerformed: false,
      cTrader: {
        apiMode: getCTraderApiMode(),
        apiEndpoint: connection?.apiEndpoint || null,
        verificationStatus: brokerVerification.status,
        verificationFailures: brokerVerification.failures,
        connected: connection?.connected === true,
        accountId: account ? maskIdentifier(String(account.accountId || '')) : null,
        accountCurrency: account?.currency || null,
        accountType: account?.accountType || null,
        balance: account?.balance ?? null,
        equity: account?.equity ?? null,
        tradingPermission,
        accountConsistency: {
          status: accountConsistency.status,
          consistent: accountConsistency.consistent,
          snapshotAgeMs: accountConsistency.snapshotAgeMs,
          balanceDelta: accountConsistency.balanceDelta,
          equityDelta: accountConsistency.equityDelta
        }
      },
      executionGate: {
        locked: !LIVE_AUTO_EXECUTION_ALLOWED,
        unlocked: LIVE_AUTO_EXECUTION_ALLOWED,
        autoTradingState: observability.autoTrading.state
      },
      unresolvedExecutionIntents: observability.executionIntents
    });
  } catch (error: any) {
    liveRuntimeLog('ERROR', 'PRODUCTION_GO_LIVE_VALIDATION_FAILED', {
      error: error?.message || String(error)
    });
    return res.status(503).json({
      phase: '9.5',
      error: 'PRODUCTION_GO_LIVE_VALIDATION_UNAVAILABLE',
      message: error?.message || 'Production go-live validation is unavailable.',
      orderSubmissionPerformed: false
    });
  }
});

app.get('/api/operations/ctrader-functional-validation', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;

    const mode = getCTraderApiMode();
    const config = getSystemConfig();
    const credentialsConfigured = brokerRegistry.getCredentialStatuses()
      .some(item => item.broker === 'CTRADER' && item.environment === 'LIVE' && item.configured);
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');

    let connection: Awaited<ReturnType<typeof adapter.testConnection>> | null = null;
    let instrumentAvailable = false;
    let quoteFresh = false;
    let quoteBidAskValid = false;
    let historicalDataAvailable = false;
    let positionsReadSuccessful = false;
    let openOrdersReadSuccessful = false;
    let orderPacketValid = false;
    let testSymbol = String(config.autoLiveForexPairs[0] || 'EUR/USD').toUpperCase().trim();

    try {
      connection = await adapter.testConnection();
    } catch {
      connection = null;
    }

    try {
      const instrument = await adapter.getInstrument(testSymbol);
      instrumentAvailable = Boolean(instrument);
      if (!instrumentAvailable) {
        const instruments = await adapter.getInstruments();
        const fallback = instruments.find(item => item.market === 'FOREX');
        if (fallback?.symbol) {
          testSymbol = String(fallback.symbol).toUpperCase();
          instrumentAvailable = true;
        }
      }
    } catch {
      instrumentAvailable = false;
    }

    let quote: Awaited<ReturnType<typeof adapter.getQuote>> | null = null;
    try {
      quote = await adapter.getQuote(testSymbol);
      quoteFresh = quote.status === 'FRESH' && Date.now() - Number(quote.timestamp) < 30_000;
      quoteBidAskValid = Number(quote.bid) > 0 && Number(quote.ask) > 0 && Number.isFinite(quote.bid) && Number.isFinite(quote.ask);
    } catch {
      quote = null;
    }

    try {
      if (typeof adapter.getHistoricalCandles !== 'function') throw new Error('HISTORICAL_DATA_CAPABILITY_UNAVAILABLE');
      const candles = await adapter.getHistoricalCandles(testSymbol, '15M', 35);
      historicalDataAvailable = Array.isArray(candles) && candles.length >= 35;
    } catch {
      historicalDataAvailable = false;
    }

    try {
      const positions = await adapter.getPositions();
      positionsReadSuccessful = Array.isArray(positions);
    } catch {
      positionsReadSuccessful = false;
    }

    try {
      const openOrders = await adapter.getOpenOrders();
      openOrdersReadSuccessful = Array.isArray(openOrders);
    } catch {
      openOrdersReadSuccessful = false;
    }

    if (quote && instrumentAvailable) {
      const price = Number(quote.ask || quote.bid);
      const instrument = await adapter.getInstrument(testSymbol).catch(() => null);
      const digits = Number(instrument?.digits || 5);
      const step = Math.pow(10, -Math.max(1, Math.min(8, digits)));
      const stopLoss = Number((price - step * 20).toFixed(digits));
      const takeProfit = Number((price + step * 40).toFixed(digits));
      const packet = validateAutoLiveOrderPacket({
        market: 'FOREX',
        symbol: testSymbol,
        side: 'BUY',
        orderType: 'MARKET',
        quantity: 1,
        price,
        stopLoss,
        takeProfit,
        trailingStopLoss: true,
        strategyId: 'fx_structure_v2a',
        signalId: 'FUNCTIONAL_VALIDATION'
      });
      orderPacketValid = packet.valid;
    }

    const validation = evaluateCTraderFunctionalValidation({
      configured: credentialsConfigured,
      selectedApiMode: mode,
      connection: connection ? {
        connected: connection.connected,
        apiMode: connection.apiMode,
        apiEndpoint: connection.apiEndpoint,
        account: connection.account,
        accountType: connection.accountType,
        balance: connection.balance,
        equity: connection.equity,
        currency: connection.currency,
        permissions: connection.permissions
      } : null,
      instrumentAvailable,
      quoteFresh,
      quoteBidAskValid,
      historicalDataAvailable,
      positionsReadSuccessful,
      openOrdersReadSuccessful,
      orderPacketValid,
      validationSubmittedOrder: false
    });

    liveRuntimeLog(
      validation.ready ? 'SYSTEM' : 'WARN',
      validation.ready ? 'CTRADER_FUNCTIONAL_VALIDATION_PASSED' : 'CTRADER_FUNCTIONAL_VALIDATION_BLOCKED',
      {
        mode,
        testSymbol,
        failures: validation.failures,
        orderSubmissionPerformed: false
      }
    );

    return res.status(validation.statusCode).json({
      phase: '9.7.1',
      generatedAt: Date.now(),
      environment: process.env.NODE_ENV || 'development',
      tradingMode: 'LIVE_ONLY',
      mode,
      status: validation.status,
      ready: validation.ready,
      checks: validation.checks,
      failures: validation.failures,
      testSymbol,
      orderSubmissionPerformed: false,
      cTrader: {
        apiMode: connection?.apiMode || mode,
        apiEndpoint: connection?.apiEndpoint || (mode === 'DEMO'
          ? 'wss://demo.ctraderapi.com:5036'
          : 'wss://live.ctraderapi.com:5036'),
        connected: connection?.connected === true,
        accountId: connection?.account ? maskIdentifier(String(connection.account)) : null,
        accountType: connection?.accountType || null,
        accountCurrency: connection?.currency || null,
        balance: connection?.balance ?? null,
        equity: connection?.equity ?? null,
        tradingPermission: Array.isArray(connection?.permissions)
          ? connection.permissions.includes('TRADING')
            || connection.permissions.includes('EQUITY')
            || connection.permissions.includes('DERIVATIVES')
            || connection.permissions.includes('NSE_FNO')
          : false
      }
    });
  } catch (error: any) {
    liveRuntimeLog('ERROR', 'CTRADER_FUNCTIONAL_VALIDATION_FAILED', {
      error: error?.message || String(error)
    });
    return res.status(503).json({
      phase: '9.7.1',
      error: 'CTRADER_FUNCTIONAL_VALIDATION_UNAVAILABLE',
      message: error?.message || 'cTrader functional validation is unavailable.',
      orderSubmissionPerformed: false
    });
  }
});

app.get('/api/operations/active-auto-live-monitor', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;

    const config = getSystemConfig();
    const configIntegrity = evaluateSystemConfigIntegrity(config);
    const observability = await getRuntimeObservabilitySnapshot({
      runtimeId: GOLDCREST_RUNTIME_ID,
      environment: process.env.NODE_ENV || 'development'
    });

    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
    let account = null;
    let connection = null;
    try {
      connection = await adapter.testConnection();
      account = await adapter.getAccount();
    } catch {
      connection = null;
      account = null;
    }

    const permissions = Array.isArray(account?.permissions) ? account.permissions : [];
    const accountIsLive = account?.accountType === 'LIVE' && account?.isLiveAccount !== false;
    const accountIdPresent = Boolean(String(account?.accountId || '').trim());
    const currencyPresent = Boolean(String(account?.currency || '').trim());
    const balanceValid = typeof account?.balance === 'number' && Number.isFinite(account.balance) && account.balance > 0;
    const equityValid = typeof account?.equity === 'number' && Number.isFinite(account.equity) && account.equity > 0;
    const tradingPermission = permissions.includes('TRADING')
      || permissions.includes('EQUITY')
      || permissions.includes('DERIVATIVES')
      || permissions.includes('NSE_FNO');

    const snapshots = await getAccountBalanceSnapshots({
      broker: 'CTRADER',
      limit: 1
    });
    const accountConsistency = evaluateAccountStateConsistency(
      'CTRADER',
      account,
      snapshots[0] || null
    );

    const noUnresolvedExecutionIntents =
      observability.executionIntents.pending === 0
      && observability.executionIntents.inFlight === 0
      && observability.executionIntents.reconciliationTimeout === 0;

    const autoTradingStateOperational = ['RUNNING', 'PREPARING', 'PAUSED_LIMIT'].includes(
      observability.autoTrading.state
    );
    const executionGateUnlocked = LIVE_AUTO_EXECUTION_ALLOWED === true;

    const monitor = evaluateActiveAutoLiveMonitor({
      configurationIntegrityOk: configIntegrity.ok,
      tradingModeLiveOnly: config.tradingMode === 'LIVE_ONLY',
      databasePersistenceHealthy: !observability.databasePersistence.lastPersistenceError,
      runtimeLifecycleRunning: observability.lifecycle.state === 'RUNNING',
      auditLogReady: observability.auditLog.enabled && observability.auditLog.exists,
      cTraderConnected: connection?.connected === true && account?.connectionStatus === 'CONNECTED',
      cTraderAccountIsLive: accountIsLive,
      cTraderAccountIdPresent: accountIdPresent,
      cTraderCurrencyPresent: currencyPresent,
      cTraderBalanceValid: balanceValid,
      cTraderEquityValid: equityValid,
      cTraderTradingPermission: tradingPermission,
      cTraderApiModeLive: getCTraderApiMode() === 'LIVE',
      killSwitchClear: !killSwitch.isHalted(),
      executionGateUnlocked,
      autoTradingStateOperational,
      noUnresolvedExecutionIntents,
      cTraderAccountStateConsistent: accountConsistency.consistent
    });

    liveRuntimeLog(
      monitor.healthy ? 'SYSTEM' : monitor.status === 'BLOCKED' ? 'ERROR' : 'WARN',
      monitor.healthy ? 'ACTIVE_AUTO_LIVE_MONITOR_HEALTHY' : 'ACTIVE_AUTO_LIVE_MONITOR_BLOCKED',
      {
        failures: monitor.failures,
        criticalFailures: monitor.criticalFailures,
        cTraderApiMode: getCTraderApiMode(),
        autoTradingState: observability.autoTrading.state,
        accountConsistency: accountConsistency.status
      }
    );

    return res.status(monitor.statusCode).json({
      phase: '9.6',
      generatedAt: Date.now(),
      runtimeId: GOLDCREST_RUNTIME_ID,
      environment: process.env.NODE_ENV || 'development',
      tradingMode: 'LIVE_ONLY',
      status: monitor.status,
      healthy: monitor.healthy,
      checks: monitor.checks,
      failures: monitor.failures,
      criticalFailures: monitor.criticalFailures,
      cTrader: {
        apiMode: getCTraderApiMode(),
        apiEndpoint: connection?.apiEndpoint || null,
        connected: connection?.connected === true,
        accountId: account ? maskIdentifier(String(account.accountId || '')) : null,
        accountCurrency: account?.currency || null,
        accountType: account?.accountType || null,
        balance: account?.balance ?? null,
        equity: account?.equity ?? null,
        tradingPermission,
        accountConsistency: {
          status: accountConsistency.status,
          consistent: accountConsistency.consistent,
          snapshotAgeMs: accountConsistency.snapshotAgeMs,
          balanceDelta: accountConsistency.balanceDelta,
          equityDelta: accountConsistency.equityDelta
        }
      },
      executionGate: {
        unlocked: executionGateUnlocked,
        locked: !executionGateUnlocked
      },
      autoTrading: {
        state: observability.autoTrading.state,
        currentExecution: observability.autoTrading.currentExecution,
        lastExecution: observability.autoTrading.lastExecution
      },
      unresolvedExecutionIntents: observability.executionIntents
    });
  } catch (error: any) {
    liveRuntimeLog('ERROR', 'ACTIVE_AUTO_LIVE_MONITOR_FAILED', {
      error: error?.message || String(error)
    });
    return res.status(503).json({
      phase: '9.6',
      error: 'ACTIVE_AUTO_LIVE_MONITOR_UNAVAILABLE',
      message: error?.message || 'Active Auto Live monitoring is unavailable.'
    });
  }
});

app.get('/api/observability/runtime', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    const snapshot = await getRuntimeObservabilitySnapshot({
      runtimeId: GOLDCREST_RUNTIME_ID,
      environment: process.env.NODE_ENV || 'development'
    });
    res.json({
      ...snapshot,
      recovery: getRecoveryRecommendation(snapshot)
    });
  } catch (error: any) {
    liveRuntimeLog('ERROR', 'RUNTIME_OBSERVABILITY_SNAPSHOT_FAILED', {
      error: error?.message || String(error)
    });
    res.status(503).json({
      error: 'RUNTIME_OBSERVABILITY_UNAVAILABLE',
      message: error?.message || 'Runtime observability is unavailable.'
    });
  }
});

// Operator authentication is a same-origin, HttpOnly session derived from the
// server-side operator API key. The secret is never embedded in the client bundle.
app.get('/api/operator/session', (req: Request, res: Response) => {
  const address = String(req.socket.remoteAddress || req.ip || '').toLowerCase();
  const localDevelopment = process.env.NODE_ENV !== 'production'
    && (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) || !operatorAuthConfigured());

  res.json({
    configured: operatorAuthConfigured(),
    authenticated: localDevelopment || isOperatorSessionValid(req),
    bypassedForLocalDevelopment: localDevelopment,
    ttlHours: 8
  });
});

app.post('/api/operator/login', (req: Request, res: Response) => {
  const configuredKey = process.env.GOLDCREST_OPERATOR_API_KEY?.trim();
  if (!configuredKey) {
    return res.status(503).json({
      error: 'OPERATOR_AUTH_NOT_CONFIGURED',
      message: 'Configure GOLDCREST_OPERATOR_API_KEY before using operator authentication.'
    });
  }
  const supplied = String(req.body?.key || '');
  if (!supplied || supplied.length !== configuredKey.length) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid operator credentials are required.' });
  }
  const expected = Buffer.from(configuredKey, 'utf8');
  const actual = Buffer.from(supplied, 'utf8');
  if (!timingSafeEqual(expected, actual)) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid operator credentials are required.' });
  }
  setOperatorSessionCookie(res, issueOperatorSession(configuredKey));
  return res.json({ authenticated: true, expiresInHours: 8 });
});

app.post('/api/operator/logout', (_req: Request, res: Response) => {
  clearOperatorSessionCookie(res);
  res.json({ authenticated: false });
});

app.use('/api/brokers', operatorAuthRequired, brokerRouter);
app.use('/api/ml', operatorAuthRequired, (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'RESEARCH_API_RETIRED',
    message: 'Goldcrest research program is closed. ML training, dataset generation, backtesting and experiment APIs are retired.'
  });
});
app.use('/api/governance', operatorAuthRequired, governanceRouter);

app.get('/api/auto-trading/status', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(autoTradingService.getStatus());
});

app.post('/api/auto-trading/start', operatorAuthRequired, (req: Request, res: Response) => {
  // During local development, the UI may be served through a wildcard/bind-all
  // host even though the operator is connecting from the same machine.
  // Detect loopback requests explicitly so the local auto-live arm path is
  // deterministic and does not depend on the HOST environment variable.
  if (process.env.NODE_ENV !== 'production') {
    const requestHost = String(req.headers.host || '').split(':')[0].trim().toLowerCase();
    const remoteAddress = String(req.socket.remoteAddress || req.ip || '').toLowerCase().replace(/^::ffff:/, '');
    const loopbackRequest = ['127.0.0.1', 'localhost', '::1'].includes(requestHost) ||
      ['127.0.0.1', 'localhost', '::1'].includes(remoteAddress);
    // The server may bind to 0.0.0.0 while the operator still connects from
    // loopback. In that case the startup host check can have marked local
    // development as false; the request itself is the authoritative signal.
    if (loopbackRequest) process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'true';
  }

  const confirmWhenClosed = req.body?.confirmWhenClosed === true;
  const status = autoTradingService.start({ confirmWhenClosed });
  const statusCode = status.requiresClosedMarketConfirmation
    ? 409
    : (status.state === 'BLOCKED' ? 409 : 200);
  return res.status(statusCode).json(status);
});

app.post('/api/auto-trading/abandon-closed-start', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(autoTradingService.abandonClosedMarketStart());
});

app.post('/api/auto-trading/stop', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(autoTradingService.stop());
});

// Explicit Execution Gate Controls
app.get('/api/execution-gate/status', operatorAuthRequired, (_req: Request, res: Response) => {
  const permitted = refreshAutonomousExecutionPermission();
  const autoStatus = autoTradingService.getStatus();
  res.json({
    locked: !permitted,
    unlocked: permitted,
    state: permitted ? 'UNLOCKED' : 'LOCKED',
    autoTradingState: autoStatus.state,
    autonomousPermission: permitted,
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
    productionStrategyApproved: process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED === 'true',
    approvedStrategyId: process.env.GOLDCREST_PRODUCTION_STRATEGY_ID || 'fx_structure_v2a',
    timestamp: Date.now()
  });
});

app.post('/api/execution-gate/unlock', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    const releaseIntegrity = process.env.NODE_ENV === 'production'
      ? evaluateProductionReleaseIntegrity(buildProductionReleaseIntegrityInput({
          tradingMode: getSystemConfig().tradingMode,
          operatorAuthConfigured: operatorAuthConfigured(),
          liveBrokerConfigured: Boolean(
            process.env.CTRADER_LIVE_CLIENT_ID?.trim() &&
            process.env.CTRADER_LIVE_CLIENT_SECRET?.trim() &&
            process.env.CTRADER_LIVE_ACCESS_TOKEN?.trim() &&
            process.env.CTRADER_LIVE_ACCOUNT_ID?.trim()
          ),
          packageVersion: process.env.GOLDCREST_RELEASE_VERSION || undefined
        }))
      : { ok: true };

    const configIntegrity = evaluateSystemConfigIntegrity(getSystemConfig());
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
    const credentialsConfigured = brokerRegistry.getCredentialStatuses()
      .some(item => item.broker === 'CTRADER' && item.environment === 'LIVE' && item.configured);

    let connection = null;
    let account = null;
    try {
      connection = await adapter.testConnection();
      account = await adapter.getAccount();
    } catch {
      connection = null;
      account = null;
    }

    const permissions = Array.isArray(account?.permissions) ? account.permissions : [];
    const accountIsLive = account?.accountType === 'LIVE' && account?.isLiveAccount !== false;
    const accountIdPresent = Boolean(String(account?.accountId || '').trim());
    const currencyPresent = Boolean(String(account?.currency || '').trim());
    const balanceValid = typeof account?.balance === 'number' && Number.isFinite(account.balance) && account.balance >= 0;
    const equityValid = typeof account?.equity === 'number' && Number.isFinite(account.equity) && account.equity >= 0;
    const tradingPermission = permissions.includes('TRADING')
      || permissions.includes('EQUITY')
      || permissions.includes('DERIVATIVES')
      || permissions.includes('NSE_FNO');

    const localActivationAllowed = process.env.NODE_ENV !== 'production'
      ? ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(String(process.env.HOST || '127.0.0.1').trim().toLowerCase())
        || process.env.GOLDCREST_LOCAL_DEVELOPMENT === 'true'
      : true;

    const activation = evaluateAutoLiveActivation({
      productionEnvironment: localActivationAllowed,
      releaseIntegrityOk: releaseIntegrity.ok,
      configurationIntegrityOk: configIntegrity.ok,
      tradingModeLiveOnly: getSystemConfig().tradingMode === 'LIVE_ONLY',
      runtimeLifecycleRunning: runtimeLifecycle.getStatus().state === 'RUNNING',
      cTraderCredentialsConfigured: credentialsConfigured,
      cTraderConnected: connection?.connected === true && account?.connectionStatus === 'CONNECTED',
      cTraderAccountIsLive: accountIsLive,
      cTraderAccountIdPresent: accountIdPresent,
      cTraderCurrencyPresent: currencyPresent,
      cTraderBalanceValid: balanceValid,
      cTraderEquityValid: equityValid,
      cTraderTradingPermission: tradingPermission,
      cTraderApiMode: getCTraderApiMode(),
      allowDemoApiMode: process.env.NODE_ENV !== 'production',
      killSwitchClear: !killSwitch.isHalted()
    });

    if (!activation.ready) {
      liveRuntimeLog('WARN', 'EXECUTION_GATE_UNLOCK_BLOCKED', {
        failures: activation.failures,
        apiMode: getCTraderApiMode(),
        connected: connection?.connected === true
      });
      return res.status(activation.statusCode).json({
        success: false,
        code: 'AUTO_LIVE_ACTIVATION_BLOCKED',
        message: 'Auto Live activation preflight failed.',
        activation,
        locked: true,
        unlocked: false,
        autoTradingState: autoTradingService.getStatus().state,
        timestamp: Date.now()
      });
    }

    const result = armAutonomousExecutionGate();
    const autoStatus = autoTradingService.getStatus();
    res.status(200).json({
      ...result,
      activation,
      locked: !LIVE_AUTO_EXECUTION_ALLOWED,
      unlocked: LIVE_AUTO_EXECUTION_ALLOWED,
      autoTradingState: autoStatus.state,
      timestamp: Date.now()
    });
  } catch (error: any) {
    liveRuntimeLog('ERROR', 'EXECUTION_GATE_UNLOCK_PREFLIGHT_FAILED', {
      error: error?.message || String(error)
    });
    res.status(503).json({
      success: false,
      code: 'AUTO_LIVE_ACTIVATION_PREFLIGHT_UNAVAILABLE',
      message: error?.message || 'Auto Live activation preflight is unavailable.',
      locked: true,
      unlocked: false,
      timestamp: Date.now()
    });
  }
});

app.post('/api/execution-gate/lock', operatorAuthRequired, (_req: Request, res: Response) => {
  const result = lockAutonomousExecutionGate();
  const autoStatus = autoTradingService.getStatus();
  res.json({
    ...result,
    locked: true,
    unlocked: false,
    autoTradingState: autoStatus.state,
    timestamp: Date.now()
  });
});

app.get('/api/live-log/status', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(getLiveRuntimeLogStatus());
});

app.post('/api/live-log/start', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(startLiveRuntimeLog('SETTINGS'));
});

app.post('/api/live-log/stop', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(stopLiveRuntimeLog('SETTINGS'));
});

app.get('/api/live-log/files', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json({ files: listLiveRuntimeLogFiles() });
});

app.get('/api/live-log/file', operatorAuthRequired, (req: Request, res: Response) => {
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'INVALID_LOG_DATE', message: 'Log date must use YYYY-MM-DD format.' });
  }
  const file = getLiveRuntimeLogFile(date);
  res.sendFile(file);
});


const scannerService = new ScannerService();

async function hydratePersistedTradeLimits(): Promise<void> {
  // SQLite is authoritative. Rehydrate the complete known configuration set,
  // including the cTrader LIVE/DEMO selector, then refresh the JSON fallback
  // snapshot so a future SQLite recovery path is not left with stale settings.
  const persistedUpdates = await loadPersistedSystemConfigFromDatabase();

  if (Object.keys(persistedUpdates).length > 0) {
    applyPersistedSystemConfig(persistedUpdates);
    persistSystemConfig(getSystemConfig());
  }
}

// Initialize database on boot and keep one shared initialization promise so
// API reads cannot race the initial SQLite hydration.
const databaseInitPromise = getDatabase()
  .then(async () => {
    await hydratePersistedTradeLimits();
    databaseReady = true;
    console.log('SQLite database initialized successfully');
  })
  .catch(err => {
    console.error('Failed to initialize SQLite database:', err);
    throw err;
  });

// Lazy Gemini AI initialization
let genAiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAiClient && process.env.GEMINI_API_KEY) {
    genAiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return genAiClient;
}

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// 1. System Status & Health
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ...buildRuntimeHealthPayload(process.env.NODE_ENV), timestamp: Date.now() });
});

app.get('/api/health/ready', (req: Request, res: Response) => {
  const preflight = productionPreflight();
  const productionRuntime = process.env.NODE_ENV === 'production';
  const releaseIntegrity = productionRuntime
    ? evaluateProductionReleaseIntegrity(buildProductionReleaseIntegrityInput({
        tradingMode: getSystemConfig().tradingMode,
        operatorAuthConfigured: operatorAuthConfigured(),
        liveBrokerConfigured: Boolean(
          process.env.CTRADER_LIVE_CLIENT_ID?.trim() &&
          process.env.CTRADER_LIVE_CLIENT_SECRET?.trim() &&
          process.env.CTRADER_LIVE_ACCESS_TOKEN?.trim() &&
          process.env.CTRADER_LIVE_ACCOUNT_ID?.trim()
        ) || Boolean(
          process.env.FIVEPAISA_LIVE_APP_NAME?.trim() &&
          process.env.FIVEPAISA_LIVE_USER_ID?.trim() &&
          process.env.FIVEPAISA_LIVE_USER_KEY?.trim() &&
          process.env.FIVEPAISA_LIVE_CLIENT_CODE?.trim()
        ),
        packageVersion: process.env.GOLDCREST_RELEASE_VERSION || undefined
      }))
    : null;
  const readiness = evaluateRuntimeReadiness(databaseReady, preflight.ok && (releaseIntegrity?.ok ?? true));
  res.status(readiness.statusCode).json({
    status: readiness.status,
    database: databaseReady ? 'READY' : 'INITIALIZING',
    tradingMode: getSystemConfig().tradingMode,
    autonomousLiveExecutionAllowed: LIVE_AUTO_EXECUTION_ALLOWED,
    autoTrading: autoTradingService.getStatus(),
    lifecycle: runtimeLifecycle.getStatus(),
    productionChecks: preflight.checks,
    configIntegrity: evaluateSystemConfigIntegrity(getSystemConfig()),
    releaseIntegrity,
    timestamp: Date.now()
  });
});

app.get('/api/status', (req: Request, res: Response) => {
  const indianSession = getIndianSessionState();
  const config = getSystemConfig();

  res.json({
    status: 'ONLINE',
    marketStatus: {
      indianEquity: indianSession
    },
    dataStatus: config.dataStatus,
    modelStatus: config.modelStatus,
    tradingMode: config.tradingMode,
    timestamp: Date.now()
  });
});

app.get('/api/live-trade-research/evaluations', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const limit = Number(req.query.limit || 50);
    res.json({
      evaluations: await getLiveTradeResearchEvaluations(limit),
      timestamp: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Research evaluations unavailable.' });
  }
});

app.post('/api/live-trade-research/evaluate', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const horizon = String(req.body?.horizon || '1D').toUpperCase();
    if (!['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'HORIZON_INVALID', message: 'Evaluation horizon must be 1D, 3D or 7D.' });
    }
    const result = await evaluateLiveTradeResearch({
      fromTimestamp: req.body?.fromTimestamp === undefined ? undefined : Number(req.body.fromTimestamp),
      toTimestamp: req.body?.toTimestamp === undefined ? undefined : Number(req.body.toTimestamp),
      horizon: horizon as '1D' | '3D' | '7D',
      modelVersion: req.body?.modelVersion ? String(req.body.modelVersion) : undefined
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Research evaluation failed.' });
  }
});

app.get('/api/market-history/status', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    res.json({
      scheduler: getMarketHistorySchedulerStatus(),
      pairs: await getMarketHistorySyncStatus(),
      timestamp: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Market history status unavailable.' });
  }
});

app.post('/api/market-history/sync', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const requestedPairs = Array.isArray(req.body?.pairs)
      ? req.body.pairs.map((value: unknown) => String(value).toUpperCase().trim())
      : undefined;
    const forceFull = req.body?.forceFull === true;
    const results = await syncMarketHistory({
      forceFull,
      symbols: requestedPairs
    });
    res.json({
      success: true,
      forceFull,
      results,
      scheduler: getMarketHistorySchedulerStatus(),
      timestamp: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Market history synchronization failed.' });
  }
});

app.get('/api/market-history/:pair', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const pair = decodeURIComponent(String(req.params.pair || '')).toUpperCase().trim();
    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) {
      return res.status(400).json({ error: 'PAIR_FORMAT_INVALID', message: 'Pair must use BASE/QUOTE format.' });
    }
    const summary = await getMarketHistorySummary(pair);
    res.json({
      ...summary,
      scheduler: getMarketHistorySchedulerStatus(),
      timestamp: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Market history summary unavailable.' });
  }
});


const DATABASE_EXPLORER_TABLES = [
  { name: 'execution_intents', label: 'Execution Intents', category: 'Execution', description: 'Trigger Now and autonomous execution idempotency records.' },
  { name: 'execution_fill_observations', label: 'Fill Observations', category: 'Execution', description: 'Observed broker order fill state and quantities.' },
  { name: 'execution_fill_events', label: 'Fill Events', category: 'Execution', description: 'Broker-native execution/fill ledger.' },
  { name: 'trade_traces', label: 'Trade Trace Roots', category: 'Execution', description: 'Top-level lifecycle trace payloads.' },
  { name: 'trade_trace_nodes', label: 'Trade Trace Nodes', category: 'Execution', description: 'Individual execution lifecycle nodes.' },
  { name: 'orders', label: 'Orders', category: 'Trading', description: 'Normalized order records.' },
  { name: 'trades', label: 'Trades', category: 'Trading', description: 'Trade entry/exit records and P&L.' },
  { name: 'positions', label: 'Positions', category: 'Trading', description: 'Persisted position state.' },
  { name: 'broker_accounts', label: 'Broker Accounts', category: 'Trading', description: 'Broker account snapshots and permissions.' },
  { name: 'broker_reconciliation_snapshots', label: 'Reconciliation Snapshots', category: 'Trading', description: 'Broker account, position and order snapshots.' },
  { name: 'account_balance_snapshots', label: 'Account Balance History', category: 'Trading', description: 'Three-hour LIVE account balance, equity, used-margin and free-margin snapshots.' },
  { name: 'market_data', label: 'Market Data', category: 'Market Data', description: 'Persisted market observations.' },
  { name: 'candles', label: 'Candles', category: 'Market Data', description: 'OHLCV candle series.' },
  { name: 'market_history_sync', label: 'Market History Sync', category: 'Market Data', description: 'Per-pair historical market-data synchronization state.' },
  { name: 'market_period_stats', label: 'Market Period Statistics', category: 'Market Data', description: 'Daily, weekly, monthly and rolling 7D/30D/90D/365D market statistics.' },
  { name: 'options_chain', label: 'Options Chains', category: 'Market Data', description: 'Persisted options-chain snapshots.' },
  { name: 'option_contracts', label: 'Option Contracts', category: 'Market Data', description: 'Strike-level option observations.' },
  { name: 'greeks', label: 'Greeks', category: 'Market Data', description: 'Option Greeks and IV records.' },
  { name: 'signals', label: 'Signals', category: 'Strategy', description: 'Generated strategy signals and trade levels.' },
  { name: 'signal_events', label: 'Signal Events', category: 'Strategy', description: 'Signal lifecycle and status events.' },
  { name: 'live_trade_research', label: 'Live Trade Research', category: 'ML & Research', description: 'Decision-time Auto Live signals, market/news context, execution results and future outcome fields.' },
  { name: 'live_trade_research_features', label: 'Live Trade Research Features', category: 'ML & Research', description: 'Normalized research features derived from closed live-trade observations.' },
  { name: 'live_trade_research_training', label: 'Live Trade Research Training', category: 'ML & Research', description: 'Supervised research rows with 1D, 3D and 7D forward market labels.' },
  { name: 'live_trade_research_evaluations', label: 'Live Trade Research Evaluations', category: 'ML & Research', description: 'Time-ordered out-of-sample directional evaluation results and confusion metrics.' },
  { name: 'strategy_configs', label: 'Strategy Configs', category: 'Strategy', description: 'Strategy thresholds and enablement.' },
  { name: 'economic_events', label: 'Economic Events', category: 'Strategy', description: 'Calendar events used by the strategy layer.' },
  { name: 'risk_configs', label: 'Risk Configs', category: 'Risk & System', description: 'Risk, loss and execution limits.' },
  { name: 'system_settings', label: 'System Settings', category: 'Risk & System', description: 'Persisted Goldcrest configuration values.' },
  { name: 'trade_notes', label: 'Trade Notes', category: 'Risk & System', description: 'Operator notes linked to trading context.' },
  { name: 'users', label: 'Users', category: 'Reference', description: 'Application user records.' },
  { name: 'markets', label: 'Markets', category: 'Reference', description: 'Market definitions.' },
  { name: 'instruments', label: 'Instruments', category: 'Reference', description: 'Instrument metadata.' },
  { name: 'currency_pairs', label: 'Currency Pairs', category: 'Reference', description: 'Forex pair reference metadata.' },
  { name: 'underlyings', label: 'Underlyings', category: 'Reference', description: 'Indian market underlying metadata.' },
  { name: 'contracts', label: 'Contracts', category: 'Reference', description: 'Derivative contract reference records.' },
  { name: 'model_versions', label: 'Model Versions', category: 'ML & Research', description: 'Registered model versions.' },
  { name: 'model_predictions', label: 'Model Predictions', category: 'ML & Research', description: 'Persisted model prediction records.' },
  { name: 'backtest_runs', label: 'Backtest Runs', category: 'ML & Research', description: 'Historical backtest run summaries.' },
  { name: 'backtest_trades', label: 'Backtest Trades', category: 'ML & Research', description: 'Historical backtest trade rows.' },
  { name: 'ml_storage_records', label: 'ML Storage Records', category: 'ML & Research', description: 'Persisted ML bridge records.' },
  { name: 'ai_research_server_connections', label: 'Research AI Gateway Connection', category: 'ML & Research', description: 'Single Llama-hosted research gateway connection that can orchestrate Qwen; authentication tokens are redacted.' },
];

const DATABASE_EXPLORER_REDACT_PATTERNS = /(password|secret|token|encryption.?key|totp|pin|client.?secret|access.?token)/i;

function sanitizeDatabaseRow(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (DATABASE_EXPLORER_REDACT_PATTERNS.test(key)) {
      result[key] = value === null || value === undefined || value === '' ? value : '[REDACTED]';
      continue;
    }
    if (key === 'value' && DATABASE_EXPLORER_REDACT_PATTERNS.test(String(row.key || ''))) {
      result[key] = '[REDACTED]';
      continue;
    }
    result[key] = value;
  }
  return result;
}

function quoteSqlIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

app.get('/api/database/overview', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const tables = [];
    for (const definition of DATABASE_EXPLORER_TABLES) {
      const rows = await executeQuery<any>('SELECT COUNT(*) AS count FROM ' + quoteSqlIdentifier(definition.name));
      tables.push({ ...definition, count: Number(rows[0]?.count || 0) });
    }
    res.json({ database: 'data/trading_analyst.sqlite', tables, timestamp: Date.now() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Database overview unavailable.' });
  }
});

app.get('/api/database/table', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const tableName = String(req.query.table || '').trim();
    const definition = DATABASE_EXPLORER_TABLES.find(item => item.name === tableName);
    if (!definition) return res.status(400).json({ error: 'Unknown database table.' });

    const schema = await executeQuery<any>('PRAGMA table_info(' + quoteSqlIdentifier(tableName) + ')');
    const columns = schema.map(column => ({ name: String(column.name), type: String(column.type || 'TEXT') }));
    const columnNames = columns.map(column => column.name);
    if (!columnNames.length) return res.status(404).json({ error: 'Selected database table has no columns.' });

    const rawLimit = Number(req.query.limit || 50);
    const rawOffset = Number(req.query.offset || 0);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50, 1), 250);
    const offset = Math.min(Math.max(Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0, 0), 100000);
    const search = String(req.query.search || '').trim();

    const requestedSort = String(req.query.sort || '').trim();
    const sortColumn = columnNames.includes(requestedSort)
      ? requestedSort
      : (['timestamp', 'updated_at', 'created_at', 'observed_at', 'executed_at'].find(name => columnNames.includes(name)) || columnNames[0]);
    const direction = String(req.query.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const searchClause = search
      ? ' WHERE ' + columnNames.map(column => 'CAST(' + quoteSqlIdentifier(column) + ' AS TEXT) LIKE ?').join(' OR ')
      : '';
    const searchParams = search ? columnNames.map(() => '%' + search + '%') : [];

    const totalRows = await executeQuery<any>(
      'SELECT COUNT(*) AS count FROM ' + quoteSqlIdentifier(tableName) + searchClause,
      searchParams
    );
    const rows = await executeQuery<any>(
      'SELECT ' + columnNames.map(quoteSqlIdentifier).join(', ') +
      ' FROM ' + quoteSqlIdentifier(tableName) +
      searchClause +
      ' ORDER BY ' + quoteSqlIdentifier(sortColumn) + ' ' + direction +
      ' LIMIT ? OFFSET ?',
      [...searchParams, limit, offset]
    );

    res.json({
      database: 'data/trading_analyst.sqlite',
      table: tableName,
      label: definition.label,
      category: definition.category,
      columns,
      rows: rows.map(row => sanitizeDatabaseRow(row)),
      total: Number(totalRows[0]?.count || 0),
      limit,
      offset,
      updatedAt: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Database table unavailable.' });
  }
});

app.get('/api/reports/account-balance-history', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const broker = typeof req.query.broker === 'string'
      ? String(req.query.broker).toUpperCase()
      : undefined;
    if (broker && broker !== 'CTRADER' && broker !== 'FIVE_PAISA') {
      return res.status(400).json({ error: 'BROKER_INVALID', message: 'broker must be CTRADER or FIVE_PAISA.' });
    }

    const from = req.query.from !== undefined ? Number(req.query.from) : undefined;
    const to = req.query.to !== undefined ? Number(req.query.to) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 500;
    const rows = await getAccountBalanceSnapshots({
      from: Number.isFinite(from) ? from : undefined,
      to: Number.isFinite(to) ? to : undefined,
      broker: broker as 'CTRADER' | 'FIVE_PAISA' | undefined,
      limit: Number.isFinite(limit) ? limit : 500
    });

    res.json({
      rows,
      intervalHours: 3,
      schedule: 'Every 3 hours at 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00 server-local time.',
      timestamp: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Account balance history unavailable.' });
  }
});

// 2. Configuration API
app.get('/api/config', async (_req: Request, res: Response) => {
  try {
    // Always wait for SQLite initialization and rehydrate persisted limits
    // before returning configuration. This prevents navigation/reload from
    // displaying the in-memory defaults while the DB contains operator values.
    await databaseInitPromise;
    res.json(getSystemConfig());
  } catch (err: any) {
    res.status(503).json({
      error: 'CONFIG_UNAVAILABLE',
      message: err?.message || 'Persisted configuration is unavailable.'
    });
  }
});

app.post('/api/config', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    // Always hydrate the latest durable values before applying a partial
    // settings update. This prevents one save operation from accidentally
    // overwriting unrelated persisted settings with process defaults.
    await databaseInitPromise;
    await hydratePersistedTradeLimits();

    const requestedForex = req.body?.maxTradeValueForexUsd;
    const requestedIndian = req.body?.maxTradeValueIndianInr;
    const requestedAutoLiveMinSignalScore = req.body?.autoLiveMinSignalScore;
    const requestedAutoLiveMaxTradesPerPair = req.body?.autoLiveMaxTradesPerPair;
    const requestedMaxOpenPositions = req.body?.maxOpenPositions;
    const requestedMaxDailyLossPct = req.body?.maxDailyLossPct;
    const requestedForexStopLossPips = req.body?.forexStopLossPips;
    const requestedForexTakeProfitPips = req.body?.forexTakeProfitPips;
    const requestedForexPairs = req.body?.autoLiveForexPairs;
    const requestedIndianUnderlyings = req.body?.autoLiveIndianUnderlyings;
    const updates: any = { ...req.body };

    if (requestedForex !== undefined) {
      const value = Number(requestedForex);
      if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'maxTradeValueForexUsd must be a positive number.' });
      updates.maxTradeValueForexUsd = value;
    }

    if (requestedIndian !== undefined) {
      const value = Number(requestedIndian);
      if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'maxTradeValueIndianInr must be a positive number.' });
      updates.maxTradeValueIndianInr = value;
    }

    if (requestedAutoLiveMinSignalScore !== undefined) {
      const value = Number(requestedAutoLiveMinSignalScore);
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        return res.status(400).json({ error: 'autoLiveMinSignalScore must be an integer from 0 to 100.' });
      }
      updates.autoLiveMinSignalScore = value;
    }

    if (requestedAutoLiveMaxTradesPerPair !== undefined) {
      const value = Number(requestedAutoLiveMaxTradesPerPair);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        return res.status(400).json({ error: 'autoLiveMaxTradesPerPair must be an integer from 1 to 20.' });
      }
      updates.autoLiveMaxTradesPerPair = value;
    }

    if (requestedMaxOpenPositions !== undefined) {
      const value = Number(requestedMaxOpenPositions);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        return res.status(400).json({ error: 'maxOpenPositions must be an integer from 1 to 100.' });
      }
      updates.maxOpenPositions = value;
    }

    if (requestedMaxDailyLossPct !== undefined) {
      const value = Number(requestedMaxDailyLossPct);
      if (!Number.isFinite(value) || value <= 0 || value > 100) {
        return res.status(400).json({ error: 'maxDailyLossPct must be greater than 0 and no greater than 100 percent.' });
      }
      updates.maxDailyLossPct = value;
    }

    if (requestedForexStopLossPips !== undefined) {
      const value = Number(requestedForexStopLossPips);
      if (!Number.isFinite(value) || value <= 0 || value > 10000) {
        return res.status(400).json({ error: 'forexStopLossPips must be a positive number no greater than 10000.' });
      }
      updates.forexStopLossPips = value;
    }

    if (requestedForexTakeProfitPips !== undefined) {
      const value = Number(requestedForexTakeProfitPips);
      if (!Number.isFinite(value) || value <= 0 || value > 10000) {
        return res.status(400).json({ error: 'forexTakeProfitPips must be a positive number no greater than 10000.' });
      }
      updates.forexTakeProfitPips = value;
    }

    const validIndianUnderlyings = new Set(INDIAN_UNDERLYINGS.map(item => item.symbol.toUpperCase()));

    if (requestedForexPairs !== undefined) {
      updates.autoLiveForexPairs = Array.isArray(requestedForexPairs) ? requestedForexPairs : [];
    }

    if (requestedIndianUnderlyings !== undefined) {
      if (!Array.isArray(requestedIndianUnderlyings)) {
        return res.status(400).json({ error: 'autoLiveIndianUnderlyings must be an array.' });
      }
      const normalized = [...new Set(requestedIndianUnderlyings.map((value: unknown) => String(value).toUpperCase().trim()))];
      if (normalized.some(symbol => !validIndianUnderlyings.has(symbol))) {
        return res.status(400).json({ error: 'One or more selected NSE/BSE underlyings are not supported.' });
      }
      updates.autoLiveIndianUnderlyings = normalized;
    }

    const updated = prepareSystemConfigUpdate(updates);

    // Commit SQLite first. The in-memory configuration and JSON fallback are
    // only updated after the authoritative durable transaction succeeds.
    await persistSystemConfigToDatabase(updated);
    applyPersistedSystemConfig(updated);
    try {
      persistSystemConfig(updated);
    } catch (syncError: any) {
      liveRuntimeLog('ERROR', 'SYSTEM_CONFIG_FALLBACK_SYNC_FAILED', {
        error: syncError?.message || String(syncError)
      });
    }
    // SQLite persistence above is the authoritative configuration commit. The JSON file is a fallback snapshot only.
    res.json({ success: true, config: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});


// Optional single AI gateway connector. The gateway is Llama-hosted and can
// orchestrate Qwen internally; this remains research-only and never controls
// Auto Live execution.
app.get('/api/research-ai/server', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    res.json({ server: await getResearchAiServerConfig(), timestamp: Date.now() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Research AI gateway configuration unavailable.' });
  }
});

app.post('/api/research-ai/server', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const config = await saveResearchAiServerConfig({
      enabled: req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled),
      baseUrl: req.body?.baseUrl === undefined ? undefined : String(req.body.baseUrl),
      llamaModel: req.body?.llamaModel === undefined ? undefined : String(req.body.llamaModel),
      qwenModel: req.body?.qwenModel === undefined ? undefined : String(req.body.qwenModel),
      healthPath: req.body?.healthPath === undefined ? undefined : String(req.body.healthPath),
      predictPath: req.body?.predictPath === undefined ? undefined : String(req.body.predictPath),
      timeoutMs: req.body?.timeoutMs === undefined ? undefined : Number(req.body.timeoutMs),
      authToken: req.body?.authToken === undefined ? undefined : String(req.body.authToken)
    });
    res.json({ success: true, server: config });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Research AI gateway configuration rejected.' });
  }
});

app.post('/api/research-ai/server/test', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    res.json(await testResearchAiServerConnection());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Research AI gateway connection test failed.' });
  }
});

app.post('/api/research-ai/server/test-prediction', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    res.json(await testResearchAiServerPrediction());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Research AI gateway prediction test failed.' });
  }
});

// 3. Markets Abstraction
app.get('/api/markets', (req: Request, res: Response) => {
  res.json([
    {
      id: 'INDIA_EQUITY',
      name: 'Indian Equity Benchmark Indices',
      currency: 'INR',
      instrumentsCount: INDIAN_UNDERLYINGS.length,
      status: 'ACTIVE',
      session: getIndianSessionState()
    },
    {
      id: 'INDIA_OPTIONS',
      name: 'Indian Equity Index Derivatives & Options',
      currency: 'INR',
      underlyings: INDIAN_UNDERLYINGS.map(u => u.symbol),
      status: 'ACTIVE',
      session: getIndianSessionState()
    }
  ]);
});

// Forex endpoints are retired in favour of Indian market focus
app.get(['/api/forex/*', '/api/forex'], (_req: Request, res: Response) => {
  res.status(404).json({ error: 'MARKET_NOT_SUPPORTED', message: 'Forex market endpoints have been retired. System is configured for Indian markets only.' });
});



app.get('/api/notes', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const rows = await executeQuery<any>('SELECT id, title, content, symbol, created_at, updated_at FROM trade_notes ORDER BY created_at DESC');
    const notes = rows.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      symbol: r.symbol || undefined,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    }));
    res.json(notes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notes', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const { title, content, symbol } = req.body;
    const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    await executeRun(
      'INSERT INTO trade_notes (id, title, content, symbol, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, title, content, symbol || null, now, now]
    );
    res.json({ id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notes/:id', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await executeRun('DELETE FROM trade_notes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Indian Equity Endpoints
const INDIA_UNDERLYINGS_CACHE_TTL_MS = 60_000;
let indiaUnderlyingsCache: { payload: any[]; expiresAt: number } | null = null;
let indiaUnderlyingsInFlight: Promise<any[]> | null = null;

const CANDLE_CACHE_TTL_MS = 30_000;
const candleCache = new Map<string, { payload: any[]; expiresAt: number }>();
const candleInFlight = new Map<string, Promise<any[]>>();

app.get('/api/india/underlyings', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (indiaUnderlyingsCache && now < indiaUnderlyingsCache.expiresAt) {
      return res.json(indiaUnderlyingsCache.payload);
    }
    if (indiaUnderlyingsInFlight) {
      return res.json(await indiaUnderlyingsInFlight);
    }

    indiaUnderlyingsInFlight = (async () => {
      const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
      if (typeof adapter.fetchIndianUnderlyingsFrom5Paisa !== 'function') {
        throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa underlying market-data capability is unavailable.', 'FIVE_PAISA', 'LIVE');
      }
      const payload = await adapter.fetchIndianUnderlyingsFrom5Paisa();
      indiaUnderlyingsCache = {
        payload: Array.isArray(payload) ? payload : [],
        expiresAt: Date.now() + INDIA_UNDERLYINGS_CACHE_TTL_MS
      };
      return indiaUnderlyingsCache.payload;
    })().finally(() => {
      indiaUnderlyingsInFlight = null;
    });

    return res.json(await indiaUnderlyingsInFlight);
  } catch (err: any) {
    res.status(503).json({
      error: err?.code || 'LIVE_MARKET_DATA_UNAVAILABLE',
      message: err?.message || 'Authoritative 5paisa underlying data is unavailable.'
    });
  }
});

app.get('/api/india/sessions', (req: Request, res: Response) => {
  const session = getIndianSessionState();
  res.json(session);
});

app.get('/api/india/candles/:symbol', async (req: Request, res: Response) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE');
    if (!adapter.getHistoricalCandles) throw new Error('Authoritative 5paisa historical market-data capability is unavailable.');
    const candles = await adapter.getHistoricalCandles(symbol, '15m', 60);
    res.json(candles);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/india/analysis/:symbol', async (req: Request, res: Response) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (typeof adapter.fetchIndianUnderlyingsFrom5Paisa !== 'function') {
      throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa underlying market-data capability is unavailable.', 'FIVE_PAISA', 'LIVE');
    }
    const underlyings = await adapter.fetchIndianUnderlyingsFrom5Paisa();
    const found = underlyings.find((u: any) => u.symbol === symbol);
    if (!found) {
      return res.status(404).json({ error: `Underlying ${symbol} not found in authoritative 5paisa market data.` });
    }
    res.json(found);
  } catch (err: any) {
    res.status(503).json({
      error: err?.code || 'LIVE_MARKET_DATA_UNAVAILABLE',
      message: err?.message || 'Authoritative 5paisa analysis data is unavailable.'
    });
  }
});

// Universal candles endpoint for Indian underlyings (NIFTY, BANKNIFTY, etc.)
app.get(['/api/candles/:symbol', '/api/candles/:part1/:part2'], async (req: Request, res: Response) => {
  try {
    let symbol = req.params.symbol;
    if (!symbol && req.params.part1 && req.params.part2) {
      symbol = `${req.params.part1}/${req.params.part2}`;
    }
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol parameter is required' });
    }

    symbol = decodeURIComponent(symbol).toUpperCase().trim();
    const tf = String(req.query.tf || '15m');
    const limit = req.query.limit
      ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 10), 500)
      : 80;

    const cacheKey = `IN|${symbol}|${tf}|${limit}`;
    const cached = candleCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.payload);
    }

    const inFlight = candleInFlight.get(cacheKey);
    if (inFlight) {
      return res.json(await inFlight);
    }

    const promise = (async () => {
      const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE');
      if (!adapter.getHistoricalCandles) {
        throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa historical market-data capability is unavailable.', 'FIVE_PAISA', 'LIVE');
      }
      return await adapter.getHistoricalCandles(symbol, tf, limit);
    })();

    candleInFlight.set(cacheKey, promise);
    try {
      const candles = await promise;
      candleCache.set(cacheKey, {
        payload: Array.isArray(candles) ? candles : [],
        expiresAt: Date.now() + CANDLE_CACHE_TTL_MS
      });
      return res.json(Array.isArray(candles) ? candles : []);
    } finally {
      candleInFlight.delete(cacheKey);
    }
  } catch (err: any) {
    const isAuth = err?.code === 'AUTHENTICATION_FAILED' || err?.code === 'ACCOUNT_NOT_FOUND' || err?.code === 'TOKEN_EXPIRED';
    const status = isAuth ? 401 : 503;
    return res.status(status).json({
      error: err?.code || 'MARKET_DATA_UNAVAILABLE',
      message: err?.message || 'Historical candle data is unavailable from the live broker.'
    });
  }
});

// 6. Options Endpoints
app.get('/api/options/chain/:symbol', async (req: Request, res: Response) => {
  const symbol = req.params.symbol.toUpperCase();
  const expiry = req.query.expiry as string | undefined;
  const depth = req.query.depth ? parseInt(req.query.depth as string, 10) : 7;
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (typeof adapter.fetchOptionChainFrom5Paisa !== 'function') {
      throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa option-chain capability is unavailable.', 'FIVE_PAISA', 'LIVE');
    }
    const chain = await adapter.fetchOptionChainFrom5Paisa(symbol, expiry, depth);
    if (!chain) {
      return res.status(503).json({
        underlying: symbol,
        expiry: expiry || '',
        rows: [],
        isBlank: true,
        error: 'Authoritative 5paisa option-chain data is unavailable.'
      });
    }
    res.json(chain);
  } catch (err: any) {
    res.status(503).json({
      underlying: symbol,
      expiry: expiry || '',
      rows: [],
      isBlank: true,
      error: err?.message || 'Authoritative 5paisa option-chain data is unavailable.'
    });
  }
});

app.get('/api/options/scanner/:symbol', async (req: Request, res: Response) => {
  const symbol = req.params.symbol ? req.params.symbol.toUpperCase() : 'NIFTY';
  const expiry = typeof req.query.expiry === 'string' ? req.query.expiry : undefined;
  const rawDepth = Number(req.query.depth);
  const depth = Number.isInteger(rawDepth) ? Math.min(Math.max(rawDepth, 1), 20) : getSystemConfig().strikeDepth;
  try {
    const result = await scannerService.getOptionsScanner(symbol, expiry, depth);
    res.json(result);
  } catch (err: any) {
    res.status(503).json({
      underlying: symbol,
      spot: 0,
      bias: 'Range-bound',
      pcr: 0,
      opportunities: [],
      isBlank: true,
      error: err?.message || 'Option scanner data unavailable.'
    });
  }
});

app.post('/api/options/payoff', (req: Request, res: Response) => {
  try {
    const payoff = calculateStrategyPayoff(req.body);
    res.json(payoff);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Unified Signals
app.get(['/api/signals', '/api/signals/all'], async (req: Request, res: Response) => {
  try {
    const signals = await scannerService.getAllSignals();
    res.json(signals);
  } catch (err: any) {
    res.status(503).json({
      error: err?.code || 'LIVE_SIGNAL_DATA_UNAVAILABLE',
      message: err?.message || 'Live signal data is unavailable from the configured brokers.'
    });
  }
});

// 7b. Indian Market News & Prediction
app.get('/api/india/news', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    let marketData: any[] = [];
    try {
      marketData = await scannerService.getIndianMarketScanner();
    } catch {}
    const snapshot = await fetchIndianMarketNews({ forceRefresh, marketData });
    res.status(snapshot.status === 'UNAVAILABLE' ? 503 : 200).json(snapshot);
  } catch (err: any) {
    res.status(503).json({
      error: 'INDIAN_MARKET_NEWS_UNAVAILABLE',
      message: err?.message || 'Indian market news is unavailable.'
    });
  }
});

// 8. Live Forex News (Retired)
app.get('/api/forex/news', async (_req: Request, res: Response) => {
  res.status(404).json({
    error: 'MARKET_NOT_SUPPORTED',
    message: 'Forex news endpoint has been retired. System is configured for Indian markets only.'
  });
});

// 8c. Broker Session Status
app.get('/api/operations/broker-session-status', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    const broker = brokerRegistry.getSelectedBroker();
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE') as any;

    if (broker === 'FIVE_PAISA') {
      const active = await adapter.ensureActiveSession().catch(() => false);
      res.json({ status: active ? 'VERIFIED_ACTIVE' : 'VERIFIED_INACTIVE' });
    } else {
      // Existing cTrader logic...
      const account = await adapter.getAccount().catch(() => null);
      res.json({ status: account ? 'VERIFIED_ACTIVE' : 'VERIFIED_INACTIVE' });
    }
  } catch {
    res.json({ status: 'UNKNOWN' });
  }
});

// 8. Macroeconomic Events
app.get('/api/economic-events', async (_req: Request, res: Response) => {
  res.status(503).json({
    error: 'LIVE_MACRO_EVENTS_UNAVAILABLE',
    message: 'No authoritative live macroeconomic event feed is configured.'
  });
});

// 9. Database Stats & Diagnostics
app.get('/api/live-trade-research', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const signalId = typeof req.query.signalId === 'string' ? req.query.signalId : undefined;
    const rows = await getLiveTradeResearch(signalId);
    res.json({
      rows,
      outcomeTracker: getLiveTradeResearchOutcomeTrackerStatus()
    });
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_TRADE_RESEARCH_UNAVAILABLE',
      message: err?.message || 'Live trade research data is unavailable.'
    });
  }
});

app.get('/api/live-trade-research/outcomes/status', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(getLiveTradeResearchOutcomeTrackerStatus());
});


app.get('/api/live-trade-research/predictions', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const predictions = await getLiveTradeResearchPredictions({
      limit: Number(req.query.limit || 50),
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol : undefined,
      modelVersion: typeof req.query.modelVersion === 'string' ? req.query.modelVersion : undefined
    });
    res.json({ predictions, count: predictions.length, generatedAt: Date.now() });
  } catch (err: any) {
    res.status(503).json({ error: 'LIVE_TRADE_RESEARCH_PREDICTIONS_UNAVAILABLE', message: err?.message || 'Research predictions are unavailable.' });
  }
});

app.get('/api/live-trade-research/predictions/analytics', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const analytics = await getResearchPredictionAnalytics({
      modelVersion: typeof req.query.modelVersion === 'string' ? req.query.modelVersion : undefined,
      horizon: horizon as '1D' | '3D' | '7D' | undefined,
      limit: Number(req.query.limit || 50000)
    });
    res.json(analytics);
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_TRADE_RESEARCH_PREDICTION_ANALYTICS_UNAVAILABLE',
      message: err?.message || 'Research prediction analytics are unavailable.'
    });
  }
});

app.get('/api/live-trade-research/predictions/compare', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }

    const requestedLimit = Math.max(1, Math.min(100000, Number(req.query.limit || 50000)));
    const [baseline, aiGateway] = await Promise.all([
      getResearchPredictionAnalytics({
        modelVersion: 'SIGNAL_DIRECTION_BASELINE_V1',
        horizon: horizon as '1D' | '3D' | '7D' | undefined,
        limit: requestedLimit
      }),
      getResearchPredictionAnalytics({
        modelVersion: 'LLAMA_GATEWAY_QWEN_LLAMA_V1',
        horizon: horizon as '1D' | '3D' | '7D' | undefined,
        limit: requestedLimit
      })
    ]);

    res.json({
      horizon: horizon || null,
      models: {
        baseline,
        aiGateway
      },
      note: 'This endpoint reports observed research metrics side-by-side. It does not select a winner and does not affect live execution.',
      generatedAt: Date.now()
    });
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_TRADE_RESEARCH_PREDICTION_COMPARISON_UNAVAILABLE',
      message: err?.message || 'Research prediction comparison is unavailable.'
    });
  }
});

app.get('/api/live-trade-research/predictions/:predictionId', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const prediction = await getResearchPrediction(String(req.params.predictionId));
    if (!prediction) return res.status(404).json({ error: 'PREDICTION_NOT_FOUND' });
    res.json(prediction);
  } catch (err: any) {
    res.status(503).json({ error: 'LIVE_TRADE_RESEARCH_PREDICTION_UNAVAILABLE', message: err?.message || 'Research prediction is unavailable.' });
  }
});

app.post('/api/live-trade-research/predict', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = String(req.body?.horizon || '1D').toUpperCase();
    if (!['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const modelName = String(req.body?.model || 'BASELINE').toUpperCase();
    if (!['BASELINE', 'AI_GATEWAY'].includes(modelName)) {
      return res.status(400).json({
        error: 'INVALID_PREDICTION_MODEL',
        message: 'model must be BASELINE or AI_GATEWAY.'
      });
    }

    const model = modelName === 'AI_GATEWAY'
      ? new LlamaGatewayPredictionModel()
      : new SignalDirectionBaselineModel();

    const predictions = await generateResearchPredictions({
      fromTimestamp: Number.isFinite(Number(req.body?.fromTimestamp)) ? Number(req.body.fromTimestamp) : undefined,
      toTimestamp: Number.isFinite(Number(req.body?.toTimestamp)) ? Number(req.body.toTimestamp) : undefined,
      horizon: horizon as '1D' | '3D' | '7D',
      limit: Number(req.body?.limit || 50000),
      model
    });
    res.json({ predictions, count: predictions.length, generatedAt: Date.now() });
  } catch (err: any) {
    res.status(503).json({ error: 'LIVE_TRADE_RESEARCH_PREDICTION_FAILED', message: err?.message || 'Research prediction generation failed.' });
  }
});

app.get('/api/live-trade-research/pair-predictions', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = String(req.query.horizon || '1D').toUpperCase();
    if (!['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const model = String(req.query.model || 'BASELINE').toUpperCase();
    if (!['BASELINE', 'AI_GATEWAY'].includes(model)) {
      return res.status(400).json({ error: 'INVALID_PREDICTION_MODEL', message: 'model must be BASELINE or AI_GATEWAY.' });
    }
    const pairs = typeof req.query.pairs === 'string'
      ? req.query.pairs.split(',').map(value => value.trim().toUpperCase()).filter(Boolean)
      : undefined;
    const predictions = await generateCurrentPairPredictions({
      pairs,
      horizon: horizon as '1D' | '3D' | '7D',
      model: model as 'BASELINE' | 'AI_GATEWAY'
    });
    res.json({ predictions, count: predictions.length, generatedAt: Date.now(), model, horizon });
  } catch (err: any) {
    res.status(503).json({
      error: 'CURRENT_PAIR_PREDICTION_UNAVAILABLE',
      message: err?.message || 'Current pair predictions are unavailable.'
    });
  }
});

app.post('/api/live-trade-research/current-pair/evaluate', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.body?.horizon ? String(req.body.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const result = await evaluatePendingCurrentPairPredictions({
      symbol: typeof req.body?.symbol === 'string' ? req.body.symbol.toUpperCase() : undefined,
      modelVersion: typeof req.body?.modelVersion === 'string' ? req.body.modelVersion : undefined,
      horizon: horizon as '1D' | '3D' | '7D' | undefined,
      limit: Number(req.body?.limit || 50000)
    });
    res.json(result);
  } catch (err: any) {
    res.status(503).json({
      error: 'CURRENT_PAIR_OUTCOME_EVALUATION_FAILED',
      message: err?.message || 'Current pair outcome evaluation failed.'
    });
  }
});

app.get('/api/live-trade-research/current-pair/predictions', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const predictions = await getCurrentPairPredictions({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      modelVersion: typeof req.query.modelVersion === 'string' ? req.query.modelVersion : undefined,
      horizon: horizon as '1D' | '3D' | '7D' | undefined,
      limit: Number(req.query.limit || 100)
    });
    res.json({ predictions, count: predictions.length, generatedAt: Date.now() });
  } catch (err: any) {
    res.status(503).json({
      error: 'CURRENT_PAIR_PREDICTIONS_UNAVAILABLE',
      message: err?.message || 'Current pair prediction history is unavailable.'
    });
  }
});

app.get('/api/live-trade-research/current-pair/collection-status', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(getCurrentPairPredictionCollectionStatus());
});

app.post('/api/live-trade-research/current-pair/collect-now', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    res.json(await runCurrentPairPredictionCollectionCycle());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Current pair prediction collection failed.' });
  }
});

app.get('/api/live-trade-research/current-pair/walk-forward', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const parsePositive = (value: unknown) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : undefined;
    };
    const analytics = await getCurrentPairPredictionWalkForwardAnalytics({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      modelVersion: typeof req.query.modelVersion === 'string' ? req.query.modelVersion : undefined,
      horizon: horizon as '1D' | '3D' | '7D' | undefined,
      limit: parsePositive(req.query.limit),
      cohortDays: parsePositive(req.query.cohortDays),
      maxCohorts: parsePositive(req.query.maxCohorts)
    });
    res.json(analytics);
  } catch (err: any) {
    res.status(503).json({
      error: 'CURRENT_PAIR_WALK_FORWARD_ANALYTICS_UNAVAILABLE',
      message: err?.message || 'Current pair walk-forward analytics are unavailable.'
    });
  }
});

app.get('/api/live-trade-research/current-pair/model-comparison', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const parsePositive = (value: unknown) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : undefined;
    };
    const comparison = await getCurrentPairPredictionModelComparison({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      horizon: horizon as '1D' | '3D' | '7D' | undefined,
      limit: parsePositive(req.query.limit)
    });
    res.json(comparison);
  } catch (err: any) {
    res.status(503).json({
      error: 'CURRENT_PAIR_MODEL_COMPARISON_UNAVAILABLE',
      message: err?.message || 'Current pair model comparison is unavailable.'
    });
  }
});


app.get('/api/live-trade-research/current-pair/paired-model-comparison', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const parsePositive = (value: unknown) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : undefined;
    };
    const comparison = await getCurrentPairPairedModelComparison({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      horizon: horizon as '1D' | '3D' | '7D' | undefined,
      limit: parsePositive(req.query.limit)
    });
    res.json(comparison);
  } catch (err: any) {
    res.status(503).json({
      error: 'CURRENT_PAIR_PAIRED_MODEL_COMPARISON_UNAVAILABLE',
      message: err?.message || 'Current pair paired model comparison is unavailable.'
    });
  }
});app.get('/api/live-trade-research/current-pair/paired-context-comparison', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon) : undefined;
    if (horizon && !['1D', '4H', '1H'].includes(horizon)) return res.status(400).json({ error: 'Invalid horizon' });
    const result = await getCurrentPairPairedContextComparison({
      horizon: horizon as CurrentPairPredictionHorizon | undefined,
      symbol: req.query.symbol ? String(req.query.symbol) : undefined,
      marketRegime: req.query.marketRegime ? String(req.query.marketRegime) : undefined,
      session: req.query.session ? String(req.query.session) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined
    });
    return res.json(result);
  } catch (error) {
    console.error('[CURRENT_PAIR_PAIRED_CONTEXT]', error);
    return res.status(500).json({ error: 'Failed to generate context-conditioned paired comparison' });
  }
});

app.get('/api/live-trade-research/current-pair/paired-model-comparison-rolling', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon) : undefined;
    const symbol = req.query.symbol ? String(req.query.symbol) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    if (horizon && !['1D', '4H', '1H'].includes(horizon)) {
      return res.status(400).json({ error: 'Invalid horizon' });
    }
    const rollingWindows = await getCurrentPairPairedModelComparisonRolling({
      horizon: horizon as CurrentPairPredictionHorizon | undefined,
      symbol,
      limit
    });
    return res.json({ rollingWindows, generatedAt: Date.now() });
  } catch (error) {
    console.error('[CURRENT_PAIR_PAIRED_ROLLING]', error);
    return res.status(500).json({ error: 'Failed to generate paired rolling comparison' });
  }
});



app.get('/api/live-trade-research/current-pair/validation-report', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const report = await getCurrentPairResearchValidationReport({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      horizon: horizon as CurrentPairPredictionHorizon | undefined,
      limit: Number(req.query.limit || 50000)
    });
    return res.json(report);
  } catch (error: any) {
    console.error('[CURRENT_PAIR_VALIDATION_REPORT]', error);
    return res.status(503).json({
      error: 'CURRENT_PAIR_VALIDATION_REPORT_UNAVAILABLE',
      message: error?.message || 'Current pair research validation report is unavailable.'
    });
  }
});

app.get('/api/live-trade-research/current-pair/research-readiness-ledger', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : '1D';
    if (!['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const report = await getCurrentPairResearchReadinessLedger({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      horizon: horizon as CurrentPairPredictionHorizon
    });
    return res.json(report);
  } catch (error: any) {
    console.error('[CURRENT_PAIR_RESEARCH_READINESS_LEDGER]', error);
    return res.status(503).json({
      error: 'CURRENT_PAIR_RESEARCH_READINESS_LEDGER_UNAVAILABLE',
      message: error?.message || 'Current pair research readiness ledger is unavailable.'
    });
  }
});
app.get('/api/live-trade-research/current-pair/cross-model-context-temporal-calibration', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() as CurrentPairPredictionHorizon : undefined;
    if (horizon && !['1D','3D','7D'].includes(horizon)) return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    const report = await getCurrentPairCrossModelContextTemporalCalibration({
      horizon,
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      marketRegime: typeof req.query.marketRegime === 'string' ? req.query.marketRegime : undefined,
      session: typeof req.query.session === 'string' ? req.query.session : undefined
    });
    return res.json(report);
  } catch (error: any) {
    console.error('[CURRENT_PAIR_CROSS_MODEL_CONTEXT_TEMPORAL_CALIBRATION]', error);
    return res.status(503).json({ error: 'CURRENT_PAIR_CROSS_MODEL_CONTEXT_TEMPORAL_CALIBRATION_UNAVAILABLE', message: error?.message || 'Context temporal calibration report is unavailable.' });
  }
});

app.get('/api/live-trade-research/current-pair/temporal-calibration', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() as CurrentPairPredictionHorizon : undefined;
    if (horizon && !['1D','3D','7D'].includes(horizon)) return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    const report = await getCurrentPairTemporalCalibrationMatrix({
      horizon,
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      modelVersion: typeof req.query.modelVersion === 'string' ? req.query.modelVersion : undefined
    });
    return res.json(report);
  } catch (error: any) {
    console.error('[CURRENT_PAIR_TEMPORAL_CALIBRATION]', error);
    return res.status(503).json({ error: 'CURRENT_PAIR_TEMPORAL_CALIBRATION_UNAVAILABLE', message: error?.message || 'Temporal calibration report is unavailable.' });
  }
});


app.get('/api/live-trade-research/current-pair/oos-drift', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : '1D';
    if (!['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const modelVersion = typeof req.query.modelVersion === 'string' && req.query.modelVersion.trim()
      ? req.query.modelVersion.trim()
      : 'LLAMA_GATEWAY_QWEN_LLAMA_V1';
    const report = await getCurrentPairOosDriftReport({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      horizon: horizon as CurrentPairPredictionHorizon,
      modelVersion
    });
    return res.json(report);
  } catch (error: any) {
    console.error('[CURRENT_PAIR_OOS_DRIFT]', error);
    return res.status(503).json({
      error: 'CURRENT_PAIR_OOS_DRIFT_UNAVAILABLE',
      message: error?.message || 'Current pair OOS drift report is unavailable.'
    });
  }
});


app.get('/api/live-trade-research/current-pair/calibration-matrix', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const modelVersion = typeof req.query.modelVersion === 'string' && req.query.modelVersion.trim()
      ? req.query.modelVersion.trim()
      : 'LLAMA_GATEWAY_QWEN_LLAMA_V1';
    const matrix = await getCurrentPairCalibrationMatrix({
      modelVersion,
      horizon: horizon as CurrentPairPredictionHorizon | undefined,
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol : undefined
    });
    return res.json(matrix);
  } catch (error: any) {
    console.error('[CURRENT_PAIR_CALIBRATION_MATRIX]', error);
    return res.status(503).json({
      error: 'CURRENT_PAIR_CALIBRATION_MATRIX_UNAVAILABLE',
      message: error?.message || 'Current pair calibration matrix is unavailable.'
    });
  }
});


app.get('/api/live-trade-research/current-pair/cross-model-calibration', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    const report = await getCurrentPairCrossModelCalibration({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      horizon: horizon as CurrentPairPredictionHorizon | undefined
    });
    return res.json(report);
  } catch (error: any) {
    console.error('[CURRENT_PAIR_CROSS_MODEL_CALIBRATION]', error);
    return res.status(503).json({ error: 'CURRENT_PAIR_CROSS_MODEL_CALIBRATION_UNAVAILABLE', message: error?.message || 'Cross-model calibration is unavailable.' });
  }
});

app.get('/api/live-trade-research/current-pair/cross-model-temporal-calibration', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    const report = await getCurrentPairCrossModelTemporalCalibration({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      horizon: horizon as CurrentPairPredictionHorizon | undefined
    });
    return res.json(report);
  } catch (error: any) {
    console.error('[CURRENT_PAIR_CROSS_MODEL_TEMPORAL_CALIBRATION]', error);
    return res.status(503).json({ error: 'CURRENT_PAIR_CROSS_MODEL_TEMPORAL_CALIBRATION_UNAVAILABLE', message: error?.message || 'Cross-model temporal calibration is unavailable.' });
  }
});

app.get('/api/live-trade-research/current-pair/cross-model-context-calibration', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) return res.status(400).json({ error: 'INVALID_HORIZON' });
    const report = await getCurrentPairCrossModelContextCalibration({ symbol: typeof req.query.symbol==='string'?req.query.symbol:undefined, horizon: horizon as CurrentPairPredictionHorizon|undefined, marketRegime: typeof req.query.marketRegime==='string'?req.query.marketRegime:undefined, session: typeof req.query.session==='string'?req.query.session:undefined });
    return res.json(report);
  } catch (error:any) { console.error('[CURRENT_PAIR_CROSS_MODEL_CONTEXT_CALIBRATION]', error); return res.status(503).json({error:'CURRENT_PAIR_CROSS_MODEL_CONTEXT_CALIBRATION_UNAVAILABLE',message:error?.message||'Context calibration is unavailable.'}); }
});

app.get('/api/live-trade-research/current-pair/analytics', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon ? String(req.query.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const analytics = await getCurrentPairPredictionAnalytics({
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
      modelVersion: typeof req.query.modelVersion === 'string' ? req.query.modelVersion : undefined,
      horizon: horizon as '1D' | '3D' | '7D' | undefined,
      limit: Number(req.query.limit || 50000)
    });
    res.json(analytics);
  } catch (err: any) {
    res.status(503).json({
      error: 'CURRENT_PAIR_PREDICTION_ANALYTICS_UNAVAILABLE',
      message: err?.message || 'Current pair prediction analytics are unavailable.'
    });
  }
});

app.post('/api/live-trade-research/predictions/evaluate', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const horizon = req.body?.horizon ? String(req.body.horizon).toUpperCase() : undefined;
    if (horizon && !['1D', '3D', '7D'].includes(horizon)) {
      return res.status(400).json({ error: 'INVALID_HORIZON', message: 'horizon must be 1D, 3D, or 7D.' });
    }
    const result = await evaluatePendingResearchPredictions({
      fromTimestamp: Number.isFinite(Number(req.body?.fromTimestamp)) ? Number(req.body.fromTimestamp) : undefined,
      toTimestamp: Number.isFinite(Number(req.body?.toTimestamp)) ? Number(req.body.toTimestamp) : undefined,
      modelVersion: typeof req.body?.modelVersion === 'string' ? req.body.modelVersion : undefined,
      horizon: horizon as '1D' | '3D' | '7D' | undefined
    });
    res.json(result);
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_TRADE_RESEARCH_PREDICTION_EVALUATION_FAILED',
      message: err?.message || 'Research prediction evaluation failed.'
    });
  }
});

app.get('/api/live-trade-research/analytics', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const parseNumber = (value: unknown) => {
      if (typeof value !== 'string' && typeof value !== 'number') return undefined;
      const number = Number(value);
      return Number.isFinite(number) ? number : undefined;
    };
    const analytics = await getLiveTradeResearchAnalytics({
      fromTimestamp: parseNumber(req.query.from),
      toTimestamp: parseNumber(req.query.to),
      symbol: typeof req.query.symbol === 'string' ? req.query.symbol : undefined,
      direction: typeof req.query.direction === 'string' ? req.query.direction : undefined,
      marketRegime: typeof req.query.marketRegime === 'string' ? req.query.marketRegime : undefined,
      session: typeof req.query.session === 'string' ? req.query.session : undefined,
      minScore: parseNumber(req.query.minScore),
      maxScore: parseNumber(req.query.maxScore)
    });
    res.json(analytics);
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_TRADE_RESEARCH_ANALYTICS_UNAVAILABLE',
      message: err?.message || 'Live trade research analytics are unavailable.'
    });
  }
});

app.get('/api/live-trade-research/features', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const parseNumber = (value: unknown) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : undefined;
    };
    const rows = await getLiveTradeResearchFeatures({
      fromTimestamp: parseNumber(req.query.from),
      toTimestamp: parseNumber(req.query.to),
      closedOnly: req.query.closedOnly !== 'false',
      limit: parseNumber(req.query.limit)
    });
    res.json({ rows, count: rows.length, generatedAt: Date.now() });
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_TRADE_RESEARCH_FEATURES_UNAVAILABLE',
      message: err?.message || 'Research features are unavailable.'
    });
  }
});

app.post('/api/live-trade-research/features/materialize', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const result = await materializeLiveTradeResearchFeatures({
      fromTimestamp: Number.isFinite(Number(req.body?.from)) ? Number(req.body.from) : undefined,
      toTimestamp: Number.isFinite(Number(req.body?.to)) ? Number(req.body.to) : undefined
    });
    res.json(result);
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_TRADE_RESEARCH_FEATURE_MATERIALIZATION_FAILED',
      message: err?.message || 'Research feature materialization failed.'
    });
  }
});


app.get('/api/db/stats', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const stats = await getDatabaseStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Gemini Natural-Language Explanation Layer
// Strict system instructions: Gemini receives structured quantitative output, explains factors,
// never overrides quantitative rules, highlights uncertainty, and does not claim guaranteed profit.
app.post('/api/analysis/explain', async (req: Request, res: Response) => {
  const payload = req.body;
  const ai = getGenAI();

  if (!ai) {
    // Deterministic fallback explanation if Gemini API key not present
    return res.json({
      summary: `Quantitative analysis for ${payload.instrument || payload.underlying || 'the instrument'} indicates a ${payload.direction || payload.strategy || 'probabilistic'} setup based on indicators, VWAP, and market structure.`,
      supportingFactors: [
        `Market structure aligns with quantitative rules`,
        `Technical indicator confluence (EMA stack, RSI momentum)`,
        `Risk/Reward is statistically bounded with predefined Stop Loss`
      ],
      conflictingFactors: [
        `Probabilistic setup only — no guaranteed market direction`,
        `Upcoming economic events or session transition may introduce volatility`
      ],
      riskNote: 'Trading in derivatives and Forex carries substantial risk. All probabilities are statistical estimates.',
      isAiGenerated: false
    });
  }

  try {
    const prompt = `You are the explanation layer of a quantitative multi-market trading-analysis system.
You do not guarantee future market movements.
You do not invent market data.
You do not change numerical values supplied by the quantitative engine.
You clearly distinguish observed data, calculated metrics, and model estimates.
You must explain uncertainty.
You must identify conflicting evidence.
You must not claim guaranteed profit.
You must not describe a probabilistic signal as certainty.
You should explain why the quantitative engine produced a signal rather than independently overriding it.

Here is the quantitative data payload:
${JSON.stringify(payload, null, 2)}

Provide a concise, professional JSON response matching this schema:
{
  "summary": "2-3 sentence explanation of the setup rationale",
  "supportingFactors": ["factor 1", "factor 2", "factor 3"],
  "conflictingFactors": ["factor 1", "factor 2"],
  "riskNote": "Specific risk conditions to watch"
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const text = response.text?.trim() || '{}';
    const parsed = JSON.parse(text);
    res.json({ ...parsed, isAiGenerated: true });
  } catch (err: any) {
    console.error('Gemini explanation error:', err);
    res.json({
      summary: `Quantitative analysis for ${payload.instrument || payload.underlying || 'instrument'} derived from indicator stack and market structure.`,
      supportingFactors: [`Quantitative alignment verified`],
      conflictingFactors: [`Market conditions can change rapidly; the supplied quantitative data is probabilistic.`],
      riskNote: 'Risk is bounded by strict Stop Loss rules. Probabilistic estimate only.',
      isAiGenerated: false
    });
  }
});

// API 404 handler to ensure unknown API requests return JSON instead of HTML
app.all('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// -------------------------------------------------------------
// VITE MIDDLEWARE & SERVER STARTUP
// -------------------------------------------------------------
async function captureLiveBrokerReconciliation(): Promise<void> {
  if (!databaseReady) return;
  try {
    const results = await Promise.allSettled([
      reconciliationService.captureBrokerSnapshot('CTRADER'),
      reconciliationService.captureBrokerSnapshot('FIVE_PAISA')
    ]);
    results.forEach((result, index) => {
      const broker = index === 0 ? 'CTRADER' : 'FIVE_PAISA';
      if (result.status === 'rejected') {
        console.warn(`Goldcrest reconciliation failed for ${broker}: `, result.reason?.message || result.reason);
      } else if (result.value?.status === 'UNCONFIGURED') {
        // Broker is unconfigured or access token is unavailable; snapshot recorded as UNCONFIGURED.
      }
    });
  } catch (err: any) {
    console.warn('Goldcrest reconciliation cycle failed:', err?.message || err);
  }
}

async function startServer() {
  logApplicationAction('SERVER_STARTING', {
    nodeEnv: process.env.NODE_ENV || 'development',
    lifecycle: process.env.npm_lifecycle_event || null,
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3000)
  });

  // Strict preflight enforcement applies only to an actual production launch.
  // npm run dev is always treated as local development even when .env contains
  // a stale NODE_ENV=production value.
  const productionRuntime = process.env.npm_lifecycle_event !== 'dev'
    && process.env.NODE_ENV === 'production';
  productionPreflight(productionRuntime);

  if (productionRuntime) {
    const releaseIntegrity = evaluateProductionReleaseIntegrity(buildProductionReleaseIntegrityInput({
      tradingMode: getSystemConfig().tradingMode,
      operatorAuthConfigured: operatorAuthConfigured(),
      liveBrokerConfigured: Boolean(
        process.env.CTRADER_LIVE_CLIENT_ID?.trim() &&
        process.env.CTRADER_LIVE_CLIENT_SECRET?.trim() &&
        process.env.CTRADER_LIVE_ACCESS_TOKEN?.trim() &&
        process.env.CTRADER_LIVE_ACCOUNT_ID?.trim()
      ) || Boolean(
        process.env.FIVEPAISA_LIVE_APP_NAME?.trim() &&
        process.env.FIVEPAISA_LIVE_USER_ID?.trim() &&
        process.env.FIVEPAISA_LIVE_USER_KEY?.trim() &&
        process.env.FIVEPAISA_LIVE_CLIENT_CODE?.trim()
      ),
      packageVersion: process.env.GOLDCREST_RELEASE_VERSION || undefined
    }));
    if (!releaseIntegrity.ok) {
      throw new Error(`Production release integrity failed: ${releaseIntegrity.failures.join(', ') || 'invalid release artifacts'}`);
    }
    const configIntegrity = evaluateSystemConfigIntegrity(getSystemConfig());
    if (!configIntegrity.ok) {
      throw new Error(`Production configuration integrity failed: ${configIntegrity.failures.join(', ') || 'invalid configuration'}`);
    }
  }

  // Global JSON error-handling middleware for API routes
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err.status || err.statusCode || 500);
    const message = err.message || 'Internal Server Error';
    if (req.path.startsWith('/api/')) {
      res.status(status).json({
        error: message,
        code: err.code || 'INTERNAL_ERROR',
        details: err.details || undefined,
        stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
      });
    } else {
      res.status(status).send(message);
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      // Express owns /api and SPA routing. Vite must not generate an HTML
      // fallback response for an unmatched API endpoint.
      appType: 'custom',
    });
    app.use(vite.middlewares);

    // Express handles SPA navigation explicitly after API routes. This preserves
    // Vite HMR/transforms while preventing API requests from reaching HTML fallback.
    app.use('*', async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api/')) return next();

      try {
        const fs = await import('node:fs/promises');
        const indexPath = path.join(process.cwd(), 'index.html');
        const template = await fs.readFile(indexPath, 'utf8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).setHeader('Content-Type', 'text/html').end(html);
      } catch (error) {
        next(error);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Dev server binds to 0.0.0.0 for accessible container networking.
  const host = process.env.HOST || '0.0.0.0';
  const localDevelopmentHost = ['0.0.0.0', '127.0.0.1', 'localhost', '::1'].includes(String(host).trim().toLowerCase());
  if (process.env.NODE_ENV !== 'production') {
    process.env.GOLDCREST_LOCAL_DEVELOPMENT = localDevelopmentHost ? 'true' : 'false';
  }
  const server = app.listen(PORT, host, () => {
    const runtime = process.env.NODE_ENV || 'development';
    console.log(`Goldcrest server listening on http://${host}:${PORT} (NODE_ENV=${runtime})`);
    logApplicationAction('SERVER_STARTED', {
      host,
      port: PORT,
      nodeEnv: runtime,
      auditFile: getLiveRuntimeLogStatus().file
    });
    void captureLiveBrokerReconciliation();
    void reconcileInFlightExecutionIntents();
    startAccountBalanceSnapshotScheduler();

    // Phase 1: durable Forex historical market-data collection. The initial
    // synchronization backfills daily history (plus broker-native weekly and
    // monthly bars) and then the scheduler performs lightweight incremental
    // refreshes so today's high/low/close stays current without flooding
    // cTrader historical endpoints.
    void databaseInitPromise
      .then(() => {
        // startLiveTradeResearchOutcomeTracker();
        // startCurrentPairPredictionCollectionScheduler();
      })
      // .then(() => syncMarketHistory())
      // .then(() => {
      //   startMarketHistoryScheduler();
      // })
      .catch((error) => {
        liveRuntimeLog('ERROR', 'MARKET_HISTORY_INITIAL_SYNC_FAILED', {
          error: error?.message || String(error)
        });
        startMarketHistoryScheduler();
      });

    reconciliationTimer = setInterval(() => void captureLiveBrokerReconciliation(), 5 * 60_000);
    executionLifecycleTimer = setInterval(() => void reconcileInFlightExecutionIntents(), 15_000);
    if (process.env.GOLDCREST_AUTO_TRADING_START_ON_BOOT === 'true') {
      const autoStatus = autoTradingService.start();
      console.log(`Goldcrest auto-trading startup: ${autoStatus.state} - ${autoStatus.lastCycleResult || ''}`);
    }
    reconciliationTimer.unref?.();
    executionLifecycleTimer.unref?.();
  });

  runtimeLifecycle.registerCleanup('AUTO_LIVE', () => {
    autoTradingService.stop('Server shutdown requested.');
  });
  // runtimeLifecycle.registerCleanup('CURRENT_PAIR_PREDICTION_COLLECTION', stopCurrentPairPredictionCollectionScheduler);
  // runtimeLifecycle.registerCleanup('LIVE_TRADE_RESEARCH_OUTCOME_TRACKER', stopLiveTradeResearchOutcomeTracker);
  runtimeLifecycle.registerCleanup('ACCOUNT_BALANCE_SNAPSHOT', stopAccountBalanceSnapshotScheduler);
  runtimeLifecycle.registerCleanup('MARKET_HISTORY', stopMarketHistoryScheduler);
  runtimeLifecycle.registerCleanup('EXECUTION_RECONCILIATION_TIMER', () => {
    if (executionLifecycleTimer) {
      clearInterval(executionLifecycleTimer);
      executionLifecycleTimer = null;
    }
  });
  runtimeLifecycle.registerCleanup('BROKER_RECONCILIATION_TIMER', () => {
    if (reconciliationTimer) {
      clearInterval(reconciliationTimer);
      reconciliationTimer = null;
    }
  });

  runtimeLifecycle.transition('RUNNING');

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (signal: string) => {
    if (shutdownPromise) return;
    liveRuntimeLog('SYSTEM', 'SERVER_SHUTDOWN_REQUESTED', { signal });
    console.log(`Goldcrest received ${signal}; closing HTTP server gracefully.`);

    shutdownPromise = (async () => {
      await runtimeLifecycle.shutdown(signal);

      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });

      try {
        // Persist the authoritative SQLite state only after all schedulers and
        // Auto Live have been stopped, so no background writer can race shutdown.
        persistDatabase();
      } catch (err: any) {
        console.error('SQLite shutdown persistence failed:', err?.message || err);
      }
      process.exit(0);
    })();

    setTimeout(() => {
      console.error('Goldcrest graceful shutdown timed out; forcing exit.');
      process.exit(1);
    }, 15_000).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer();
