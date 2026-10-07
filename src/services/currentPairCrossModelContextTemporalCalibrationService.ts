import { executeQuery } from '../database/db';
import type { CurrentPairPredictionHorizon } from './currentPairPredictionOutcomeService';

const WINDOWS_DAYS=[7,14,30,60,90] as const;
const MIN_SAMPLE_COUNT=30;
const BOOTSTRAP_RESAMPLES=2000;
const BASELINE_MODEL='PAIR_FEATURE_BASELINE_V2';
const AI_MODEL='LLAMA_GATEWAY_QWEN_LLAMA_V1';

type ContextMetric={predictions:number;directionalEvaluated:number;correct:number;accuracyPct:number|null;averageConfidencePct:number|null;expectedCalibrationErrorPct:number|null;calibrationSlope:number|null;sampleSufficient:boolean};
export interface CrossModelContextTemporalWindow {
  windowDays:number; pairedObservations:number; pairedEvaluated:number;
  baseline:ContextMetric; ai:ContextMetric;
  deltas:{accuracyPct:number|null;confidencePct:number|null;expectedCalibrationErrorPct:number|null;calibrationSlope:number|null};
  bootstrap:{accuracyDelta95Pct:{lowerPct:number;upperPct:number}|null;confidenceDelta95Pct:{lowerPct:number;upperPct:number}|null;expectedCalibrationErrorDelta95Pct:{lowerPct:number;upperPct:number}|null};
}
export interface CurrentPairCrossModelContextTemporalRow {symbol:string;horizon:CurrentPairPredictionHorizon;marketRegime:string;session:string;windows:CrossModelContextTemporalWindow[];}

const confidence=(v:unknown)=>Math.max(0,Math.min(1,Number(v)||0));
const delta=(a:number|null,b:number|null)=>a==null||b==null?null:a-b;
const percentile=(values:number[],p:number)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo);};
const interval=(values:number[]):{lowerPct:number;upperPct:number}|null=>values.length?{lowerPct:percentile(values,.025)!,upperPct:percentile(values,.975)!}:null;

function metric(rows:any[],cutoff:number):ContextMetric{
  const evaluated=rows.filter(row=>Number(row.predicted_at)<=cutoff&&row.outcome_status==='EVALUATED'&&row.actual_direction&&row.predicted_direction!=='FLAT'&&row.actual_direction!=='FLAT');
  const observations=evaluated.map(row=>({x:confidence(row.confidence),y:row.predicted_direction===row.actual_direction?1:0}));
  const accuracyPct=observations.length?observations.reduce((s,o)=>s+o.y,0)/observations.length*100:null;
  const averageConfidencePct=rows.length?rows.reduce((s,row)=>s+confidence(row.confidence),0)/rows.length*100:null;
  const buckets=Array.from({length:5},()=>({n:0,e:0,c:0,cs:0}));
  for(const row of rows){const x=confidence(row.confidence),bucket=buckets[Math.min(4,Math.floor(x*100/20))];bucket.n++;bucket.cs+=x;if(row.outcome_status==='EVALUATED'&&row.actual_direction&&row.predicted_direction!=='FLAT'&&row.actual_direction!=='FLAT'){bucket.e++;if(row.predicted_direction===row.actual_direction)bucket.c++;}}
  const expectedCalibrationErrorPct=observations.length?buckets.filter(b=>b.e).reduce((s,b)=>s+Math.abs(b.cs/b.n*100-b.c/b.e*100)*b.e/observations.length,0):null;
  let calibrationSlope:number|null=null;
  if(observations.length>=MIN_SAMPLE_COUNT){const mx=observations.reduce((s,o)=>s+o.x,0)/observations.length,my=observations.reduce((s,o)=>s+o.y,0)/observations.length,variance=observations.reduce((s,o)=>s+(o.x-mx)**2,0);calibrationSlope=variance>Number.EPSILON?observations.reduce((s,o)=>s+(o.x-mx)*(o.y-my),0)/variance:null;}
  return {predictions:rows.length,directionalEvaluated:observations.length,correct:observations.reduce((s,o)=>s+o.y,0),accuracyPct,averageConfidencePct,expectedCalibrationErrorPct,calibrationSlope,sampleSufficient:observations.length>=MIN_SAMPLE_COUNT};
}
function bootstrap(pairs:Array<{baseline:any;ai:any}>,seed:number){
  if(pairs.length<MIN_SAMPLE_COUNT)return {accuracyDelta95Pct:null,confidenceDelta95Pct:null,expectedCalibrationErrorDelta95Pct:null};
  let state=seed>>>0;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  const acc:number[]=[],conf:number[]=[],ece:number[]=[];
  for(let n=0;n<BOOTSTRAP_RESAMPLES;n++){const b:any[]=[],a:any[]=[];for(let i=0;i<pairs.length;i++){const pair=pairs[Math.floor(random()*pairs.length)];b.push(pair.baseline);a.push(pair.ai);}const bm=metric(b,Number.MAX_SAFE_INTEGER),am=metric(a,Number.MAX_SAFE_INTEGER);if(bm.accuracyPct!=null&&am.accuracyPct!=null)acc.push(am.accuracyPct-bm.accuracyPct);if(bm.averageConfidencePct!=null&&am.averageConfidencePct!=null)conf.push(am.averageConfidencePct-bm.averageConfidencePct);if(bm.expectedCalibrationErrorPct!=null&&am.expectedCalibrationErrorPct!=null)ece.push(am.expectedCalibrationErrorPct-bm.expectedCalibrationErrorPct);}
  return {accuracyDelta95Pct:interval(acc),confidenceDelta95Pct:interval(conf),expectedCalibrationErrorDelta95Pct:interval(ece)};
}
function context(row:any,key:'marketRegime'|'session'){try{const value=JSON.parse(row.feature_snapshot_json||'{}')?.[key];return typeof value==='string'&&value.trim()?value.trim().toUpperCase():'UNKNOWN';}catch{return'UNKNOWN';}}

