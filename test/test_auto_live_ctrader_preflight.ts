import assert from 'node:assert/strict';
import { validateAutoLiveCTraderConnection } from '../src/services/autoTradingService';
const demo = await validateAutoLiveCTraderConnection({testConnection:async()=>({broker:'CTRADER',environment:'LIVE',connected:true,apiMode:'DEMO',apiEndpoint:'wss://demo.ctraderapi.com:5036',account:'2001',accountType:'LIVE',balance:100000,equity:100000,currency:'USD',timestamp:Date.now(),latency:12})});
assert.equal(demo.ok,true); assert.equal(demo.result.apiMode,'DEMO'); assert.match(demo.message,/cTrader DEMO API connection preflight passed/);
const live = await validateAutoLiveCTraderConnection({testConnection:async()=>({broker:'CTRADER',environment:'LIVE',connected:true,apiMode:'LIVE',apiEndpoint:'wss://live.ctraderapi.com:5036',account:'1001',accountType:'LIVE',balance:100000,equity:100000,currency:'USD',timestamp:Date.now(),latency:10})});
assert.equal(live.ok,true); assert.equal(live.result.apiMode,'LIVE'); assert.match(live.message,/cTrader LIVE API connection preflight passed/);
const fail = await validateAutoLiveCTraderConnection({testConnection:async()=>({broker:'CTRADER',environment:'LIVE',connected:false,apiMode:'DEMO',apiEndpoint:'wss://demo.ctraderapi.com:5036',account:'****',accountType:'LIVE',error:'No cTrader accounts match the selected DEMO environment.',timestamp:Date.now(),latency:25})});
assert.equal(fail.ok,false); assert.match(fail.message,/DEMO API connection preflight failed/); assert.match(fail.message,/selected DEMO environment/);
console.log('AUTO LIVE cTrader connection preflight tests passed.');
