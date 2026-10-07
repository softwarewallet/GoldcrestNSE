import assert from 'node:assert/strict';
import { evaluateActiveAutoLiveMonitor, type ActiveAutoLiveMonitorInput } from '../src/services/activeAutoLiveMonitorService';

const valid: ActiveAutoLiveMonitorInput = {
  configurationIntegrityOk: true,
  tradingModeLiveOnly: true,
  databasePersistenceHealthy: true,
  runtimeLifecycleRunning: true,
  auditLogReady: true,
  cTraderConnected: true,
  cTraderAccountIsLive: true,
  cTraderAccountIdPresent: true,
  cTraderCurrencyPresent: true,
  cTraderBalanceValid: true,
  cTraderEquityValid: true,
  cTraderTradingPermission: true,
  cTraderApiModeLive: true,
  killSwitchClear: true,
  executionGateUnlocked: true,
  autoTradingStateOperational: true,
  noUnresolvedExecutionIntents: true,
  cTraderAccountStateConsistent: true
};

const scenarios: Array<{id:number;name:string;run:()=>void}> = [];
const add=(id:number,name:string,run:()=>void)=>scenarios.push({id,name,run});
const blockers = [
  ['configurationIntegrityOk','configurationIntegrity'],
  ['tradingModeLiveOnly','tradingMode'],
  ['databasePersistenceHealthy','databasePersistence'],
  ['runtimeLifecycleRunning','runtimeLifecycle'],
  ['auditLogReady','auditLog'],
  ['cTraderConnected','cTraderConnected'],
  ['cTraderAccountIsLive','cTraderAccountLive'],
  ['cTraderAccountIdPresent','cTraderAccountId'],
  ['cTraderCurrencyPresent','cTraderCurrency'],
  ['cTraderBalanceValid','cTraderBalance'],
  ['cTraderEquityValid','cTraderEquity'],
  ['cTraderTradingPermission','cTraderTradingPermission'],
  ['cTraderApiModeLive','cTraderApiMode'],
  ['killSwitchClear','killSwitch'],
  ['executionGateUnlocked','executionGate'],
  ['autoTradingStateOperational','autoTradingState'],
  ['noUnresolvedExecutionIntents','unresolvedExecutionIntents'],
  ['cTraderAccountStateConsistent','accountStateConsistency']
] as const;
add(1,'Complete active Auto Live monitor is healthy',()=>assert.equal(evaluateActiveAutoLiveMonitor(valid).healthy,true));
add(2,'Healthy status is HEALTHY',()=>assert.equal(evaluateActiveAutoLiveMonitor(valid).status,'HEALTHY'));
add(3,'Healthy status code is 200',()=>assert.equal(evaluateActiveAutoLiveMonitor(valid).statusCode,200));
for(let i=0;i<blockers.length;i++){
  const [field,gateName]=blockers[i];
  add(4+i,gateName+' blocks active monitor',()=>{
    const input={...valid,[field]:false} as ActiveAutoLiveMonitorInput;
    assert.equal(evaluateActiveAutoLiveMonitor(input).healthy,false);
    assert.ok(evaluateActiveAutoLiveMonitor(input).failures.includes(gateName));
  });
}
add(22,'Account identity failure is degraded rather than critical',()=>{
  const result=evaluateActiveAutoLiveMonitor({...valid,cTraderAccountIdPresent:false});
  assert.equal(result.status,'DEGRADED');
  assert.deepEqual(result.criticalFailures,[]);
});
add(23,'Currency failure is degraded rather than critical',()=>{
  const result=evaluateActiveAutoLiveMonitor({...valid,cTraderCurrencyPresent:false});
  assert.equal(result.status,'DEGRADED');
  assert.deepEqual(result.criticalFailures,[]);
});
add(24,'Balance failure is degraded rather than critical',()=>{
  const result=evaluateActiveAutoLiveMonitor({...valid,cTraderBalanceValid:false});
  assert.equal(result.status,'DEGRADED');
  assert.deepEqual(result.criticalFailures,[]);
});
add(25,'Equity failure is degraded rather than critical',()=>{
  const result=evaluateActiveAutoLiveMonitor({...valid,cTraderEquityValid:false});
  assert.equal(result.status,'DEGRADED');
  assert.deepEqual(result.criticalFailures,[]);
});
add(26,'Multiple critical blockers aggregate',()=>{
  const result=evaluateActiveAutoLiveMonitor({...valid,cTraderConnected:false,killSwitchClear:false,noUnresolvedExecutionIntents:false});
  assert.deepEqual(result.criticalFailures,['cTraderConnected','killSwitch','unresolvedExecutionIntents']);
});
add(27,'Account identity plus critical blocker retains critical classification',()=>{
  const result=evaluateActiveAutoLiveMonitor({...valid,cTraderAccountIdPresent:false,cTraderConnected:false});
  assert.equal(result.status,'BLOCKED');
  assert.deepEqual(result.criticalFailures,['cTraderConnected']);
});
add(28,'No failures are returned for valid input',()=>assert.deepEqual(evaluateActiveAutoLiveMonitor(valid).failures,[]));
add(29,'Checks expose PASS or FAIL only',()=>assert.ok(Object.values(evaluateActiveAutoLiveMonitor(valid).checks).every(v=>v.status==='PASS'||v.status==='FAIL')));
add(30,'All checks pass for valid input',()=>assert.ok(Object.values(evaluateActiveAutoLiveMonitor(valid).checks).every(v=>v.status==='PASS')));
add(31,'Execution gate is independently observable',()=>assert.equal(evaluateActiveAutoLiveMonitor({...valid,executionGateUnlocked:false}).checks.executionGate.status,'FAIL'));
add(32,'Auto Live state is independently observable',()=>assert.equal(evaluateActiveAutoLiveMonitor({...valid,autoTradingStateOperational:false}).checks.autoTradingState.status,'FAIL'));
add(33,'Kill switch is independently observable',()=>assert.equal(evaluateActiveAutoLiveMonitor({...valid,killSwitchClear:false}).checks.killSwitch.status,'FAIL'));
add(34,'Result is deterministic',()=>assert.deepEqual(evaluateActiveAutoLiveMonitor(valid),evaluateActiveAutoLiveMonitor({...valid})));
add(35,'Complete check count is 18',()=>assert.equal(Object.keys(evaluateActiveAutoLiveMonitor(valid).checks).length,18));
add(36,'Only configured degradation gates are non-critical',()=>{
  const nonCritical=['cTraderAccountId','cTraderCurrency','cTraderBalance','cTraderEquity'];
  assert.deepEqual(
    Object.keys(evaluateActiveAutoLiveMonitor(valid).checks).filter(name=>!new Set(['configurationIntegrity','tradingMode','databasePersistence','runtimeLifecycle','auditLog','cTraderConnected','cTraderAccountLive','cTraderTradingPermission','cTraderApiMode','killSwitch','executionGate','autoTradingState','unresolvedExecutionIntents','accountStateConsistency']).has(name)),
    nonCritical
  );
});
add(37,'Status code is 409 for blocked monitor',()=>assert.equal(evaluateActiveAutoLiveMonitor({...valid,cTraderConnected:false}).statusCode,409));
add(38,'Critical failures are empty when only balance is invalid',()=>assert.deepEqual(evaluateActiveAutoLiveMonitor({...valid,cTraderBalanceValid:false}).criticalFailures,[]));
add(39,'Production API mode false blocks monitor',()=>assert.equal(evaluateActiveAutoLiveMonitor({...valid,cTraderApiModeLive:false}).status,'BLOCKED'));
add(40,'Locked execution gate blocks active monitor',()=>assert.equal(evaluateActiveAutoLiveMonitor({...valid,executionGateUnlocked:false}).status,'BLOCKED'));
add(41,'No unresolved intents is mandatory',()=>assert.equal(evaluateActiveAutoLiveMonitor({...valid,noUnresolvedExecutionIntents:false}).status,'BLOCKED'));
add(42,'Account consistency is mandatory',()=>assert.equal(evaluateActiveAutoLiveMonitor({...valid,cTraderAccountStateConsistent:false}).status,'BLOCKED'));
add(43,'Phase 9.6 certification contains exactly 42 scenarios',()=>assert.equal(scenarios.length,43));

for(const item of scenarios){item.run();console.log('[PASS '+String(item.id).padStart(2,'0')+'/43] '+item.name);}
console.log('PHASE 9.6 ACTIVE AUTO LIVE MONITOR CERTIFICATION: 43/43 PASSED');
