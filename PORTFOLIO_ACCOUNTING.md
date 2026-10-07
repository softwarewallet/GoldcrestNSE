# Portfolio Accounting & Multi-Currency Consolidation Protocol (v1.2.1-fx-integrity)

## Overview
The Portfolio Accounting layer reconciles multi-currency trades and positions across USD and INR market streams.

## Structural Guarantees
1. **Subtotal Independence**: Native subtotals for USD and INR are calculated independently prior to conversion.
2. **Converted Totals**: Converted totals map native amounts into the requested `reportingCurrency` (`USD` or `INR`) without modifying underlying native ledgers.
3. **Risk & Drawdown Isolation**: Drawdowns are calculated on native equity streams to prevent FX noise from distorting core trading risk metrics.
4. **Three-Way Reconciliation**: Compares internal ledger, broker state, and Firestore persistence, verifying native currency alignment and flagging currency divergence.
