import assert from 'node:assert/strict';
const { evaluateSystemConfigIntegrity } = await import('../src/services/configIntegrityService');
const { getSystemConfig } = await import('../src/services/configService');

const base = getSystemConfig();
const scenarios:Array<{id:number;name:string;run:()=>void}> = [];
const add=(id:number,name:string,run:()=>void)=>scenarios.push({id,name,run});
const check=(patch:any)=>evaluateSystemConfigIntegrity({...base,...patch});

add(1,'Default configuration is valid',()=>assert.equal(evaluateSystemConfigIntegrity(base).ok,true));
add(2,'Default trading mode is LIVE_ONLY',()=>assert.equal(base.tradingMode,'LIVE_ONLY'));
add(3,'Default cTrader API mode is supported',()=>assert.ok(base.cTraderApiMode==='LIVE'||base.cTraderApiMode==='DEMO'));
add(4,'Default liveTradingEnabled is boolean',()=>assert.equal(typeof base.liveTradingEnabled,'boolean'));
add(5,'Default risk percentage is valid',()=>assert.equal(check({}).checks.defaultRiskPct,'PASS'));
add(6,'Default daily loss percentage is valid',()=>assert.equal(check({}).checks.maxDailyLossPct,'PASS'));
add(7,'Default max open positions is valid',()=>assert.equal(check({}).checks.maxOpenPositions,'PASS'));
add(8,'Default max trades per day is valid',()=>assert.equal(check({}).checks.maxTradesPerDay,'PASS'));
add(9,'Default max consecutive losses is valid',()=>assert.equal(check({}).checks.maxConsecutiveLosses,'PASS'));
add(10,'Default spread limit is valid',()=>assert.equal(check({}).checks.maxSpreadBps,'PASS'));
add(11,'Default signal cooldown is valid',()=>assert.equal(check({}).checks.signalCooldownMs,'PASS'));
add(12,'Default event proximity threshold is valid',()=>assert.equal(check({}).checks.eventProximityThresholdMinutes,'PASS'));
add(13,'Default strike depth is valid',()=>assert.equal(check({}).checks.strikeDepth,'PASS'));
add(14,'Default Forex maximum trade value is valid',()=>assert.equal(check({}).checks.maxTradeValueForexUsd,'PASS'));
add(15,'Default Indian maximum trade value is valid',()=>assert.equal(check({}).checks.maxTradeValueIndianInr,'PASS'));
add(16,'Default Auto Live minimum score is valid',()=>assert.equal(check({}).checks.autoLiveMinSignalScore,'PASS'));
add(17,'Default Auto Live pair limit is valid',()=>assert.equal(check({}).checks.autoLiveMaxTradesPerPair,'PASS'));
add(18,'Default Forex stop loss is valid',()=>assert.equal(check({}).checks.forexStopLossPips,'PASS'));
add(19,'Default Forex take profit is valid',()=>assert.equal(check({}).checks.forexTakeProfitPips,'PASS'));
add(20,'Default Forex pair list is valid',()=>assert.equal(check({}).checks.autoLiveForexPairs,'PASS'));

add(21,'Trading mode other than LIVE_ONLY fails',()=>assert.equal(check({tradingMode:'DEMO'}).ok,false));
add(22,'Invalid cTrader API mode fails',()=>assert.equal(check({cTraderApiMode:'PAPER'}).ok,false));
add(23,'Risk percentage zero fails',()=>assert.equal(check({defaultRiskPct:0}).ok,false));
add(24,'Risk percentage above 100 fails',()=>assert.equal(check({defaultRiskPct:100.1}).ok,false));
add(25,'Daily loss percentage zero fails',()=>assert.equal(check({maxDailyLossPct:0}).ok,false));
add(26,'Daily loss percentage above 100 fails',()=>assert.equal(check({maxDailyLossPct:101}).ok,false));
add(27,'Max open positions zero fails',()=>assert.equal(check({maxOpenPositions:0}).ok,false));
add(28,'Max open positions fractional fails',()=>assert.equal(check({maxOpenPositions:1.5}).ok,false));
add(29,'Max trades per day zero fails',()=>assert.equal(check({maxTradesPerDay:0}).ok,false));
add(30,'Max trades per day fractional fails',()=>assert.equal(check({maxTradesPerDay:1.5}).ok,false));

