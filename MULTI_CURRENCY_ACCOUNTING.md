# Multi-Currency Accounting Architecture (v1.2.1-fx-integrity)

## Overview
The AI Trading Analyst application employs a production-grade multi-currency accounting architecture to manage financial records across international asset classes:
- **FOREX**: Natively accounted in United States Dollars (`USD`).
- **INDIAN MARKETS** (5paisa / Equities / Futures / Options / Indices): Natively accounted in Indian Rupees (`INR`).

## Core Invariants & Safety Controls

### 1. Mandatory Safety Invariant
```typescript
export const LIVE_AUTO_EXECUTION_ALLOWED = false;
```
Live-money trading remains strictly disabled across all environments (`PAPER`, `cTrader DEMO`, and `5paisa SANDBOX`).

### 2. Native Currency Preservation
All ledger records store native amounts in their original market currency:
- `nativeCurrency`: Currency code (`USD` or `INR`).
- `nativeGrossPnL`: Raw gross profit/loss before transaction fees.
- `nativeCosts`: Transaction fees, commissions, slippage, and STT in native currency.
- `nativeNetPnL`: `nativeGrossPnL - nativeCosts`.

Native ledger entries are immutable and never overwritten by converted values.

### 3. Fail-Closed Arithmetic Safety
Direct arithmetic operations between `USD` and `INR` without explicit conversion are blocked at runtime. The `assertSameCurrency()` utility throws a `CURRENCY_MISMATCH_ERROR` if mismatched currencies are combined.

### 4. FX Rate Provenance & Historical Reproducibility
- **Rate Provenance**: Every FX conversion record captures rate type (`TRADE_TIME`, `REPORT_TIME`, `PERIOD_END`, `REFERENCE`), rate status (`FRESH`, `STALE`, `UNAVAILABLE`, `INVALID`, `REFERENCE`), source (`RBI benchmark/reference`), and conversion version (`v1.2.1-fx-integrity`).
- **Unconfigured Live FX**: Reports `FX_LIVE_SOURCE = NOT_CONFIGURED` when live feed is inactive, cleanly defaulting to the RBI reference rate (`1 USD = 86.50 INR`).
- **Report Snapshots**: `ConsolidationEngine.createReportSnapshot()` generates immutable snapshots (`HistoricalReportSnapshot`) stored in Cloud Firestore for auditable financial reporting.

