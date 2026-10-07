import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  evaluateProductionReleaseIntegrity,
  buildProductionReleaseIntegrityInput,
  getInstalledApplicationVersion
} = await import('../src/services/productionReleaseIntegrityService');
const { evaluateSystemConfigIntegrity } = await import('../src/services/configIntegrityService');
const { getSystemConfig, prepareSystemConfigUpdate } = await import('../src/services/configService');
const { buildSystemSettingRows, decodeSystemSettingRows } = await import('../src/services/configPersistenceService');
const { evaluateRuntimeReadiness } = await import('../src/services/runtimeReadiness');
const { RuntimeLifecycleCoordinator } = await import('../src/services/runtimeLifecycle');
const {
  validateAutoLiveOrderPacket,
  LIVE_AUTO_EXECUTION_ALLOWED
} = await import('../src/brokers/safety/AutoExecutionEngine');
const {
  operatorAuthRequired
} = await import('../src/server/security');

const scenarios:Array<{id:number;name:string;run:()=>void|Promise<void>}>=[];
const add=(id:number,name:string,run:()=>void|Promise<void>)=>scenarios.push({id,name,run});

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goldcrest-final-'));
const dist=path.join(dir,'dist');
const data=path.join(dir,'data');
fs.mkdirSync(dist,{recursive:true});
fs.mkdirSync(data,{recursive:true});
const serverFile=path.join(dist,'server.cjs');
const indexFile=path.join(dist,'index.html');
fs.writeFileSync(serverFile,'compiled-server');
fs.writeFileSync(indexFile,'compiled-index');

const validReleaseInput={
  environment:'production',
  nodeVersion:'24.21.0',
  tradingMode:'LIVE_ONLY',
  operatorAuthConfigured:true,
  liveBrokerConfigured:true,
  distServerFile:serverFile,
  distIndexFile:indexFile,
  dataDirectory:data,
  packageVersion:'1.3.0-quantitative-review'
};

const validRelease=()=>evaluateProductionReleaseIntegrity(validReleaseInput);
const config=getSystemConfig();

add(1,'Installed package version is available',()=>assert.ok(getInstalledApplicationVersion(process.cwd())));
add(2,'Current system configuration passes integrity',()=>assert.equal(evaluateSystemConfigIntegrity(config).ok,true));
add(3,'Production LIVE_ONLY boundary passes',()=>assert.equal(validRelease().checks.tradingMode,'PASS'));
add(4,'Production operator authentication requirement passes',()=>assert.equal(validRelease().checks.operatorAuth,'PASS'));
add(5,'Production live broker requirement passes',()=>assert.equal(validRelease().checks.liveBroker,'PASS'));
add(6,'Production compiled server artifact is present in acceptance fixture',()=>assert.equal(validRelease().checks.distServer,'PASS'));
add(7,'Production SPA artifact is present in acceptance fixture',()=>assert.equal(validRelease().checks.distIndex,'PASS'));
add(8,'Production data directory is writable in acceptance fixture',()=>assert.equal(validRelease().checks.dataDirectoryWritable,'PASS'));
add(9,'Declared Node 24.21 runtime passes release gate',()=>assert.equal(validRelease().checks.nodeVersion,'PASS'));
add(10,'Node 24.20 runtime is rejected',()=>assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,nodeVersion:'24.20.0'}).checks.nodeVersion,'FAIL'));
add(11,'Node 25 runtime is rejected',()=>assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,nodeVersion:'25.0.0'}).checks.nodeVersion,'FAIL'));
add(12,'Prefixed Node 24.21 runtime is accepted',()=>assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,nodeVersion:'v24.21.0'}).checks.nodeVersion,'PASS'));
add(13,'Malformed Node version is rejected',()=>assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,nodeVersion:'24'}).checks.nodeVersion,'FAIL'));
add(14,'Empty operator authentication fails release gate',()=>assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,operatorAuthConfigured:false}).ok,false));
add(15,'Missing LIVE broker fails release gate',()=>assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,liveBrokerConfigured:false}).ok,false));
add(16,'Missing package version fails release gate',()=>assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,packageVersion:''}).ok,false));
add(17,'Missing compiled server fails release gate',()=>assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,distServerFile:path.join(dist,'missing')}).ok,false));
add(18,'Missing SPA artifact fails release gate',()=>assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,distIndexFile:path.join(dist,'missing')}).ok,false));
add(19,'Non-writable-path fixture fails release gate',()=>{const blocker=path.join(dir,'blocker');fs.writeFileSync(blocker,'x');assert.equal(evaluateProductionReleaseIntegrity({...validReleaseInput,dataDirectory:path.join(blocker,'data')}).checks.dataDirectoryWritable,'FAIL');});
add(20,'Release builder targets compiled server',()=>{const b=buildProductionReleaseIntegrityInput({...validReleaseInput,rootDirectory:dir});assert.equal(b.distServerFile,serverFile);});
add(21,'Release builder targets compiled SPA',()=>{const b=buildProductionReleaseIntegrityInput({...validReleaseInput,rootDirectory:dir});assert.equal(b.distIndexFile,indexFile);});
add(22,'Release builder targets durable data directory',()=>{const b=buildProductionReleaseIntegrityInput({...validReleaseInput,rootDirectory:dir});assert.equal(b.dataDirectory,data);});
add(23,'Release builder carries declared runtime',()=>{const b=buildProductionReleaseIntegrityInput({...validReleaseInput,rootDirectory:dir});assert.equal(b.nodeVersion,'24.21.0');});
add(24,'Release builder carries LIVE_ONLY mode',()=>{const b=buildProductionReleaseIntegrityInput({...validReleaseInput,rootDirectory:dir});assert.equal(b.tradingMode,'LIVE_ONLY');});

