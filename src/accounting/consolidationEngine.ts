// ============================================================================
// CONSOLIDATION ENGINE FOR MULTI-CURRENCY FINANCIAL REPORTING
// ============================================================================

import * as AccountingTypes from './types.ts';
type CurrencyCode = AccountingTypes.CurrencyCode;
type FinancialRecord = AccountingTypes.FinancialRecord;
type ConsolidatedPnLSummary = AccountingTypes.ConsolidatedPnLSummary;
type NativePerformanceSummary = AccountingTypes.NativePerformanceSummary;
type FXConversionMethodology = AccountingTypes.FXConversionMethodology;
type FXConversionRecord = AccountingTypes.FXConversionRecord;
type HistoricalReportSnapshot = AccountingTypes.HistoricalReportSnapshot;
import { round4, calculateNativeNetPnL } from './currencyEngine.ts';
import { FXRateProvider } from './fxRateProvider.ts';

export class ConsolidationEngine {
  /**
   * Generates a reproducible, persisted HistoricalReportSnapshot.
   */
  public static createReportSnapshot(
    reportId: string,
    reportPeriod: string,
    records: FinancialRecord[],
    reportingCurrency: CurrencyCode = 'USD',
    methodology: FXConversionMethodology = 'REPORT_TIME_FX',
    fxProvider: FXRateProvider = FXRateProvider.getInstance()
  ): HistoricalReportSnapshot {
    const pnlSummary = this.calculateConsolidatedPnL(records, reportingCurrency, methodology, fxProvider);

    const fxRecordsUsed: FXConversionRecord[] = [];
    if (pnlSummary.fxConversions.USD_to_INR) fxRecordsUsed.push(pnlSummary.fxConversions.USD_to_INR);
    if (pnlSummary.fxConversions.INR_to_USD) fxRecordsUsed.push(pnlSummary.fxConversions.INR_to_USD);

    return {
      reportId,
      reportPeriod,
      reportingCurrency,
      conversionMethodology: methodology,
      conversionVersion: 'v1.2.1-fx-integrity',
      fxRecordsUsed,
      nativeSubtotals: pnlSummary.nativeSubtotals,
      convertedSubtotals: pnlSummary.convertedSubtotals,
      consolidatedTotals: {
        grossPnL: pnlSummary.consolidatedGrossPnL,
        costs: pnlSummary.consolidatedCosts,
        netPnL: pnlSummary.consolidatedNetPnL,
        drawdownPct: pnlSummary.consolidatedDrawdownPct,
        exposure: pnlSummary.consolidatedExposure
      },
      generatedAt: Date.now()
    };
  }
  /**
   * Consolidates multi-currency financial records into a single reporting currency
   * without altering native ledger records or mixing raw native values arithmetic.
   */
  public static calculateConsolidatedPnL(
    records: FinancialRecord[],
    reportingCurrency: CurrencyCode = 'USD',
    methodology: FXConversionMethodology = 'REPORT_TIME_FX',
    fxProvider: FXRateProvider = FXRateProvider.getInstance()
  ): ConsolidatedPnLSummary {
    // 1. Group records by native currency
    const usdRecords = records.filter(r => r.nativeCurrency === 'USD');
    const inrRecords = records.filter(r => r.nativeCurrency === 'INR');

    // 2. Compute USD native performance summary
    const usdSubtotal = this.computeNativeSubtotal('USD', usdRecords);

    // 3. Compute INR native performance summary
    const inrSubtotal = this.computeNativeSubtotal('INR', inrRecords);

    // 4. Obtain FX conversion records if conversion is required
    let usdConversion: FXConversionRecord | undefined = undefined;
    let inrConversion: FXConversionRecord | undefined = undefined;

    if (reportingCurrency === 'USD') {
      // USD -> USD is 1.0
      usdConversion = fxProvider.buildConversionRecord('USD', 'USD', methodology);
      // INR -> USD requires rate
      if (inrRecords.length > 0 || inrSubtotal.grossPnL !== 0 || inrSubtotal.costs !== 0) {
        inrConversion = fxProvider.buildConversionRecord('INR', 'USD', methodology);
      }
    } else {
      // reportingCurrency === 'INR'
      // INR -> INR is 1.0
      inrConversion = fxProvider.buildConversionRecord('INR', 'INR', methodology);
      // USD -> INR requires rate
      if (usdRecords.length > 0 || usdSubtotal.grossPnL !== 0 || usdSubtotal.costs !== 0) {
        usdConversion = fxProvider.buildConversionRecord('USD', 'INR', methodology);
      }
    }

    // 5. Calculate converted subtotals
    let usdConvertedGross = usdSubtotal.grossPnL;
    let usdConvertedCosts = usdSubtotal.costs;
    let usdConvertedNet = usdSubtotal.netPnL;

    if (usdConversion && usdConversion.fromCurrency !== usdConversion.toCurrency) {
      usdConvertedGross = round4(usdSubtotal.grossPnL * usdConversion.rate);
      usdConvertedCosts = round4(usdSubtotal.costs * usdConversion.rate);
      usdConvertedNet = round4(usdSubtotal.netPnL * usdConversion.rate);
    }

    let inrConvertedGross = inrSubtotal.grossPnL;
    let inrConvertedCosts = inrSubtotal.costs;
    let inrConvertedNet = inrSubtotal.netPnL;

    if (inrConversion && inrConversion.fromCurrency !== inrConversion.toCurrency) {
      inrConvertedGross = round4(inrSubtotal.grossPnL * inrConversion.rate);
      inrConvertedCosts = round4(inrSubtotal.costs * inrConversion.rate);
      inrConvertedNet = round4(inrSubtotal.netPnL * inrConversion.rate);
    }

    // 6. Aggregate consolidated totals in reporting currency
    const consolidatedGrossPnL = round4(usdConvertedGross + inrConvertedGross);
    const consolidatedCosts = round4(usdConvertedCosts + inrConvertedCosts);
    const consolidatedNetPnL = round4(usdConvertedNet + inrConvertedNet);

    const consolidatedExposure = round4(
      (usdConversion && usdConversion.fromCurrency !== usdConversion.toCurrency
        ? usdSubtotal.exposure * usdConversion.rate
        : usdSubtotal.exposure) +
      (inrConversion && inrConversion.fromCurrency !== inrConversion.toCurrency
        ? inrSubtotal.exposure * inrConversion.rate
        : inrSubtotal.exposure)
    );

    const consolidatedDrawdownPct = round4(
      Math.max(usdSubtotal.maxDrawdownPct, inrSubtotal.maxDrawdownPct)
    );

    const fxConversions: { USD_to_INR?: FXConversionRecord; INR_to_USD?: FXConversionRecord } = {};
    if (usdConversion && usdConversion.fromCurrency === 'USD' && usdConversion.toCurrency === 'INR') {
      fxConversions.USD_to_INR = usdConversion;
    }
    if (inrConversion && inrConversion.fromCurrency === 'INR' && inrConversion.toCurrency === 'USD') {
      fxConversions.INR_to_USD = inrConversion;
    }

    return {
      reportingCurrency,
      methodology,
      nativeSubtotals: {
        USD: usdSubtotal,
        INR: inrSubtotal
      },
      fxConversions,
      convertedSubtotals: {
        USD_in_reportingCurrency: usdConvertedNet,
        INR_in_reportingCurrency: inrConvertedNet
      },
      consolidatedGrossPnL,
      consolidatedCosts,
      consolidatedNetPnL,
      consolidatedDrawdownPct,
      consolidatedExposure,
      conversionTimestamp: Date.now()
    };
  }

