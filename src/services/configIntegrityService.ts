import type { SystemConfig } from './configService';

export interface ConfigIntegrityResult {
  ok: boolean;
  checks: Record<string, 'PASS' | 'FAIL'>;
  failures: string[];
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function positiveFinite(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value > 0;
}

export function evaluateSystemConfigIntegrity(config: SystemConfig): ConfigIntegrityResult {
  const checks: Record<string, 'PASS' | 'FAIL'> = {};
  const failures: string[] = [];
  const check=(name:string, ok:boolean)=>{ checks[name]=ok?'PASS':'FAIL'; if(!ok) failures.push(name); };

  check('tradingMode', config.tradingMode === 'LIVE_ONLY');
  check('cTraderApiMode', config.cTraderApiMode === 'LIVE' || config.cTraderApiMode === 'DEMO');
  check('liveTradingEnabledType', typeof config.liveTradingEnabled === 'boolean');
  check('defaultRiskPct', positiveFinite(config.defaultRiskPct) && config.defaultRiskPct <= 100);
  check('maxDailyLossPct', positiveFinite(config.maxDailyLossPct) && config.maxDailyLossPct <= 100);
  check('maxOpenPositions', positiveInteger(config.maxOpenPositions));
  check('maxTradesPerDay', positiveInteger(config.maxTradesPerDay));
  check('maxConsecutiveLosses', positiveInteger(config.maxConsecutiveLosses));
  check('maxSpreadBps', nonNegativeFinite(config.maxSpreadBps));
  check('signalCooldownMs', positiveFinite(config.signalCooldownMs));
  check('eventProximityThresholdMinutes', nonNegativeFinite(config.eventProximityThresholdMinutes));
  check('strikeDepth', positiveInteger(config.strikeDepth));
  check('maxTradeValueForexUsd', positiveFinite(config.maxTradeValueForexUsd));
  check('maxTradeValueIndianInr', positiveFinite(config.maxTradeValueIndianInr));
  check('smallTradeBudgetInr', positiveFinite(config.smallTradeBudgetInr));
  check('smallTradeBudgetEnabled', typeof config.smallTradeBudgetEnabled === 'boolean');
  check('niftyFnoTestingMode', typeof config.niftyFnoTestingMode === 'boolean');
  check('customNiftyBudgetEnabled', typeof config.customNiftyBudgetEnabled === 'boolean');
  check('niftyMaxTradeValues', !config.niftyMaxTradeValues || (typeof config.niftyMaxTradeValues === 'object' && Object.values(config.niftyMaxTradeValues).every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)));
  check('autoLiveMinSignalScore', nonNegativeFinite(config.autoLiveMinSignalScore) && config.autoLiveMinSignalScore <= 100);
  check('autoLiveMaxTradesPerPair', positiveInteger(config.autoLiveMaxTradesPerPair));
  check('forexStopLossPips', positiveFinite(config.forexStopLossPips));
  check('forexTakeProfitPips', positiveFinite(config.forexTakeProfitPips));
  check('autoLiveForexPairs', Array.isArray(config.autoLiveForexPairs));
  check('autoLiveIndianUnderlyings', Array.isArray(config.autoLiveIndianUnderlyings) && config.autoLiveIndianUnderlyings.length > 0 && config.autoLiveIndianUnderlyings.every(symbol => typeof symbol === 'string' && /^[A-Z0-9._-]+$/.test(symbol)));
  check('financialDisclaimer', typeof config.financialDisclaimer === 'string' && config.financialDisclaimer.trim().length > 0);

  return { ok: failures.length===0, checks, failures };
}