add(31,'Max consecutive losses zero fails',()=>assert.equal(check({maxConsecutiveLosses:0}).ok,false));
add(32,'Negative spread limit fails',()=>assert.equal(check({maxSpreadBps:-1}).ok,false));
add(33,'Zero signal cooldown fails',()=>assert.equal(check({signalCooldownMs:0}).ok,false));
add(34,'Negative event proximity fails',()=>assert.equal(check({eventProximityThresholdMinutes:-1}).ok,false));
add(35,'Strike depth zero fails',()=>assert.equal(check({strikeDepth:0}).ok,false));
add(36,'Forex maximum trade value zero fails',()=>assert.equal(check({maxTradeValueForexUsd:0}).ok,false));
add(37,'Forex maximum trade value decimal passes',()=>assert.equal(check({maxTradeValueForexUsd:1.5}).ok,true));
add(38,'Indian maximum trade value zero fails',()=>assert.equal(check({maxTradeValueIndianInr:0}).ok,false));
add(39,'Auto Live minimum score above 100 fails',()=>assert.equal(check({autoLiveMinSignalScore:101}).ok,false));
add(40,'Auto Live pair limit zero fails',()=>assert.equal(check({autoLiveMaxTradesPerPair:0}).ok,false));

add(41,'Forex stop loss zero fails',()=>assert.equal(check({forexStopLossPips:0}).ok,false));
add(42,'Forex take profit zero fails',()=>assert.equal(check({forexTakeProfitPips:0}).ok,false));
add(43,'Empty Forex pair list fails',()=>assert.equal(check({autoLiveForexPairs:[]}).ok,false));
add(44,'Malformed Forex pair fails',()=>assert.equal(check({autoLiveForexPairs:['EURUSD']}).ok,false));
add(45,'Lowercase Forex pair fails',()=>assert.equal(check({autoLiveForexPairs:['eur/usd']}).ok,false));
add(46,'Mixed malformed Forex list fails',()=>assert.equal(check({autoLiveForexPairs:['EUR/USD','BAD']}).ok,false));
add(47,'Empty Indian underlying list fails',()=>assert.equal(check({autoLiveIndianUnderlyings:[]}).ok,false));
add(48,'Malformed Indian underlying fails',()=>assert.equal(check({autoLiveIndianUnderlyings:['NIFTY 50']}).ok,false));
add(49,'Non-array Forex list fails',()=>assert.equal(check({autoLiveForexPairs:'EUR/USD'}).ok,false));
add(50,'Non-array Indian list fails',()=>assert.equal(check({autoLiveIndianUnderlyings:'NIFTY'}).ok,false));

add(51,'Empty financial disclaimer fails',()=>assert.equal(check({financialDisclaimer:''}).ok,false));
add(52,'Whitespace financial disclaimer fails',()=>assert.equal(check({financialDisclaimer:'   '}).ok,false));
add(53,'NaN risk fails',()=>assert.equal(check({defaultRiskPct:NaN}).ok,false));
add(54,'Infinite trade value fails',()=>assert.equal(check({maxTradeValueForexUsd:Infinity}).ok,false));
add(55,'String risk fails',()=>assert.equal(check({defaultRiskPct:'1'}).ok,false));
add(56,'String max positions fails',()=>assert.equal(check({maxOpenPositions:'5'}).ok,false));
add(57,'Boolean stop loss fails',()=>assert.equal(check({forexStopLossPips:true}).ok,false));
add(58,'Duplicate pair entries remain structurally acceptable',()=>assert.equal(check({autoLiveForexPairs:['EUR/USD','EUR/USD']}).checks.autoLiveForexPairs,'PASS'));
add(59,'Valid alphanumeric Indian symbols pass',()=>assert.equal(check({autoLiveIndianUnderlyings:['NIFTY','BANKNIFTY','MIDCPNIFTY']}).checks.autoLiveIndianUnderlyings,'PASS'));
add(60,'Integrity returns explicit failure names',()=>{const r=check({tradingMode:'DEMO',maxOpenPositions:0});assert.ok(r.failures.includes('tradingMode'));assert.ok(r.failures.includes('maxOpenPositions'));});

console.log('=========================================================================');
console.log('PHASE 8.16 — PRODUCTION CONFIGURATION INTEGRITY CERTIFICATION');
console.log('60 deterministic configuration-safety scenarios');
console.log('=========================================================================');
assert.equal(scenarios.length,60);
for(const item of scenarios){ item.run(); console.log('[PASS '+String(item.id).padStart(2,'0')+'/60] '+item.name); }
console.log('=========================================================================');
console.log('PHASE 8.16 CERTIFICATION: 60/60 PASSED');
console.log('Configuration structure validation: VERIFIED');
console.log('Numeric safety bounds: VERIFIED');
console.log('Forex universe validation: VERIFIED');
console.log('LIVE_ONLY mode boundary: VERIFIED');
console.log('cTrader LIVE/DEMO selector compatibility: VERIFIED');
console.log('=========================================================================');