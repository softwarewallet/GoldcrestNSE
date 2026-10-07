// ============================================================================
// MULTI-CURRENCY DRAWDOWN & RISK METRICS ENGINE
// ============================================================================

import * as AccountingTypes from './types.ts';
type CurrencyCode = AccountingTypes.CurrencyCode;
type FinancialRecord = AccountingTypes.FinancialRecord;
type MultiCurrencyDrawdown = AccountingTypes.MultiCurrencyDrawdown;
type MultiCurrencyExposure = AccountingTypes.MultiCurrencyExposure;
import { round4 } from './currencyEngine.ts';
import { FXRateProvider } from './fxRateProvider.ts';

export class DrawdownRiskEngine {
  /**
   * Calculates isolated native peak-to-trough drawdowns for USD and INR streams.
   */
  public static calculateNativeDrawdowns(records: FinancialRecord[]): MultiCurrencyDrawdown {
    const usdRecords = records.filter(r => r.nativeCurrency === 'USD');
    const inrRecords = records.filter(r => r.nativeCurrency === 'INR');

    return {
      USD: this.calculateStreamDrawdownPct(usdRecords),
      INR: this.calculateStreamDrawdownPct(inrRecords)
    };
  }

  /**
   * Computes peak-to-trough drawdown percentage for a single currency stream.
   */
  private static calculateStreamDrawdownPct(records: FinancialRecord[]): number {
    if (records.length === 0) return 0;

    // Sort by timestamp
    const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);

    let cumulativePnL = 0;
    let peakPnL = 0;
    let maxDrawdownValue = 0;

    for (const r of sorted) {
      cumulativePnL += r.nativeNetPnL;
      if (cumulativePnL > peakPnL) {
        peakPnL = cumulativePnL;
      }
      const drawdown = peakPnL - cumulativePnL;
      if (drawdown > maxDrawdownValue) {
        maxDrawdownValue = drawdown;
      }
    }

    // Return percentage drawdown relative to baseline capital or absolute drawdown value
    return round4(maxDrawdownValue);
  }

  /**
   * Calculates current multi-currency exposures without mixing USD and INR.
   */
  public static calculateMultiCurrencyExposures(
    positions: Array<{ nativeCurrency: CurrencyCode; nativeExposure: number }>
  ): MultiCurrencyExposure {
    let usdExposure = 0;
    let inrExposure = 0;

    for (const p of positions) {
      if (p.nativeCurrency === 'USD') {
        usdExposure += p.nativeExposure;
      } else if (p.nativeCurrency === 'INR') {
        inrExposure += p.nativeExposure;
      }
    }

    return {
      USD: round4(usdExposure),
      INR: round4(inrExposure)
    };
  }
}
