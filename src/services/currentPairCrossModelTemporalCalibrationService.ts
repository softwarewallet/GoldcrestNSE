import { executeQuery } from '../database/db';
import type { CurrentPairPredictionHorizon } from './currentPairPredictionOutcomeService';

const WINDOWS_DAYS=[7,14,30,60,90] as const;
const MIN_SAMPLE_COUNT=30;
const BOOTSTRAP_RESAMPLES=2000;
const BASELINE_MODEL='PAIR_FEATURE_BASELINE_V2';
const AI_MODEL='LLAMA_GATEWAY_QWEN_LLAMA_V1';

export interface CrossModelTemporalCalibrationBucket {
  lowerPct:number; upperPct:number; predictions:number; directionalEvaluated:number; correct:number;
  averageConfidencePct:number|null; accuracyPct:number|null; calibrationGapPct:number|null;
  accuracyConfidenceInterval95Pct:{lowerPct:number;upperPct:number}|null; sampleSufficient:boolean;
}
export interface CrossModelTemporalBucketDelta {
  accuracyPct:number|null; averageConfidencePct:number|null; calibrationGapPct:number|null;
}
export interface CrossModelTemporalMetrics {
  predictions:number; directionalEvaluated:number; correct:number; accuracyPct:number|null;
  averageConfidencePct:number|null; expectedCalibrationErrorPct:number|null;
  maximumCalibrationErrorPct:number|null; calibrationSlope:number|null;
  calibrationInterceptPct:number|null; sampleSufficient:boolean;
  calibrationBuckets:CrossModelTemporalCalibrationBucket[];
}
export interface CrossModelTemporalBootstrapIntervals {
  accuracyDelta95Pct:{lowerPct:number;upperPct:number}|null;
  confidenceDelta95Pct:{lowerPct:number;upperPct:number}|null;
  expectedCalibrationErrorDelta95Pct:{lowerPct:number;upperPct:number}|null;
  maximumCalibrationErrorDelta95Pct:{lowerPct:number;upperPct:number}|null;
}
export interface CrossModelTemporalWindow {
  windowDays:number;
  baseline:CrossModelTemporalMetrics;
  ai:CrossModelTemporalMetrics;
  deltas:{accuracyPct:number|null;confidencePct:number|null;expectedCalibrationErrorPct:number|null;maximumCalibrationErrorPct:number|null;calibrationSlope:number|null;calibrationInterceptPct:number|null;calibrationBuckets:CrossModelTemporalBucketDelta[]};
  bootstrap:CrossModelTemporalBootstrapIntervals;
}
export interface CurrentPairCrossModelTemporalCalibrationRow {
  symbol:string; horizon:CurrentPairPredictionHorizon; pairedObservations:number; pairedEvaluated:number; pairedPending:number;
  windows:CrossModelTemporalWindow[];
}
const conf=(v:unknown)=>Math.max(0,Math.min(1,Number(v)||0));
const delta=(a:number|null,b:number|null)=>a==null||b==null?null:a-b;
const wilson=(correct:number,total:number)=>{if(total<=0)return null;const z=1.96,p=correct/total,den=1+z*z/total,center=(p+z*z/(2*total))/den,half=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/den;return {lowerPct:Math.max(0,center-half)*100,upperPct:Math.min(1,center+half)*100};};
const percentile=(values:number[],p:number)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*p,lower=Math.floor(index),upper=Math.ceil(index);return sorted[lower]+(sorted[upper]-sorted[lower])*(index-lower);};
const interval=(values:number[]):{lowerPct:number;upperPct:number}|null=>values.length?{lowerPct:percentile(values,0.025)!,upperPct:percentile(values,0.975)!}:null;
const bootstrapIntervals=(pairs:Array<{baseline:any;ai:any}>,cutoff:number,seed:number):CrossModelTemporalBootstrapIntervals=>{
  if(pairs.length<MIN_SAMPLE_COUNT)return {accuracyDelta95Pct:null,confidenceDelta95Pct:null,expectedCalibrationErrorDelta95Pct:null,maximumCalibrationErrorDelta95Pct:null};
  let state=seed>>>0; const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  const accuracy:number[]=[],confidence:number[]=[],ece:number[]=[],mce:number[]=[];
  for(let n=0;n<BOOTSTRAP_RESAMPLES;n++){const baseline:any[]=[],ai:any[]=[];for(let i=0;i<pairs.length;i++){const pair=pairs[Math.floor(random()*pairs.length)];baseline.push(pair.baseline);ai.push(pair.ai);}const b=metrics(baseline,cutoff),a=metrics(ai,cutoff);if(b.accuracyPct!=null&&a.accuracyPct!=null)accuracy.push(a.accuracyPct-b.accuracyPct);if(b.averageConfidencePct!=null&&a.averageConfidencePct!=null)confidence.push(a.averageConfidencePct-b.averageConfidencePct);if(b.expectedCalibrationErrorPct!=null&&a.expectedCalibrationErrorPct!=null)ece.push(a.expectedCalibrationErrorPct-b.expectedCalibrationErrorPct);if(b.maximumCalibrationErrorPct!=null&&a.maximumCalibrationErrorPct!=null)mce.push(a.maximumCalibrationErrorPct-b.maximumCalibrationErrorPct);}
  return {accuracyDelta95Pct:interval(accuracy),confidenceDelta95Pct:interval(confidence),expectedCalibrationErrorDelta95Pct:interval(ece),maximumCalibrationErrorDelta95Pct:interval(mce)};
};
const empty=():CrossModelTemporalMetrics=>({predictions:0,directionalEvaluated:0,correct:0,accuracyPct:null,averageConfidencePct:null,expectedCalibrationErrorPct:null,maximumCalibrationErrorPct:null,calibrationSlope:null,calibrationInterceptPct:null,sampleSufficient:false,calibrationBuckets:Array.from({length:5},(_,i)=>({lowerPct:i*20,upperPct:(i+1)*20,predictions:0,directionalEvaluated:0,correct:0,averageConfidencePct:null,accuracyPct:null,calibrationGapPct:null,accuracyConfidenceInterval95Pct:null,sampleSufficient:false}))});

