import assert from 'node:assert/strict';
import { getDatabase, executeRun } from '../src/database/db';
import { getCurrentPairCrossModelContextTemporalCalibration } from '../src/services/currentPairCrossModelContextTemporalCalibrationService';

await getDatabase();
await executeRun('DELETE FROM live_trade_research_predictions');
const now=Date.now();
const insert=async(id:string,model:string,timestamp:number,actual:'UP'|'DOWN',confidence:number,regime:string,session:string)=>executeRun(
  `INSERT INTO live_trade_research_predictions (prediction_id,model_version,prediction_source,symbol,signal_id,predicted_at,horizon,predicted_direction,confidence,feature_hash,model_agreement,reasoning,invalidation,actual_direction,actual_return_pct,outcome_status,evaluated_at,created_at,feature_snapshot_json,prediction_context) VALUES (?,?,'TEST','EUR/USD',?,?,?,?,?,?,1,'test',null,?,1,'EVALUATED',?,?,?,'CURRENT_PAIR')`,
  [id,model,id,timestamp,'1D','UP',confidence,id+'-hash',actual,now,now,JSON.stringify({marketRegime:regime,session})]
);
for(let i=0;i<45;i++){
  const ts=now-(i+2)*8*60*60*1000+60000;
  const actual=i<30?'UP':'DOWN';
  const regime=i<35?'TREND':'RANGE';
  const session=i<35?'LONDON':'NEW_YORK';
  await insert('b-'+i,'PAIR_FEATURE_BASELINE_V2',ts,actual,.65,regime,session);
  await insert('a-'+i,'LLAMA_GATEWAY_QWEN_LLAMA_V1',ts,actual,i<30?.70:.85,regime,session);
}
const report=await getCurrentPairCrossModelContextTemporalCalibration({now,horizon:'1D'});
assert.deepEqual(report.windowsDays,[7,14,30,60,90]);
assert.equal(report.minimumSampleCount,30);
assert.equal(report.bootstrapResamples,2000);
assert.ok(report.rows.length>=2);
const trend=report.rows.find(r=>r.marketRegime==='TREND');
assert.ok(trend);
assert.equal(trend?.windows.length,5);
assert.equal(trend?.windows[4].pairedObservations,35);
assert.ok((trend?.windows[4].pairedEvaluated||0)>=30);
assert.ok((trend?.windows[4].pairedEvaluated||0)<=35);
assert.ok((trend?.windows[2].baseline.directionalEvaluated||0)>=30);
assert.ok(trend?.windows[2].bootstrap.accuracyDelta95Pct);
assert.ok(trend?.windows[2].bootstrap.confidenceDelta95Pct);
assert.ok(trend?.windows[2].bootstrap.expectedCalibrationErrorDelta95Pct);
assert.ok((trend?.windows[2].bootstrap.accuracyDelta95Pct?.lowerPct||0)<=(trend?.windows[2].bootstrap.accuracyDelta95Pct?.upperPct||0));
const london=report.rows.find(r=>r.session==='LONDON');
assert.ok(london);
assert.ok(london?.windows[4].pairedObservations>0);
console.log('CURRENT PAIR CROSS-MODEL CONTEXT TEMPORAL CALIBRATION TEST PASSED');
