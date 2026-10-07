# AI Trading Analyst — Operations Center Documentation

## Overview
The **Operations Center** is the operational mission control for the AI Trading Analyst application post-RC-1.0.0-FINAL certification. It provides real-time health telemetry, market data monitoring, risk gate verification, execution quality tracking, 3-way reconciliation, and centralized alert management.

---

## Safety Invariant
```typescript
LIVE_AUTO_EXECUTION_ALLOWED === false
```
- **Absolute Rule:** Hard-coded safety invariant preventing any auto-execution in live real-money environments.
- **Allowed Environments:** PAPER, cTrader DEMO, 5paisa SANDBOX.
- **Enforcement:** Enforced at module load time via `LiveTradingGate.verifySafetyInvariant()` in Express middleware, broker routing, and frontend controls.

---

## Subsystem Architecture

### 1. System Health Monitoring
- **Application & API Status:** Live health probes on Express API routes (`/api/governance/status`, `/api/health`).
- **Firebase Persistence Status:** Sync heartbeat monitoring with Firestore collections (`trade_traces`, `reconciliation_records`, `audit_events`).
- **Model Inference & Telemetry:** Monitors real-time GBDT model predictions, inference latency, and feature matrix validity.
- **Market Data Feed Freshness:** Tracks bid/ask quote latency, candle continuity, and stale feed flags across Forex and Indian markets.

### 2. Market Data Quality Center
- **Monitored Indicators:** Missing candles, duplicate timestamps, stale feeds (>1000ms), invalid OHLC structures, zero volume, and timestamp inconsistencies.
- **Continuity Scoring:** Automated 0-100% data continuity score for tracked instruments (EUR/USD, GBP/USD, USD/JPY, NIFTY, BANKNIFTY).

### 3. Risk Center & Safety Gates
- **Global Risk Limits:** Max 1% account risk per trade cap, drawdown limits, position count limits, margin utilization thresholds.
- **Emergency Kill Switch:** Operator-triggered emergency halt mechanism. When armed, all new order proposals are immediately rejected.
- **Kill Switch Proof Automation:** Automated POST test endpoint (`/api/governance/kill-switch-test`) that verifies order rejections while armed and clean recovery when disarmed.

### 4. Execution Center
- **Environments:** PAPER (simulated fills), cTrader DEMO (Fix/REST sandbox), 5paisa SANDBOX (Open API sandbox).
- **Quality Metrics:** Latency (ms), spread cost (pips/points), slippage impact, and fill success rate.
- **Trace Tracking:** Every executed order generates a unique `tradeTraceId` linking it to market data, model predictions, and risk decisions.

### 5. 3-Way Reconciliation Engine
- **Triple Ledger Comparison:** Compares state between:
  1. Internal System Memory Ledger
  2. External Broker Sandbox Account State
  3. Cloud Firestore Ledger
- **Status Classification:** `MATCHED`, `RECONCILIATION_MISMATCH`, `ORPHAN_INTERNAL`, `ORPHAN_BROKER`, `ORPHAN_CLOUD`, `CLOUDDIVERGENCE`.

### 6. Alert Center with Deduplication
- **Severities:** `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`.
- **Deduplication:** Groups alerts by `dedupKey` and updates repeat count rather than spamming log streams.
- **Operator Acknowledgement:** In-memory and Firebase persistence of operator acknowledgement timestamp and operator ID.

---

## API References
- `GET /api/governance/status`: Subsystem health telemetry
- `GET /api/governance/demo-readiness`: 14-gate sandbox verification report
- `POST /api/governance/demo-test`: Controlled sandbox execution test
- `POST /api/governance/reconciliation/positions/run`: Triggers 3-way position reconciliation
- `POST /api/governance/reconciliation/orders/run`: Triggers 3-way orderbook reconciliation
- `POST /api/governance/kill-switch-test`: Automated kill switch test suite
- `POST /api/governance/override`: Chief Risk Officer manual parameter adjustment with audit logging
