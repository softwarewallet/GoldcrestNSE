import { executeQuery } from '../database/db';
import type { CurrentPairPredictionHorizon } from './currentPairPredictionOutcomeService';

const CURRENT_WINDOW_DAYS = 30;
const REFERENCE_WINDOW_DAYS = 90;
const MIN_SAMPLE_COUNT = 30;
const BASELINE_MODEL = 'PAIR_FEATURE_BASELINE_V2';
const AI_MODEL = 'LLAMA_GATEWAY_QWEN_LLAMA_V1';

export interface CurrentPairCrossModelCalibrationMetrics {
  predictions: number; directionalEvaluated: number; correct: number; accuracyPct: number | null;
  averageConfidencePct: number | null; expectedCalibrationErrorPct: number | null;
  maximumCalibrationErrorPct: number | null; calibrationSlope: number | null;
  calibrationInterceptPct: number | null; sampleSufficient: boolean;
}
export interface CurrentPairCrossModelCalibrationRow {
  symbol: string; horizon: CurrentPairPredictionHorizon; pairedObservations: number; pairedEvaluated: number; pairedPending: number;
  baseline: { modelVersion: string; current: CurrentPairCrossModelCalibrationMetrics; reference: CurrentPairCrossModelCalibrationMetrics };
  ai: { modelVersion: string; current: CurrentPairCrossModelCalibrationMetrics; reference: CurrentPairCrossModelCalibrationMetrics };
  deltas: { currentAccuracyDeltaPct:number|null; currentConfidenceDeltaPct:number|null; currentExpectedCalibrationErrorDeltaPct:number|null; currentMaximumCalibrationErrorDeltaPct:number|null; currentCalibrationSlopeDelta:number|null; currentCalibrationInterceptDeltaPct:number|null; referenceAccuracyDeltaPct:number|null; referenceConfidenceDeltaPct:number|null; referenceExpectedCalibrationErrorDeltaPct:number|null; referenceMaximumCalibrationErrorDeltaPct:number|null; referenceCalibrationSlopeDelta:number|null; referenceCalibrationInterceptDeltaPct:number|null };
}
function clampConfidence(value: unknown): number { return Math.max(0, Math.min(1, Number(value) || 0)); }
function emptyMetrics(): CurrentPairCrossModelCalibrationMetrics { return { predictions:0,directionalEvaluated:0,correct:0,accuracyPct:null,averageConfidencePct:null,expectedCalibrationErrorPct:null,maximumCalibrationErrorPct:null,calibrationSlope:null,calibrationInterceptPct:null,sampleSufficient:false }; }
function calculateMetrics(rows:any[], maturityCutoff:number): CurrentPairCrossModelCalibrationMetrics {
  const result=emptyMetrics(); result.predictions=rows.length;
  const buckets=Array.from({length:5},()=>({predictions:0,directionalEvaluated:0,correct:0,confidenceSum:0}));
  const observations:Array<{confidence:number;correct:number}>=[];
  for(const row of rows){
    const confidence=clampConfidence(row.confidence); const bucket=buckets[Math.min(4,Math.floor(confidence*100/20))];
    bucket.predictions++; bucket.confidenceSum+=confidence;
    if(Number(row.predicted_at)>maturityCutoff || row.outcome_status!=='EVALUATED' || !row.actual_direction) continue;
    if(row.predicted_direction==='FLAT'||row.actual_direction==='FLAT') continue;
    const correct=row.predicted_direction===row.actual_direction?1:0; result.directionalEvaluated++; result.correct+=correct; bucket.directionalEvaluated++; bucket.correct+=correct; observations.push({confidence,correct});
  }
  result.accuracyPct=result.directionalEvaluated?result.correct/result.directionalEvaluated*100:null;
  result.averageConfidencePct=rows.length?rows.reduce((sum,row)=>sum+clampConfidence(row.confidence),0)/rows.length*100:null;
  if(result.directionalEvaluated>0){
    const errors=buckets.filter(b=>b.directionalEvaluated>0).map(b=>{const accuracy=b.correct/b.directionalEvaluated*100;const confidence=b.confidenceSum/b.predictions*100;const error=Math.abs(confidence-accuracy);return {error,weighted:error*b.directionalEvaluated/result.directionalEvaluated,sufficient:b.directionalEvaluated>=MIN_SAMPLE_COUNT};});
    result.expectedCalibrationErrorPct=errors.reduce((sum,b)=>sum+b.weighted,0); const sufficient=errors.filter(b=>b.sufficient).map(b=>b.error); result.maximumCalibrationErrorPct=sufficient.length?Math.max(...sufficient):null;
  }
  result.sampleSufficient=result.directionalEvaluated>=MIN_SAMPLE_COUNT;
  if(observations.length>=MIN_SAMPLE_COUNT){
    const meanX=observations.reduce((s,o)=>s+o.confidence,0)/observations.length; const meanY=observations.reduce((s,o)=>s+o.correct,0)/observations.length; const variance=observations.reduce((s,o)=>s+Math.pow(o.confidence-meanX,2),0);
    if(variance<=Number.EPSILON) result.calibrationInterceptPct=meanY*100; else { const covariance=observations.reduce((s,o)=>s+(o.confidence-meanX)*(o.correct-meanY),0); const slope=covariance/variance; result.calibrationSlope=slope; result.calibrationInterceptPct=(meanY-slope*meanX)*100; }
  }
  return result;
}
const delta=(a:number|null,b:number|null)=>a==null||b==null?null:a-b;

