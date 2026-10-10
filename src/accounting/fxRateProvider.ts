// ============================================================================
// FX RATE PROVIDER ABSTRACTION & LOOKUP ENGINE (v1.2.1-fx-integrity)
// ============================================================================

import * as AccountingTypes from './types.ts';
type CurrencyCode = AccountingTypes.CurrencyCode;
type FXConversionMethodology = AccountingTypes.FXConversionMethodology;
type FXRateQueryResult = AccountingTypes.FXRateQueryResult;
type FXConversionRecord = AccountingTypes.FXConversionRecord;
type FXRateType = AccountingTypes.FXRateType;
type FXRateStatus = AccountingTypes.FXRateStatus;
type FXLiveSourceStatus = AccountingTypes.FXLiveSourceStatus;

export interface FXRateFeedConfig {
  usdInrRate: number;
  effectiveAt: number;
  retrievedAt: number;
  source: string;
  rateType: FXRateType;
  rateStatus: FXRateStatus;
}

export class FXRateProvider {
  private static instance: FXRateProvider;

  // Baseline reference configuration
  private currentUsdInrRate: number = 86.50; // Production RBI benchmark baseline
  private effectiveTs: number = 1773734400000; // Benchmark effective timestamp
  private retrievedTs: number = Date.now();
  private rateSource: string = 'RBI benchmark/reference';
  private rateType: FXRateType = 'REFERENCE';
  private rateStatus: FXRateStatus = 'REFERENCE';
  private liveSourceStatus: FXLiveSourceStatus = 'NOT_CONFIGURED';
  private conversionVersion: string = 'v1.2.1-fx-integrity';

  constructor(customRate?: number, customSource?: string, customType?: FXRateType) {
    if (customRate !== undefined) {
      this.currentUsdInrRate = customRate;
      if (!Number.isFinite(customRate) || customRate <= 0) {
        this.rateStatus = 'INVALID';
      }
    }
    if (customSource) {
      this.rateSource = customSource;
    }
    if (customType) {
      this.rateType = customType;
      if (customType === 'TRADE_TIME' || customType === 'REPORT_TIME') {
        this.rateStatus = 'FRESH';
      }
    }
  }

  public static getInstance(): FXRateProvider {
    if (!FXRateProvider.instance) {
      FXRateProvider.instance = new FXRateProvider();
    }
    return FXRateProvider.instance;
  }

  /**
   * Resets or updates the FX rate with explicit provenance parameters.
   */
  public updateRate(
    usdInrRate: number,
    source: string = 'RBI benchmark/reference',
    rateType: FXRateType = 'REFERENCE',
    rateStatus: FXRateStatus = 'REFERENCE',
    liveSourceStatus?: FXLiveSourceStatus
  ): boolean {
    if (!Number.isFinite(usdInrRate) || usdInrRate <= 0) {
      return false;
    }
    this.currentUsdInrRate = usdInrRate;
    this.rateSource = source;
    this.rateType = rateType;
    this.rateStatus = rateStatus;
    this.retrievedTs = Date.now();
    this.effectiveTs = Date.now();
    this.liveSourceStatus = liveSourceStatus || (rateType === 'TRADE_TIME' ? 'CONNECTED' : (this.liveSourceStatus || 'NOT_CONFIGURED'));
    return true;
  }

  /**
   * Invalidates or clears the current rate for fail-closed testing.
   */
  public invalidateRate(reasonStatus: FXRateStatus = 'INVALID'): void {
    this.rateStatus = reasonStatus;
    this.currentUsdInrRate = NaN;
  }

  public getLiveSourceStatus(): FXLiveSourceStatus {
    return this.liveSourceStatus;
  }

  public setLiveSourceStatus(status: FXLiveSourceStatus): void {
    this.liveSourceStatus = status;
  }

  public getRateType(): FXRateType {
    return this.rateType;
  }

  public getRateStatus(): FXRateStatus {
    return this.rateStatus;
  }

  public getRateSource(): string {
    return this.rateSource;
  }

  public getEffectiveTs(): number {
    return this.effectiveTs;
  }

  public getRetrievedTs(): number {
    return this.retrievedTs;
  }