function metrics(rows:any[],cutoff:number):CrossModelTemporalMetrics{
  const r=empty(); r.predictions=rows.length;
  const buckets=Array.from({length:5},()=>({predictions:0,evaluated:0,correct:0,confidenceSum:0}));
  const observations:Array<{confidence:number;correct:number}>=[];
  for(const row of rows){
    const confidence=conf(row.confidence),bucket=buckets[Math.min(4,Math.floor(confidence*100/20))];
    bucket.predictions++; bucket.confidenceSum+=confidence;
    if(Number(row.predicted_at)>cutoff||row.outcome_status!=='EVALUATED'||!row.actual_direction||row.predicted_direction==='FLAT'||row.actual_direction==='FLAT')continue;
    const correct=row.predicted_direction===row.actual_direction?1:0;
    r.directionalEvaluated++; r.correct+=correct; bucket.evaluated++; bucket.correct+=correct; observations.push({confidence,correct});
  }
  r.accuracyPct=r.directionalEvaluated?r.correct/r.directionalEvaluated*100:null;
  r.averageConfidencePct=rows.length?rows.reduce((s,row)=>s+conf(row.confidence),0)/rows.length*100:null;
  r.calibrationBuckets=buckets.map((b,i)=>{
    const averageConfidencePct=b.predictions?b.confidenceSum/b.predictions*100:null;
    const accuracyPct=b.evaluated?b.correct/b.evaluated*100:null;
    return {lowerPct:i*20,upperPct:(i+1)*20,predictions:b.predictions,directionalEvaluated:b.evaluated,correct:b.correct,averageConfidencePct,accuracyPct,calibrationGapPct:averageConfidencePct==null||accuracyPct==null?null:accuracyPct-averageConfidencePct,accuracyConfidenceInterval95Pct:wilson(b.correct,b.evaluated),sampleSufficient:b.evaluated>=MIN_SAMPLE_COUNT};
  });
  if(r.directionalEvaluated){
    const errors=buckets.filter(b=>b.evaluated>0).map(b=>({error:Math.abs(b.confidenceSum/b.predictions*100-b.correct/b.evaluated*100),weight:b.evaluated/r.directionalEvaluated,sufficient:b.evaluated>=MIN_SAMPLE_COUNT}));
    r.expectedCalibrationErrorPct=errors.reduce((s,b)=>s+b.error*b.weight,0);
    const sufficient=errors.filter(b=>b.sufficient).map(b=>b.error);
    r.maximumCalibrationErrorPct=sufficient.length?Math.max(...sufficient):null;
  }
  if(observations.length>=MIN_SAMPLE_COUNT){
    const meanX=observations.reduce((s,o)=>s+o.confidence,0)/observations.length;
    const meanY=observations.reduce((s,o)=>s+o.correct,0)/observations.length;
    const variance=observations.reduce((s,o)=>s+(o.confidence-meanX)**2,0);
    if(variance>Number.EPSILON){
      const covariance=observations.reduce((s,o)=>s+(o.confidence-meanX)*(o.correct-meanY),0);
      r.calibrationSlope=covariance/variance; r.calibrationInterceptPct=(meanY-r.calibrationSlope*meanX)*100;
    } else r.calibrationInterceptPct=meanY*100;
  }
  r.sampleSufficient=r.directionalEvaluated>=MIN_SAMPLE_COUNT; return r;
}

