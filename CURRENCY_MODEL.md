# Native Currency Model & Multi-Asset Accounting (v1.2.1-fx-integrity)

## Currency Alignment
- **FOREX Asset Class**: USD Native
- **INDIAN_EQUITY Asset Class**: INR Native
- **INDIAN_FUTURES Asset Class**: INR Native
- **INDIAN_OPTIONS Asset Class**: INR Native
- **INDIAN_INDEX Asset Class**: INR Native

## Arithmetic Precision & Rounding Rules
- **Native Operations**: Performed using double-precision float arithmetic.
- **Rounding Strategy**: Standard `round4` (4 decimal places) for monetary amounts and exchange rates, and `round2` for user-facing UI currency display.
- **Net P&L Formula**: `nativeNetPnL = nativeGrossPnL - nativeCosts`.

## Non-Real Capital Demarcation
All portfolio balance endpoints (`/api/governance/accounting/balances`) explicitly include execution context and disclaimer notices marking PAPER, cTrader DEMO, and 5paisa SANDBOX capital as simulated, non-real money capital.