  /**
   * Primary FX rate query method with fail-closed validation.
   */
  public getRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    timestamp?: number,
    methodology: FXConversionMethodology = 'REPORT_TIME_FX',
    requestedRateType?: FXRateType
  ): FXRateQueryResult {
    // A caller must not be able to label a reference rate as TRADE_TIME merely by supplying a requested rate type
    const isUnderlyingReference = this.rateType === 'REFERENCE' || this.rateStatus === 'REFERENCE';
    let rateTypeToUse = requestedRateType || this.rateType;
    if (isUnderlyingReference && requestedRateType === 'TRADE_TIME') {
      rateTypeToUse = 'REFERENCE';
    } else if (!isUnderlyingReference && requestedRateType) {
      rateTypeToUse = requestedRateType;
    }

    // Validate supported currencies
    const supportedCurrencies: CurrencyCode[] = ['USD', 'INR'];
    if (!supportedCurrencies.includes(fromCurrency) || !supportedCurrencies.includes(toCurrency)) {
      return {
        status: 'UNAVAILABLE',
        rateStatus: 'UNAVAILABLE',
        fxLiveSourceStatus: this.liveSourceStatus,
        fromCurrency,
        toCurrency,
        error: `UNSUPPORTED_CURRENCY_ERROR: Currency pair ${fromCurrency}/${toCurrency} contains unsupported currency.`
      };
    }

    // Identity conversion (same currency)
    if (fromCurrency === toCurrency) {
      return {
        status: 'AVAILABLE',
        rateStatus: 'FRESH',
        fxLiveSourceStatus: this.liveSourceStatus,
        fromCurrency,
        toCurrency,
        rate: 1.0,
        effectiveAt: timestamp || Date.now(),
        retrievedAt: timestamp || Date.now(),
        source: 'IDENTITY',
        rateType: rateTypeToUse,
        methodology,
        conversionVersion: this.conversionVersion
      };
    }

    // Check rate validity (fail-closed on null, zero, negative, NaN, Infinity, or INVALID status)
    if (
      this.rateStatus === 'INVALID' ||
      this.rateStatus === 'UNAVAILABLE' ||
      !Number.isFinite(this.currentUsdInrRate) ||
      this.currentUsdInrRate <= 0
    ) {
      return {
        status: 'UNAVAILABLE',
        rateStatus: this.rateStatus === 'REFERENCE' ? 'INVALID' : this.rateStatus,
        fxLiveSourceStatus: this.liveSourceStatus,
        fromCurrency,
        toCurrency,
        error: `FX_RATE_UNAVAILABLE: Zero, negative, NaN, or invalid FX rate detected (${this.currentUsdInrRate}) for ${fromCurrency}/${toCurrency}.`
      };
    }

    const effectiveAt = timestamp || this.effectiveTs;
    const retrievedAt = this.retrievedTs;

    if (fromCurrency === 'USD' && toCurrency === 'INR') {
      return {
        status: 'AVAILABLE',
        rateStatus: this.rateStatus,
        fxLiveSourceStatus: this.liveSourceStatus,
        fromCurrency: 'USD',
        toCurrency: 'INR',
        rate: this.currentUsdInrRate,
        effectiveAt,
        retrievedAt,
        source: this.rateSource,
        rateType: rateTypeToUse,
        methodology,
        conversionVersion: this.conversionVersion
      };
    }

    if (fromCurrency === 'INR' && toCurrency === 'USD') {
      // Mathematically derived inverse rate
      const inverseRate = Math.round((1 / this.currentUsdInrRate) * 1000000) / 1000000;
      return {
        status: 'AVAILABLE',
        rateStatus: this.rateStatus,
        fxLiveSourceStatus: this.liveSourceStatus,
        fromCurrency: 'INR',
        toCurrency: 'USD',
        rate: inverseRate,
        effectiveAt,
        retrievedAt,
        source: `${this.rateSource} (Derived Inverse)`,
        rateType: rateTypeToUse,
        methodology,
        conversionVersion: this.conversionVersion
      };
    }

    return {
      status: 'UNAVAILABLE',
      rateStatus: 'UNAVAILABLE',
      fxLiveSourceStatus: this.liveSourceStatus,
      fromCurrency,
      toCurrency,
      error: `FX_RATE_UNAVAILABLE: Conversion direction ${fromCurrency} -> ${toCurrency} is not supported.`
    };
  }

  /**
   * Builds an immutable FXConversionRecord.
   */
  public buildConversionRecord(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    methodology: FXConversionMethodology = 'REPORT_TIME_FX',
    timestamp?: number,
    originalAmount?: number,
    requestedRateType?: FXRateType
  ): FXConversionRecord {
    const query = this.getRate(fromCurrency, toCurrency, timestamp, methodology, requestedRateType);
    if (query.status === 'UNAVAILABLE' || !query.rate || !Number.isFinite(query.rate) || query.rate <= 0) {
      throw new Error(
        query.error || `FX_CONVERSION_RECORD_ERROR: Cannot build conversion record for ${fromCurrency}/${toCurrency}.`
      );
    }

    const rec: FXConversionRecord = {
      fromCurrency,
      toCurrency,
      rate: query.rate,
      effectiveAt: query.effectiveAt || Date.now(),
      retrievedAt: query.retrievedAt || Date.now(),
      source: query.source || this.rateSource,
      rateType: query.rateType,
      methodology,
      conversionVersion: this.conversionVersion,
      status: query.rateStatus
    };

    if (originalAmount !== undefined) {
      rec.originalAmount = originalAmount;
      rec.originalCurrency = fromCurrency;
      rec.convertedAmount = Math.round((originalAmount * query.rate) * 10000) / 10000;
      rec.reportingCurrency = toCurrency;
    }

    return rec;
  }
}