  /**
   * Helper to aggregate native records into a NativePerformanceSummary.
   */
  private static computeNativeSubtotal(
    currency: CurrencyCode,
    records: FinancialRecord[]
  ): NativePerformanceSummary {
    if (records.length === 0) {
      return {
        currency,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRatePct: 0,
        grossPnL: 0,
        costs: 0,
        netPnL: 0,
        profitFactor: 0,
        expectancyR: 0,
        maxDrawdownPct: 0,
        exposure: 0
      };
    }

    let grossPnL = 0;
    let costs = 0;
    let wins = 0;
    let losses = 0;
    let grossWins = 0;
    let grossLosses = 0;

    for (const r of records) {
      grossPnL += r.nativeGrossPnL;
      costs += r.nativeCosts;
      if (r.nativeNetPnL > 0) {
        wins += 1;
        grossWins += r.nativeNetPnL;
      } else if (r.nativeNetPnL < 0) {
        losses += 1;
        grossLosses += Math.abs(r.nativeNetPnL);
      }
    }

    grossPnL = round4(grossPnL);
    costs = round4(costs);
    const netPnL = calculateNativeNetPnL(grossPnL, costs);
    const totalTrades = records.length;
    const winRatePct = totalTrades > 0 ? round4((wins / totalTrades) * 100) : 0;
    const profitFactor = grossLosses > 0 ? round4(grossWins / grossLosses) : grossWins > 0 ? 99.99 : 0;
    const expectancyR = totalTrades > 0 ? round4(netPnL / totalTrades) : 0;

    return {
      currency,
      totalTrades,
      wins,
      losses,
      winRatePct,
      grossPnL,
      costs,
      netPnL,
      profitFactor,
      expectancyR,
      maxDrawdownPct: 0,
      exposure: 0
    };
  }
}
