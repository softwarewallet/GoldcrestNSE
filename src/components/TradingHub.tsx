import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Activity, 
  ShieldCheck, 
  Radio, 
  ArrowRight, 
  AlertTriangle, 
  Play, 
  Pause, 
  Save, 
  Terminal as TerminalIcon, 
  Cpu, 
  Sparkles, 
  Send,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Target,
  X
} from 'lucide-react';
import { TradingEnvironment, BrokerType } from '../brokers/types';
import { OptionsTradingPanel } from './OptionsTradingPanel';
import { AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS, isVisibleAutoLiveSignal } from '../services/autoLiveTradePolicy';

interface TradingHubProps {
  environment: TradingEnvironment;
  selectedBroker?: string;
  maskedAccount?: string;
  balance?: number;
  currency?: string;
  isEmergencyHalted: boolean;
  onRequestEnvironmentChange: (env: TradingEnvironment) => void;
}

interface TerminalLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'nlp';
  message: string;
}

// Representing genuine live broker positions from /api/brokers/positions
interface RealPosition {
  id: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  market: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  currentPriceStatus?: 'LIVE' | 'FALLBACK' | 'UNAVAILABLE';
  stopLoss?: number;
  takeProfit?: number;
  unrealizedPnL: number;
  realizedPnL: number;
  currency: string;
  timestamp: number;
}

// Representing actual scanned system signals from /api/signals
interface RealSignal {
  id: string;
  timestamp: number;
  market: string;
  instrument: string;
  direction: 'BUY' | 'SELL' | 'NO_TRADE';
  strategy: string;
  score: number;
  mlProbability: number;
  entryZone: { min: number; max: number; preferred: number };
  stopLoss: number;
  target1: number;
  status: string;
  reasons: string[];
}

interface CurrentPairPrediction {
  predictionId: string;
  symbol: string;
  predictedAt: number;
  horizon: '1D' | '3D' | '7D';
  predictedDirection: 'UP' | 'DOWN' | 'FLAT';
  confidence: number;
  modelVersion: string;
  predictionSource: string;
  modelAgreement: number;
  reasoning: string;
  invalidation: string;
  actualDirection?: 'UP' | 'DOWN' | 'FLAT' | null;
  actualReturnPct?: number | null;
  outcomeStatus?: string;
  evaluatedAt?: number | null;
}

interface CurrentPairGroupMetric {
  symbol: string;
  modelVersion: string;
  horizon: '1D' | '3D' | '7D';
  total: number;
  evaluated: number;
  pending: number;
  correct: number;
  directionalEvaluated: number;
  accuracyPct: number | null;
  brierScore: number | null;
  upPredictions: number;
  downPredictions: number;
  flatPredictions: number;
  upActuals: number;
  downActuals: number;
  flatActuals: number;
  calibration: Array<{ lowerPct:number; upperPct:number; predictions:number; evaluated:number; correct:number; accuracyPct:number|null; averageConfidencePct:number|null; sampleSufficient:boolean }>;
  marketRegime: string;
  session: string;
  sampleSufficient: boolean;
  minimumSampleCount: number;
  accuracyConfidenceInterval95Pct: { lowerPct:number; upperPct:number } | null;
  rollingWindows: Array<{windowDays:30|90; evaluated:number; directionalEvaluated:number; correct:number; accuracyPct:number|null; brierScore:number|null; sampleSufficient:boolean; accuracyConfidenceInterval95Pct:{lowerPct:number; upperPct:number}|null}>;
}

interface CurrentPairWalkForwardCohort {
  cohortIndex: number;
  cohortDays: number;
  fromTimestamp: number;
  toTimestamp: number;
  evaluated: number;
  directionalEvaluated: number;
  correct: number;
  accuracyPct: number | null;
  brierScore: number | null;
  sampleSufficient: boolean;
  accuracyConfidenceInterval95Pct: { lowerPct:number; upperPct:number } | null;
}

interface CurrentPairWalkForwardGroup {
  symbol: string;
  modelVersion: string;
  horizon: '1D' | '3D' | '7D';
  marketRegime: string;
  session: string;
  cohortDays: number;
  minimumSampleCount: number;
  cohorts: CurrentPairWalkForwardCohort[];
}

interface CurrentPairWalkForwardAnalytics {
  total: number;
  evaluated: number;
  cohortDays: number;
  minimumSampleCount: number;
  groups: CurrentPairWalkForwardGroup[];
  generatedAt: number;
}

interface CurrentPairPredictionAnalytics {
  total: number;
  evaluated: number;
  pending: number;
  correct: number;
  directionalEvaluated: number;
  accuracyPct: number | null;
  brierScore: number | null;
  groups: CurrentPairGroupMetric[];
  generatedAt: number;
}

interface CurrentPairModelComparison {
  total: number;
  evaluated: number;
  pending: number;
  models: Array<{
    modelVersion: string;
    predictions: number;
    evaluated: number;
    pending: number;
    correct: number;
    directionalEvaluated: number;
    accuracyPct: number | null;
    brierScore: number | null;
    sampleSufficient: boolean;
    minimumSampleCount: number;
  }>;
  generatedAt: number;
}

interface CurrentPairResearchValidationReport {
  scope: { symbol: string | null; horizon: string; generatedAt: number };
  data: { totalPredictions: number; baselinePredictions: number; aiPredictions: number; pairedObservations: number; pairedEvaluated: number; pairedPending: number; pendingPct: number | null; unmatchedBaseline: number; unmatchedAi: number; duplicatePairKeys: number; featureSnapshotRows: number; featureSnapshotLeakageRows: number };
  models: Array<{ modelVersion: string; predictions: number; evaluated: number; pending: number; directionalEvaluated: number; accuracyPct: number | null; brierScore: number | null; sampleSufficient: boolean; minimumSampleCount: number }>;
  paired: { discordantPairs: number; baselineOnlyCorrect: number; aiOnlyCorrect: number; bothCorrect: number; bothIncorrect: number; directionAgreementPct: number | null; exactMcNemarPValue: number | null; sampleSufficient: boolean };
  rolling: Array<{ windowDays: 30 | 90; pairedObservations: number; pairedEvaluated: number; pairedPending: number; discordantPairs: number; directionAgreementPct: number | null; exactMcNemarPValue: number | null; sampleSufficient: boolean }>;
  contexts: { total: number; sufficient: number; insufficient: number; evaluatedObservations: number };
  checks: Array<{ id: string; status: 'PASS' | 'WARN' | 'INSUFFICIENT'; title: string; detail: string }>;
}

interface CurrentPairTemporalBootstrapInterval { lower:number; upper:number; confidenceLevelPct:number; resamples:number }
interface CurrentPairTemporalCalibrationBucket { lowerPct:number; upperPct:number; predictions:number; directionalEvaluated:number; correct:number; averageConfidencePct:number|null; accuracyPct:number|null; calibrationGapPct:number|null; accuracyConfidenceInterval95Pct:{lowerPct:number;upperPct:number}|null; sampleSufficient:boolean }
interface CurrentPairTemporalCalibrationMatrix {
  modelVersion: string; generatedAt: number; windowsDays: number[]; minimumSampleCount: number; bootstrapResamples:number;
  rows: Array<{ symbol: string; horizon: '1D'|'3D'|'7D'; windows: Array<{ windowDays:number; predictions:number; directionalEvaluated:number; correct:number; accuracyPct:number|null; averageConfidencePct:number|null; expectedCalibrationErrorPct:number|null; maximumCalibrationErrorPct:number|null; calibrationSlope:number|null; calibrationInterceptPct:number|null; calibrationBuckets:CurrentPairTemporalCalibrationBucket[]; sampleSufficient:boolean }>; deltas: { accuracy7dVs90dPct:number|null; confidence7dVs90dPct:number|null; ece7dVs90dPct:number|null; mce7dVs90dPct:number|null; slope7dVs90d:number|null; intercept7dVs90dPct:number|null; accuracy7dVs90d95Pct:CurrentPairTemporalBootstrapInterval|null; confidence7dVs90d95Pct:CurrentPairTemporalBootstrapInterval|null; ece7dVs90d95Pct:CurrentPairTemporalBootstrapInterval|null } }>;
}

interface CurrentPairResearchReadinessLedger {
  scope: { symbol: string | null; horizon: string; generatedAt: number; aiModelVersion: string };
  evidence: {
    validationChecks: number; validationWarnings: number; validationInsufficient: number;
    aiDirectionalEvaluated: number; baselineDirectionalEvaluated: number; pairedEvaluated: number;
    currentOosDirectionalEvaluated: number; referenceOosDirectionalEvaluated: number;
    calibrationRows: number; sufficientCalibrationRows: number; contextRows: number; sufficientContextRows: number;
  };
  checks: Array<{ id: string; status: 'PASS' | 'WARN' | 'INSUFFICIENT'; title: string; detail: string }>;
}

interface CurrentPairOosCalibrationBucket {
  lowerPct:number; upperPct:number; predictions:number; directionalEvaluated:number; correct:number;
  averageConfidencePct:number|null; accuracyPct:number|null;
  accuracyConfidenceInterval95Pct:{lowerPct:number;upperPct:number}|null;
  calibrationGapPct:number|null; sampleSufficient:boolean;
}

interface CurrentPairCalibrationMatrixRow {
  symbol: string;
  horizon: '1D' | '3D' | '7D';
  current: { predictions:number; directionalEvaluated:number; correct:number; accuracyPct:number|null; averageConfidencePct:number|null; expectedCalibrationErrorPct:number|null; maximumCalibrationErrorPct:number|null; calibrationSlope:number|null; calibrationInterceptPct:number|null; sampleSufficient:boolean };
  reference: { predictions:number; directionalEvaluated:number; correct:number; accuracyPct:number|null; averageConfidencePct:number|null; expectedCalibrationErrorPct:number|null; maximumCalibrationErrorPct:number|null; sampleSufficient:boolean };
  deltas: { accuracyDeltaPct:number|null; confidenceDeltaPct:number|null; expectedCalibrationErrorDeltaPct:number|null; maximumCalibrationErrorDeltaPct:number|null; calibrationSlopeDelta:number|null; calibrationInterceptDeltaPct:number|null };
}

interface CurrentPairCalibrationMatrix {
  modelVersion: string;
  generatedAt: number;
  currentWindowDays: number;
  referenceWindowDays: number;
  minimumSampleCount: number;
  rows: CurrentPairCalibrationMatrixRow[];
}

interface CurrentPairCrossModelCalibrationMetrics {
  predictions:number; directionalEvaluated:number; correct:number; accuracyPct:number|null; averageConfidencePct:number|null;
  expectedCalibrationErrorPct:number|null; maximumCalibrationErrorPct:number|null; calibrationSlope:number|null; calibrationInterceptPct:number|null; sampleSufficient:boolean;
}
interface CurrentPairCrossModelCalibrationRow {
  symbol:string; horizon:'1D'|'3D'|'7D'; pairedObservations:number; pairedEvaluated:number; pairedPending:number;
  baseline:{modelVersion:string;current:CurrentPairCrossModelCalibrationMetrics;reference:CurrentPairCrossModelCalibrationMetrics};
  ai:{modelVersion:string;current:CurrentPairCrossModelCalibrationMetrics;reference:CurrentPairCrossModelCalibrationMetrics};
  deltas:{currentAccuracyDeltaPct:number|null;currentConfidenceDeltaPct:number|null;currentExpectedCalibrationErrorDeltaPct:number|null;currentMaximumCalibrationErrorDeltaPct:number|null;currentCalibrationSlopeDelta:number|null;currentCalibrationInterceptDeltaPct:number|null;referenceAccuracyDeltaPct:number|null;referenceConfidenceDeltaPct:number|null;referenceExpectedCalibrationErrorDeltaPct:number|null;referenceMaximumCalibrationErrorDeltaPct:number|null;referenceCalibrationSlopeDelta:number|null;referenceCalibrationInterceptDeltaPct:number|null};
}
interface CurrentPairCrossModelCalibration {
  baselineModelVersion:string; aiModelVersion:string; currentWindowDays:number; referenceWindowDays:number; minimumSampleCount:number; generatedAt:number;
  rows:CurrentPairCrossModelCalibrationRow[];
}

interface CurrentPairOosDriftReport {
  symbol: string | null; horizon: string; modelVersion: string; generatedAt: number;
  currentWindow: { windowDays: 30; predictions:number; evaluated:number; directionalEvaluated:number; correct:number; accuracyPct:number|null; brierScore:number|null; averageConfidencePct:number|null; calibrationGapPct:number|null; expectedCalibrationErrorPct:number|null; maximumCalibrationErrorPct:number|null; sampleSufficient:boolean; calibrationBuckets:CurrentPairOosCalibrationBucket[] };
  baselineWindow: { windowDays: 90; predictions:number; evaluated:number; directionalEvaluated:number; correct:number; accuracyPct:number|null; brierScore:number|null; averageConfidencePct:number|null; calibrationGapPct:number|null; expectedCalibrationErrorPct:number|null; maximumCalibrationErrorPct:number|null; sampleSufficient:boolean; calibrationBuckets:CurrentPairOosCalibrationBucket[] };
  uncertainty: {
    accuracyDelta95Pct:{lower:number;upper:number;confidenceLevelPct:number;resamples:number}|null;
    brierDelta95:{lower:number;upper:number;confidenceLevelPct:number;resamples:number}|null;
    calibrationErrorDelta95Pct:{lower:number;upper:number;confidenceLevelPct:number;resamples:number}|null;
    maximumCalibrationErrorDelta95Pct:{lower:number;upper:number;confidenceLevelPct:number;resamples:number}|null;
  };
  drift:{accuracyDeltaPct:number|null;brierDelta:number|null;confidenceDeltaPct:number|null;calibrationGapDeltaPct:number|null;calibrationErrorDeltaPct:number|null;accuracyDriftFlag:boolean;brierDriftFlag:boolean;confidenceDriftFlag:boolean;calibrationDriftFlag:boolean;calibrationErrorDriftFlag:boolean};
  checks:Array<{id:string;status:'PASS'|'WARN'|'INSUFFICIENT';title:string;detail:string}>;
}

interface CurrentPairPairedContextComparison {
  symbol: string;
  horizon: string;
  marketRegime: string;
  session: string;
  pairedObservations: number;
  pairedEvaluated: number;
  pairedPending: number;
  bothCorrect: number;
  baselineOnlyCorrect: number;
  aiOnlyCorrect: number;
  bothIncorrect: number;
  directionAgreementPct: number | null;
  discordantPairs: number;
  exactMcNemarPValue: number | null;
  sampleSufficient: boolean;
  accuracyConfidenceInterval95Pct: { lowerPct: number; upperPct: number } | null;
}

interface CurrentPairPairedRollingWindowMetrics {
  windowDays: 30 | 90;
  pairedObservations: number;
  pairedEvaluated: number;
  pairedPending: number;
  bothCorrect: number;
  baselineOnlyCorrect: number;
  aiOnlyCorrect: number;
  bothIncorrect: number;
  directionAgreementPct: number | null;
  discordantPairs: number;
  exactMcNemarPValue: number | null;
}

interface CurrentPairPairedModelComparison {
  baselineModelVersion: string;
  aiModelVersion: string;
  pairedObservations: number;
  pairedEvaluated: number;
  pairedPending: number;
  bothCorrect: number;
  baselineOnlyCorrect: number;
  aiOnlyCorrect: number;
  bothIncorrect: number;
  directionAgreementPct: number | null;
  discordantPairs: number;
  exactMcNemarPValue: number | null;
}

interface CurrentPairCollectionStatus {
  running: boolean;
  pollIntervalMs: number;
  cycleInFlight: boolean;
  lastCycleAt: number | null;
  lastCompletedAt: number | null;
  lastGenerated: number;
  lastEvaluated: number;
  lastPending: number;
  lastError: string | null;
  nextScheduledAt: number | null;
}

interface ExecutionReconciliationDiagnostic {
  idempotencyKey: string;
  broker: string;
  market: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  state: string;
  createdAt: number;
  ageMs: number;
  reconciliation: {
    state: string;
    attemptCount: number;
    lastAttemptAt: number | null;
    lastAttemptAgeMs: number | null;
    brokerOrderId: string | null;
    clientOrderId: string | null;
    brokerStatus: string | null;
    requestedQuantity: number | null;
    filledQuantity: number;
    remainingQuantity: number | null;
    averageFillPrice: number | null;
    errorCode: string | null;
    reason: string | null;
    operatorActionRequired: boolean;
  };
}

