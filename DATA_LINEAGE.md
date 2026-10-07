# AI Trading Analyst — Data Lineage & Trade Trace Documentation

## Overview
The **Trade Explorer & Data Lineage System** guarantees full cryptographic and relational auditability for every order processed by the AI Trading Analyst. Utilizing a unique `tradeTraceId`, every execution is recorded as an immutable Directed Acyclic Graph (DAG) across 12 lifecycle stages.

---

## The 12 Lifecycle Nodes

```
[1. MARKET_SNAPSHOT] ──> [2. FEATURE_SNAPSHOT] ──> [3. PREDICTION]
                                                           │
[6. TRADE_PROPOSAL]  <── [5. RISK_DECISION]     <── [4. SIGNAL]
        │
        ▼
[7. BROKER_ORDER]    ──> [8. FILL]              ──> [9. POSITION]
                                                           │
[12. RECONCILIATION] <── [11. TRADE_RESULT]    <── [10. EXIT]
```

### Node Descriptions & Payloads

1. **`MARKET_SNAPSHOT`**
   - **Timestamp:** Exact quote arrival time (ms).
   - **Payload:** Bid, Ask, Spread, Timestamp, Market, Instrument.

2. **`FEATURE_SNAPSHOT`**
   - **Payload:** Feature version (`v1.0.0`), RSI, EMA trend, ATR, Volatility regime, Candle patterns.

3. **`PREDICTION`**
   - **Payload:** Model version (`gbt_forex_v1.0.0`), Predicted probability of hitting target before stop loss ($\hat{p}$).

4. **`SIGNAL`**
   - **Payload:** Signal ID, Direction (`BUY`/`SELL`), Suggested Entry, Stop Loss, Take Profit 1/2/3.

5. **`RISK_DECISION`**
   - **Payload:** Risk decision (`APPROVED`/`REJECTED`), Account risk % cap (max 1.0%), Max loss in USD, Leverage check.

6. **`TRADE_PROPOSAL`**
   - **Payload:** Order type (`MARKET`), Quantity, Calculated SL/TP prices, Environment (`PAPER`/`DEMO`/`SANDBOX`).

7. **`BROKER_ORDER`**
   - **Payload:** Selected broker (`CTRADER`/`FIVEPAISA`/`PAPER`), External Broker Order ID, Dispatch timestamp.

8. **`FILL`**
   - **Payload:** Execution fill price, Executed quantity, Execution latency (ms), Slippage (pips).

9. **`POSITION`**
   - **Payload:** Position ID, Open price, Margin allocated, Open timestamp.

10. **`EXIT`**
    - **Payload:** Exit price, Exit reason (`TAKE_PROFIT`, `STOP_LOSS`, `MANUAL_CLOSE`, `KILL_SWITCH`), Close timestamp.

11. **`TRADE_RESULT`**
    - **Payload:** Realized P&L in USD, Realized $R$-multiple, Win/Loss flag, Holding duration.

12. **`RECONCILIATION`**
    - **Payload:** 3-Way reconciliation check status (`MATCHED`/`MISMATCH`), Internal vs Broker vs Firestore verification timestamp.

---

## Firebase Storage Schema
- Collection: `trade_traces/{tradeTraceId}`
- Subcollection: `trade_traces/{tradeTraceId}/nodes/{nodeId}`

## Privacy & Redaction
All payloads are processed via `FirestoreTradeTraceService.sanitizePayload()` before persistence to automatically redact API keys, passcodes, access tokens, and private user credentials.
