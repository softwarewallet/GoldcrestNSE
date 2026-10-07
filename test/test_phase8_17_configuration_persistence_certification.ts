import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldcrest-phase8-17-'));
process.env.GOLDCREST_CONFIG_DIR = tempDir;
process.env.GOLDCREST_CONFIG_FILE = path.join(tempDir, 'system-config.json');

const {
  getSystemConfig,
  prepareSystemConfigUpdate,
  updateSystemConfig,
  persistSystemConfig,
  loadPersistedSystemConfig
} = await import('../src/services/configService');
const {
  buildSystemSettingRows,
  decodeSystemSettingRows
} = await import('../src/services/configPersistenceService');
const { evaluateSystemConfigIntegrity } = await import('../src/services/configIntegrityService');

const base = getSystemConfig();
const scenarios: Array<{id:number; name:string; run:()=>void|Promise<void>}> = [];
const add=(id:number,name:string,run:()=>void|Promise<void>)=>scenarios.push({id,name,run});

add(1,'Fresh isolated configuration is valid',()=>assert.equal(evaluateSystemConfigIntegrity(base).ok,true));
add(2,'Default trading mode is LIVE_ONLY',()=>assert.equal(base.tradingMode,'LIVE_ONLY'));
add(3,'Default cTrader API mode is DEMO',()=>assert.equal(base.cTraderApiMode,'DEMO'));
add(4,'Preparation preserves unrelated settings',()=>{const next=prepareSystemConfigUpdate({maxOpenPositions:9});assert.equal(next.maxOpenPositions,9);assert.equal(next.maxTradesPerDay,base.maxTradesPerDay);});
add(5,'Preparation does not write the JSON fallback',()=>{assert.equal(fs.existsSync(process.env.GOLDCREST_CONFIG_FILE!),false);});
add(6,'Prepared configuration passes integrity',()=>assert.equal(evaluateSystemConfigIntegrity(prepareSystemConfigUpdate({defaultRiskPct:1.25})).ok,true));
add(7,'Invalid trading mode is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({tradingMode:'DEMO' as any}),/Trading mode rejected/));
add(8,'Invalid cTrader API mode is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({cTraderApiMode:'PAPER' as any}),/cTrader API mode must be LIVE or DEMO/));
add(9,'Zero max positions is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({maxOpenPositions:0}),/Configuration integrity rejected/));
add(10,'Fractional max positions is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({maxOpenPositions:1.5}),/Configuration integrity rejected/));
add(11,'Empty Forex universe is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({autoLiveForexPairs:[]}),/Configuration integrity rejected/));
add(12,'Malformed Forex universe is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({autoLiveForexPairs:['EURUSD']}),/Configuration integrity rejected/));
add(13,'Empty disclaimer is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({financialDisclaimer:''}),/Configuration integrity rejected/));
add(14,'String numeric risk is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({defaultRiskPct:'1' as any}),/Configuration integrity rejected/));
add(15,'NaN risk is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({defaultRiskPct:Number.NaN}),/Configuration integrity rejected/));
add(16,'Infinite trade value is rejected before persistence',()=>assert.throws(()=>prepareSystemConfigUpdate({maxTradeValueForexUsd:Number.POSITIVE_INFINITY}),/Configuration integrity rejected/));
add(17,'Valid cTrader LIVE mode can be prepared',()=>assert.equal(prepareSystemConfigUpdate({cTraderApiMode:'LIVE'}).cTraderApiMode,'LIVE'));
add(18,'Valid cTrader DEMO mode can be prepared',()=>assert.equal(prepareSystemConfigUpdate({cTraderApiMode:'DEMO'}).cTraderApiMode,'DEMO'));
add(19,'Valid pair list can be prepared',()=>assert.deepEqual(prepareSystemConfigUpdate({autoLiveForexPairs:['EUR/USD','GBP/USD']}).autoLiveForexPairs,['EUR/USD','GBP/USD']));
add(20,'Valid Indian list can be prepared',()=>assert.deepEqual(prepareSystemConfigUpdate({autoLiveIndianUnderlyings:['NIFTY','BANKNIFTY']}).autoLiveIndianUnderlyings,['NIFTY','BANKNIFTY']));
add(21,'System setting row plan contains all persisted fields',()=>assert.equal(buildSystemSettingRows(base).length,22));
add(22,'System setting row plan contains cTrader API mode',()=>assert.equal(buildSystemSettingRows(base).some(row=>row[0]==='CTRADER_API_MODE'),true));
add(23,'System setting row plan contains selected account id',()=>assert.equal(buildSystemSettingRows(base).some(row=>row[0]==='SELECTED_CTRADER_ACCOUNT_ID'),true));
add(24,'System setting row plan contains risk percentage',()=>assert.equal(buildSystemSettingRows(base).some(row=>row[0]==='DEFAULT_RISK_PCT'),true));
add(25,'System setting row plan contains pair universe',()=>assert.equal(buildSystemSettingRows(base).some(row=>row[0]==='AUTO_LIVE_FOREX_PAIRS'),true));
add(26,'System setting row plan serializes Forex pairs as JSON',()=>{const row=buildSystemSettingRows({...base,autoLiveForexPairs:['EUR/USD','USD/JPY']}).find(r=>r[0]==='AUTO_LIVE_FOREX_PAIRS')!;assert.deepEqual(JSON.parse(row[1]),['EUR/USD','USD/JPY']);});
add(27,'System setting row plan serializes Indian underlyings as JSON',()=>{const row=buildSystemSettingRows({...base,autoLiveIndianUnderlyings:['NIFTY','SENSEX']}).find(r=>r[0]==='AUTO_LIVE_INDIAN_UNDERLYINGS')!;assert.deepEqual(JSON.parse(row[1]),['NIFTY','SENSEX']);});
add(28,'System setting row plan serializes cTrader DEMO mode',()=>{const row=buildSystemSettingRows({...base,cTraderApiMode:'DEMO'}).find(r=>r[0]==='CTRADER_API_MODE')!;assert.equal(row[1],'DEMO');});
add(29,'System setting row plan serializes cTrader LIVE mode',()=>{const row=buildSystemSettingRows({...base,cTraderApiMode:'LIVE'}).find(r=>r[0]==='CTRADER_API_MODE')!;assert.equal(row[1],'LIVE');});
add(30,'Numeric system setting is stored as plain text',()=>{const row=buildSystemSettingRows({...base,maxOpenPositions:12}).find(r=>r[0]==='MAX_OPEN_POSITIONS')!;assert.equal(row[1],'12');});
add(31,'Disclaimer is stored as plain text',()=>{const row=buildSystemSettingRows({...base,financialDisclaimer:'A durable disclaimer'}).find(r=>r[0]==='FINANCIAL_DISCLAIMER')!;assert.equal(row[1],'A durable disclaimer');});
add(32,'Decoder restores cTrader mode',()=>{assert.equal(decodeSystemSettingRows([{key:'CTRADER_API_MODE',value:'LIVE'}]).cTraderApiMode,'LIVE');});
add(33,'Decoder restores numeric fields',()=>{assert.equal(decodeSystemSettingRows([{key:'MAX_OPEN_POSITIONS',value:'12'}]).maxOpenPositions,12);});
add(34,'Decoder restores pair arrays',()=>{assert.deepEqual(decodeSystemSettingRows([{key:'AUTO_LIVE_FOREX_PAIRS',value:'["EUR/USD","GBP/USD"]'}]).autoLiveForexPairs,['EUR/USD','GBP/USD']);});
add(35,'Decoder restores Indian arrays',()=>{assert.deepEqual(decodeSystemSettingRows([{key:'AUTO_LIVE_INDIAN_UNDERLYINGS',value:'["NIFTY","BANKNIFTY"]'}]).autoLiveIndianUnderlyings,['NIFTY','BANKNIFTY']);});
add(36,'Decoder ignores unknown settings',()=>{assert.deepEqual(decodeSystemSettingRows([{key:'NOT_A_GOLDCREST_SETTING',value:'x'}]),{});});
add(37,'Decoder ignores malformed pair JSON',()=>{assert.deepEqual(decodeSystemSettingRows([{key:'AUTO_LIVE_FOREX_PAIRS',value:'not-json'}]),{});});
add(38,'Decoder ignores non-string pair array items',()=>{assert.deepEqual(decodeSystemSettingRows([{key:'AUTO_LIVE_FOREX_PAIRS',value:'["EUR/USD",7]'}]),{});});
add(39,'Decoder ignores malformed numeric text',()=>{assert.deepEqual(decodeSystemSettingRows([{key:'MAX_OPEN_POSITIONS',value:'abc'}]),{});});
add(40,'Decoder ignores blank string setting',()=>{assert.deepEqual(decodeSystemSettingRows([{key:'FINANCIAL_DISCLAIMER',value:'   '}]),{});});
add(41,'Full row-plan round trip preserves cTrader mode',()=>{const restored=decodeSystemSettingRows(buildSystemSettingRows({...base,cTraderApiMode:'LIVE'}).map(([key,value])=>({key,value})));assert.equal(restored.cTraderApiMode,'LIVE');});
add(42,'Full row-plan round trip preserves numeric limits',()=>{const candidate={...base,maxOpenPositions:11,maxTradesPerDay:33,maxDailyLossPct:4.5};const restored=decodeSystemSettingRows(buildSystemSettingRows(candidate).map(([key,value])=>({key,value})));assert.equal(restored.maxOpenPositions,11);assert.equal(restored.maxTradesPerDay,33);assert.equal(restored.maxDailyLossPct,4.5);});
add(43,'Full row-plan round trip preserves pair universe',()=>{const candidate={...base,autoLiveForexPairs:['EUR/USD','USD/JPY']};const restored=decodeSystemSettingRows(buildSystemSettingRows(candidate).map(([key,value])=>({key,value})));assert.deepEqual(restored.autoLiveForexPairs,candidate.autoLiveForexPairs);});
add(44,'Full row-plan round trip preserves Indian universe',()=>{const candidate={...base,autoLiveIndianUnderlyings:['NIFTY','SENSEX']};const restored=decodeSystemSettingRows(buildSystemSettingRows(candidate).map(([key,value])=>({key,value})));assert.deepEqual(restored.autoLiveIndianUnderlyings,candidate.autoLiveIndianUnderlyings);});
add(45,'Full row-plan round trip preserves disclaimer',()=>{const candidate={...base,financialDisclaimer:'Round trip verified'};const restored=decodeSystemSettingRows(buildSystemSettingRows(candidate).map(([key,value])=>({key,value})));assert.equal(restored.financialDisclaimer,candidate.financialDisclaimer);});
add(46,'Persisting a valid config creates an atomic JSON fallback',()=>{const candidate=prepareSystemConfigUpdate({maxOpenPositions:8});persistSystemConfig(candidate);assert.equal(fs.existsSync(process.env.GOLDCREST_CONFIG_FILE!),true);assert.equal(fs.existsSync(process.env.GOLDCREST_CONFIG_FILE!+'.tmp'),false);});
add(47,'Persisted JSON stores the committed value',()=>{const raw=JSON.parse(fs.readFileSync(process.env.GOLDCREST_CONFIG_FILE!,'utf8'));assert.equal(raw.maxOpenPositions,8);});
add(48,'Persisted cTrader mode survives JSON serialization',()=>{const candidate=prepareSystemConfigUpdate({cTraderApiMode:'LIVE'});persistSystemConfig(candidate);const raw=JSON.parse(fs.readFileSync(process.env.GOLDCREST_CONFIG_FILE!,'utf8'));assert.equal(raw.cTraderApiMode,'LIVE');});
add(49,'Prepared changes are not committed on rejection',()=>{const before=loadPersistedSystemConfig().maxOpenPositions;assert.throws(()=>prepareSystemConfigUpdate({maxOpenPositions:0}),/Configuration integrity rejected/);assert.equal(loadPersistedSystemConfig().maxOpenPositions,before);});
add(50,'Final configuration remains integrity-valid',()=>assert.equal(evaluateSystemConfigIntegrity(getSystemConfig()).ok,true));

console.log('===========================================================================');
console.log('PHASE 8.17 — CONFIGURATION PERSISTENCE & TRANSACTION CERTIFICATION');
console.log('50 deterministic broker-free configuration persistence scenarios');
console.log('===========================================================================');
assert.equal(scenarios.length,50);
for(const item of scenarios){ await item.run(); console.log('[PASS '+String(item.id).padStart(2,'0')+'/50] '+item.name); }
console.log('===========================================================================');
console.log('PHASE 8.17 CERTIFICATION: 50/50 PASSED');
console.log('Pre-commit configuration validation: VERIFIED');
console.log('SQLite row plan and round-trip encoding: VERIFIED');
console.log('cTrader LIVE/DEMO persistence: VERIFIED');
console.log('Atomic JSON fallback persistence: VERIFIED');
console.log('Rejected configuration does not persist: VERIFIED');
console.log('===========================================================================');

try { fs.rmSync(tempDir,{recursive:true,force:true}); } catch {}