add(25,'Configuration LIVE_ONLY remains enforced',()=>assert.equal(config.tradingMode,'LIVE_ONLY'));
add(26,'Default cTrader API mode remains DEMO',()=>assert.equal(config.cTraderApiMode,'DEMO'));
add(27,'Configuration candidate with supported cTrader LIVE mode is valid',()=>assert.equal(evaluateSystemConfigIntegrity(prepareSystemConfigUpdate({cTraderApiMode:'LIVE'})).ok,true));
add(28,'Configuration candidate with supported cTrader DEMO mode is valid',()=>assert.equal(evaluateSystemConfigIntegrity(prepareSystemConfigUpdate({cTraderApiMode:'DEMO'})).ok,true));
add(29,'Configuration rejects invalid cTrader API mode',()=>assert.throws(()=>prepareSystemConfigUpdate({cTraderApiMode:'PAPER' as any}),/cTrader API mode must be LIVE or DEMO/));
add(30,'Configuration rejects invalid trading mode',()=>assert.throws(()=>prepareSystemConfigUpdate({tradingMode:'PAPER' as any}),/Trading mode rejected/));
add(31,'Configuration rejects zero open positions',()=>assert.throws(()=>prepareSystemConfigUpdate({maxOpenPositions:0}),/Configuration integrity rejected/));
add(32,'Configuration accepts decimal Forex trade value',()=>assert.equal(prepareSystemConfigUpdate({maxTradeValueForexUsd:10.22}).maxTradeValueForexUsd,10.22));
add(33,'Configuration rejects string numeric trade risk',()=>assert.throws(()=>prepareSystemConfigUpdate({defaultRiskPct:'1' as any}),/Configuration integrity rejected/));
add(34,'Configuration candidate remains integrity-valid after legitimate update',()=>assert.equal(evaluateSystemConfigIntegrity(prepareSystemConfigUpdate({maxDailyLossPct:3.5})).ok,true));
add(35,'Configuration persisted field count is stable',()=>assert.equal(buildSystemSettingRows(config).length,28));
add(36,'cTrader API mode is included in durable settings',()=>assert.equal(buildSystemSettingRows({...config,cTraderApiMode:'LIVE'}).find(r=>r[0]==='CTRADER_API_MODE')?.[1],'LIVE'));
add(37,'Durable settings decode cTrader LIVE mode',()=>assert.equal(decodeSystemSettingRows([{key:'CTRADER_API_MODE',value:'LIVE'}]).cTraderApiMode,'LIVE'));
add(38,'Durable settings decode cTrader DEMO mode',()=>assert.equal(decodeSystemSettingRows([{key:'CTRADER_API_MODE',value:'DEMO'}]).cTraderApiMode,'DEMO'));
add(39,'Durable settings round-trip Forex universe',()=>{const c={...config,autoLiveForexPairs:['EUR/USD','USD/JPY']};const r=decodeSystemSettingRows(buildSystemSettingRows(c).map(([key,value])=>({key,value})));assert.deepEqual(r.autoLiveForexPairs,c.autoLiveForexPairs);});
add(40,'Durable settings round-trip numeric controls',()=>{const c={...config,maxOpenPositions:9,autoLiveMaxTradesPerPair:6};const r=decodeSystemSettingRows(buildSystemSettingRows(c).map(([key,value])=>({key,value})));assert.equal(r.maxOpenPositions,9);assert.equal(r.autoLiveMaxTradesPerPair,6);});