export async function getCurrentPairCrossModelTemporalCalibration(params:{symbol?:string;horizon?:CurrentPairPredictionHorizon;now?:number;baselineModelVersion?:string;aiModelVersion?:string}={}):Promise<{baselineModelVersion:string;aiModelVersion:string;windowsDays:readonly number[];minimumSampleCount:number;generatedAt:number;rows:CurrentPairCrossModelTemporalCalibrationRow[]}>{
  const now=Number(params.now)||Date.now(),baselineModelVersion=params.baselineModelVersion||BASELINE_MODEL,aiModelVersion=params.aiModelVersion||AI_MODEL;
  const conditions=["prediction_context = 'CURRENT_PAIR'","model_version IN (?, ?)","predicted_at >= ?","predicted_at <= ?"];
  const values:unknown[]=[baselineModelVersion,aiModelVersion,now-90*86400000,now];
  if(params.symbol?.trim()){conditions.push('symbol = ?');values.push(params.symbol.trim().toUpperCase());}
  if(params.horizon){conditions.push('horizon = ?');values.push(params.horizon);}
  const rows=await executeQuery<any>(`SELECT model_version,symbol,horizon,predicted_at,predicted_direction,confidence,actual_direction,outcome_status FROM live_trade_research_predictions WHERE ${conditions.join(' AND ')} ORDER BY symbol,horizon,predicted_at`,values);
  const pairs=new Map<string,{baseline?:any;ai?:any}>();
  for(const row of rows){
    const model=String(row.model_version),symbol=String(row.symbol||'').trim().toUpperCase(),horizon=String(row.horizon||'').toUpperCase() as CurrentPairPredictionHorizon;
    if(!symbol||!['1D','3D','7D'].includes(horizon))continue;
    const key=`${symbol}|${horizon}|${Number(row.predicted_at)}`,pair=pairs.get(key)||{};
    if(model===baselineModelVersion&&!pair.baseline)pair.baseline=row;
    if(model===aiModelVersion&&!pair.ai)pair.ai=row; pairs.set(key,pair);
  }
  const grouped=new Map<string,Array<{baseline:any;ai:any;timestamp:number}>>();
  for(const [key,pair] of pairs){if(!pair.baseline||!pair.ai)continue;const [symbol,horizon,timestamp]=key.split('|'),group=grouped.get(`${symbol}|${horizon}`)||[];group.push({baseline:pair.baseline,ai:pair.ai,timestamp:Number(timestamp)});grouped.set(`${symbol}|${horizon}`,group);}
  const maturity=new Map<CurrentPairPredictionHorizon,number>([['1D',now-86400000],['3D',now-3*86400000],['7D',now-7*86400000]]);
  const resultRows:CurrentPairCrossModelTemporalCalibrationRow[]=[];
  for(const [key,group] of grouped){
    const [symbol,horizonText]=key.split('|'),horizon=horizonText as CurrentPairPredictionHorizon,cutoff=maturity.get(horizon)!;
    const windows=WINDOWS_DAYS.map(windowDays=>{
      const selected=group.filter(p=>p.timestamp>=now-windowDays*86400000);
      const baseline=metrics(selected.map(p=>p.baseline),cutoff),ai=metrics(selected.map(p=>p.ai),cutoff);
      const maturePairs=selected.filter(p=>p.timestamp<=cutoff&&p.baseline.outcome_status==='EVALUATED'&&p.baseline.actual_direction&&p.baseline.predicted_direction!=='FLAT'&&p.baseline.actual_direction!=='FLAT'&&p.ai.outcome_status==='EVALUATED'&&p.ai.actual_direction&&p.ai.predicted_direction!=='FLAT'&&p.ai.actual_direction!=='FLAT');
      const bootstrap=bootstrapIntervals(maturePairs,cutoff,Array.from(`${symbol}|${horizon}|${windowDays}`).reduce((s,ch)=>Math.imul(31,s)+ch.charCodeAt(0),2166136261)>>>0);
      const bucketDeltas=ai.calibrationBuckets.map((bucket,index)=>{const base=baseline.calibrationBuckets[index];return {accuracyPct:delta(bucket.accuracyPct,base.accuracyPct),averageConfidencePct:delta(bucket.averageConfidencePct,base.averageConfidencePct),calibrationGapPct:delta(bucket.calibrationGapPct,base.calibrationGapPct)};});
      return {windowDays,baseline,ai,bootstrap,deltas:{accuracyPct:delta(ai.accuracyPct,baseline.accuracyPct),confidencePct:delta(ai.averageConfidencePct,baseline.averageConfidencePct),expectedCalibrationErrorPct:delta(ai.expectedCalibrationErrorPct,baseline.expectedCalibrationErrorPct),maximumCalibrationErrorPct:delta(ai.maximumCalibrationErrorPct,baseline.maximumCalibrationErrorPct),calibrationSlope:delta(ai.calibrationSlope,baseline.calibrationSlope),calibrationInterceptPct:delta(ai.calibrationInterceptPct,baseline.calibrationInterceptPct),calibrationBuckets:bucketDeltas}};
    });
    const valid=(row:any)=>row.outcome_status==='EVALUATED'&&row.actual_direction&&row.predicted_direction!=='FLAT'&&row.actual_direction!=='FLAT';
    const pairedEvaluated=group.filter(p=>p.timestamp<=cutoff&&valid(p.baseline)&&valid(p.ai)).length;
    resultRows.push({symbol,horizon,pairedObservations:group.length,pairedEvaluated,pairedPending:group.length-pairedEvaluated,windows});
  }
  resultRows.sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.horizon.localeCompare(b.horizon));
  return {baselineModelVersion,aiModelVersion,windowsDays:WINDOWS_DAYS,minimumSampleCount:MIN_SAMPLE_COUNT,generatedAt:now,rows:resultRows};
}