export async function getCurrentPairCrossModelCalibration(params:{symbol?:string;horizon?:CurrentPairPredictionHorizon;now?:number;baselineModelVersion?:string;aiModelVersion?:string}):Promise<{baselineModelVersion:string;aiModelVersion:string;currentWindowDays:number;referenceWindowDays:number;minimumSampleCount:number;generatedAt:number;rows:CurrentPairCrossModelCalibrationRow[]}> {
  const now=Number(params.now)||Date.now(); const currentCutoff=now-CURRENT_WINDOW_DAYS*86400000; const referenceStart=now-(CURRENT_WINDOW_DAYS+REFERENCE_WINDOW_DAYS)*86400000;
  const baselineModelVersion=params.baselineModelVersion||BASELINE_MODEL; const aiModelVersion=params.aiModelVersion||AI_MODEL;
  const conditions=["prediction_context = 'CURRENT_PAIR'",'model_version IN (?, ?)','predicted_at >= ?','predicted_at <= ?']; const values:unknown[]=[baselineModelVersion,aiModelVersion,referenceStart,now];
  if(params.symbol?.trim()){conditions.push('symbol = ?');values.push(params.symbol.trim().toUpperCase());} if(params.horizon){conditions.push('horizon = ?');values.push(params.horizon);}
  const rows=await executeQuery<any>(`SELECT model_version,symbol,horizon,predicted_at,predicted_direction,confidence,actual_direction,outcome_status FROM live_trade_research_predictions WHERE ${conditions.join(' AND ')} ORDER BY symbol ASC,horizon ASC,predicted_at ASC`,values);
  const pairs=new Map<string,{baseline?:any;ai?:any}>();
  for(const row of rows){const model=String(row.model_version);const symbol=String(row.symbol||'').trim().toUpperCase();const horizon=String(row.horizon||'').toUpperCase() as CurrentPairPredictionHorizon;if(!symbol||!['1D','3D','7D'].includes(horizon))continue;const key=`${symbol}|${horizon}|${Number(row.predicted_at)}`;const pair=pairs.get(key)||{};if(model===baselineModelVersion&&!pair.baseline)pair.baseline=row;if(model===aiModelVersion&&!pair.ai)pair.ai=row;pairs.set(key,pair);}
  const grouped=new Map<string,Array<{baseline:any;ai:any;timestamp:number}>>(); for(const[key,pair]of pairs.entries()){if(!pair.baseline||!pair.ai)continue;const[symbol,horizon,timestamp]=key.split('|');const group=grouped.get(`${symbol}|${horizon}`)||[];group.push({baseline:pair.baseline,ai:pair.ai,timestamp:Number(timestamp)});grouped.set(`${symbol}|${horizon}`,group);}
  const maturity=new Map<CurrentPairPredictionHorizon,number>([['1D',now-86400000],['3D',now-3*86400000],['7D',now-7*86400000]]); const resultRows:CurrentPairCrossModelCalibrationRow[]=[];
  for(const[key,group]of grouped.entries()){const[symbol,horizonText]=key.split('|');const horizon=horizonText as CurrentPairPredictionHorizon;const cutoff=maturity.get(horizon) as number;const current=group.filter(p=>p.timestamp>=currentCutoff);const reference=group.filter(p=>p.timestamp<currentCutoff);const valid=(row:any)=>row.outcome_status==='EVALUATED'&&row.actual_direction&&row.predicted_direction!=='FLAT'&&row.actual_direction!=='FLAT';const pairedEvaluated=group.filter(p=>p.timestamp<=cutoff&&valid(p.baseline)&&valid(p.ai)).length;const pairedObservations=group.length;const pairedPending=pairedObservations-pairedEvaluated;const bc=calculateMetrics(current.map(p=>p.baseline),cutoff);const br=calculateMetrics(reference.map(p=>p.baseline),cutoff);const ac=calculateMetrics(current.map(p=>p.ai),cutoff);const ar=calculateMetrics(reference.map(p=>p.ai),cutoff);
    resultRows.push({symbol,horizon,pairedObservations,pairedEvaluated,pairedPending,baseline:{modelVersion:baselineModelVersion,current:bc,reference:br},ai:{modelVersion:aiModelVersion,current:ac,reference:ar},deltas:{currentAccuracyDeltaPct:delta(ac.accuracyPct,bc.accuracyPct),currentConfidenceDeltaPct:delta(ac.averageConfidencePct,bc.averageConfidencePct),currentExpectedCalibrationErrorDeltaPct:delta(ac.expectedCalibrationErrorPct,bc.expectedCalibrationErrorPct),currentMaximumCalibrationErrorDeltaPct:delta(ac.maximumCalibrationErrorPct,bc.maximumCalibrationErrorPct),currentCalibrationSlopeDelta:delta(ac.calibrationSlope,bc.calibrationSlope),currentCalibrationInterceptDeltaPct:delta(ac.calibrationInterceptPct,bc.calibrationInterceptPct),referenceAccuracyDeltaPct:delta(ar.accuracyPct,br.accuracyPct),referenceConfidenceDeltaPct:delta(ar.averageConfidencePct,br.averageConfidencePct),referenceExpectedCalibrationErrorDeltaPct:delta(ar.expectedCalibrationErrorPct,br.expectedCalibrationErrorPct),referenceMaximumCalibrationErrorDeltaPct:delta(ar.maximumCalibrationErrorPct,br.maximumCalibrationErrorPct),referenceCalibrationSlopeDelta:delta(ar.calibrationSlope,br.calibrationSlope),referenceCalibrationInterceptDeltaPct:delta(ar.calibrationInterceptPct,br.calibrationInterceptPct)}});
  }
  resultRows.sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.horizon.localeCompare(b.horizon)); return {baselineModelVersion,aiModelVersion,currentWindowDays:CURRENT_WINDOW_DAYS,referenceWindowDays:REFERENCE_WINDOW_DAYS,minimumSampleCount:MIN_SAMPLE_COUNT,generatedAt:now,rows:resultRows};
}