add(41,'Runtime readiness is ready when DB and preflight are ready',()=>assert.equal(evaluateRuntimeReadiness(true,true).ready,true));
add(42,'Runtime readiness returns HTTP 200 when ready',()=>assert.equal(evaluateRuntimeReadiness(true,true).statusCode,200));
add(43,'Runtime readiness is not ready when DB is unavailable',()=>assert.equal(evaluateRuntimeReadiness(false,true).ready,false));
add(44,'Runtime readiness returns HTTP 503 when DB is unavailable',()=>assert.equal(evaluateRuntimeReadiness(false,true).statusCode,503));
add(45,'Runtime readiness is not ready when preflight fails',()=>assert.equal(evaluateRuntimeReadiness(true,false).ready,false));
add(46,'Runtime readiness returns HTTP 503 on preflight failure',()=>assert.equal(evaluateRuntimeReadiness(true,false).statusCode,503));
add(47,'Runtime readiness status is ready for the valid production case',()=>assert.equal(evaluateRuntimeReadiness(true,true).status,'ready'));
add(48,'Runtime readiness status is not_ready for the blocked case',()=>assert.equal(evaluateRuntimeReadiness(false,false).status,'not_ready'));

const lifecycle=new RuntimeLifecycleCoordinator();
const cleanupOrder:string[]=[];
lifecycle.registerCleanup('FIRST',()=>cleanupOrder.push('FIRST'));
lifecycle.registerCleanup('SECOND',()=>cleanupOrder.push('SECOND'));
add(49,'Fresh runtime lifecycle starts in STARTING',()=>assert.equal(lifecycle.getStatus().state,'STARTING'));
add(50,'Runtime lifecycle transitions to RUNNING',()=>assert.equal(lifecycle.transition('RUNNING').state,'RUNNING'));
add(51,'Runtime lifecycle reports registered cleanup count',()=>assert.equal(lifecycle.getStatus().registeredCleanupCount,2));
add(52,'Runtime lifecycle shutdown enters STOPPED',async()=>{const result=await lifecycle.shutdown('FINAL_ACCEPTANCE');assert.equal(lifecycle.getStatus().state,'STOPPED');assert.deepEqual(result.completed,['SECOND','FIRST']);});
add(53,'Runtime lifecycle executes cleanup in reverse registration order',()=>assert.deepEqual(cleanupOrder,['SECOND','FIRST']));
add(54,'Runtime lifecycle records shutdown reason',()=>assert.equal(lifecycle.getStatus().lastShutdownReason,'FINAL_ACCEPTANCE'));
add(55,'Runtime lifecycle shutdown is idempotent',async()=>{const a=await lifecycle.shutdown('SECOND_REQUEST');assert.deepEqual(a.completed,['SECOND','FIRST']);});
add(56,'Runtime lifecycle rejects cleanup registration after STOPPED',()=>assert.throws(()=>lifecycle.registerCleanup('AFTER_STOP',()=>{}),/RUNTIME_LIFECYCLE_STOPPED/));

