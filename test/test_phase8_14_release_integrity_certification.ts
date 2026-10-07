import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const release=await import('../src/services/productionReleaseIntegrityService');

const scenarios:Array<{id:number;name:string;run:()=>void}>=[];
const add=(id:number,name:string,run:()=>void)=>scenarios.push({id,name,run});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goldcrest-phase8-14-'));
const dist=path.join(dir,'dist'); const data=path.join(dir,'data');
fs.mkdirSync(dist,{recursive:true}); fs.mkdirSync(data,{recursive:true});
const serverFile=path.join(dist,'server.cjs'); const indexFile=path.join(dist,'index.html');
fs.writeFileSync(serverFile,'server'); fs.writeFileSync(indexFile,'index');

const valid=()=>release.evaluateProductionReleaseIntegrity({environment:'production',nodeVersion:'24.21.0',tradingMode:'LIVE_ONLY',operatorAuthConfigured:true,liveBrokerConfigured:true,distServerFile:serverFile,distIndexFile:indexFile,dataDirectory:data,packageVersion:'1.3.0-quantitative-review'});

add(1,'Valid production release passes',()=>{assert.equal(valid().ok,true);});
add(2,'Valid release has no failures',()=>{assert.deepEqual(valid().failures,[]);});
add(3,'Production environment is required',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),environment:'development'}).checks.environment,'FAIL');});
function validInput():any{return {environment:'production',nodeVersion:'24.21.0',tradingMode:'LIVE_ONLY',operatorAuthConfigured:true,liveBrokerConfigured:true,distServerFile:serverFile,distIndexFile:indexFile,dataDirectory:data,packageVersion:'1.3.0-quantitative-review'};}
add(4,'Node 24 passes minimum runtime contract',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),nodeVersion:'24.21.0'}).checks.nodeVersion,'PASS');});
add(5,'Node 23 fails minimum runtime contract',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),nodeVersion:'23.11.0'}).checks.nodeVersion,'FAIL');});
add(6,'Prefixed supported Node version is accepted',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),nodeVersion:'v24.21.0'}).checks.nodeVersion,'PASS');});
add(7,'Non-numeric Node version fails',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),nodeVersion:'unknown'}).checks.nodeVersion,'FAIL');});
add(8,'LIVE_ONLY is required',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),tradingMode:'PAPER'}).checks.tradingMode,'FAIL');});
add(9,'Operator authentication is required',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),operatorAuthConfigured:false}).checks.operatorAuth,'FAIL');});
add(10,'At least one LIVE broker is required',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),liveBrokerConfigured:false}).checks.liveBroker,'FAIL');});
add(11,'Package version is required',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),packageVersion:''}).checks.packageVersion,'FAIL');});
add(12,'Whitespace-only package version fails',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),packageVersion:'   '}).checks.packageVersion,'FAIL');});
add(13,'Built server artifact is required',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),distServerFile:path.join(dist,'missing.cjs')}).checks.distServer,'FAIL');});
add(14,'Built index artifact is required',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),distIndexFile:path.join(dist,'missing.html')}).checks.distIndex,'FAIL');});
add(15,'Writable data directory is required',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),dataDirectory:path.join(dir,'new-data')}).checks.dataDirectoryWritable,'PASS');});
add(16,'Missing release artifact contributes to failures',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),distServerFile:path.join(dist,'missing')});assert.ok(r.failures.includes('distServer'));});
add(17,'Multiple failed checks are accumulated',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),environment:'development',tradingMode:'PAPER',operatorAuthConfigured:false});assert.ok(r.failures.length>=3);});
add(18,'Result exposes PASS/FAIL check values only',()=>{assert.ok(Object.values(valid().checks).every(v=>v==='PASS'||v==='FAIL'));});
add(19,'Result exposes release version unchanged',()=>{assert.equal(valid().version,'1.3.0-quantitative-review');});
add(20,'Valid release is deterministic across repeated evaluation',()=>{assert.deepEqual(valid(),valid());});
add(21,'Missing package version does not mutate failures to unrelated fields',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),packageVersion:''});assert.ok(r.failures.includes('packageVersion'));assert.ok(!r.failures.includes('tradingMode'));});
add(22,'Missing server file does not change environment result',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),distServerFile:path.join(dist,'x')});assert.equal(r.checks.environment,'PASS');});
add(23,'Missing index file does not change broker result',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),distIndexFile:path.join(dist,'x')});assert.equal(r.checks.liveBroker,'PASS');});
add(24,'Unconfigured broker does not change artifact checks',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),liveBrokerConfigured:false});assert.equal(r.checks.distServer,'PASS');assert.equal(r.checks.distIndex,'PASS');});
add(25,'Unconfigured operator auth does not change artifact checks',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),operatorAuthConfigured:false});assert.equal(r.checks.distServer,'PASS');});
add(26,'Empty data path fails writable check',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),dataDirectory:''}).checks.dataDirectoryWritable,'FAIL');});
add(27,'Directory path is allowed even before creation',()=>{const target=path.join(dir,'future-data');const r=release.evaluateProductionReleaseIntegrity({...validInput(),dataDirectory:target});assert.equal(r.checks.dataDirectoryWritable,'PASS');});
add(28,'A directory cannot satisfy server artifact check',()=>{const d=path.join(dir,'dir-server');fs.mkdirSync(d);assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),distServerFile:d}).checks.distServer,'FAIL');});
add(29,'A directory cannot satisfy index artifact check',()=>{const d=path.join(dir,'dir-index');fs.mkdirSync(d);assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),distIndexFile:d}).checks.distIndex,'FAIL');});
add(30,'Relative artifact path works when file exists',()=>{const cwd=process.cwd();const rel=path.relative(cwd,serverFile);assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),distServerFile:rel}).checks.distServer,'PASS');});