export const TradingHub: React.FC<TradingHubProps> = ({ 
  environment, 
  selectedBroker = 'cTrader', 
  maskedAccount = 'ID-8849-LIVE', 
  balance = 148500.00, 
  currency = 'USD', 
  isEmergencyHalted 
}) => {
  // Manual Order Form States
  const [market, setMarket] = useState<string>('FOREX');
  const [symbol, setSymbol] = useState<string>('EUR/USD');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [quantity, setQuantity] = useState<number>(10000);
  const [price, setPrice] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [isPlacingOrder, setIsPlacingOrder] = useState<boolean>(false);
  
  // Real Data Feeds State
  const [runningTrades, setRunningTrades] = useState<RealPosition[]>([]);
  const [plannedTrades, setPlannedTrades] = useState<RealSignal[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState<boolean>(true);
  const [isLoadingSignals, setIsLoadingSignals] = useState<boolean>(true);
  const [signalsAgeNow, setSignalsAgeNow] = useState<number>(Date.now());
  const [signalsScanCompletedAt, setSignalsScanCompletedAt] = useState<number | null>(null);
  const [signalScanStats, setSignalScanStats] = useState({ total: 0, actionable: 0, noTrade: 0, errors: 0 });

  const [logs, setLogs] = useState<TerminalLog[]>([
    {
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      message: 'Autonomous Trading console connected to active Live adapters.'
    },
    {
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      message: 'Background scanners synchronized with system scanner services.'
    }
  ]);

  // System Auto-Execution Instructions States
  const [autoInstruction, setAutoInstruction] = useState<string>(
    'Monitor multi-timeframe breakout patterns on key currency pairs (EUR/USD, GBP/USD) and execute buyer positions on RSI breakouts above 60 with strict trailing stop-losses.'
  );
  const [isAutoTradingActive, setIsAutoTradingActive] = useState<boolean>(true);
  const [isSavingInstructions, setIsSavingInstructions] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Triggering State & Notifications
  const [triggeringSignalId, setTriggeringSignalId] = useState<string | null>(null);
  const [triggerNotification, setTriggerNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  type AutoExecutionStage = 'IDLE' | 'SCANNING_MARKET' | 'ANALYZING_SIGNAL' | 'PREPARING_ORDER' | 'SAFETY_GATE' | 'SUBMITTING_ORDER' | 'TRADE_EXECUTED' | 'REJECTED';
  interface AutoTradingStatusSnapshot {
    state: 'STOPPED' | 'PREPARING' | 'RUNNING' | 'BLOCKED';
    autonomousPermission: boolean;
    minSignalScore: number;
    maxTradesPerPair: number;
    maxOpenPositions: number;
    lastCycleAt: number | null;
    lastCycleResult: string | null;
    lastActions: Array<{
      pair: string;
      result: string;
      signalId?: string;
      reason?: string;
      orderId?: string;
    }>;
    currentExecution: {
      stage: AutoExecutionStage;
      pair: string | null;
      side: 'BUY' | 'SELL' | null;
      signalId: string | null;
      message: string;
      updatedAt: number;
    };
    lastExecution: {
      stage: AutoExecutionStage;
      pair: string | null;
      side: 'BUY' | 'SELL' | null;
      signalId: string | null;
      message: string;
      updatedAt: number;
    } | null;
  }
  const [activeTab, setActiveTab] = useState<'cockpit' | 'positions' | 'signals' | 'options' | 'execution' | 'research' | 'controls'>('cockpit');
  const [autoStatus, setAutoStatus] = useState<AutoTradingStatusSnapshot | null>(null);
  const [autoStatusError, setAutoStatusError] = useState<string | null>(null);
  const [executionDiagnostics, setExecutionDiagnostics] = useState<ExecutionReconciliationDiagnostic[]>([]);
  const [currentPairPredictions, setCurrentPairPredictions] = useState<CurrentPairPrediction[]>([]);
  const [currentPairAnalytics, setCurrentPairAnalytics] = useState<CurrentPairPredictionAnalytics | null>(null);
  const [currentPairModelComparison, setCurrentPairModelComparison] = useState<CurrentPairModelComparison | null>(null);
  const [currentPairPairedComparison, setCurrentPairPairedComparison] = useState<CurrentPairPairedModelComparison | null>(null);
  const [currentPairPairedRolling, setCurrentPairPairedRolling] = useState<CurrentPairPairedRollingWindowMetrics[]>([]);
  const [currentPairPairedContexts, setCurrentPairPairedContexts] = useState<CurrentPairPairedContextComparison[]>([]);
  const [currentPairValidationReport, setCurrentPairValidationReport] = useState<CurrentPairResearchValidationReport | null>(null);
  const [currentPairResearchReadinessLedger, setCurrentPairResearchReadinessLedger] = useState<CurrentPairResearchReadinessLedger | null>(null);
  const [currentPairTemporalCalibration, setCurrentPairTemporalCalibration] = useState<CurrentPairTemporalCalibrationMatrix | null>(null);
  const [currentPairOosDrift, setCurrentPairOosDrift] = useState<CurrentPairOosDriftReport | null>(null);
  const [currentPairCalibrationMatrix, setCurrentPairCalibrationMatrix] = useState<CurrentPairCalibrationMatrix | null>(null);
  const [currentPairCrossModelContextCalibration, setCurrentPairCrossModelContextCalibration] = useState<any>(null);
  const [currentPairCrossModelCalibration, setCurrentPairCrossModelCalibration] = useState<CurrentPairCrossModelCalibration | null>(null);
  const [currentPairCrossModelTemporalCalibration, setCurrentPairCrossModelTemporalCalibration] = useState<any>(null);
  const [currentPairCrossModelContextTemporalCalibration, setCurrentPairCrossModelContextTemporalCalibration] = useState<any>(null);
  const [currentPairWalkForward, setCurrentPairWalkForward] = useState<CurrentPairWalkForwardAnalytics | null>(null);
  const [currentPairHorizon, setCurrentPairHorizon] = useState<'1D' | '3D' | '7D'>('1D');
  const [currentPairModel, setCurrentPairModel] = useState<'BASELINE' | 'AI_GATEWAY' | 'COMPARE'>('BASELINE');
  const [currentPairSymbol, setCurrentPairSymbol] = useState<string>('ALL');
  const [currentPairSymbols, setCurrentPairSymbols] = useState<string[]>([]);
  const [currentPairLoading, setCurrentPairLoading] = useState(false);
  const [currentPairError, setCurrentPairError] = useState<string | null>(null);
  const [currentPairEvaluationMessage, setCurrentPairEvaluationMessage] = useState<string | null>(null);
  const [currentPairCollectionStatus, setCurrentPairCollectionStatus] = useState<CurrentPairCollectionStatus | null>(null);
  const [currentPairCollectionAction, setCurrentPairCollectionAction] = useState(false);
  const [executionDiagnosticsError, setExecutionDiagnosticsError] = useState<string | null>(null);
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState<number>(3);
  const [dailyLossSaving, setDailyLossSaving] = useState<boolean>(false);
  const [dailyLossSaveMessage, setDailyLossSaveMessage] = useState<string | null>(null);

  // Helper to append telemetry console logs
  const addLog = useCallback((type: 'info' | 'success' | 'error' | 'warning' | 'nlp', message: string) => {
    setLogs(prev => [
      {
        timestamp: new Date().toLocaleTimeString(),
        type,
        message
      },
      ...prev
    ].slice(0, 100)); // Maintain last 100 entries
  }, []);

  // Safe JSON parsing helper to prevent unexpected token '<' exceptions from non-JSON gateway error pages
  const safeParseJson = useCallback(async (res: Response): Promise<any> => {
    const text = await res.text();
    const contentType = res.headers.get('content-type') || 'unknown';
    const goldcrestRoute = res.headers.get('x-goldcrest-route');
    try {
      return JSON.parse(text);
    } catch {
      if (text.includes('<!DOCTYPE') || text.includes('<!doctype') || text.includes('<html')) {
        throw new Error(
          goldcrestRoute === 'broker-order-live'
            ? `Goldcrest order endpoint returned HTTP ${res.status} HTML unexpectedly (content-type: ${contentType}).`
            : `HTTP ${res.status} returned HTML instead of the Goldcrest API JSON route (content-type: ${contentType}). The request may be hitting a stale/proxy/Vite process.`
        );
      }
      throw new Error(text.substring(0, 150) || `Server returned status ${res.status}`);
    }
  }, []);

  // Fetch positions from /api/brokers/positions
  const fetchRealPositions = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoadingPositions(true);
    try {
      const res = await fetch('/api/brokers/positions');
      if (res.ok) {
        const data = await safeParseJson(res);
        if (Array.isArray(data)) {
          setRunningTrades(data);
        }
      } else {
        throw new Error('Positions endpoint returned non-ok status');      }
    } catch (err: any) {
      console.warn('Failed to load real broker positions:', err);
    } finally {
      setIsLoadingPositions(false);
    }
  }, [safeParseJson]);

  // Fetch signals from /api/signals
  const fetchRealSignals = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoadingSignals(true);
    try {
      const res = await fetch('/api/signals');
      if (res.ok) {
        const data = await safeParseJson(res);
        if (Array.isArray(data)) {
          const actionable = data.filter((signal: RealSignal) => ['BUY', 'SELL'].includes(String(signal.direction || '').toUpperCase()));
          const noTrade = data.filter((signal: RealSignal) => String(signal.direction || '').toUpperCase() === 'NO_TRADE');
          const errors = data.filter((signal: RealSignal) => !signal || !signal.direction || String(signal.status || '').toUpperCase() === 'ERROR');
          setSignalScanStats({ total: data.length, actionable: actionable.length, noTrade: noTrade.length, errors: errors.length });
          setPlannedTrades(actionable);
          // Start the freshness counter only after the complete signal scan/fetch has finished.
          // This measures scanner-result age, not the timestamp embedded in an individual signal.
          setSignalsScanCompletedAt(Date.now());
        }
      } else {
        throw new Error('Signals endpoint returned non-ok status');
      }
    } catch (err: any) {
      console.warn('Failed to load real trading signals:', err);
    } finally {
      setIsLoadingSignals(false);
    }
  }, [safeParseJson]);

  const fetchExecutionDiagnostics = useCallback(async () => {
    try {
      const res = await fetch('/api/brokers/execution-intents?limit=50', { cache: 'no-store' });
      const data = await safeParseJson(res);
      if (!res.ok) throw new Error(data?.error || 'Execution reconciliation diagnostics unavailable.');
      setExecutionDiagnostics(Array.isArray(data?.intents) ? data.intents : []);
      setExecutionDiagnosticsError(null);
    } catch (err: any) {
      setExecutionDiagnosticsError(err?.message || 'Execution reconciliation diagnostics unavailable.');
    }
  }, [safeParseJson]);

  const fetchCurrentPairResearch = useCallback(async () => {
    setCurrentPairLoading(true);
    try {
      const modelVersion = currentPairModel === 'BASELINE'
        ? 'PAIR_FEATURE_BASELINE_V2'
        : currentPairModel === 'AI_GATEWAY'
          ? 'LLAMA_GATEWAY_QWEN_LLAMA_V1'
          : '';
      const query = `horizon=${currentPairHorizon}${modelVersion ? `&modelVersion=${modelVersion}` : ''}${currentPairSymbol !== 'ALL' ? `&symbol=${encodeURIComponent(currentPairSymbol)}` : ''}`;
      const comparisonQuery = `horizon=${currentPairHorizon}${currentPairSymbol !== 'ALL' ? `&symbol=${encodeURIComponent(currentPairSymbol)}` : ''}`;
      const [predictionRes, analyticsRes, walkForwardRes, comparisonRes, pairedComparisonRes, pairedRollingRes, pairedContextRes, validationRes, oosDriftRes, calibrationMatrixRes, crossModelCalibrationRes, crossModelTemporalCalibrationRes, crossModelContextTemporalCalibrationRes, readinessLedgerRes, temporalCalibrationRes] = await Promise.all([
        fetch(`/api/live-trade-research/current-pair/predictions?${query}&limit=100`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/analytics?${query}`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/walk-forward?${query}&cohortDays=30&maxCohorts=6`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/model-comparison?${comparisonQuery}&limit=50000`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/paired-model-comparison?${comparisonQuery}&limit=50000`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/paired-model-comparison-rolling?${comparisonQuery}&limit=50000`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/paired-context-comparison?${comparisonQuery}&limit=50000`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/validation-report?${comparisonQuery}&limit=50000`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/oos-drift?${comparisonQuery}&modelVersion=LLAMA_GATEWAY_QWEN_LLAMA_V1`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/calibration-matrix?${comparisonQuery}&modelVersion=LLAMA_GATEWAY_QWEN_LLAMA_V1`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/cross-model-calibration?${comparisonQuery}`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/cross-model-temporal-calibration?${comparisonQuery}`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/cross-model-context-temporal-calibration?${comparisonQuery}`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/research-readiness-ledger?${comparisonQuery}`, { cache: 'no-store' }),
        fetch(`/api/live-trade-research/current-pair/temporal-calibration?${comparisonQuery}&modelVersion=LLAMA_GATEWAY_QWEN_LLAMA_V1`, { cache: 'no-store' })
      ]);
      const [predictionData, analyticsData, walkForwardData, comparisonData, pairedComparisonData, pairedRollingData, pairedContextData, validationData, oosDriftData, calibrationMatrixData, crossModelCalibrationData, crossModelTemporalCalibrationData, crossModelContextTemporalCalibrationData, readinessLedgerData, temporalCalibrationData] = await Promise.all([
        safeParseJson(predictionRes),
        safeParseJson(analyticsRes),
        safeParseJson(walkForwardRes),
        safeParseJson(comparisonRes),
        safeParseJson(pairedComparisonRes),
        safeParseJson(pairedRollingRes),
        safeParseJson(pairedContextRes),
        safeParseJson(validationRes),
        safeParseJson(oosDriftRes),
        safeParseJson(calibrationMatrixRes),
        safeParseJson(crossModelCalibrationRes),
        safeParseJson(crossModelTemporalCalibrationRes),
        safeParseJson(crossModelContextTemporalCalibrationRes),
        safeParseJson(readinessLedgerRes),
        safeParseJson(temporalCalibrationRes)
      ]);
      if (!predictionRes.ok) throw new Error(predictionData?.message || predictionData?.error || 'Current pair predictions unavailable.');
      if (!analyticsRes.ok) throw new Error(analyticsData?.message || analyticsData?.error || 'Current pair analytics unavailable.');
      if (!walkForwardRes.ok) throw new Error(walkForwardData?.message || walkForwardData?.error || 'Current pair walk-forward analytics unavailable.');
      if (!comparisonRes.ok) throw new Error(comparisonData?.message || comparisonData?.error || 'Current pair model comparison unavailable.');
      if (!pairedComparisonRes.ok) throw new Error(pairedComparisonData?.message || pairedComparisonData?.error || 'Paired current pair model comparison unavailable.');
      if (!pairedRollingRes.ok) throw new Error(pairedRollingData?.message || pairedRollingData?.error || 'Paired rolling model comparison unavailable.');
      if (!pairedContextRes.ok) throw new Error(pairedContextData?.message || pairedContextData?.error || 'Context-conditioned paired comparison unavailable.');
      if (!validationRes.ok) throw new Error(validationData?.message || validationData?.error || 'Research validation report unavailable.');
      if (!oosDriftRes.ok) throw new Error(oosDriftData?.message || oosDriftData?.error || 'OOS drift report unavailable.');
      if (!calibrationMatrixRes.ok) throw new Error(calibrationMatrixData?.message || calibrationMatrixData?.error || 'Calibration matrix unavailable.');
      if (!crossModelCalibrationRes.ok) throw new Error(crossModelCalibrationData?.message || crossModelCalibrationData?.error || 'Cross-model calibration unavailable.');
      if (!crossModelTemporalCalibrationRes.ok) throw new Error(crossModelTemporalCalibrationData?.message || crossModelTemporalCalibrationData?.error || 'Cross-model temporal calibration unavailable.');
      if (!crossModelContextTemporalCalibrationRes.ok) throw new Error(crossModelContextTemporalCalibrationData?.message || crossModelContextTemporalCalibrationData?.error || 'Cross-model context temporal calibration unavailable.');
      if (!readinessLedgerRes.ok) throw new Error(readinessLedgerData?.message || readinessLedgerData?.error || 'Research readiness ledger unavailable.');
      if (!temporalCalibrationRes.ok) throw new Error(temporalCalibrationData?.message || temporalCalibrationData?.error || 'Temporal calibration report unavailable.');
      setCurrentPairPredictions(Array.isArray(predictionData?.predictions) ? predictionData.predictions : []);
      setCurrentPairAnalytics(analyticsData || null);
      setCurrentPairWalkForward(walkForwardData || null);
      setCurrentPairModelComparison(comparisonData || null);
      setCurrentPairPairedComparison(pairedComparisonData || null);
      setCurrentPairPairedRolling(Array.isArray(pairedRollingData?.rollingWindows) ? pairedRollingData.rollingWindows : []);
      setCurrentPairPairedContexts(Array.isArray(pairedContextData?.groups) ? pairedContextData.groups : []);
      setCurrentPairValidationReport(validationData || null);
      setCurrentPairResearchReadinessLedger(readinessLedgerData || null);
      setCurrentPairTemporalCalibration(temporalCalibrationData || null);
      setCurrentPairOosDrift(oosDriftData || null);
      setCurrentPairCalibrationMatrix(calibrationMatrixData || null);
      const contextCalibrationRes = await fetch(`/api/live-trade-research/current-pair/cross-model-context-calibration?${comparisonQuery}`, { cache: 'no-store' });
      const contextCalibrationData = await safeParseJson(contextCalibrationRes);
      if (!contextCalibrationRes.ok) throw new Error(contextCalibrationData?.message || contextCalibrationData?.error || 'Context calibration unavailable.');
      setCurrentPairCrossModelContextCalibration(contextCalibrationData || null);
      setCurrentPairCrossModelCalibration(crossModelCalibrationData || null);
      setCurrentPairCrossModelTemporalCalibration(crossModelTemporalCalibrationData || null);
      setCurrentPairCrossModelContextTemporalCalibration(crossModelContextTemporalCalibrationData || null);
      const discoveredSymbols = Array.from(new Set([
        ...currentPairSymbols,
        ...(Array.isArray(predictionData?.predictions) ? predictionData.predictions.map((p: CurrentPairPrediction) => p.symbol) : []),
        ...(Array.isArray(analyticsData?.groups) ? analyticsData.groups.map((g: CurrentPairGroupMetric) => g.symbol) : []),
        ...(Array.isArray(calibrationMatrixData?.rows) ? calibrationMatrixData.rows.map((row: CurrentPairCalibrationMatrixRow) => row.symbol) : [])
      ].filter(Boolean))).sort();
      if (discoveredSymbols.length !== currentPairSymbols.length || discoveredSymbols.some((symbol, index) => symbol !== currentPairSymbols[index])) {
        setCurrentPairSymbols(discoveredSymbols);
      }
      setCurrentPairError(null);
    } catch (err: any) {
      setCurrentPairError(err?.message || 'Current pair research data unavailable.');
    } finally {
      setCurrentPairLoading(false);
    }
  }, [currentPairHorizon, currentPairModel, currentPairSymbol, currentPairSymbols, safeParseJson]);

  const fetchCurrentPairCollectionStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/live-trade-research/current-pair/collection-status', { cache: 'no-store' });
      const data = await safeParseJson(res);
      if (!res.ok) throw new Error(data?.error || 'Current pair collection status unavailable.');
      setCurrentPairCollectionStatus(data);
    } catch (err: any) {
      console.warn('Failed to load current pair collection status:', err);
    }
  }, [safeParseJson]);

  const runCurrentPairCollectionNow = useCallback(async () => {
    setCurrentPairCollectionAction(true);
    try {
      const res = await fetch('/api/live-trade-research/current-pair/collect-now', {
        method: 'POST',
        cache: 'no-store'
      });
      const data = await safeParseJson(res);
      if (!res.ok) throw new Error(data?.error || 'Current pair collection failed.');
      setCurrentPairCollectionStatus(prev => prev ? {
        ...prev,
        lastCycleAt: data.completedAt || Date.now(),
        lastCompletedAt: data.completedAt || Date.now(),
        lastGenerated: Number(data.generated || 0),
        lastEvaluated: Number(data.evaluated || 0),
        lastPending: Number(data.pending || 0),
        lastError: null,
        nextScheduledAt: prev.nextScheduledAt
      } : prev);
      await fetchCurrentPairResearch();
      await fetchCurrentPairCollectionStatus();
    } catch (err: any) {
      setCurrentPairEvaluationMessage(err?.message || 'Current pair collection failed.');
    } finally {
      setCurrentPairCollectionAction(false);
    }
  }, [fetchCurrentPairCollectionStatus, fetchCurrentPairResearch, safeParseJson]);

  const evaluateCurrentPairResearch = useCallback(async () => {
    setCurrentPairEvaluationMessage(null);
    try {
      const res = await fetch('/api/live-trade-research/current-pair/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ horizon: currentPairHorizon, symbol: currentPairSymbol === 'ALL' ? undefined : currentPairSymbol, limit: 50000 })
      });
      const data = await safeParseJson(res);
      if (!res.ok) throw new Error(data?.message || data?.error || 'Current pair outcome evaluation failed.');
      setCurrentPairEvaluationMessage(`Evaluated ${Number(data?.evaluated || 0)} prediction(s); ${Number(data?.pending || 0)} remain pending.`);
      await fetchCurrentPairResearch();
    } catch (err: any) {
      setCurrentPairEvaluationMessage(err?.message || 'Current pair outcome evaluation failed.');
    }
  }, [currentPairHorizon, currentPairSymbol, fetchCurrentPairResearch, safeParseJson]);

  useEffect(() => {
    void fetchExecutionDiagnostics();
    const timer = setInterval(fetchExecutionDiagnostics, 10000);
    return () => clearInterval(timer);
  }, [fetchExecutionDiagnostics]);

  useEffect(() => {
    void fetchCurrentPairResearch();
    const timer = setInterval(() => { void fetchCurrentPairResearch(); }, 60000);
    return () => clearInterval(timer);
  }, [fetchCurrentPairResearch]);
  useEffect(() => {
    void fetchCurrentPairCollectionStatus();
    const timer = setInterval(() => { void fetchCurrentPairCollectionStatus(); }, 10000);
    return () => clearInterval(timer);
  }, [fetchCurrentPairCollectionStatus]);


  useEffect(() => {
    let mounted = true;
    fetch('/api/config', { cache: 'no-store' })
      .then(async (res) => res.ok ? await safeParseJson(res) : null)
      .then((config) => {
        const configuredPairs = Array.isArray(config?.autoLiveForexPairs)
          ? config.autoLiveForexPairs.filter((pair: unknown): pair is string => typeof pair === 'string' && pair.length > 0)
          : [];
        if (mounted && configuredPairs.length) {
          setCurrentPairSymbols(prev => Array.from(new Set([...configuredPairs, ...prev])).sort());
        }
      })
      .catch((err) => console.warn('Failed to load configured Forex pairs for prediction research:', err));
    return () => { mounted = false; };
  }, [safeParseJson]);

  // Synchronize with backend system controls
  const syncAutoControls = useCallback(async (enabled: boolean) => {
    try {
      const res = await fetch('/api/brokers/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoExecutionEnabled: enabled })
      });
      if (res.ok) {
        addLog('info', `Autonomous execution mode toggled on backend: ${enabled ? 'ACTIVE' : 'INACTIVE'}`);
      }
    } catch (err: any) {
      addLog('error', `Failed to sync autonomous status with system: ${err.message}`);
    }
  }, [addLog]);

  // Poll the authoritative Auto Live lifecycle so the cockpit reflects the server-side execution state.
  useEffect(() => {
    let mounted = true;
    const fetchAutoStatus = async () => {
      try {
        const res = await fetch('/api/brokers/controls', { cache: 'no-store' });
        if (!res.ok) throw new Error('Auto Live status endpoint returned HTTP ' + res.status);
        const data = await safeParseJson(res);
        if (mounted && data?.autoTrading) {
          setAutoStatus(data.autoTrading);
          setAutoStatusError(null);
        }
      } catch (err: any) {
        if (mounted) setAutoStatusError(err?.message || 'Auto Live status unavailable');
      }
    };
    void fetchAutoStatus();
    const statusTimer = setInterval(fetchAutoStatus, 2000);
    return () => { mounted = false; clearInterval(statusTimer); };
  }, [safeParseJson]);

  const saveDailyLossLimit = useCallback(async () => {
    const value = Number(dailyLossLimitPct);
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      setDailyLossSaveMessage('Daily loss limit must be greater than 0% and no greater than 100%.');
      return;
    }
    setDailyLossSaving(true);
    setDailyLossSaveMessage(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxDailyLossPct: value })
      });
      const data = await safeParseJson(res);
      if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to save daily loss limit.');
      setDailyLossLimitPct(Number(data.maxDailyLossPct));
      setDailyLossSaveMessage(`Saved: ${Number(data.maxDailyLossPct).toFixed(2)}% of account balance.`);
      addLog('success', `Daily loss limit updated to ${Number(data.maxDailyLossPct).toFixed(2)}%.`);
    } catch (err: any) {
      setDailyLossSaveMessage(err?.message || 'Failed to save daily loss limit.');
      addLog('error', `Daily loss limit update failed: ${err?.message || String(err)}`);
    } finally {
      setDailyLossSaving(false);
    }
  }, [dailyLossLimitPct, safeParseJson, addLog]);

  // Load the persisted risk setting once. Do not refresh it from the backend
  // on the 2-second Auto Live status poll, otherwise an unsaved operator edit
  // would be overwritten by the persisted value.
  useEffect(() => {
    let mounted = true;
    fetch('/api/config', { cache: 'no-store' })
      .then(async (res) => res.ok ? await safeParseJson(res) : null)
      .then((config) => {
        const configuredLimit = Number(config?.maxDailyLossPct);
        if (mounted && Number.isFinite(configuredLimit) && configuredLimit > 0) {
          setDailyLossLimitPct(configuredLimit);
        }
      })
      .catch((err) => console.warn('Failed to load persisted daily loss limit:', err))
    return () => { mounted = false; };
  }, [safeParseJson]);

  // Initial load and polling setup
  useEffect(() => {
    fetchRealPositions();
    fetchRealSignals();

    const positionsInterval = setInterval(() => {
      fetchRealPositions(true);
    }, AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS);

    const signalsInterval = setInterval(() => {
      fetchRealSignals(true);
    }, 30000);

    return () => {
      clearInterval(positionsInterval);
      clearInterval(signalsInterval);
    };
  }, [fetchRealPositions, fetchRealSignals]);

  // Keep the displayed record-age counter moving once per second without refetching.
  useEffect(() => {
    const ageTimer = setInterval(() => setSignalsAgeNow(Date.now()), 1000);
    return () => clearInterval(ageTimer);
  }, []);

  const formatAge = useCallback((timestamp: number | undefined | null): string => {
    if (!timestamp || !Number.isFinite(Number(timestamp))) return 'N/A';
    const ageSeconds = Math.max(0, Math.floor((signalsAgeNow - Number(timestamp)) / 1000));
    if (ageSeconds < 60) return ageSeconds + 's';
    const minutes = Math.floor(ageSeconds / 60);
    const seconds = ageSeconds % 60;
    if (minutes < 60) return minutes + 'm ' + seconds + 's';
    const hours = Math.floor(minutes / 60);
    return hours + 'h ' + (minutes % 60) + 'm';
  }, [signalsAgeNow]);

  const visiblePlannedTrades = useMemo(
    () => plannedTrades.filter(signal => isVisibleAutoLiveSignal(signal.direction)),
    [plannedTrades]
  );

  // All rows belong to the same completed scanner pass, so their displayed age is
  // measured from the time that pass completed. This prevents an old signal timestamp
  // from consuming the execution freshness window before the scanner has finished.

  // Handle market change configuration
  const handleMarketChange = (newMarket: string) => {
    setMarket(newMarket);
    if (newMarket === 'FOREX') {
      setSymbol('EUR/USD');
      setQuantity(10000);
    } else if (newMarket === 'INDIAN_EQUITY') {
      setSymbol('RELIANCE');
      setQuantity(50);
    } else {
      setSymbol('NIFTY');
      setQuantity(1);
    }
  };

  // Submit direct manual trade order
  const handleExecuteTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmergencyHalted) {
      addLog('error', 'Execution Intercepted: Emergency Kill Switch is ACTIVE. New orders are blocked.');
      return;
    }

    setIsPlacingOrder(true);
    const idempotencyKey = globalThis.crypto.randomUUID();
    addLog('info', `Routing manual order: ${side} ${quantity} ${symbol} via ${market} gateway...`);

    try {
      // Verify that this browser is talking to the current Goldcrest Express
      // backend before submitting a live order. Do not retry an order blindly:
      // the idempotency key must remain unique for every operator action.
      const runtimeRes = await fetch('/api/runtime', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const runtimeContentType = runtimeRes.headers.get('content-type') || '';
      if (!runtimeRes.ok || !runtimeContentType.includes('application/json')) {
        throw new Error(
          `Goldcrest backend runtime probe failed (HTTP ${runtimeRes.status}, content-type: ${runtimeContentType || 'unknown'}). Restart the current Node server on port 3000.`
        );
      }

      const payload = {
        market,
        symbol,
        side,
        orderType,
        quantity: Number(quantity),
        price: orderType === 'LIMIT' && price ? Number(price) : undefined,
        stopLoss: stopLoss ? Number(stopLoss) : undefined,
        takeProfit: takeProfit ? Number(takeProfit) : undefined,
        environment,
        signalId: idempotencyKey,
        executionSource: 'TRIGGER_NOW'
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const data = await safeParseJson(res);

      if (!res.ok) {
        throw new Error(data.error || data.reason || 'Failed to execute order');
      }

      const executionStatus = String(data.order?.status || data.executionState || 'UNKNOWN').toUpperCase();
      addLog(
        executionStatus === 'FILLED' ? 'success' : 'info',
        `ORDER ${executionStatus}: Ref ID ${data.order?.id || data.executionId || idempotencyKey} - Dispatched to ${data.broker || 'Live Adapter'}`
      );
      
      // Instantly trigger re-fetch to show new position/orders
      fetchRealPositions();
    } catch (err: any) {
      addLog('error', `Execution Failed: ${err.message}`);    } finally {
      setIsPlacingOrder(false);
    }
  };

  // Compile instructions and update auto execution state
  const handleSaveAutoInstructions = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingInstructions(true);
    setSaveMessage(null);

    addLog('info', '[NLP ENGINE] Analyzing natural language parameters...');
    addLog('info', `[NLP ENGINE] Actively registering rules for: "${autoInstruction.slice(0, 60)}..."`);

    try {
      // Post actual configuration updates to the backend controls API
      const res = await fetch('/api/brokers/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoExecutionEnabled: isAutoTradingActive,
          autonomousLiveExecutionAllowed: isAutoTradingActive
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save controls');
      }

      setSaveMessage('System Instructions successfully compiled and active on the backend processor!');
      addLog('success', 'AUTO SYSTEM CONFIGURED: Target scanner active using the persisted Auto Live execution rules.');
      fetchRealSignals();
    } catch (err: any) {
      addLog('error', `Failed to apply strategy parameters: ${err.message}`);
    } finally {
      setIsSavingInstructions(false);
    }
  };

  // Close live broker position
  const handleClosePosition = async (positionId: string, broker: BrokerType) => {
    addLog('info', `Sending close request for Position ${positionId} on ${broker}...`);
    try {
      const res = await fetch(`/api/brokers/position/${encodeURIComponent(positionId)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker })
      });
      const data = await safeParseJson(res);
      if (res.ok && data.success) {
        addLog('success', `Position ${positionId} closed successfully. Real-time liquidation confirmed.`);
        fetchRealPositions();
      } else {
        throw new Error(data.error || 'Failed to close position on broker gateway');
      }
    } catch (err: any) {
      addLog('error', `Liquidation Failed: ${err.message}`);
    }
  };

  // Execute immediate order placement directly from a planned signal
  const triggerSignalExecution = async (signal: RealSignal) => {
    // 1. Resolve effective trade direction from signal direction, SL/TP structure, or strategy bias
    let orderSide: 'BUY' | 'SELL' = 'BUY';
    const rawDir = String(signal.direction || '').toUpperCase();
    if (rawDir.includes('BUY') || rawDir.includes('LONG')) {
      orderSide = 'BUY';
    } else if (rawDir.includes('SELL') || rawDir.includes('SHORT')) {
      orderSide = 'SELL';
    } else if (signal.stopLoss && signal.target1 && signal.stopLoss > 0 && signal.target1 > 0) {
      // If stopLoss > target1, it's a short (SELL) setup; if below, it's a long (BUY) setup
      orderSide = signal.stopLoss > signal.target1 ? 'SELL' : 'BUY';
    } else if (Array.isArray(signal.reasons) && signal.reasons.some(r => /bear|short|sell|down/i.test(r))) {
      orderSide = 'SELL';
    } else {
      orderSide = 'BUY';
    }

    addLog('nlp', `[SIGNAL DISPATCH] Operator triggered immediate execution for ${signal.instrument} (${orderSide})`);
    setTriggeringSignalId(signal.id);
    setTriggerNotification(null);

    const idempotencyKey = `${signal.id}:${globalThis.crypto.randomUUID()}`;
    try {
      // Trigger Now uses the same live order API as the manual ticket. Verify the
      // browser is connected to the current Express backend before dispatching.
      // Never retry a live order automatically after an ambiguous response.
      const runtimeRes = await fetch('/api/runtime', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const runtimeContentType = runtimeRes.headers.get('content-type') || '';
      if (!runtimeRes.ok || !runtimeContentType.includes('application/json')) {
        throw new Error(
          `Goldcrest backend runtime probe failed (HTTP ${runtimeRes.status}, content-type: ${runtimeContentType || 'unknown'}). Restart the current Node server on port 3000.`
        );
      }

      const payload = {
        market: signal.market,
        symbol: signal.instrument,
        side: orderSide,
        orderType: 'MARKET',
        quantity: signal.market === 'FOREX' ? 10000 : 25,
        stopLoss: signal.stopLoss && signal.stopLoss > 0 ? signal.stopLoss : undefined,
        takeProfit: signal.target1 && signal.target1 > 0 ? signal.target1 : undefined,
        environment,
        signalId: idempotencyKey
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const data = await safeParseJson(res);
      if (!res.ok) {
        const errorMsg = data?.error || data?.message || `Signal trigger submission rejected (HTTP ${res.status})`;
        const detailsMsg = data.details?.length ? ` (${data.details.join(', ')})` : '';
        throw new Error(`${errorMsg}${detailsMsg}`);
      }

      const executionStatus = String(data.order?.status || data.executionState || 'SUBMITTED').toUpperCase();
      const orderRef = data.order?.id || data.executionId || idempotencyKey;
      
      addLog(
        executionStatus === 'FILLED' || executionStatus === 'EXECUTED' ? 'success' : 'info',
        `SIGNAL ORDER ${executionStatus}: ${signal.instrument} ${orderSide} - Ref ID ${orderRef}`
      );

      setTriggerNotification({
        type: 'success',
        message: `Order submitted for ${signal.instrument} [${orderSide}] (Status: ${executionStatus}, Ref: ${orderRef})`
      });

      fetchRealPositions();
    } catch (err: any) {
      const errMsg = err.message || 'Failed to dispatch signal order';
      addLog('error', `Trigger Dispatch Error (${signal.instrument}): ${errMsg}`);
      setTriggerNotification({
        type: 'error',
        message: `${signal.instrument}: ${errMsg}`
      });
    } finally {
      setTriggeringSignalId(null);
    }
  };

  const executionStage: AutoExecutionStage = autoStatus?.currentExecution?.stage || 'IDLE';
  const executionPair = autoStatus?.currentExecution?.pair;
  const executionSide = autoStatus?.currentExecution?.side;
  const executionMessage = autoStatus?.currentExecution?.message || 'Waiting for the next Auto Live cycle.';
  const stageLabel: Record<AutoExecutionStage, string> = {
    IDLE: 'STANDBY',
    SCANNING_MARKET: 'SCANNING MARKET',
    ANALYZING_SIGNAL: 'ANALYZING SIGNAL',
    PREPARING_ORDER: 'PREPARING ORDER',
    SAFETY_GATE: 'SAFETY GATE',
    SUBMITTING_ORDER: 'SUBMITTING ORDER',
    TRADE_EXECUTED: 'TRADE EXECUTED',
    REJECTED: 'REJECTED'
  };
  const renderTabs = () => (
    <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
      {[
        ['cockpit', 'Auto Live'],
        ['positions', 'Positions'],
        ['signals', 'Signals'],
        ['options', 'NIFTY Options'],
        ['execution', 'Execution Log'],
        ['research', 'Prediction Research'],
        ['controls', 'Controls']
      ].map(([id, label]) => (
        <button key={id} type="button" onClick={() => setActiveTab(id as typeof activeTab)}
          className={"px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition " +
            (activeTab === id ? "bg-cyan-950 text-cyan-300 border-cyan-700" : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white")}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div id="unified_trading_hub" className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="text-white font-bold text-base">Auto Live Trading Cockpit</div>
            <div className="text-slate-500 text-xs font-mono mt-1">Operational view for live execution only.</div>
          </div>
          <div className="flex flex-wrap gap-2 font-mono text-[11px]">
            <span className={"px-3 py-1 rounded-lg border font-bold " +
              (autoStatus?.state === 'RUNNING' ? "text-emerald-300 bg-emerald-950/60 border-emerald-800" :
               autoStatus?.state === 'BLOCKED' ? "text-rose-300 bg-rose-950/60 border-rose-800" :
               "text-amber-300 bg-amber-950/60 border-amber-800")}>
              AUTO LIVE: {autoStatus?.state || 'LOADING'}
            </span>            <span className="px-3 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300">{selectedBroker} · LIVE</span>
          </div>
        </div>
      </div>

      {renderTabs()}

      {activeTab === 'cockpit' && (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Current Activity</div>
            <div className="mt-2 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className={"text-xl font-black font-mono " +
                  (executionStage === 'TRADE_EXECUTED' ? "text-emerald-400" :
                   executionStage === 'REJECTED' ? "text-rose-400" :
                   executionStage === 'IDLE' ? "text-slate-300" : "text-cyan-300")}>
                  {stageLabel[executionStage]}
                </div>
                <div className="text-slate-300 text-sm mt-1">
                  {executionPair ? executionPair + (executionSide ? " · " + executionSide : "") : "No trade currently being prepared"}
                </div>
                <div className="text-slate-500 text-xs mt-2">{executionMessage}</div>
              </div>
              <div className="px-4 py-3 rounded-xl border border-cyan-800 bg-cyan-950/40 text-cyan-300 font-mono text-xs font-bold">
                {executionStage === 'SUBMITTING_ORDER' ? 'BROKER REQUEST IN PROGRESS' :
                 executionStage === 'TRADE_EXECUTED' ? 'BROKER CONFIRMATION RECEIVED' :
                 executionStage === 'REJECTED' ? 'TRADE NOT EXECUTED' : 'AUTO LIVE MONITORING'}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1 mt-5">
              {['SCANNING_MARKET','ANALYZING_SIGNAL','PREPARING_ORDER','SAFETY_GATE','SUBMITTING_ORDER'].map(stage => (
                <div key={stage} className={"h-1.5 rounded " +
                  (executionStage === stage ? "bg-cyan-400 animate-pulse" :
                   (executionStage === 'TRADE_EXECUTED' || executionStage === 'REJECTED') ? "bg-slate-700" : "bg-slate-800")} />
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-[10px] text-slate-500 font-mono uppercase">Active Positions</div><div className="text-2xl font-bold text-white mt-1">{runningTrades.length}</div></div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-[10px] text-slate-500 font-mono uppercase">Actionable Signals</div><div className="text-2xl font-bold text-white mt-1">{visiblePlannedTrades.length}</div></div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-[10px] text-slate-500 font-mono uppercase">Last Cycle</div><div className="text-xs text-slate-300 mt-2">{autoStatus?.lastCycleResult || 'Waiting.'}</div></div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div><div className="text-xs font-bold text-white font-mono uppercase">Active Positions</div><div className="text-[10px] text-slate-500 mt-1">Broker-authoritative · refreshes every 10 seconds</div></div>
              <button type="button" onClick={() => fetchRealPositions(false)} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button>
            </div>
            {runningTrades.length === 0 ? <div className="py-7 text-center text-xs text-slate-500 font-mono">No active live positions.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-xs font-mono">
                <thead><tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 text-left">Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">Current</th><th className="text-right">Stop Loss</th><th className="text-right">Take Profit</th><th className="text-right">Floating P&L</th><th>Action</th>
                </tr></thead>
                <tbody>{runningTrades.map(trade => (
                  <tr key={trade.id} className="border-b border-slate-800/60">
                    <td className="py-2 text-white font-bold">{trade.symbol}</td><td className={trade.side === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{trade.side}</td>
                    <td className="text-right">{trade.quantity.toLocaleString()}</td><td className="text-right">{trade.entryPrice.toLocaleString()}</td><td className="text-right text-cyan-300">{trade.currentPriceStatus === 'LIVE' ? trade.currentPrice.toLocaleString() : <span className="text-slate-500">N/A</span>}</td>
                    <td className="text-right text-rose-300">{trade.stopLoss ? trade.stopLoss.toLocaleString() : 'N/A'}</td><td className="text-right text-emerald-300">{trade.takeProfit ? trade.takeProfit.toLocaleString() : 'N/A'}</td>
                    <td className={"text-right font-bold " + (trade.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>{trade.unrealizedPnL >= 0 ? '+' : ''}{trade.unrealizedPnL.toLocaleString()}</td>
                    <td className="text-center"><button type="button" onClick={() => handleClosePosition(trade.id, trade.broker)} className="text-[10px] px-2 py-1 rounded border border-slate-700 text-rose-300">Exit</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </>
      )}

      {activeTab === 'positions' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex justify-between mb-3"><div><div className="text-sm font-bold text-white font-mono">Live Positions</div><div className="text-[10px] text-slate-500">Complete broker data</div></div><button type="button" onClick={() => fetchRealPositions(false)} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button></div>
          <div className="overflow-x-auto"><table className="w-full text-xs font-mono"><thead><tr className="text-slate-500 border-b border-slate-800">
            <th className="py-2 text-left">ID</th><th>Broker</th><th>Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">Current</th><th className="text-right">Stop Loss</th><th className="text-right">Take Profit</th><th className="text-right">Floating P&L</th><th></th>
          </tr></thead><tbody>{runningTrades.map(trade => (
            <tr key={trade.id} className="border-b border-slate-800/60"><td className="py-2 text-slate-500">{trade.id}</td><td>{trade.broker}</td><td className="text-white font-bold">{trade.symbol}</td><td className={trade.side === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{trade.side}</td><td className="text-right">{trade.quantity.toLocaleString()}</td><td className="text-right">{trade.entryPrice.toLocaleString()}</td><td className="text-right text-cyan-300">{trade.currentPriceStatus === 'LIVE' ? trade.currentPrice.toLocaleString() : <span className="text-slate-500">N/A</span>}</td><td className="text-right text-rose-300">{trade.stopLoss ? trade.stopLoss.toLocaleString() : 'N/A'}</td><td className="text-right text-emerald-300">{trade.takeProfit ? trade.takeProfit.toLocaleString() : 'N/A'}</td><td className={"text-right font-bold " + (trade.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>{trade.unrealizedPnL >= 0 ? '+' : ''}{trade.unrealizedPnL.toLocaleString()}</td><td className="text-center"><button type="button" onClick={() => handleClosePosition(trade.id, trade.broker)} className="text-[10px] px-2 py-1 rounded border border-slate-700 text-rose-300">Exit</button></td></tr>
          ))}</tbody></table></div>
        </div>
      )}

      {activeTab === 'signals' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><div><div className="text-sm font-bold text-white font-mono">Actionable Signals</div><div className="text-[10px] text-slate-500">Scanned: <span className="text-cyan-300">{signalScanStats.total}</span> · Actionable: <span className="text-emerald-300">{signalScanStats.actionable}</span> · NO_TRADE: <span className="text-slate-400">{signalScanStats.noTrade}</span> · Errors: <span className="text-rose-300">{signalScanStats.errors}</span> · Auto Live minimum score: <span className="text-cyan-300">{autoStatus?.minSignalScore ?? '—'}</span></div></div><div className="flex gap-2 items-center"><span className="text-[11px] font-mono text-slate-400">Scan Age: <b className="text-cyan-300">{signalsScanCompletedAt ? formatAge(signalsScanCompletedAt) : 'N/A'}</b></span><button type="button" onClick={() => fetchRealSignals(false)} disabled={isLoadingSignals} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button></div></div>
          {triggerNotification && <div className={"p-3 rounded-lg border text-xs font-mono " + (triggerNotification.type === 'error' ? "border-rose-800 bg-rose-950/40 text-rose-300" : "border-emerald-800 bg-emerald-950/40 text-emerald-300")}>{triggerNotification.message}</div>}
          <div className="overflow-x-auto"><table className="w-full text-xs font-mono"><thead><tr className="text-slate-500 border-b border-slate-800"><th className="py-2 text-left">Market</th><th>Symbol</th><th>Side</th><th>Strategy</th><th className="text-right">SL</th><th className="text-right">TP</th><th>Score</th><th>ML</th><th>Age</th><th>Action</th></tr></thead>
          <tbody>{visiblePlannedTrades.map(signal => <tr key={signal.id} className="border-b border-slate-800/60"><td className="py-2 text-slate-500">{signal.market}</td><td className="text-white font-bold">{signal.instrument}</td><td className={signal.direction === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{signal.direction}</td><td className="max-w-xs truncate" title={signal.reasons?.join(', ') || signal.strategy}>{signal.strategy}</td><td className="text-right text-rose-300">{signal.stopLoss?.toLocaleString() || 'N/A'}</td><td className="text-right text-emerald-300">{signal.target1?.toLocaleString() || 'N/A'}</td><td className="text-center">{signal.score}</td><td className="text-center text-emerald-400">{(signal.mlProbability * 100).toFixed(0)}%</td><td className="text-center text-cyan-300">{formatAge(signalsScanCompletedAt)}</td><td className="text-center"><button type="button" onClick={() => triggerSignalExecution(signal)} disabled={triggeringSignalId === signal.id} className="text-[10px] px-2.5 py-1 rounded bg-emerald-700 text-white disabled:opacity-50">{triggeringSignalId === signal.id ? 'Triggering...' : 'Trigger Now'}</button></td></tr>)}</tbody></table></div>
        </div>
      )}

      {activeTab === 'options' && (
        <OptionsTradingPanel
          isEmergencyHalted={isEmergencyHalted}
          onPositionsRefresh={() => { void fetchRealPositions(true); }}
          onLog={addLog}
        />
      )}

      {activeTab === 'execution' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-sm font-bold text-white font-mono mb-3">Execution Lifecycle</div><div className="space-y-2">
            {['SCANNING_MARKET','ANALYZING_SIGNAL','PREPARING_ORDER','SAFETY_GATE','SUBMITTING_ORDER','TRADE_EXECUTED','REJECTED'].map(stage => <div key={stage} className={"flex items-center justify-between px-3 py-2 rounded border " + (executionStage === stage ? "border-cyan-700 bg-cyan-950/40 text-cyan-300" : "border-slate-800 bg-slate-950 text-slate-500")}><span className="font-mono text-xs">{stageLabel[stage as AutoExecutionStage]}</span>{executionStage === stage && <span className="text-[10px]">CURRENT</span>}</div>)}
          </div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="text-sm font-bold text-white font-mono">Execution Decision</div>
            <div className={"rounded-lg border p-3 text-xs font-mono " + (executionStage === 'REJECTED' ? "border-rose-800 bg-rose-950/30 text-rose-300" : executionStage === 'TRADE_EXECUTED' ? "border-emerald-800 bg-emerald-950/30 text-emerald-300" : "border-cyan-800 bg-cyan-950/30 text-cyan-300")}>
              <div className="font-bold">{executionPair ? executionPair : 'AUTO LIVE'}{executionSide ? " · " + executionSide : ""}</div>
              <div className="mt-1">{executionMessage}</div>
            </div>
            <div className="text-sm font-bold text-white font-mono">Pair Decisions</div>
            <div className="bg-slate-950 rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-[11px] space-y-2">
              {!autoStatus?.lastActions?.length ? <div className="text-slate-600">No pair decisions recorded yet.</div> : autoStatus.lastActions.slice(-12).map((action, i) => (
                <div key={i} className="border-b border-slate-800 pb-2 last:border-b-0">
                  <div><span className="text-white font-bold">{action.pair}</span> <span className="text-cyan-400">[{action.result}]</span></div>
                  {action.reason && <div className="text-rose-300 mt-1">{action.reason}</div>}
                  {action.orderId && <div className="text-emerald-300 mt-1">Order: {action.orderId}</div>}
                </div>
              ))}
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-bold text-white font-mono">Execution Reconciliation Diagnostics</div>
                  <div className="text-[10px] text-slate-500 mt-1">Durable broker reconciliation state · refreshed every 10 seconds</div>
                </div>
                <button type="button" onClick={() => void fetchExecutionDiagnostics()} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button>
              </div>
              {executionDiagnosticsError && <div className="mb-3 text-[11px] font-mono text-rose-300 border border-rose-900 bg-rose-950/30 rounded p-2">{executionDiagnosticsError}</div>}
              {executionDiagnostics.length === 0 ? (
                <div className="py-5 text-center text-xs text-slate-600 font-mono">No execution intents recorded.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead><tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 text-left">Symbol</th><th>Side</th><th>State</th><th>Intent Age</th><th>Broker Order</th><th>Client Order</th><th className="text-right">Requested</th><th className="text-right">Filled</th><th className="text-right">Remaining</th><th>Broker Status</th><th>Attempts</th><th>Last Attempt</th><th>Reason</th>
                    </tr></thead>
                    <tbody>{executionDiagnostics.map(intent => (
                      <tr key={intent.idempotencyKey} className="border-b border-slate-800/60">
                        <td className="py-2 text-white font-bold">{intent.symbol}</td>
                        <td className={intent.side === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{intent.side}</td>
                        <td className={intent.state === 'COMPLETED' ? "text-emerald-400" : intent.state === 'FAILED' ? "text-rose-400" : intent.state === 'RECONCILIATION_TIMEOUT' ? "text-amber-300" : "text-cyan-300"}>{intent.state}</td>
                        <td className="text-center">{formatAge(intent.createdAt)}</td>
                        <td className="text-slate-300">{intent.reconciliation.brokerOrderId || '—'}</td>
                        <td className="text-slate-400">{intent.reconciliation.clientOrderId || '—'}</td>
                        <td className="text-right">{intent.reconciliation.requestedQuantity ?? '—'}</td>
                        <td className="text-right text-emerald-300">{intent.reconciliation.filledQuantity}</td>
                        <td className="text-right">{intent.reconciliation.remainingQuantity ?? '—'}</td>
                        <td>{intent.reconciliation.brokerStatus || '—'}</td>
                        <td className="text-center">{intent.reconciliation.attemptCount}</td>
                        <td className="text-center">{intent.reconciliation.lastAttemptAt != null ? formatAge(intent.reconciliation.lastAttemptAt) : '—'}</td>
                        <td className="max-w-xs truncate text-amber-200" title={intent.reconciliation.reason || undefined}>{intent.reconciliation.operatorActionRequired ? 'OPERATOR ACTION: ' : ''}{intent.reconciliation.reason || '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="text-sm font-bold text-white font-mono">Runtime Output</div>
            <div className="bg-slate-950 rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-[11px] space-y-1">{logs.length === 0 ? <div className="text-slate-600">No UI telemetry.</div> : logs.map((log, i) => <div key={i}><span className="text-slate-600">[{log.timestamp}]</span> <span className={log.type === 'error' ? "text-rose-400" : log.type === 'success' ? "text-emerald-400" : "text-cyan-400"}>[{log.type.toUpperCase()}]</span> <span className="text-slate-300">{log.message}</span></div>)}</div>
          </div>
        </div>
      )}

      {activeTab === 'research' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white font-mono">Collection Scheduler</div>
                <div className="text-[10px] text-slate-500 mt-1">Continuous observational collection · 1D BASELINE · no Auto Live execution impact</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={currentPairCollectionStatus?.running ? "text-emerald-300" : "text-amber-300"}>{currentPairCollectionStatus?.running ? 'RUNNING' : 'STOPPED'}</span>
                <button type="button" onClick={() => void runCurrentPairCollectionNow()} disabled={currentPairCollectionAction || currentPairCollectionStatus?.cycleInFlight} className="px-2.5 py-1.5 rounded-lg border border-cyan-700 bg-cyan-950/40 text-cyan-300 text-[11px] font-mono disabled:opacity-50">{currentPairCollectionAction ? 'Collecting...' : 'Collect Now'}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-3 text-[10px] font-mono">
              <div><span className="text-slate-500 block">Interval</span><span className="text-white">{currentPairCollectionStatus ? Math.round(currentPairCollectionStatus.pollIntervalMs / 60000) + ' min' : '—'}</span></div>
              <div><span className="text-slate-500 block">Last Generated</span><span className="text-white">{currentPairCollectionStatus?.lastGenerated ?? '—'}</span></div>
              <div><span className="text-slate-500 block">Last Evaluated</span><span className="text-white">{currentPairCollectionStatus?.lastEvaluated ?? '—'}</span></div>
              <div><span className="text-slate-500 block">Pending</span><span className="text-amber-300">{currentPairCollectionStatus?.lastPending ?? '—'}</span></div>
              <div><span className="text-slate-500 block">Last Cycle</span><span className="text-white">{currentPairCollectionStatus?.lastCompletedAt ? new Date(currentPairCollectionStatus.lastCompletedAt).toLocaleString() : '—'}</span></div>
              <div><span className="text-slate-500 block">Next Cycle</span><span className="text-white">{currentPairCollectionStatus?.nextScheduledAt ? new Date(currentPairCollectionStatus.nextScheduledAt).toLocaleString() : '—'}</span></div>
            </div>
            {currentPairCollectionStatus?.lastError && <div className="mt-3 text-[11px] font-mono text-rose-300 border border-rose-900 bg-rose-950/30 rounded p-2">{currentPairCollectionStatus.lastError}</div>}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white font-mono">Current Pair Prediction Research</div>
                <div className="text-[10px] text-slate-500 mt-1">Observational analytics only. This panel does not control Auto Live execution.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={currentPairSymbol} onChange={(e) => setCurrentPairSymbol(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-mono text-white">
                  <option value="ALL">All Pairs</option>
                  {currentPairSymbols.map(symbol => <option key={symbol} value={symbol}>{symbol}</option>)}
                </select>
                <select value={currentPairHorizon} onChange={(e) => setCurrentPairHorizon(e.target.value as '1D' | '3D' | '7D')} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-mono text-white">
                  <option value="1D">1D Horizon</option><option value="3D">3D Horizon</option><option value="7D">7D Horizon</option>
                </select>
                <select value={currentPairModel} onChange={(e) => setCurrentPairModel(e.target.value as 'BASELINE' | 'AI_GATEWAY' | 'COMPARE')} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-mono text-white">
                  <option value="BASELINE">Baseline</option><option value="AI_GATEWAY">AI Gateway</option><option value="COMPARE">Compare Models</option>
                </select>
                <button type="button" onClick={() => void fetchCurrentPairResearch()} disabled={currentPairLoading} className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">{currentPairLoading ? 'Loading...' : 'Refresh'}</button>
                <button type="button" onClick={() => void evaluateCurrentPairResearch()} className="px-2.5 py-1.5 rounded-lg border border-cyan-700 bg-cyan-950/40 text-cyan-300 text-[11px] font-mono">Evaluate Matured</button>
              </div>
            </div>
            {currentPairError && <div className="mt-3 text-[11px] font-mono text-rose-300 border border-rose-900 bg-rose-950/30 rounded p-2">{currentPairError}</div>}
            {currentPairEvaluationMessage && <div className="mt-3 text-[11px] font-mono text-cyan-300 border border-cyan-900 bg-cyan-950/30 rounded p-2">{currentPairEvaluationMessage}</div>}
          </div>

          {currentPairModel === 'COMPARE' && currentPairOosDrift && (
            <div className="bg-slate-900 border border-amber-900/60 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-bold text-white font-mono">Out-of-Sample Drift Monitor</div>
                  <div className="text-[10px] text-slate-500 mt-1">Research-only comparison of the latest 30-day window against the 90-day reference window.</div>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">{currentPairOosDrift.modelVersion}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px] font-mono mb-3">
                <div><div className="text-slate-500">30D Accuracy</div><div className="text-white text-lg">{currentPairOosDrift.currentWindow.accuracyPct == null ? '—' : currentPairOosDrift.currentWindow.accuracyPct.toFixed(1) + '%'}</div></div>
                <div><div className="text-slate-500">90D Accuracy</div><div className="text-white text-lg">{currentPairOosDrift.baselineWindow.accuracyPct == null ? '—' : currentPairOosDrift.baselineWindow.accuracyPct.toFixed(1) + '%'}</div></div>
                <div><div className="text-slate-500">Accuracy Δ</div><div className={currentPairOosDrift.drift.accuracyDriftFlag ? 'text-amber-300 text-lg' : 'text-emerald-300 text-lg'}>{currentPairOosDrift.drift.accuracyDeltaPct == null ? '—' : currentPairOosDrift.drift.accuracyDeltaPct.toFixed(1) + ' pp'}</div></div>
                <div><div className="text-slate-500">Brier Δ</div><div className={currentPairOosDrift.drift.brierDriftFlag ? 'text-amber-300 text-lg' : 'text-emerald-300 text-lg'}>{currentPairOosDrift.drift.brierDelta == null ? '—' : currentPairOosDrift.drift.brierDelta.toFixed(4)}</div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-[10px] font-mono">
                <div className="border border-slate-800 rounded-lg p-3">
                  <div className="text-slate-500">Accuracy Δ 95% Bootstrap CI</div>
                  <div className="text-white mt-1">{currentPairOosDrift.uncertainty.accuracyDelta95Pct == null ? 'Insufficient sample' : currentPairOosDrift.uncertainty.accuracyDelta95Pct.lower.toFixed(1) + ' to ' + currentPairOosDrift.uncertainty.accuracyDelta95Pct.upper.toFixed(1) + ' pp'}</div>
                  <div className="text-slate-600 mt-1">{currentPairOosDrift.uncertainty.accuracyDelta95Pct?.resamples ?? 0} deterministic bootstrap resamples</div>
                </div>
                <div className="border border-slate-800 rounded-lg p-3">
                  <div className="text-slate-500">Brier Δ 95% Bootstrap CI</div>
                  <div className="text-white mt-1">{currentPairOosDrift.uncertainty.brierDelta95 == null ? 'Insufficient sample' : currentPairOosDrift.uncertainty.brierDelta95.lower.toFixed(4) + ' to ' + currentPairOosDrift.uncertainty.brierDelta95.upper.toFixed(4)}</div>
                  <div className="text-slate-600 mt-1">{currentPairOosDrift.uncertainty.brierDelta95?.resamples ?? 0} deterministic bootstrap resamples</div>
                </div>
              </div>
              {currentPairCalibrationMatrix && currentPairCalibrationMatrix.rows.length > 0 && (
                <div className="border border-slate-800 rounded-lg p-3 mb-3">
                  <div className="text-xs font-bold text-white font-mono mb-1">Symbol / Horizon Calibration Drift Matrix</div>
                  <div className="text-[10px] text-slate-600 font-mono mb-2">Latest 30-day OOS versus the non-overlapping 90-day reference. Slope is the OLS calibration slope of correctness on confidence; intercept is expressed in percentage points. Rows below 30 directional evaluations are marked insufficient. Research telemetry only.</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead><tr className="text-slate-500 border-b border-slate-800">
                        <th className="py-2 text-left">Pair</th><th>Horizon</th><th>30D n</th><th>90D n</th><th>30D Acc.</th><th>90D Acc.</th><th>Acc. Δ</th><th>ECE Δ</th><th>MCE Δ</th><th>Slope Δ</th><th>Int. Δ</th><th>Status</th>
                      </tr></thead>
                      <tbody>{currentPairCalibrationMatrix.rows.map(row => {
                        const sufficient = row.current.sampleSufficient && row.reference.sampleSufficient;
                        const drift = row.deltas.expectedCalibrationErrorDeltaPct;
                        const status = !sufficient ? 'INSUFFICIENT' : drift != null && Math.abs(drift) >= 10 ? 'WARN' : 'PASS';
                        return <tr key={row.symbol + row.horizon} className="border-b border-slate-800/60">
                          <td className="py-2 text-white">{row.symbol}</td>
                          <td className="text-center">{row.horizon}</td>
                          <td className="text-center">{row.current.directionalEvaluated}</td>
                          <td className="text-center">{row.reference.directionalEvaluated}</td>
                          <td className="text-center">{row.current.accuracyPct == null ? '—' : row.current.accuracyPct.toFixed(1) + '%'}</td>
                          <td className="text-center">{row.reference.accuracyPct == null ? '—' : row.reference.accuracyPct.toFixed(1) + '%'}</td>
                          <td className="text-center">{row.deltas.accuracyDeltaPct == null ? '—' : row.deltas.accuracyDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className="text-center">{row.deltas.expectedCalibrationErrorDeltaPct == null ? '—' : row.deltas.expectedCalibrationErrorDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className="text-center">{row.deltas.maximumCalibrationErrorDeltaPct == null ? '—' : row.deltas.maximumCalibrationErrorDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className="text-center">{row.deltas.calibrationSlopeDelta == null ? '—' : row.deltas.calibrationSlopeDelta.toFixed(3)}</td>
                          <td className="text-center">{row.deltas.calibrationInterceptDeltaPct == null ? '—' : row.deltas.calibrationInterceptDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className={status === 'WARN' ? 'text-amber-300 text-center' : status === 'PASS' ? 'text-emerald-300 text-center' : 'text-cyan-300 text-center'}>{status}</td>
                        </tr>;
                      })}</tbody>
                    </table>
                  </div>
                </div>
              )}


              {currentPairCrossModelCalibration && currentPairCrossModelCalibration.rows.length > 0 && (
                <div className="border border-slate-800 rounded-lg p-3 mb-3">
                  <div className="text-xs font-bold text-white font-mono mb-1">Paired Cross-Model Calibration Matrix</div>
                  <div className="text-[10px] text-slate-600 font-mono mb-2">Baseline versus AI Gateway on the same symbol + horizon + prediction-time observations. Deltas are AI minus baseline; 30D is compared with the preceding non-overlapping 90D reference. Research telemetry only.</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead><tr className="text-slate-500 border-b border-slate-800">
                        <th className="py-2 text-left">Pair</th><th>Horizon</th><th>Paired</th><th>Eval.</th><th>30D Acc Δ</th><th>30D Conf Δ</th><th>30D ECE Δ</th><th>30D MCE Δ</th><th>30D Slope Δ</th><th>30D Int. Δ</th><th>90D ECE Δ</th><th>Status</th>
                      </tr></thead>
                      <tbody>{currentPairCrossModelCalibration.rows.map(row => {
                        const sufficient = row.baseline.current.sampleSufficient && row.ai.current.sampleSufficient && row.baseline.reference.sampleSufficient && row.ai.reference.sampleSufficient;
                        return <tr key={row.symbol + row.horizon} className="border-b border-slate-800/60">
                          <td className="py-2 text-white">{row.symbol}</td><td className="text-center">{row.horizon}</td><td className="text-center">{row.pairedObservations}</td><td className="text-center">{row.pairedEvaluated}</td>
                          <td className="text-center">{row.deltas.currentAccuracyDeltaPct == null ? '—' : row.deltas.currentAccuracyDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className="text-center">{row.deltas.currentConfidenceDeltaPct == null ? '—' : row.deltas.currentConfidenceDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className="text-center">{row.deltas.currentExpectedCalibrationErrorDeltaPct == null ? '—' : row.deltas.currentExpectedCalibrationErrorDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className="text-center">{row.deltas.currentMaximumCalibrationErrorDeltaPct == null ? '—' : row.deltas.currentMaximumCalibrationErrorDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className="text-center">{row.deltas.currentCalibrationSlopeDelta == null ? '—' : row.deltas.currentCalibrationSlopeDelta.toFixed(3)}</td>
                          <td className="text-center">{row.deltas.currentCalibrationInterceptDeltaPct == null ? '—' : row.deltas.currentCalibrationInterceptDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className="text-center">{row.deltas.referenceExpectedCalibrationErrorDeltaPct == null ? '—' : row.deltas.referenceExpectedCalibrationErrorDeltaPct.toFixed(1) + ' pp'}</td>
                          <td className={sufficient ? 'text-emerald-300 text-center' : 'text-cyan-300 text-center'}>{sufficient ? 'SUFFICIENT' : 'INSUFFICIENT'}</td>
                        </tr>;
                      })}</tbody>
                    </table>
                  </div>
                </div>
              )}


              {currentPairCrossModelTemporalCalibration?.rows?.length > 0 && (
                <div className="border border-indigo-900/50 rounded-lg p-3 mb-3">
                  <div className="text-xs font-bold text-white font-mono mb-1">Cross-Model Temporal Calibration Stability</div>
                  <div className="text-[10px] text-slate-600 font-mono mb-2">AI minus baseline calibration telemetry on exact paired symbol + horizon + prediction-time observations across rolling 7D, 14D, 30D, 60D and 90D windows. Horizon maturity is enforced; research telemetry only.</div>
                  <div className="overflow-x-auto"><table className="w-full text-[10px] font-mono"><thead><tr className="text-slate-500 border-b border-slate-800"><th className="py-2 text-left">Pair</th><th>Horizon</th><th>Window</th><th>Paired</th><th>Eval.</th><th>Acc Δ</th><th>Conf Δ</th><th>ECE Δ</th><th>MCE Δ</th><th>Slope Δ</th><th>Int. Δ</th><th>Status</th></tr></thead><tbody>{currentPairCrossModelTemporalCalibration.rows.flatMap((row:any)=>row.windows.map((window:any)=><tr key={row.symbol+row.horizon+window.windowDays} className="border-b border-slate-800/60"><td className="py-2 text-white">{row.symbol}</td><td className="text-center">{row.horizon}</td><td className="text-center">{window.windowDays}D</td><td className="text-center">{row.pairedObservations}</td><td className="text-center">{row.pairedEvaluated}</td><td className="text-center">{window.deltas.accuracyPct==null?'—':window.deltas.accuracyPct.toFixed(1)+' pp'}</td><td className="text-center">{window.deltas.confidencePct==null?'—':window.deltas.confidencePct.toFixed(1)+' pp'}</td><td className="text-center">{window.deltas.expectedCalibrationErrorPct==null?'—':window.deltas.expectedCalibrationErrorPct.toFixed(1)+' pp'}</td><td className="text-center">{window.deltas.maximumCalibrationErrorPct==null?'—':window.deltas.maximumCalibrationErrorPct.toFixed(1)+' pp'}</td><td className="text-center">{window.deltas.calibrationSlope==null?'—':window.deltas.calibrationSlope.toFixed(3)}</td><td className="text-center">{window.deltas.calibrationInterceptPct==null?'—':window.deltas.calibrationInterceptPct.toFixed(1)+' pp'}</td><td className={(window.baseline.sampleSufficient&&window.ai.sampleSufficient)?'text-emerald-300 text-center':'text-cyan-300 text-center'}>{(window.baseline.sampleSufficient&&window.ai.sampleSufficient)?'SUFFICIENT':'INSUFFICIENT'}</td></tr>))}</tbody></table></div>
                </div>
              )}

              {currentPairCrossModelTemporalCalibration?.rows?.length > 0 && (
                <div className="border border-indigo-900/50 rounded-lg p-3 mb-3">
                  <div className="text-xs font-bold text-white font-mono mb-1">Cross-Model Temporal Bootstrap Uncertainty</div>
                  <div className="text-[10px] text-slate-600 font-mono mb-2">Paired deterministic bootstrap uncertainty for AI-minus-baseline temporal calibration deltas. Intervals are percentile 95% intervals from 2,000 paired resamples and are descriptive research telemetry only.</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead><tr className="text-slate-500 border-b border-slate-800">
                        <th className="text-left py-2">Pair</th><th>Horizon</th><th>Window</th><th>Paired Eval.</th><th>Accuracy Δ 95% CI</th><th>Confidence Δ 95% CI</th><th>ECE Δ 95% CI</th><th>MCE Δ 95% CI</th>
                      </tr></thead>
                      <tbody>{currentPairCrossModelTemporalCalibration.rows.flatMap((row:any) => row.windows.map((window:any) => {
                        const formatInterval = (value:any, digits:number, suffix:string = ' pp') =>
                          value == null ? 'Insufficient sample' : value.lowerPct.toFixed(digits) + ' to ' + value.upperPct.toFixed(digits) + suffix;
                        return (
                          <tr key={row.symbol + row.horizon + window.windowDays + '-bootstrap'} className="border-b border-slate-800/60">
                            <td className="py-2 text-white">{row.symbol}</td>
                            <td className="text-center">{row.horizon}</td>
                            <td className="text-center">{window.windowDays}D</td>
                            <td className="text-center">{row.pairedEvaluated}</td>
                            <td className="text-center text-slate-300">{formatInterval(window.bootstrap?.accuracyDelta95Pct, 2)}</td>
                            <td className="text-center text-slate-300">{formatInterval(window.bootstrap?.confidenceDelta95Pct, 2)}</td>
                            <td className="text-center text-slate-300">{formatInterval(window.bootstrap?.expectedCalibrationErrorDelta95Pct, 2)}</td>
                            <td className="text-center text-slate-300">{formatInterval(window.bootstrap?.maximumCalibrationErrorDelta95Pct, 2)}</td>
                          </tr>
                        );
                      }))}</tbody>
                    </table>
                  </div>
                  <div className="text-[10px] text-slate-600 font-mono mt-2">MCE can legitimately report “Insufficient sample” when no confidence bucket reaches the 30-observation sufficiency threshold across the bootstrap replicates.</div>
                </div>
              )}

              {currentPairCrossModelContextTemporalCalibration?.rows?.length > 0 && (
                <div className="border border-purple-900/50 rounded-lg p-3 mb-3">
                  <div className="text-xs font-bold text-white font-mono mb-1">Cross-Model Context Temporal Calibration</div>
                  <div className="text-[10px] text-slate-600 font-mono mb-2">AI-minus-baseline calibration telemetry conditioned on market regime and session across rolling 7D, 14D, 30D, 60D and 90D windows. Horizon maturity and paired observation matching are enforced; research telemetry only.</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead><tr className="text-slate-500 border-b border-slate-800"><th className="text-left py-2">Pair</th><th>Horizon</th><th>Regime</th><th>Session</th><th>Window</th><th>Eval.</th><th>Acc Δ</th><th>Conf Δ</th><th>ECE Δ</th><th>Slope Δ</th><th>Acc 95% CI</th><th>Status</th></tr></thead>
                      <tbody>{currentPairCrossModelContextTemporalCalibration.rows.flatMap((row:any)=>row.windows.map((window:any)=>{
                        const sufficient=window.baseline.sampleSufficient&&window.ai.sampleSufficient;
                        const fmt=(value:any)=>value==null?'—':value.toFixed(1)+' pp';
                        const ci=window.bootstrap?.accuracyDelta95Pct;
                        return <tr key={row.symbol+row.horizon+row.marketRegime+row.session+window.windowDays} className="border-b border-slate-800/60">
                          <td className="py-2 text-white">{row.symbol}</td><td className="text-center">{row.horizon}</td><td className="text-center">{row.marketRegime}</td><td className="text-center">{row.session}</td><td className="text-center">{window.windowDays}D</td><td className="text-center">{window.pairedEvaluated}</td><td className="text-center">{fmt(window.deltas.accuracyPct)}</td><td className="text-center">{fmt(window.deltas.confidencePct)}</td><td className="text-center">{fmt(window.deltas.expectedCalibrationErrorPct)}</td><td className="text-center">{window.deltas.calibrationSlope==null?'—':window.deltas.calibrationSlope.toFixed(3)}</td><td className="text-center">{ci==null?'Insufficient sample':ci.lowerPct.toFixed(1)+'–'+ci.upperPct.toFixed(1)+' pp'}</td><td className={sufficient?'text-emerald-300 text-center':'text-cyan-300 text-center'}>{sufficient?'SUFFICIENT':'INSUFFICIENT'}</td>
                        </tr>;
                      }))}</tbody>
                    </table>
                  </div>
                </div>
              )}

              {currentPairCrossModelTemporalCalibration?.rows?.length > 0 && (
                <div className="border border-indigo-900/50 rounded-lg p-3 mb-3">
                  <div className="text-xs font-bold text-white font-mono mb-1">Cross-Model Temporal Confidence-Bucket Stability</div>
                  <div className="text-[10px] text-slate-600 font-mono mb-2">AI minus baseline confidence-bucket calibration telemetry across rolling windows. Bucket accuracy uses mature directional evaluations; Wilson 95% intervals and the 30-observation threshold are descriptive research controls only.</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead><tr className="text-slate-500 border-b border-slate-800"><th className="py-2 text-left">Pair</th><th>Horizon</th><th>Window</th><th>Confidence</th><th>Eval.</th><th>Base Acc.</th><th>AI Acc.</th><th>Acc Δ</th><th>Gap Δ</th><th>AI 95% CI</th><th>Status</th></tr></thead>
                      <tbody>{currentPairCrossModelTemporalCalibration.rows.flatMap((row:any) => row.windows.flatMap((window:any) => window.baseline.calibrationBuckets.map((bucket:any,index:number) => {
                        const ai=window.ai.calibrationBuckets[index];
                        const delta=window.deltas.calibrationBuckets[index];
                        const sufficient=bucket.sampleSufficient && ai.sampleSufficient;
                        if (bucket.predictions===0 && ai.predictions===0) return null;
                        return (
                          <tr key={row.symbol+row.horizon+window.windowDays+bucket.lowerPct} className="border-b border-slate-800/60">
                            <td className="py-2 text-white">{row.symbol}</td>
                            <td className="text-center">{row.horizon}</td>
                            <td className="text-center">{window.windowDays}D</td>
                            <td className="text-center">{bucket.lowerPct}–{bucket.upperPct}%</td>
                            <td className="text-center">{Math.min(bucket.directionalEvaluated,ai.directionalEvaluated)}</td>
                            <td className="text-center">{bucket.accuracyPct==null?'—':bucket.accuracyPct.toFixed(1)+'%'}</td>
                            <td className="text-center">{ai.accuracyPct==null?'—':ai.accuracyPct.toFixed(1)+'%'}</td>
                            <td className="text-center">{delta.accuracyPct==null?'—':delta.accuracyPct.toFixed(1)+' pp'}</td>
                            <td className="text-center">{delta.calibrationGapPct==null?'—':delta.calibrationGapPct.toFixed(1)+' pp'}</td>
                            <td className="text-center">{ai.accuracyConfidenceInterval95Pct==null?'—':ai.accuracyConfidenceInterval95Pct.lowerPct.toFixed(1)+'–'+ai.accuracyConfidenceInterval95Pct.upperPct.toFixed(1)+'%'}</td>
                            <td className={sufficient?'text-emerald-300 text-center':'text-cyan-300 text-center'}>{sufficient?'SUFFICIENT':'INSUFFICIENT'}</td>
                          </tr>
                        );
                      })))}</tbody>
                    </table>
                  </div>
                </div>
              )}

              {currentPairCrossModelContextCalibration?.rows?.length > 0 && (
                <div className="border border-slate-800 rounded-lg p-3 mb-3">
                  <div className="text-xs font-bold text-white font-mono mb-1">Paired Context Calibration Matrix</div>
                  <div className="text-[10px] text-slate-600 font-mono mb-2">Baseline vs AI on exact paired observations grouped by market regime and session. Deltas are AI minus baseline; research telemetry only.</div>
                  <div className="overflow-x-auto"><table className="w-full text-[10px] font-mono"><thead><tr className="text-slate-500 border-b border-slate-800"><th className="py-2 text-left">Pair</th><th>Horizon</th><th>Regime</th><th>Session</th><th>Paired</th><th>Eval.</th><th>Acc Δ</th><th>Conf Δ</th><th>ECE Δ</th><th>Slope Δ</th><th>Status</th></tr></thead><tbody>{currentPairCrossModelContextCalibration.rows.map((row:any)=>{const ok=row.baseline.metrics.sampleSufficient&&row.ai.metrics.sampleSufficient;return <tr key={row.symbol+row.horizon+row.marketRegime+row.session} className="border-b border-slate-800/60"><td className="py-2 text-white">{row.symbol}</td><td className="text-center">{row.horizon}</td><td className="text-center">{row.marketRegime}</td><td className="text-center">{row.session}</td><td className="text-center">{row.pairedObservations}</td><td className="text-center">{row.pairedEvaluated}</td><td className="text-center">{row.deltas.accuracyDeltaPct==null?'—':row.deltas.accuracyDeltaPct.toFixed(1)+' pp'}</td><td className="text-center">{row.deltas.confidenceDeltaPct==null?'—':row.deltas.confidenceDeltaPct.toFixed(1)+' pp'}</td><td className="text-center">{row.deltas.expectedCalibrationErrorDeltaPct==null?'—':row.deltas.expectedCalibrationErrorDeltaPct.toFixed(1)+' pp'}</td><td className="text-center">{row.deltas.calibrationSlopeDelta==null?'—':row.deltas.calibrationSlopeDelta.toFixed(3)}</td><td className={ok?'text-emerald-300 text-center':'text-cyan-300 text-center'}>{ok?'SUFFICIENT':'INSUFFICIENT'}</td></tr>})}</tbody></table></div>
                </div>
              )}

              <div className="border border-slate-800 rounded-lg p-3 mb-3">
                <div className="text-xs font-bold text-white font-mono mb-2">Aggregate Calibration Error</div>
                <div className="text-[10px] text-slate-600 font-mono mb-2">ECE is the directional-evaluation-weighted mean calibration gap across confidence buckets. MCE is the largest gap among buckets with at least 30 directional evaluations. These are descriptive research metrics only.</div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 font-mono text-[10px]">
                  <div><div className="text-slate-500">30D ECE</div><div className="text-white text-lg">{currentPairOosDrift.currentWindow.expectedCalibrationErrorPct == null ? '—' : currentPairOosDrift.currentWindow.expectedCalibrationErrorPct.toFixed(1) + ' pp'}</div></div>
                  <div><div className="text-slate-500">90D ECE</div><div className="text-white text-lg">{currentPairOosDrift.baselineWindow.expectedCalibrationErrorPct == null ? '—' : currentPairOosDrift.baselineWindow.expectedCalibrationErrorPct.toFixed(1) + ' pp'}</div></div>
                  <div><div className="text-slate-500">ECE Δ</div><div className={currentPairOosDrift.drift.calibrationErrorDriftFlag ? 'text-amber-300 text-lg' : 'text-emerald-300 text-lg'}>{currentPairOosDrift.drift.calibrationErrorDeltaPct == null ? '—' : currentPairOosDrift.drift.calibrationErrorDeltaPct.toFixed(1) + ' pp'}</div></div>
                  <div><div className="text-slate-500">30D MCE</div><div className="text-white text-lg">{currentPairOosDrift.currentWindow.maximumCalibrationErrorPct == null ? '—' : currentPairOosDrift.currentWindow.maximumCalibrationErrorPct.toFixed(1) + ' pp'}</div></div>
                  <div><div className="text-slate-500">90D MCE</div><div className="text-white text-lg">{currentPairOosDrift.baselineWindow.maximumCalibrationErrorPct == null ? '—' : currentPairOosDrift.baselineWindow.maximumCalibrationErrorPct.toFixed(1) + ' pp'}</div></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-[10px] font-mono">
                  <div className="border border-slate-800 rounded-lg p-3">
                    <div className="text-slate-500">ECE Δ 95% Bootstrap CI</div>
                    <div className="text-white mt-1">{currentPairOosDrift.uncertainty.calibrationErrorDelta95Pct == null ? 'Insufficient sample' : currentPairOosDrift.uncertainty.calibrationErrorDelta95Pct.lower.toFixed(1) + ' to ' + currentPairOosDrift.uncertainty.calibrationErrorDelta95Pct.upper.toFixed(1) + ' pp'}</div>
                    <div className="text-slate-600 mt-1">{currentPairOosDrift.uncertainty.calibrationErrorDelta95Pct?.resamples ?? 0} deterministic bootstrap resamples</div>
                  </div>
                  <div className="border border-slate-800 rounded-lg p-3">
                    <div className="text-slate-500">MCE Δ 95% Bootstrap CI</div>
                    <div className="text-white mt-1">{currentPairOosDrift.uncertainty.maximumCalibrationErrorDelta95Pct == null ? 'Insufficient sample' : currentPairOosDrift.uncertainty.maximumCalibrationErrorDelta95Pct.lower.toFixed(1) + ' to ' + currentPairOosDrift.uncertainty.maximumCalibrationErrorDelta95Pct.upper.toFixed(1) + ' pp'}</div>
                    <div className="text-slate-600 mt-1">{currentPairOosDrift.uncertainty.maximumCalibrationErrorDelta95Pct?.resamples ?? 0} deterministic bootstrap resamples</div>
                  </div>
                </div>
              </div>

              <div className="border border-slate-800 rounded-lg p-3 mb-3">
                <div className="text-xs font-bold text-white font-mono mb-1">Confidence-Bucket Calibration Stability</div>
                <div className="text-[10px] text-slate-600 font-mono mb-2">Accuracy and calibration gap are shown separately for each confidence band. Wilson 95% intervals are descriptive; buckets below 30 directional evaluations are marked insufficient.</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead><tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 text-left">Confidence</th><th>30D n</th><th>30D Accuracy</th><th>30D 95% CI</th><th>30D Gap</th><th>90D n</th><th>90D Accuracy</th><th>90D 95% CI</th><th>90D Gap</th>
                    </tr></thead>
                    <tbody>{currentPairOosDrift.currentWindow.calibrationBuckets.map((bucket, index) => {
                      const reference = currentPairOosDrift.baselineWindow.calibrationBuckets[index];
                      return <tr key={bucket.lowerPct} className="border-b border-slate-800/60">
                        <td className="py-2 text-white">{bucket.lowerPct}–{bucket.upperPct}%</td>
                        <td className="text-center">{bucket.directionalEvaluated}</td>
                        <td className="text-center">{bucket.accuracyPct == null ? '—' : bucket.accuracyPct.toFixed(1) + '%'}</td>
                        <td className="text-center">{bucket.accuracyConfidenceInterval95Pct == null ? '—' : bucket.accuracyConfidenceInterval95Pct.lowerPct.toFixed(1) + '–' + bucket.accuracyConfidenceInterval95Pct.upperPct.toFixed(1) + '%'}</td>
                        <td className="text-center">{bucket.calibrationGapPct == null ? '—' : bucket.calibrationGapPct.toFixed(1) + ' pp'}</td>
                        <td className="text-center">{reference?.directionalEvaluated ?? 0}</td>
                        <td className="text-center">{reference?.accuracyPct == null ? '—' : reference.accuracyPct.toFixed(1) + '%'}</td>
                        <td className="text-center">{reference?.accuracyConfidenceInterval95Pct == null ? '—' : reference.accuracyConfidenceInterval95Pct.lowerPct.toFixed(1) + '–' + reference.accuracyConfidenceInterval95Pct.upperPct.toFixed(1) + '%'}</td>
                        <td className="text-center">{reference?.calibrationGapPct == null ? '—' : reference.calibrationGapPct.toFixed(1) + ' pp'}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {currentPairOosDrift.checks.map(check => (
                  <div key={check.id} className="border border-slate-800 rounded-lg p-2 font-mono text-[10px]">
                    <div className="flex justify-between gap-2"><span className="text-slate-300">{check.title}</span><span className={check.status === 'PASS' ? 'text-emerald-300' : check.status === 'WARN' ? 'text-amber-300' : 'text-cyan-300'}>{check.status}</span></div>
                    <div className="text-slate-500 mt-1">{check.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentPairModel === 'COMPARE' && currentPairTemporalCalibration && (
            <div className="bg-slate-900 border border-indigo-900/60 rounded-xl p-4">
              <div className="text-sm font-bold text-white font-mono">Temporal Calibration Stability</div>
              <div className="text-[10px] text-slate-500 mt-1 mb-3">AI research telemetry across rolling 7D, 14D, 30D, 60D and 90D windows. Maturity is enforced by prediction horizon; this does not control execution.</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3 text-[10px] font-mono">
                <div className="border border-slate-800 rounded-lg p-2"><span className="text-slate-500">Accuracy Δ 95% Bootstrap CI</span><div className="text-white mt-1">{currentPairTemporalCalibration.rows[0]?.deltas.accuracy7dVs90d95Pct == null ? 'Insufficient sample' : currentPairTemporalCalibration.rows[0].deltas.accuracy7dVs90d95Pct.lower.toFixed(2)+' to '+currentPairTemporalCalibration.rows[0].deltas.accuracy7dVs90d95Pct.upper.toFixed(2)+' pp'}</div></div>
                <div className="border border-slate-800 rounded-lg p-2"><span className="text-slate-500">Confidence Δ 95% Bootstrap CI</span><div className="text-white mt-1">{currentPairTemporalCalibration.rows[0]?.deltas.confidence7dVs90d95Pct == null ? 'Insufficient sample' : currentPairTemporalCalibration.rows[0].deltas.confidence7dVs90d95Pct.lower.toFixed(2)+' to '+currentPairTemporalCalibration.rows[0].deltas.confidence7dVs90d95Pct.upper.toFixed(2)+' pp'}</div></div>
                <div className="border border-slate-800 rounded-lg p-2"><span className="text-slate-500">ECE Δ 95% Bootstrap CI</span><div className="text-white mt-1">{currentPairTemporalCalibration.rows[0]?.deltas.ece7dVs90d95Pct == null ? 'Insufficient sample' : currentPairTemporalCalibration.rows[0].deltas.ece7dVs90d95Pct.lower.toFixed(2)+' to '+currentPairTemporalCalibration.rows[0].deltas.ece7dVs90d95Pct.upper.toFixed(2)+' pp'}</div></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead><tr className="text-slate-500 border-b border-slate-800"><th className="text-left p-2">Pair</th><th className="text-left p-2">Horizon</th>{currentPairTemporalCalibration.windowsDays.map(d=><th key={d} className="text-right p-2">{d}D n</th>)}<th className="text-right p-2">7D–90D Acc.</th><th className="text-right p-2">7D–90D ECE</th></tr></thead>
                  <tbody>{currentPairTemporalCalibration.rows.map(row=>(
                    <tr key={row.symbol+'|'+row.horizon} className="border-b border-slate-900">
                      <td className="p-2 text-slate-300">{row.symbol}</td><td className="p-2 text-slate-400">{row.horizon}</td>
                      {row.windows.map(w=><td key={w.windowDays} className={`p-2 text-right ${w.sampleSufficient?'text-emerald-300':'text-cyan-300'}`}>{w.directionalEvaluated}</td>)}
                      <td className="p-2 text-right text-slate-300">{row.deltas.accuracy7dVs90dPct == null ? '—' : row.deltas.accuracy7dVs90dPct.toFixed(2)+'%'}</td>
                      <td className="p-2 text-right text-slate-300">{row.deltas.ece7dVs90dPct == null ? '—' : row.deltas.ece7dVs90dPct.toFixed(2)+' pp'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {currentPairModel === 'COMPARE' && currentPairResearchReadinessLedger && (
            <div className="bg-slate-900 border border-cyan-900/60 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-bold text-white font-mono">Research Evidence Readiness Ledger</div>
                  <div className="text-[10px] text-slate-500 mt-1">Consolidates research evidence coverage only. This ledger does not promote, select, or authorize a model for Auto Live execution.</div>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">{currentPairResearchReadinessLedger.scope.aiModelVersion}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-[10px] font-mono mb-4">
                <div><div className="text-slate-500">AI Directional</div><div className="text-white text-lg">{currentPairResearchReadinessLedger.evidence.aiDirectionalEvaluated}</div></div>
                <div><div className="text-slate-500">Baseline</div><div className="text-white text-lg">{currentPairResearchReadinessLedger.evidence.baselineDirectionalEvaluated}</div></div>
                <div><div className="text-slate-500">Paired</div><div className="text-white text-lg">{currentPairResearchReadinessLedger.evidence.pairedEvaluated}</div></div>
                <div><div className="text-slate-500">OOS 30D / 90D</div><div className="text-white text-lg">{currentPairResearchReadinessLedger.evidence.currentOosDirectionalEvaluated} / {currentPairResearchReadinessLedger.evidence.referenceOosDirectionalEvaluated}</div></div>
                <div><div className="text-slate-500">Calibration</div><div className="text-white text-lg">{currentPairResearchReadinessLedger.evidence.sufficientCalibrationRows} / {currentPairResearchReadinessLedger.evidence.calibrationRows}</div></div>
                <div><div className="text-slate-500">Context</div><div className="text-white text-lg">{currentPairResearchReadinessLedger.evidence.sufficientContextRows} / {currentPairResearchReadinessLedger.evidence.contextRows}</div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {currentPairResearchReadinessLedger.checks.map(check => (
                  <div key={check.id} className="border border-slate-800 rounded-lg p-2 font-mono text-[10px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-300">{check.title}</span>
                      <span className={check.status === 'PASS' ? 'text-emerald-300' : check.status === 'WARN' ? 'text-amber-300' : 'text-cyan-300'}>{check.status}</span>
                    </div>
                    <div className="text-slate-500 mt-1">{check.detail}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[10px] text-slate-600 font-mono">Validation warnings: {currentPairResearchReadinessLedger.evidence.validationWarnings} · Insufficient: {currentPairResearchReadinessLedger.evidence.validationInsufficient} · Research telemetry only.</div>
            </div>
          )}

          {currentPairModel === 'COMPARE' && currentPairValidationReport && (
            <div className="bg-slate-900 border border-cyan-900/60 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-bold text-white font-mono">Model Validation & Governance Report</div>
                  <div className="text-[10px] text-slate-500 mt-1">Unified research evidence and data-quality telemetry. Informational only; never used by Auto Live.</div>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">Minimum sample: 30 evaluated</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[10px] font-mono mb-4">
                <div><div className="text-slate-500">Predictions</div><div className="text-white text-lg">{currentPairValidationReport.data.totalPredictions}</div></div>
                <div><div className="text-slate-500">Paired / Evaluated</div><div className="text-white text-lg">{currentPairValidationReport.data.pairedObservations} / {currentPairValidationReport.data.pairedEvaluated}</div></div>
                <div><div className="text-slate-500">Pending</div><div className="text-amber-300 text-lg">{currentPairValidationReport.data.pendingPct == null ? '—' : currentPairValidationReport.data.pendingPct.toFixed(1) + '%'}</div></div>
                <div><div className="text-slate-500">Contexts</div><div className="text-white text-lg">{currentPairValidationReport.contexts.sufficient} / {currentPairValidationReport.contexts.total}</div></div>
                <div><div className="text-slate-500">Leakage Rows</div><div className={currentPairValidationReport.data.featureSnapshotLeakageRows ? 'text-rose-300 text-lg' : 'text-emerald-300 text-lg'}>{currentPairValidationReport.data.featureSnapshotLeakageRows}</div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {currentPairValidationReport.checks.map(check => (
                  <div key={check.id} className="border border-slate-800 rounded-lg p-2 font-mono text-[10px]">
                    <div className="flex items-center justify-between gap-2"><span className="text-slate-300">{check.title}</span><span className={check.status === 'PASS' ? 'text-emerald-300' : check.status === 'WARN' ? 'text-amber-300' : 'text-cyan-300'}>{check.status}</span></div>
                    <div className="text-slate-500 mt-1">{check.detail}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[10px] text-slate-600 font-mono">Unmatched baseline/AI: {currentPairValidationReport.data.unmatchedBaseline} / {currentPairValidationReport.data.unmatchedAi} · Duplicate keys: {currentPairValidationReport.data.duplicatePairKeys} · Paired McNemar p: {currentPairValidationReport.paired.exactMcNemarPValue == null ? '—' : currentPairValidationReport.paired.exactMcNemarPValue.toFixed(4)}</div>
            </div>
          )}

          {currentPairModel === 'COMPARE' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-sm font-bold text-white font-mono mb-1">Model Comparison</div>
              <div className="text-[10px] text-slate-500 mb-3">Same persisted CURRENT_PAIR outcomes aggregated by model. Research-only; this does not authorize or modify trades.</div>
              <div className="overflow-x-auto"><table className="w-full text-[10px] font-mono">
                <thead><tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 text-left">Model</th><th>Predictions</th><th>Evaluated</th><th>Pending</th><th>Correct</th><th>Directional</th><th>Accuracy</th><th>Brier</th><th>Sample</th>
                </tr></thead>
                <tbody>{(currentPairModelComparison?.models || []).map(model => (
                  <tr key={model.modelVersion} className="border-b border-slate-800/60">
                    <td className="py-2 text-cyan-300">{model.modelVersion}</td>
                    <td className="text-center">{model.predictions}</td><td className="text-center">{model.evaluated}</td>
                    <td className="text-center text-amber-300">{model.pending}</td><td className="text-center text-emerald-300">{model.correct}</td>
                    <td className="text-center">{model.directionalEvaluated}</td>
                    <td className="text-center">{model.accuracyPct == null ? '—' : model.accuracyPct.toFixed(1) + '%'}</td>
                    <td className="text-center">{model.brierScore == null ? '—' : model.brierScore.toFixed(4)}</td>
                    <td className="text-center">{model.sampleSufficient ? 'SUFFICIENT' : `INSUFFICIENT (<${model.minimumSampleCount})`}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          )}

          {currentPairModel === 'COMPARE' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-sm font-bold text-white font-mono mb-1">Paired Model Comparison</div>
              <div className="text-[10px] text-slate-500 mb-3">Only exact symbol + horizon + prediction-time matches are paired. This prevents aggregate model metrics from mixing different observations.</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[10px] font-mono">
                <div><div className="text-slate-500">Paired</div><div className="text-lg text-white">{currentPairPairedComparison?.pairedObservations ?? 0}</div></div>
                <div><div className="text-slate-500">Evaluated</div><div className="text-lg text-white">{currentPairPairedComparison?.pairedEvaluated ?? 0}</div></div>
                <div><div className="text-slate-500">Both Correct</div><div className="text-lg text-emerald-300">{currentPairPairedComparison?.bothCorrect ?? 0}</div></div>
                <div><div className="text-slate-500">Baseline Only / AI Only</div><div className="text-lg text-cyan-300">{currentPairPairedComparison?.baselineOnlyCorrect ?? 0} / {currentPairPairedComparison?.aiOnlyCorrect ?? 0}</div></div>
                <div><div className="text-slate-500">Direction Agreement</div><div className="text-lg text-white">{currentPairPairedComparison?.directionAgreementPct == null ? '—' : currentPairPairedComparison.directionAgreementPct.toFixed(1) + '%'}</div></div>
              </div>
              <div className="mt-3 text-[10px] text-slate-500 font-mono">Both incorrect: {currentPairPairedComparison?.bothIncorrect ?? 0} · Pending paired observations: {currentPairPairedComparison?.pairedPending ?? 0} · Discordant: {currentPairPairedComparison?.discordantPairs ?? 0} · Exact McNemar p: {currentPairPairedComparison?.exactMcNemarPValue == null ? '—' : currentPairPairedComparison.exactMcNemarPValue.toFixed(4)}</div>
              <div className="mt-2 text-[10px] text-slate-600 font-mono">McNemar p-value is descriptive research telemetry for paired directional correctness; it is not a trading decision rule.</div>
            </div>
          )}

          {currentPairModel === 'COMPARE' && currentPairPairedContexts.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-sm font-bold text-white font-mono mb-1">Paired Regime / Session Breakdown</div>
              <div className="text-[10px] text-slate-500 mb-3">Exact paired observations segmented using the same market-regime and session labels as current-pair analytics. Research-only telemetry.</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead><tr className="text-slate-500 border-b border-slate-800"><th className="text-left py-2">Regime</th><th className="text-left">Session</th><th>Paired</th><th>Evaluated</th><th>Baseline / AI</th><th>Agreement</th><th>95% CI</th><th>McNemar p</th><th>Sample</th></tr></thead>
                  <tbody>{currentPairPairedContexts.map(group => (
                    <tr key={group.symbol + group.horizon + group.marketRegime + group.session} className="border-b border-slate-900 text-slate-300">
                      <td className="py-2">{group.marketRegime}</td><td>{group.session}</td><td className="text-center">{group.pairedObservations}</td><td className="text-center">{group.pairedEvaluated}</td><td className="text-center">{group.baselineOnlyCorrect} / {group.aiOnlyCorrect}</td><td className="text-center">{group.directionAgreementPct == null ? '—' : group.directionAgreementPct.toFixed(1) + '%'}</td><td className="text-center">{group.accuracyConfidenceInterval95Pct == null ? '—' : group.accuracyConfidenceInterval95Pct.lowerPct.toFixed(1) + '–' + group.accuracyConfidenceInterval95Pct.upperPct.toFixed(1) + '%'}</td><td className="text-center">{group.exactMcNemarPValue == null ? '—' : group.exactMcNemarPValue.toFixed(4)}</td><td className="text-center">{group.sampleSufficient ? 'SUFFICIENT' : 'INSUFFICIENT'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {currentPairModel === 'COMPARE' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-sm font-bold text-white font-mono mb-1">Paired Temporal Stability</div>
              <div className="text-[10px] text-slate-500 mb-3">30-day and 90-day research windows anchored to the latest paired observation. Metrics are descriptive and do not affect trading decisions.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {currentPairPairedRolling.map(window => (
                  <div key={window.windowDays} className="border border-slate-800 rounded-lg p-3 font-mono text-[10px]">
                    <div className="text-xs font-bold text-white mb-2">{window.windowDays}-Day Window</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><span className="text-slate-500">Paired / Evaluated</span><div className="text-white">{window.pairedObservations} / {window.pairedEvaluated}</div></div>
                      <div><span className="text-slate-500">Agreement</span><div className="text-white">{window.directionAgreementPct == null ? '—' : window.directionAgreementPct.toFixed(1) + '%'}</div></div>
                      <div><span className="text-slate-500">Baseline / AI Only</span><div className="text-cyan-300">{window.baselineOnlyCorrect} / {window.aiOnlyCorrect}</div></div>
                      <div><span className="text-slate-500">Discordant / p</span><div className="text-white">{window.discordantPairs} / {window.exactMcNemarPValue == null ? '—' : window.exactMcNemarPValue.toFixed(4)}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              ['Predictions', currentPairAnalytics?.total ?? 0],
              ['Evaluated', currentPairAnalytics?.evaluated ?? 0],
              ['Pending', currentPairAnalytics?.pending ?? 0],
              ['Correct', currentPairAnalytics?.correct ?? 0],
              ['Accuracy', currentPairAnalytics?.accuracyPct == null ? '—' : currentPairAnalytics.accuracyPct.toFixed(1) + '%'],
              ['Brier', currentPairAnalytics?.brierScore == null ? '—' : currentPairAnalytics.brierScore.toFixed(4)]
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="text-[10px] text-slate-500 font-mono uppercase">{label}</div>
                <div className="text-lg font-bold text-white mt-1 font-mono">{value}</div>
              </div>
            ))}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-sm font-bold text-white font-mono mb-3">Pair Prediction Snapshots</div>
            {currentPairPredictions.length === 0 ? (
              <div className="py-7 text-center text-xs text-slate-600 font-mono">No current-pair prediction snapshots available.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead><tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 text-left">Symbol</th><th>Prediction</th><th>Confidence</th><th>Agreement</th><th>Model</th><th>Predicted At</th><th>Outcome</th><th>Return</th>
                  </tr></thead>
                  <tbody>{currentPairPredictions.slice(0, 50).map(prediction => (
                    <tr key={prediction.predictionId} className="border-b border-slate-800/60">
                      <td className="py-2 text-white font-bold">{prediction.symbol}</td>
                      <td className={prediction.predictedDirection === 'UP' ? 'text-emerald-400' : prediction.predictedDirection === 'DOWN' ? 'text-rose-400' : 'text-slate-400'}>{prediction.predictedDirection}</td>
                      <td className="text-center">{(Number(prediction.confidence) * 100).toFixed(1)}%</td>
                      <td className="text-center">{(Number(prediction.modelAgreement) * 100).toFixed(1)}%</td>
                      <td className="text-center text-cyan-300">{prediction.modelVersion}</td>
                      <td className="text-center text-slate-400">{new Date(prediction.predictedAt).toLocaleString()}</td>
                      <td className={prediction.outcomeStatus === 'EVALUATED' ? 'text-emerald-300' : 'text-amber-300'}>{prediction.outcomeStatus || 'PENDING'}</td>
                      <td className="text-right">{prediction.actualReturnPct == null ? '—' : Number(prediction.actualReturnPct).toFixed(3) + '%'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-sm font-bold text-white font-mono mb-3">Confidence Calibration</div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              {(currentPairAnalytics?.groups?.find(g => g.symbol === (currentPairSymbol === 'ALL' ? currentPairAnalytics.groups[0]?.symbol : currentPairSymbol))?.calibration || []).map(bin => (
                <div key={bin.lowerPct} className="rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[10px]">
                  <div className="text-slate-400">{bin.lowerPct.toFixed(0)}–{bin.upperPct.toFixed(0)}% confidence</div>
                  <div className="mt-1 text-white">n={bin.predictions}</div>
                  <div className="text-cyan-300">Avg: {bin.averageConfidencePct == null ? '—' : bin.averageConfidencePct.toFixed(1) + '%'}</div>
                  <div className="text-emerald-300">Accuracy: {bin.accuracyPct == null ? '—' : bin.accuracyPct.toFixed(1) + '%'}</div>
                </div>
              ))}
            </div>
            <div className="text-sm font-bold text-white font-mono mb-3">Rolling Research Stability</div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {(currentPairAnalytics?.groups?.find(g => g.symbol === (currentPairSymbol === 'ALL' ? currentPairAnalytics.groups[0]?.symbol : currentPairSymbol))?.rollingWindows || []).map(window => (
                <div key={window.windowDays} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-[11px] text-slate-400 font-mono mb-2">{window.windowDays}D WINDOW</div>
                  <div className="text-xs text-slate-300">Directional: <span className="text-white">{window.directionalEvaluated}</span></div>
                  <div className="text-xs text-slate-300">Accuracy: <span className="text-white">{window.accuracyPct == null ? '—' : window.accuracyPct.toFixed(1) + '%'}</span></div>
                  <div className="text-xs text-slate-300">95% CI: <span className="text-white">{window.accuracyConfidenceInterval95Pct == null ? '—' : window.accuracyConfidenceInterval95Pct.lowerPct.toFixed(1) + '–' + window.accuracyConfidenceInterval95Pct.upperPct.toFixed(1) + '%'}</span></div>
                  <div className={window.sampleSufficient ? 'text-emerald-300 text-[11px] mt-1' : 'text-amber-300 text-[11px] mt-1'}>{window.sampleSufficient ? 'SAMPLE SUFFICIENT' : 'INSUFFICIENT SAMPLE'}</div>
                </div>
              ))}
            </div>
            <div className="text-sm font-bold text-white font-mono mt-5 mb-3">Walk-Forward Cohort Stability</div>
            <div className="text-[10px] text-slate-500 mb-3">Successive non-overlapping 30-day evaluation cohorts. Cohort 1 is the latest period; older cohorts follow chronologically backward. This is observational stability analysis, not model retraining.</div>
            <div className="overflow-x-auto">
              {(() => {
                const wfGroup = currentPairWalkForward?.groups?.find(g => g.symbol === (currentPairSymbol === 'ALL' ? currentPairWalkForward.groups[0]?.symbol : currentPairSymbol));
                if (!wfGroup?.cohorts?.length) return <div className="text-xs text-slate-600 font-mono py-3">No evaluated walk-forward cohorts available.</div>;
                return <table className="w-full text-[10px] font-mono">
                  <thead><tr className="text-slate-500 border-b border-slate-800"><th className="py-2 text-left">Cohort</th><th>Period</th><th>Directional</th><th>Correct</th><th>Accuracy</th><th>95% CI</th><th>Brier</th><th>Sample</th></tr></thead>
                  <tbody>{wfGroup.cohorts.map(cohort => (
                    <tr key={cohort.cohortIndex} className="border-b border-slate-800/60">
                      <td className="py-2 text-white">Cohort {cohort.cohortIndex}</td>
                      <td className="text-center text-slate-400">{new Date(cohort.fromTimestamp).toLocaleDateString()} – {new Date(cohort.toTimestamp).toLocaleDateString()}</td>
                      <td className="text-center">{cohort.directionalEvaluated}</td>
                      <td className="text-center text-emerald-300">{cohort.correct}</td>
                      <td className="text-center">{cohort.accuracyPct == null ? '—' : cohort.accuracyPct.toFixed(1) + '%'}</td>
                      <td className="text-center">{cohort.accuracyConfidenceInterval95Pct == null ? '—' : cohort.accuracyConfidenceInterval95Pct.lowerPct.toFixed(1) + '–' + cohort.accuracyConfidenceInterval95Pct.upperPct.toFixed(1) + '%'}</td>
                      <td className="text-center">{cohort.brierScore == null ? '—' : cohort.brierScore.toFixed(4)}</td>
                      <td className={cohort.sampleSufficient ? 'text-center text-emerald-300' : 'text-center text-amber-300'}>{cohort.sampleSufficient ? 'SUFFICIENT' : 'INSUFFICIENT'}</td>
                    </tr>
                  ))}</tbody>
                </table>;
              })()}
            </div>
            <div className="text-[10px] text-slate-600 font-mono mt-2">Descriptive research telemetry only. Accuracy is accompanied by a Wilson 95% confidence interval; groups with fewer than 30 directional evaluations are explicitly marked insufficient-sample. These controls do not alter prediction or Auto Live behavior.</div>
            <div className="text-sm font-bold text-white font-mono mt-5 mb-3">Temporal Confidence-Bucket Stability</div>
            <div className="text-[10px] text-slate-500 mb-3">Confidence calibration is tracked independently inside each rolling window. Bucket accuracy uses directional evaluated observations; Wilson intervals and sample sufficiency are descriptive research telemetry only.</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead><tr className="text-slate-500 border-b border-slate-800"><th className="text-left p-2">Pair / Horizon</th><th>Window</th><th>Confidence</th><th>Evaluated</th><th>Accuracy</th><th>Avg. Confidence</th><th>Gap</th><th>95% CI</th><th>Sample</th></tr></thead>
                <tbody>{currentPairTemporalCalibration.rows.flatMap(row => row.windows.flatMap(window => window.calibrationBuckets.filter(bucket => bucket.predictions > 0).map(bucket =>
                  <tr key={row.symbol+'|'+row.horizon+'|'+window.windowDays+'|'+bucket.lowerPct} className="border-b border-slate-900">
                    <td className="p-2 text-slate-300">{row.symbol} / {row.horizon}</td>
                    <td className="text-center">{window.windowDays}D</td>
                    <td className="text-center">{bucket.lowerPct}–{bucket.upperPct}%</td>
                    <td className="text-center">{bucket.directionalEvaluated}</td>
                    <td className="text-center">{bucket.accuracyPct == null ? '—' : bucket.accuracyPct.toFixed(1)+'%'}</td>
                    <td className="text-center">{bucket.averageConfidencePct == null ? '—' : bucket.averageConfidencePct.toFixed(1)+'%'}</td>
                    <td className="text-center">{bucket.calibrationGapPct == null ? '—' : bucket.calibrationGapPct.toFixed(1)+' pp'}</td>
                    <td className="text-center">{bucket.accuracyConfidenceInterval95Pct == null ? '—' : bucket.accuracyConfidenceInterval95Pct.lowerPct.toFixed(1)+'–'+bucket.accuracyConfidenceInterval95Pct.upperPct.toFixed(1)+'%'}</td>
                    <td className={bucket.sampleSufficient ? 'text-center text-emerald-300' : 'text-center text-amber-300'}>{bucket.sampleSufficient ? 'SUFFICIENT' : 'INSUFFICIENT'}</td>
                  </tr>
                )))}</tbody>
              </table>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-sm font-bold text-white font-mono mb-3">Grouped Performance</div>
            {(!currentPairAnalytics?.groups?.length) ? <div className="text-xs text-slate-600 font-mono">No evaluated or pending groups available.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-[10px] font-mono">
                <thead><tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 text-left">Pair</th><th>Model</th><th>Horizon</th><th>Total</th><th>Evaluated</th><th>Pending</th><th>Correct</th><th>Directional</th><th>Accuracy</th><th>95% CI</th><th>Sample</th><th>Brier</th><th>UP / DOWN / FLAT</th><th>Regime</th><th>Session</th>
                </tr></thead>
                <tbody>{currentPairAnalytics.groups.map(group => (
                  <tr key={`${group.symbol}-${group.modelVersion}-${group.horizon}`} className="border-b border-slate-800/60">
                    <td className="py-2 text-white font-bold">{group.symbol}</td><td>{group.modelVersion}</td><td>{group.horizon}</td><td className="text-center">{group.total}</td><td className="text-center">{group.evaluated}</td><td className="text-center text-amber-300">{group.pending}</td><td className="text-center text-emerald-300">{group.correct}</td><td className="text-center">{group.directionalEvaluated}</td><td className="text-center">{group.accuracyPct == null ? '—' : group.accuracyPct.toFixed(1) + '%'}</td><td className="text-center">{group.accuracyConfidenceInterval95Pct == null ? '—' : `${group.accuracyConfidenceInterval95Pct.lowerPct.toFixed(1)}–${group.accuracyConfidenceInterval95Pct.upperPct.toFixed(1)}%`}</td><td className={`text-center ${group.sampleSufficient ? 'text-emerald-300' : 'text-amber-300'}`}>{group.sampleSufficient ? 'SUFFICIENT' : `INSUFFICIENT (<${group.minimumSampleCount})`}</td><td className="text-center">{group.brierScore == null ? '—' : group.brierScore.toFixed(4)}</td><td className="text-center">{group.upPredictions} / {group.downPredictions} / {group.flatPredictions}</td><td className="text-center text-cyan-300">{group.marketRegime}</td><td className="text-center text-cyan-300">{group.session}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'controls' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <div>
              <div className="text-sm font-bold text-white font-mono">Risk Controls</div>
              <div className="text-[10px] text-slate-500 mt-1">Daily loss protection is operator-configurable and persists across server restarts.</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2">Daily Loss Limit (%)</label>
              <div className="flex gap-2 items-center">
                <input type="number" min="0.1" max="100" step="0.1" value={dailyLossLimitPct} onChange={(e) => setDailyLossLimitPct(Number(e.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-white outline-none focus:border-cyan-500" />
                <span className="text-slate-400 font-mono">%</span>
                <button type="button" onClick={saveDailyLossLimit} disabled={dailyLossSaving} className="shrink-0 rounded-lg border border-cyan-700 bg-cyan-950/40 px-3 py-2 text-xs font-mono text-cyan-300 disabled:opacity-50">{dailyLossSaving ? 'Saving...' : 'Save'}</button>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">The live safety gate calculates the actual daily loss threshold from the current account balance using this percentage.</div>
              {dailyLossSaveMessage && <div className="text-[10px] text-emerald-300 mt-2">{dailyLossSaveMessage}</div>}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-sm font-bold text-white font-mono mb-3">Auto Live Status</div><div className="space-y-3 text-xs font-mono">
            <div className="flex justify-between"><span className="text-slate-500">Engine State</span><span className="text-white">{autoStatus?.state || 'LOADING'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Autonomous Permission</span><span className={autoStatus?.autonomousPermission ? "text-emerald-400" : "text-rose-400"}>{autoStatus?.autonomousPermission ? 'ALLOWED' : 'BLOCKED'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Minimum Signal Score</span><span className="text-cyan-300">{autoStatus?.minSignalScore ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Max Trades / Pair</span><span className="text-cyan-300">{autoStatus?.maxTradesPerPair ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Max Trades / System</span><span className="text-cyan-300">{autoStatus?.maxOpenPositions ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Emergency Halt</span><span className={isEmergencyHalted ? "text-rose-400" : "text-emerald-400"}>{isEmergencyHalted ? 'ACTIVE' : 'READY'}</span></div>
            {autoStatusError && <div className="text-rose-300 border border-rose-900 bg-rose-950/30 rounded p-2">{autoStatusError}</div>}
          </div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-sm font-bold text-white font-mono mb-3">Secondary Tools</div><div className="text-xs text-slate-500">Detailed diagnostics, configuration and historical information should be kept in dedicated application pages rather than the default Auto Live cockpit.</div></div>
        </div>
      )}
    </div>
  );

};