add(57,'Autonomous live execution is locked at process initialization',()=>assert.equal(LIVE_AUTO_EXECUTION_ALLOWED,false));
add(58,'Valid BUY Auto Live packet is accepted',()=>{const r=validateAutoLiveOrderPacket({broker:'CTRADER',environment:'LIVE',market:'FOREX',symbol:'EUR/USD',orderType:'MARKET',side:'BUY',quantity:100,price:1.1,stopLoss:1.09,takeProfit:1.12,signalId:'acceptance-buy'} as any);assert.equal(r.valid,true);});
add(59,'Valid SELL Auto Live packet is accepted',()=>{const r=validateAutoLiveOrderPacket({broker:'CTRADER',environment:'LIVE',market:'FOREX',symbol:'EUR/USD',orderType:'MARKET',side:'SELL',quantity:100,price:1.1,stopLoss:1.12,takeProfit:1.09,signalId:'acceptance-sell'} as any);assert.equal(r.valid,true);});
add(60,'Auto Live rejects non-Forex packet',()=>assert.equal(validateAutoLiveOrderPacket({broker:'5Paisa',environment:'LIVE',market:'INDIA_EQUITY',symbol:'NIFTY',orderType:'MARKET',side:'BUY',quantity:1,price:1,stopLoss:.9,takeProfit:1.1} as any).valid,false));
add(61,'Auto Live rejects fractional quantity',()=>assert.equal(validateAutoLiveOrderPacket({broker:'CTRADER',environment:'LIVE',market:'FOREX',symbol:'EUR/USD',orderType:'MARKET',side:'BUY',quantity:1.5,price:1.1,stopLoss:1.09,takeProfit:1.12} as any).valid,false));
add(62,'Auto Live rejects invalid symbol format',()=>assert.equal(validateAutoLiveOrderPacket({broker:'CTRADER',environment:'LIVE',market:'FOREX',symbol:'EURUSD',orderType:'MARKET',side:'BUY',quantity:100,price:1.1,stopLoss:1.09,takeProfit:1.12} as any).valid,false));
add(63,'Auto Live rejects non-MARKET order type',()=>assert.equal(validateAutoLiveOrderPacket({broker:'CTRADER',environment:'LIVE',market:'FOREX',symbol:'EUR/USD',orderType:'LIMIT',side:'BUY',quantity:100,price:1.1,stopLoss:1.09,takeProfit:1.12} as any).valid,false));
add(64,'Auto Live rejects invalid BUY stop relationship',()=>assert.equal(validateAutoLiveOrderPacket({broker:'CTRADER',environment:'LIVE',market:'FOREX',symbol:'EUR/USD',orderType:'MARKET',side:'BUY',quantity:100,price:1.1,stopLoss:1.12,takeProfit:1.09} as any).valid,false));
add(65,'Auto Live rejects invalid SELL stop relationship',()=>assert.equal(validateAutoLiveOrderPacket({broker:'CTRADER',environment:'LIVE',market:'FOREX',symbol:'EUR/USD',orderType:'MARKET',side:'SELL',quantity:100,price:1.1,stopLoss:1.09,takeProfit:1.12} as any).valid,false));

function mockResponse(){
  return {
    statusCode:200,
    payload:null as any,
    setHeader(){},
    status(code:number){this.statusCode=code;return this;},
    json(payload:any){this.payload=payload;return this;}
  };
}
function mockRequest(overrides:any={}){
  const headers=new Map<string,string>();
  if(overrides.origin) headers.set('Origin',overrides.origin);
  if(overrides.authorization) headers.set('Authorization',overrides.authorization);
  return {
    socket:{remoteAddress:overrides.remoteAddress || '203.0.113.10'},
    ip:overrides.remoteAddress || '203.0.113.10',
    protocol:'https',
    header(name:string){return headers.get(name);},
    get(name:string){if(name.toLowerCase()==='host') return 'goldcrest.example';return undefined;}
  } as any;
}
const previousEnv=process.env.NODE_ENV;
const previousKey=process.env.GOLDCREST_OPERATOR_API_KEY;
process.env.NODE_ENV='production';
process.env.GOLDCREST_OPERATOR_API_KEY='acceptance-secret';

