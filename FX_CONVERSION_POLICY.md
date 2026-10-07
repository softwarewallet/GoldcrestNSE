# FX Conversion Policy & Rate Integrity Protocol (v1.2.1-fx-integrity)

## Executive Summary
This document establishes the FX Conversion Policy for the AI Trading Analyst platform. It governs exchange rate lookup, rate classification, fail-closed validation, and reproducible snapshot generation across multi-currency assets (`USD` Forex and `INR` Indian Markets).

## Mandatory Invariants
- `LIVE_AUTO_EXECUTION_ALLOWED === false`: Hard-locked invariant across all execution environments (`PAPER`, `cTrader DEMO`, `5paisa SANDBOX`).

## Exchange Rate Provenance & Feed Model
1. **Benchmark Reference Rate**:
   - `1 USD = 86.50 INR` (Source: `RBI benchmark/reference`).
   - Inverse rate derived mathematically: `1 INR = ~0.01156069 USD`.
2. **Live Feed Status**:
   - In unconfigured environments, the platform explicitly reports `FX_LIVE_SOURCE = NOT_CONFIGURED`.
3. **Rate Type Taxonomy**:
   - `TRADE_TIME`: Rate captured at exact execution time.
   - `REPORT_TIME`: Spot rate captured at report generation time.
   - `PERIOD_END`: Official closing rate for accounting period end.
   - `REFERENCE`: Hard-coded or fallback benchmark rate.
4. **Rate Status Lifecycle**:
   - `FRESH`: Active rate retrieved within acceptable latency limits.
   - `STALE`: Outdated rate requiring refresh.
   - `UNAVAILABLE`: Feed unreachable or unconfigured.
   - `INVALID`: Rate failed safety checks (NaN, <= 0, or non-finite).
   - `REFERENCE`: Static fallback rate.

## Fail-Closed Validation
The `FXRateProvider` enforces fail-closed execution:
- Null, zero, negative, NaN, or Infinity rates return `status: "UNAVAILABLE"` and throw errors on conversion attempts.
- Currency mismatch without conversion record triggers `CURRENCY_MISMATCH_ERROR`.

## Audit Snapshots
All consolidated reporting creates an immutable `HistoricalReportSnapshot` object containing exact input records, converted subtotals, conversion methodology (`REPORT_TIME_FX` or `PERIOD_END_FX`), conversion version (`v1.2.1-fx-integrity`), and FX records used.
