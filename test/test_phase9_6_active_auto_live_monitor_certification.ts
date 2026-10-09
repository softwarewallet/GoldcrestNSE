import assert from 'node:assert/strict';
import { evaluateActiveAutoLiveMonitor, type ActiveAutoLiveMonitorInput, type CTraderInput, type FivePaisaInput } from '../src/services/activeAutoLiveMonitorService';

const commonValid = {
  configurationIntegrityOk: true,
  tradingModeLiveOnly: true,
  databasePersistenceHealthy: true,
  runtimeLifecycleRunning: true,
  auditLogReady: true,
  killSwitchClear: true,
  executionGateUnlocked: true,
  autoTradingStateOperational: true,
  noUnresolvedExecutionIntents: true,
};

const validCTrader: CTraderInput = {
  ...commonValid,
  brokerType: 'CTRADER',
  connected: true,
  accountIsLive: true,
  accountIdPresent: true,
  currencyPresent: true,
  balanceValid: true,
  equityValid: true,
  tradingPermission: true,
  apiModeLive: true,
  accountStateConsistent: true,
};

const validFivePaisa: FivePaisaInput = {
  ...commonValid,
  brokerType: 'FIVE_PAISA',
  connected: true,
  accountIsLive: true,
  accountIdPresent: true,
  balanceValid: true,
  tradingPermission: true,
  accountStateConsistent: true,
};

const scenarios: Array<{id:number;name:string;run:()=>void}> = [];
const add=(id:number,name:string,run:()=>void)=>scenarios.push({id,name,run});

add(1, 'CTRADER valid is healthy', () => assert.equal(evaluateActiveAutoLiveMonitor(validCTrader).healthy, true));
add(2, 'FIVE_PAISA valid is healthy', () => assert.equal(evaluateActiveAutoLiveMonitor(validFivePaisa).healthy, true));

// Test blocker failure
add(3, 'CTRADER connected failure blocks', () => {
    const res = evaluateActiveAutoLiveMonitor({...validCTrader, connected: false});
    assert.equal(res.healthy, false);
    assert.ok(res.criticalFailures.includes('cTraderConnected'));
});

add(4, 'FIVE_PAISA connected failure blocks', () => {
    const res = evaluateActiveAutoLiveMonitor({...validFivePaisa, connected: false});
    assert.equal(res.healthy, false);
    assert.ok(res.criticalFailures.includes('fivePaisaConnected'));
});

// Test non-critical failure (degradation)
add(5, 'CTRADER accountId failure degrades', () => {
    const res = evaluateActiveAutoLiveMonitor({...validCTrader, accountIdPresent: false});
    assert.equal(res.status, 'DEGRADED');
    assert.deepEqual(res.criticalFailures, []);
});

for(const item of scenarios){item.run();console.log('[PASS '+String(item.id).padStart(2,'0')+'/'+scenarios.length+'] '+item.name);}
console.log('PHASE 9.6 ACTIVE AUTO LIVE MONITOR CERTIFICATION: PASSED');
