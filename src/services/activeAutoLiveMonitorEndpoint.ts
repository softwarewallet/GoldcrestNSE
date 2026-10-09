import type { Request, Response } from 'express';
import { getSystemConfig, getCTraderApiMode } from './configService';
import { evaluateSystemConfigIntegrity } from './configIntegrityService';
import { getRuntimeObservabilitySnapshot } from './runtimeObservabilityService';
import { brokerRegistry } from '../brokers/registry';
import { maskIdentifier } from '../brokers/auditLog';
import { getAccountBalanceSnapshots } from './accountBalanceSnapshotService';
import { evaluateAccountStateConsistency } from './accountStateConsistencyService';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { LIVE_AUTO_EXECUTION_ALLOWED, isExecutionGateUnlocked } from '../brokers/safety/AutoExecutionEngine';
import { evaluateActiveAutoLiveMonitor } from './activeAutoLiveMonitorService';
import { liveRuntimeLog } from './liveRuntimeLog';
import { getDatabase } from '../database/db';

export const GOLDCREST_RUNTIME_ID = process.env.GOLDCREST_RUNTIME_ID || `goldcrest-${Date.now()}`;

export async function handleActiveAutoLiveMonitor(_req: Request, res: Response) {
  try {
    await getDatabase();

    const config = getSystemConfig();
    const configIntegrity = evaluateSystemConfigIntegrity(config);
    const observability = await getRuntimeObservabilitySnapshot({
      runtimeId: GOLDCREST_RUNTIME_ID,
      environment: process.env.NODE_ENV || 'development'
    });

    const selectedBroker = brokerRegistry.getSelectedBroker();
    const adapter = brokerRegistry.getAdapter(selectedBroker, 'LIVE');
    
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
    const balanceValid = typeof account?.balance === 'number' && Number.isFinite(account.balance) && account.balance > 0;
    
    let tradingPermission = false;
    if (selectedBroker === 'FIVE_PAISA') {
      tradingPermission = permissions.includes('TRADING') || permissions.includes('EQUITY') || permissions.includes('DERIVATIVES') || permissions.includes('NSE_FNO');
    } else {
      tradingPermission = permissions.includes('TRADING') || permissions.includes('EQUITY') || permissions.includes('DERIVATIVES');
    }

    const snapshots = await getAccountBalanceSnapshots({
      broker: selectedBroker,
      limit: 1
    });
    
    const accountConsistency = evaluateAccountStateConsistency(
      selectedBroker,
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
    const executionGateUnlocked = isExecutionGateUnlocked();

    const commonInput = {
      configurationIntegrityOk: configIntegrity.ok,
      tradingModeLiveOnly: config.tradingMode === 'LIVE_ONLY',
      databasePersistenceHealthy: !observability.databasePersistence.lastPersistenceError,
      runtimeLifecycleRunning: observability.lifecycle.state === 'RUNNING',
      auditLogReady: observability.auditLog.enabled && observability.auditLog.exists,
      killSwitchClear: !killSwitch.isHalted(),
      executionGateUnlocked,
      autoTradingStateOperational,
      noUnresolvedExecutionIntents
    };

    let monitorInput: any;
    if (selectedBroker === 'CTRADER') {
      monitorInput = {
        ...commonInput,
        brokerType: 'CTRADER',
        connected: connection?.connected === true && account?.connectionStatus === 'CONNECTED',
        accountIsLive: accountIsLive,
        accountIdPresent: accountIdPresent,
        currencyPresent: Boolean(String(account?.currency || '').trim()),
        balanceValid: balanceValid,
        equityValid: typeof account?.equity === 'number' && Number.isFinite(account.equity) && account.equity > 0,
        tradingPermission: tradingPermission,
        apiModeLive: getCTraderApiMode() === 'LIVE',
        accountStateConsistent: accountConsistency.consistent
      };
    } else {
      monitorInput = {
        ...commonInput,
        brokerType: 'FIVE_PAISA',
        connected: connection?.connected === true && account?.connectionStatus === 'CONNECTED',
        accountIsLive: accountIsLive,
        accountIdPresent: accountIdPresent,
        tradingPermission: tradingPermission,
        balanceValid: balanceValid,
        accountStateConsistent: accountConsistency.consistent
      };
    }

    const monitor = evaluateActiveAutoLiveMonitor(monitorInput);

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

    const responsePayload: any = {
      phase: '9.6',
      generatedAt: Date.now(),
      runtimeId: GOLDCREST_RUNTIME_ID,
      environment: process.env.NODE_ENV || 'development',
      tradingMode: 'LIVE_ONLY',
      brokerType: selectedBroker,
      status: monitor.status,
      healthy: monitor.healthy,
      checks: monitor.checks,
      failures: monitor.failures,
      criticalFailures: monitor.criticalFailures,
    };

    if (selectedBroker === 'CTRADER') {
      responsePayload.cTrader = {
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
      };
    } else {
      responsePayload.fivePaisa = {
        connected: connection?.connected === true,
        accountId: account ? maskIdentifier(String(account.accountId || '')) : null,
        accountType: account?.accountType || null,
        balance: account?.balance ?? null,
        tradingPermission,
        accountConsistency: {
          status: accountConsistency.status,
          consistent: accountConsistency.consistent,
          snapshotAgeMs: accountConsistency.snapshotAgeMs,
          balanceDelta: accountConsistency.balanceDelta,
          equityDelta: accountConsistency.equityDelta
        }
      };
    }

    responsePayload.executionGate = {
      unlocked: executionGateUnlocked,
      locked: !executionGateUnlocked
    };
    responsePayload.autoTrading = {
      state: observability.autoTrading.state,
      currentExecution: observability.autoTrading.currentExecution,
      lastExecution: observability.autoTrading.lastExecution
    };
    responsePayload.unresolvedExecutionIntents = observability.executionIntents;

    return res.status(monitor.statusCode).json(responsePayload);
  } catch (error: any) {
    liveRuntimeLog('ERROR', 'ACTIVE_AUTO_LIVE_MONITOR_FAILED', {
      error: error?.message || String(error)
    });
    return res.status(503).json({
      phase: '9.6',
      error: 'ACTIVE_AUTO_LIVE_MONITOR_UNAVAILABLE',
      message: error?.message || 'Active Auto Live monitor is unavailable.'
    });
  }
}