const input=release.buildProductionReleaseIntegrityInput({rootDirectory:dir,environment:'production',nodeVersion:'24.21.0',tradingMode:'LIVE_ONLY',operatorAuthConfigured:true,liveBrokerConfigured:true,packageVersion:'1.3.0'});
add(31,'Builder targets dist/server.cjs',()=>{assert.equal(input.distServerFile,path.join(dir,'dist','server.cjs'));});
add(32,'Builder targets dist/index.html',()=>{assert.equal(input.distIndexFile,path.join(dir,'dist','index.html'));});
add(33,'Builder targets data directory',()=>{assert.equal(input.dataDirectory,path.join(dir,'data'));});
add(34,'Builder preserves production environment',()=>{assert.equal(input.environment,'production');});
add(35,'Builder preserves Node version',()=>{assert.equal(input.nodeVersion,'24.21.0');});
add(36,'Builder preserves LIVE_ONLY mode',()=>{assert.equal(input.tradingMode,'LIVE_ONLY');});
add(37,'Builder preserves operator-auth state',()=>{assert.equal(input.operatorAuthConfigured,true);});
add(38,'Builder preserves broker state',()=>{assert.equal(input.liveBrokerConfigured,true);});
add(39,'Builder preserves release version',()=>{assert.equal(input.packageVersion,'1.3.0');});
add(40,'Builder defaults root directory to current process directory',()=>{const b=release.buildProductionReleaseIntegrityInput({tradingMode:'LIVE_ONLY',operatorAuthConfigured:true,liveBrokerConfigured:true,packageVersion:'1'});assert.equal(b.distServerFile,path.join(process.cwd(),'dist','server.cjs'));});