export async function getCurrentPairCrossModelContextTemporalCalibration(params:{symbol?:string;horizon?:CurrentPairPredictionHorizon;marketRegime?:string;session?:string;now?:number}={}){
  const now=Number(params.now)||Date.now(),conditions=["prediction_context='CURRENT_PAIR'","model_version IN (?,?)","predicted_at>=?","predicted_at<=?"],values:any[]=[BASELINE_MODEL,AI_MODEL,now-90*86400000,now];
  if(params.symbol?.trim()){conditions.push('symbol=?');values.push(params.symbol.trim().toUpperCase());}if(params.horizon){conditions.push('horizon=?');values.push(params.horizon);}
  const rows=await executeQuery<any>(`SELECT model_version,symbol,horizon,predicted_at,predicted_direction,confidence,actual_direction,outcome_status,feature_snapshot_json FROM live_trade_research_predictions WHERE ${conditions.join(' AND ')} ORDER BY symbol,horizon,predicted_at`,values);
  const pairs=new Map<string,{baseline?:any;ai?:any}>();
  for(const row of rows){const key=`${String(row.symbol).trim().toUpperCase()}|${String(row.horizon).toUpperCase()}|${context(row,'marketRegime')}|${context(row,'session')}|${Number(row.predicted_at)}`,pair=pairs.get(key)||{};if(row.model_version===BASELINE_MODEL&&!pair.baseline)pair.baseline=row;if(row.model_version===AI_MODEL&&!pair.ai)pair.ai=row;pairs.set(key,pair);}
  const groups=new Map<string,Array<{baseline:any;ai:any;timestamp:number}>>();
  for(const[key,pair]of pairs){if(!pair.baseline||!pair.ai)continue;const parts=key.split('|'),symbol=parts[0],horizon=parts[1] as CurrentPairPredictionHorizon,regime=parts[2],session=parts[3],timestamp=Number(parts[4]);if(params.marketRegime&&regime!==params.marketRegime.trim().toUpperCase())continue;if(params.session&&session!==params.session.trim().toUpperCase())continue;const group=groups.get(`${symbol}|${horizon}|${regime}|${session}`)||[];group.push({baseline:pair.baseline,ai:pair.ai,timestamp});groups.set(`${symbol}|${horizon}|${regime}|${session}`,group);}
  const maturity=new Map<CurrentPairPredictionHorizon,number>([['1D',now-86400000],['3D',now-3*86400000],['7D',now-7*86400000]]);
  const output:CurrentPairCrossModelContextTemporalRow[]=[];
  for(const[key,group]of groups){const [symbol,horizonText,marketRegime,session]=key.split('|'),horizon=horizonText as CurrentPairPredictionHorizon,cutoff=maturity.get(horizon)!;
    const windows=WINDOWS_DAYS.map(windowDays=>{const selected=group.filter(pair=>pair.timestamp>=now-windowDays*86400000),mature=selected.filter(pair=>pair.timestamp<=cutoff),baseline=metric(selected.map(pair=>pair.baseline),cutoff),ai=metric(selected.map(pair=>pair.ai),cutoff);const valid=(row:any)=>row.outcome_status==='EVALUATED'&&row.actual_direction&&row.predicted_direction!=='FLAT'&&row.actual_direction!=='FLAT';const pairedEvaluated=mature.filter(pair=>valid(pair.baseline)&&valid(pair.ai)).length;const seed=Array.from(`${symbol}|${horizon}|${marketRegime}|${session}|${windowDays}`).reduce((s,ch)=>Math.imul(31,s)+ch.charCodeAt(0),2166136261)>>>0;return {windowDays,pairedObservations:selected.length,pairedEvaluated,baseline,ai,deltas:{accuracyPct:delta(ai.accuracyPct,baseline.accuracyPct),confidencePct:delta(ai.averageConfidencePct,baseline.averageConfidencePct),expectedCalibrationErrorPct:delta(ai.expectedCalibrationErrorPct,baseline.expectedCalibrationErrorPct),calibrationSlope:delta(ai.calibrationSlope,baseline.calibrationSlope)},bootstrap:bootstrap(mature,seed)};});
    output.push({symbol,horizon,marketRegime,session,windows});
  }
  output.sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.horizon.localeCompare(b.horizon)||a.marketRegime.localeCompare(b.marketRegime)||a.session.localeCompare(b.session));
  return {baselineModelVersion:BASELINE_MODEL,aiModelVersion:AI_MODEL,windowsDays:WINDOWS_DAYS,minimumSampleCount:MIN_SAMPLE_COUNT,bootstrapResamples:BOOTSTRAP_RESAMPLES,generatedAt:now,rows:output};
}
