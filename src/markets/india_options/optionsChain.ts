import { OptionChainStrikeRow, OptionChainSummary, OptionContract } from '../common/types';
import { getIndianUnderlyingConfig } from '../india_equity/underlyings';
import { generateExpiries } from './expiryEngine';
import { calculateBlackScholesGreeks } from './greeks';

export function buildOptionChain(
  symbol: string,
  spotPrice: number,
  selectedExpiryDate?: string,
  strikeDepth: number = 7 // number of strikes above and below ATM
): OptionChainSummary {
  const config = getIndianUnderlyingConfig(symbol);
  const expiries = generateExpiries(config.expiryDayOfWeek);
  const currentExpiry = selectedExpiryDate || expiries[0]?.dateString || '2026-09-24';
  const expiryObj = expiries.find(e => e.dateString === currentExpiry) || expiries[0];

  const daysToExpiry = Math.max(0.5, expiryObj ? expiryObj.daysToExpiry : 4);
  const timeInYears = daysToExpiry / 365;

  // Find ATM strike rounded to nearest strikeStep
  const atmStrike = Math.round(spotPrice / config.strikeStep) * config.strikeStep;

  const rows: OptionChainStrikeRow[] = [];
  let totalCallOI = 0;
  let totalPutOI = 0;

  let maxCallOI = -1;
  let callResistanceStrike = atmStrike + config.strikeStep * 2;
  let maxPutOI = -1;
  let putSupportStrike = atmStrike - config.strikeStep * 2;

  // Base IV ~13.5% with standard volatility smile
  const baseIV = 0.138;

  for (let i = -strikeDepth; i <= strikeDepth; i++) {
    const strike = atmStrike + i * config.strikeStep;
    const isATM = strike === atmStrike;

    // Volatility smile: OTM options have slightly higher IV
    const moneyness = Math.abs(strike - spotPrice) / spotPrice;
    const callIV = baseIV + moneyness * 0.18;
    const putIV = baseIV + moneyness * 0.22;

    const callResult = calculateBlackScholesGreeks(spotPrice, strike, timeInYears, 0.068, callIV, 'CALL');
    const putResult = calculateBlackScholesGreeks(spotPrice, strike, timeInYears, 0.068, putIV, 'PUT');

    // Simulate realistic OI distributions around ATM and key round strikes
    const distanceFromAtm = i;
    const strikeDist = Math.abs(distanceFromAtm);
    const roundStrikeBonus = strike % (config.strikeStep * 2) === 0 ? 1.4 : 1.0;

    const baseCallOI = Math.max(12000, Math.round((140000 / (1 + strikeDist * 0.7)) * roundStrikeBonus));
    const callOI = distanceFromAtm >= 0 ? Math.round(baseCallOI * 1.3) : Math.round(baseCallOI * 0.6);
    const callChangeOI = Math.round((callOI * 0.08) * (distanceFromAtm >= 1 ? 1 : -0.5));
    const callVolume = Math.round(callOI * 0.45);

    const basePutOI = Math.max(12000, Math.round((135000 / (1 + strikeDist * 0.7)) * roundStrikeBonus));
    const putOI = distanceFromAtm <= 0 ? Math.round(basePutOI * 1.35) : Math.round(basePutOI * 0.55);
    const putChangeOI = Math.round((putOI * 0.09) * (distanceFromAtm <= -1 ? 1 : -0.4));
    const putVolume = Math.round(putOI * 0.42);

    totalCallOI += callOI;
    totalPutOI += putOI;

    if (callOI > maxCallOI && strike >= atmStrike) {
      maxCallOI = callOI;
      callResistanceStrike = strike;
    }

    if (putOI > maxPutOI && strike <= atmStrike) {
      maxPutOI = putOI;
      putSupportStrike = strike;
    }

    const callSpread = Number(Math.max(0.1, callResult.price * 0.015).toFixed(2));
    const putSpread = Number(Math.max(0.1, putResult.price * 0.015).toFixed(2));

    const callContract: OptionContract = {
      symbol: `${symbol}_${currentExpiry}_${strike}_CE`,
      underlying: symbol,
      expiry: currentExpiry,
      strike,
      optionType: 'CALL',
      lotSize: config.lotSize,
      tickSize: config.tickSize,
      contractMultiplier: 1,
      ltp: Number(callResult.price.toFixed(2)),
      change: Number((callResult.price * 0.04).toFixed(2)),
      changePercent: 4.1,
      oi: callOI,
      changeOI: callChangeOI,
      volume: callVolume,
      bid: Number((callResult.price - callSpread / 2).toFixed(2)),
      ask: Number((callResult.price + callSpread / 2).toFixed(2)),
      spread: callSpread,
      iv: Number((callIV * 100).toFixed(2)),
      greeks: callResult.greeks,
      isATM,
      isITM: strike < spotPrice
    };

    const putContract: OptionContract = {
      symbol: `${symbol}_${currentExpiry}_${strike}_PE`,
      underlying: symbol,
      expiry: currentExpiry,
      strike,
      optionType: 'PUT',
      lotSize: config.lotSize,
      tickSize: config.tickSize,
      contractMultiplier: 1,
      ltp: Number(putResult.price.toFixed(2)),
      change: Number((-putResult.price * 0.035).toFixed(2)),
      changePercent: -3.5,
      oi: putOI,
      changeOI: putChangeOI,
      volume: putVolume,
      bid: Number((putResult.price - putSpread / 2).toFixed(2)),
      ask: Number((putResult.price + putSpread / 2).toFixed(2)),
      spread: putSpread,
      iv: Number((putIV * 100).toFixed(2)),
      greeks: putResult.greeks,
      isATM,
      isITM: strike > spotPrice
    };

    rows.push({
      strike,
      isATM,
      distanceFromAtm,
      call: callContract,
      put: putContract
    });
  }

  const pcr = totalCallOI > 0 ? Number((totalPutOI / totalCallOI).toFixed(2)) : 1.0;

  return {
    underlying: symbol,
    spotPrice,
    atmStrike,
    expiry: currentExpiry,
    availableExpiries: expiries.map(e => e.dateString),
    totalCallOI,
    totalPutOI,
    pcr,
    callResistanceStrike,
    putSupportStrike,
    highOIStrikeCall: callResistanceStrike,
    highOIStrikePut: putSupportStrike,
    rows,
    timestamp: Date.now()
  };
}
