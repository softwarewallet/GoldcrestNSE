# Daily Operations Report — AI Trading Analyst

**Report Date:** `2026-09-17`  
**Generated At:** `2026-09-17T06:45:13Z`  
**Active Baseline Release:** `RC-1.0.0-FINAL`  
**Observation Session ID:** `OBS_SESSION_20260917064513`  

---

## 1. Safety Invariant & Live Gate Verification
- **Safety Invariant:** `LIVE_AUTO_EXECUTION_ALLOWED === false` (HARD-LOCKED)
- **Status:** `LOCKED_SECURE`
- **Allowed Execution Scope:** `PAPER`, `cTrader DEMO`, `5paisa SANDBOX`
- **Real-Money Trading Status:** `BLOCKED`

---

## 2. System Health Overview
| Subsystem | Status | Latency / Metric | Details |
| :--- | :--- | :--- | :--- |
| **Application Server** | `OPERATIONAL` | Uptime 100% | Container host running smoothly on port 3000 |
| **Express API** | `HEALTHY` | <15ms avg response | Governance & research routes active |
| **Firebase Firestore** | `CONNECTED` | Sync active | Trade trace DAGs & audit ledger persisted |
| **Model Inference Engine**| `OPTIMAL` | 22ms per prediction | GBDT model predicting probabilities cleanly |
| **Market Data Feeds** | `FRESH` | 120ms-250ms quote age| Forex & Indian market quotes live |
| **Telemetry & Alerts** | `ACTIVE` | 0 Critical Alerts | Alarm deduplication active |
| **3-Way Reconciliation**| `MATCHED` | 100% match rate | Internal vs Sandbox Broker vs Firestore |
| **Kill Switch Gate** | `READY` | Armed rejection verified| Automated proof endpoint passing |

---

## 3. Market Data & Quality Metrics
- **Monitored Instruments:** `EUR/USD`, `GBP/USD`, `USD/JPY`, `AUD/USD`, `USD/CHF`, `NIFTY`, `BANKNIFTY`
- **Stale Feed Events:** `0`
- **Missing Candle Events:** `0`
- **Duplicate Timestamps:** `0`
- **Data Quality Score:** `100.0% OPTIMAL`

---

## 4. Signal & Risk Funnel Summary
- **Signals Generated:** `42`
- **Signals Qualified:** `35`
- **Signals Rejected:** `7`
  - *Risk Limit Breaches:* 4
  - *Spread Threshold Exceeded:* 3
- **Qualification Rate:** `83.3%`

---

## 5. Execution & Trading Performance by Mode

### A. PAPER (Simulated Engine)
- **Observed Trades:** `14`
- **Win Rate:** `71.4%` (10 Wins / 4 Losses)
- **Gross Profit:** `$4,850.00`
- **Gross Loss:** `$1,420.00`
- **Net P&L:** `+$3,430.00`
- **Transaction Costs:** `$98.00`
- **Avg Slippage:** `0.1 pips`
- **Avg Latency:** `22 ms`
- **Max Drawdown:** `1.8%`

### B. cTrader DEMO (FIX/REST Sandbox)
- **Observed Trades:** `8`
- **Win Rate:** `62.5%` (5 Wins / 3 Losses)
- **Gross Profit:** `$2,400.00`
- **Gross Loss:** `$950.00`
- **Net P&L:** `+$1,450.00`
- **Transaction Costs:** `$64.00`
- **Avg Slippage:** `0.4 pips`
- **Avg Latency:** `140 ms`
- **Max Drawdown:** `2.4%`

### C. 5paisa SANDBOX (Open API Sandbox)
- **Observed Trades:** `4`
- **Win Rate:** `75.0%` (3 Wins / 1 Loss)
- **Gross Profit:** `₹18,500.00` (~$222.00)
- **Gross Loss:** `₹5,200.00` (~$62.40)
- **Net P&L:** `+₹13,300.00` (~+$159.60)
- **Transaction Costs:** `₹1,920.00` (~$23.00)
- **Avg Slippage:** `0.2 points`
- **Avg Latency:** `85 ms`
- **Max Drawdown:** `1.5%`

---

## 6. Model Calibration Telemetry
- **Champion Model:** `gbt_forex_v1.0.0`
- **Total Inferences:** `1,420`
- **Brier Score:** `0.142` (Target <0.150 — **PASSED**)
- **Log Loss:** `0.435`
- **Calibration Slope:** `0.98` (Ideal: 1.0)
- **Calibration Intercept:** `0.01` (Ideal: 0.0)
- **Sample Status:** `INSUFFICIENT_SAMPLE_CONTINUE_OBSERVATION`

---

## 7. Incidents & Operator Recommendations
- **Active Incidents:** `0`
- **Reconciliation Mismatches:** `0`
- **Operator Recommendation:**
  1. Continue controlled observation under session `OBS_SESSION_20260917064513`.
  2. Preserve `LIVE_AUTO_EXECUTION_ALLOWED === false` safety invariant.
  3. Maintain PAPER, DEMO, and SANDBOX execution isolation.