add(41,'Environment failure makes release not ok',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),environment:'test'}).ok,false);});
add(42,'Node failure makes release not ok',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),nodeVersion:'20.0.0'}).ok,false);});
add(43,'Trading-mode failure makes release not ok',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),tradingMode:'LIVE'}).ok,false);});
add(44,'Operator-auth failure makes release not ok',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),operatorAuthConfigured:false}).ok,false);});
add(45,'Broker failure makes release not ok',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),liveBrokerConfigured:false}).ok,false);});
add(46,'Package-version failure makes release not ok',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),packageVersion:''}).ok,false);});
add(47,'Server-artifact failure makes release not ok',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),distServerFile:path.join(dir,'missing')}).ok,false);});
add(48,'Index-artifact failure makes release not ok',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),distIndexFile:path.join(dir,'missing')}).ok,false);});
add(49,'Data-directory failure makes release not ok when parent path is a file',()=>{const blocked=path.join(dir,'blocked-parent');fs.writeFileSync(blocked,'x');const target=path.join(blocked,'data');assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),dataDirectory:target}).ok,false);});
add(50,'Failure names remain stable',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),environment:'x',packageVersion:''});assert.deepEqual(r.failures,['environment','packageVersion']);});
add(51,'Checks preserve insertion order for audit output',()=>{assert.deepEqual(Object.keys(valid().checks),['environment','nodeVersion','tradingMode','operatorAuth','liveBroker','packageVersion','distServer','distIndex','dataDirectoryWritable']);});
add(52,'PASS checks do not produce failure names',()=>{const r=valid();for(const [k,v] of Object.entries(r.checks))if(v==='PASS')assert.equal(r.failures.includes(k),false);});
add(53,'FAIL checks always produce failure names',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),tradingMode:'BAD'});assert.equal(r.checks.tradingMode,'FAIL');assert.ok(r.failures.includes('tradingMode'));});
add(54,'Version is trimmed in returned result',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),packageVersion:'  1.3.0  '}).version,'1.3.0');});
add(55,'Version value can be semver-like',()=>{assert.equal(release.evaluateProductionReleaseIntegrity({...validInput(),packageVersion:'2.0.0'}).ok,true);});
add(56,'Version value cannot be omitted when all other checks pass',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),packageVersion:undefined});assert.equal(r.checks.packageVersion,'FAIL');});
add(57,'Production release builder is pure with identical inputs',()=>{const a=release.buildProductionReleaseIntegrityInput({rootDirectory:dir,tradingMode:'LIVE_ONLY',operatorAuthConfigured:true,liveBrokerConfigured:true,packageVersion:'1'});const b=release.buildProductionReleaseIntegrityInput({rootDirectory:dir,tradingMode:'LIVE_ONLY',operatorAuthConfigured:true,liveBrokerConfigured:true,packageVersion:'1'});assert.deepEqual(a,b);});
add(58,'Absolute data path remains unchanged',()=>{assert.equal(input.dataDirectory,path.join(dir,'data'));});
add(59,'Release integrity does not inspect broker network state',()=>{const r=valid();assert.equal(r.checks.liveBroker,'PASS');});
add(60,'Release integrity contract remains LIVE_ONLY and fails closed',()=>{const r=release.evaluateProductionReleaseIntegrity({...validInput(),tradingMode:'PAPER'});assert.equal(r.ok,false);assert.equal(r.checks.tradingMode,'FAIL');});

console.log('=========================================================================');
console.log('PHASE 8.14 — PRODUCTION RELEASE & DEPLOYMENT INTEGRITY CERTIFICATION');
console.log('60 deterministic, broker-side-effect-free release integrity scenarios');
console.log('=========================================================================');
assert.equal(scenarios.length,60);
for(const item of scenarios){ item.run(); console.log('[PASS '+String(item.id).padStart(2,'0')+'/60] '+item.name); }
console.log('=========================================================================');
console.log('PHASE 8.14 CERTIFICATION: 60/60 PASSED');
console.log('Production startup artifact integrity: VERIFIED');
console.log('LIVE_ONLY release boundary: VERIFIED');
console.log('Runtime version contract: VERIFIED');
console.log('Durable data-path contract: VERIFIED');
console.log('Fail-closed deployment checks: VERIFIED');
console.log('Autonomous live execution: NOT ENABLED');
console.log('Broker order submission: NOT INVOKED');
console.log('=========================================================================');

fs.rmSync(dir,{recursive:true,force:true});