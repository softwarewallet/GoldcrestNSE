import { GreeksData, OptionType } from '../common/types';

/**
 * Standard Normal Cumulative Distribution Function approximation (Abramowitz & Stegun)
 */
function normalCDF(x: number): number {
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;

  if (x >= 0.0) {
    const t = 1.0 / (1.0 + p * x);
    return 1.0 - c * Math.exp(-x * x / 2.0) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
  } else {
    const t = 1.0 / (1.0 - p * x);
    return c * Math.exp(-x * x / 2.0) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
  }
}

/**
 * Standard Normal Probability Density Function
 */
function normalPDF(x: number): number {
  return (1.0 / Math.sqrt(2.0 * Math.PI)) * Math.exp(-0.5 * x * x);
}

/**
 * Black-Scholes European Option Price & Greeks calculation
 * @param S Current underlying spot price
 * @param K Strike price
 * @param T Time to expiration in years (days / 365)
 * @param r Risk-free interest rate (e.g. 0.068 for 6.8% RBI rate)
 * @param sigma Implied volatility (e.g. 0.14 for 14%)
 * @param type CALL or PUT
 */
export function calculateBlackScholesGreeks(
  S: number,
  K: number,
  T: number,
  r: number = 0.068,
  sigma: number = 0.14,
  type: OptionType = 'CALL'
): { price: number; greeks: GreeksData } {
  // Prevent division by zero
  const safeT = Math.max(T, 0.0001);
  const safeSigma = Math.max(sigma, 0.01);

  const d1 = (Math.log(S / K) + (r + (safeSigma * safeSigma) / 2) * safeT) / (safeSigma * Math.sqrt(safeT));
  const d2 = d1 - safeSigma * Math.sqrt(safeT);

  let price = 0;
  let delta = 0;
  let rho = 0;

  if (type === 'CALL') {
    price = S * normalCDF(d1) - K * Math.exp(-r * safeT) * normalCDF(d2);
    delta = normalCDF(d1);
    rho = (K * safeT * Math.exp(-r * safeT) * normalCDF(d2)) / 100;
  } else {
    price = K * Math.exp(-r * safeT) * normalCDF(-d2) - S * normalCDF(-d1);
    delta = normalCDF(d1) - 1;
    rho = (-K * safeT * Math.exp(-r * safeT) * normalCDF(-d2)) / 100;
  }

  // Gamma: identical for Call and Put
  const gamma = normalPDF(d1) / (S * safeSigma * Math.sqrt(safeT));

  // Vega: 1% change in volatility (divide by 100)
  const vega = (S * normalPDF(d1) * Math.sqrt(safeT)) / 100;

  // Theta: 1 day time decay (divide by 365)
  let theta = 0;
  const term1 = -(S * normalPDF(d1) * safeSigma) / (2 * Math.sqrt(safeT));
  if (type === 'CALL') {
    const term2 = r * K * Math.exp(-r * safeT) * normalCDF(d2);
    theta = (term1 - term2) / 365;
  } else {
    const term2 = r * K * Math.exp(-r * safeT) * normalCDF(-d2);
    theta = (term1 + term2) / 365;
  }

  return {
    price: Math.max(0.05, price),
    greeks: {
      delta: Number(delta.toFixed(3)),
      gamma: Number(gamma.toFixed(5)),
      theta: Number(theta.toFixed(2)),
      vega: Number(vega.toFixed(2)),
      rho: Number(rho.toFixed(3)),
      iv: Number((safeSigma * 100).toFixed(2)),
      modelDerived: true // Explicitly marked per requirements
    }
  };
}