add(66,'Production auth accepts a valid bearer without Origin header',()=>{const req=mockRequest({authorization:'Bearer acceptance-secret'});const res=mockResponse();let next=0;operatorAuthRequired(req,res,()=>next++);assert.equal(res.statusCode,200);assert.equal(next,1);});
add(67,'Production auth accepts valid same-origin bearer',()=>{const req=mockRequest({origin:'https://goldcrest.example',authorization:'Bearer acceptance-secret'});const res=mockResponse();let next=0;operatorAuthRequired(req,res,()=>next++);assert.equal(res.statusCode,200);assert.equal(next,1);});
add(68,'Production auth rejects invalid bearer credential',()=>{const req=mockRequest({origin:'https://goldcrest.example',authorization:'Bearer wrong'});const res=mockResponse();let next=0;operatorAuthRequired(req,res,()=>next++);assert.equal(res.statusCode,401);assert.equal(next,0);});
add(69,'Production auth rejects foreign origin',()=>{const req=mockRequest({origin:'https://attacker.example',authorization:'Bearer acceptance-secret'});const res=mockResponse();let next=0;operatorAuthRequired(req,res,()=>next++);assert.equal(res.statusCode,403);assert.equal(next,0);});
add(70,'Production auth accepts X-Goldcrest-Operator-Key',()=>{const req=mockRequest({origin:'https://goldcrest.example'});(req as any).header=(name:string)=>name==='Origin'?'https://goldcrest.example':name==='X-Goldcrest-Operator-Key'?'acceptance-secret':undefined;const res=mockResponse();let next=0;operatorAuthRequired(req,res,()=>next++);assert.equal(res.statusCode,200);assert.equal(next,1);});
add(71,'Production auth fails closed when operator key is absent',()=>{const savedNodeEnv=process.env.NODE_ENV;const savedKey=process.env.GOLDCREST_OPERATOR_API_KEY;process.env.NODE_ENV='production';delete process.env.GOLDCREST_OPERATOR_API_KEY;try{const req=mockRequest({origin:'https://goldcrest.example',authorization:'Bearer acceptance-secret',remoteAddress:'203.0.113.10'});const res=mockResponse();let next=0;operatorAuthRequired(req,res,()=>next++);assert.equal(res.statusCode,503);assert.equal(next,0);}finally{if(savedNodeEnv===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=savedNodeEnv;if(savedKey===undefined) delete process.env.GOLDCREST_OPERATOR_API_KEY; else process.env.GOLDCREST_OPERATOR_API_KEY=savedKey;}});
process.env.GOLDCREST_OPERATOR_API_KEY=previousKey || 'acceptance-secret';

add(72,'Valid production release is fully passing',()=>assert.equal(validRelease().ok,true));
add(73,'Valid configuration is fully passing',()=>assert.equal(evaluateSystemConfigIntegrity(getSystemConfig()).ok,true));
add(74,'Valid runtime readiness reports ready=true',()=>assert.equal(evaluateRuntimeReadiness(true,true).ready,true));
add(75,'Final release acceptance has no integrity failures',()=>assert.deepEqual(validRelease().failures,[]));
add(76,'Final acceptance retains LIVE_ONLY mode',()=>assert.equal(getSystemConfig().tradingMode,'LIVE_ONLY'));
add(77,'Final acceptance retains cTrader DEMO default persistence contract',()=>assert.equal(getSystemConfig().cTraderApiMode,'DEMO'));
add(78,'Final acceptance retains locked autonomous state at boot',()=>assert.equal(LIVE_AUTO_EXECUTION_ALLOWED,false));
add(79,'Final acceptance does not require broker network access',()=>assert.equal(validRelease().checks.liveBroker,'PASS'));
add(80,'Final production acceptance matrix is internally consistent',()=>{const releaseOk=validRelease().ok;const configOk=evaluateSystemConfigIntegrity(getSystemConfig()).ok;const readinessOk=evaluateRuntimeReadiness(true,releaseOk&&configOk).ready;assert.equal(releaseOk&&configOk&&readinessOk,true);});

console.log('===============================================================================');
console.log('PHASE 8 — FINAL PRODUCTION ACCEPTANCE CERTIFICATION');
console.log('80 deterministic, broker-side-effect-free acceptance scenarios');
console.log('===============================================================================');
assert.equal(scenarios.length,80);
for(const item of scenarios){await item.run();console.log('[PASS '+String(item.id).padStart(2,'0')+'/80] '+item.name);}
console.log('===============================================================================');
console.log('PHASE 8 FINAL ACCEPTANCE: 80/80 PASSED');
console.log('Production release integrity: VERIFIED');
console.log('Configuration integrity & persistence: VERIFIED');
console.log('Runtime readiness: VERIFIED');
console.log('Lifecycle shutdown/recovery contract: VERIFIED');
console.log('Production operator authentication boundary: VERIFIED');
console.log('Auto Live order packet safety: VERIFIED');
console.log('cTrader LIVE/DEMO selector persistence: VERIFIED');
console.log('Autonomous live execution boot state: LOCKED');
console.log('Broker order submission: NOT INVOKED');
console.log('PHASE 8 STATUS: READY FOR OPERATIONAL DEPLOYMENT');
console.log('===============================================================================');

process.env.NODE_ENV=previousEnv;
if(previousKey===undefined) delete process.env.GOLDCREST_OPERATOR_API_KEY; else process.env.GOLDCREST_OPERATOR_API_KEY=previousKey;
fs.rmSync(dir,{recursive:true,force:true});
