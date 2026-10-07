# AI Trading Analyst — Performance & Research Center Documentation

## Overview
The **Performance & Research Center** provides a Firebase-backed quantitative research workspace. It enables strategy performance evaluation, signal quality analytics, ML model calibration, execution cost breakdown, data quality diagnostics, and isolated research experiment management.

---

## Safety Invariant & Isolation
- **Safety Invariant:** `LIVE_AUTO_EXECUTION_ALLOWED === false` remains hard-coded and non-negotiable across all research modules.
- **Experiment Isolation:** Research experiments are assigned a unique `EXPERIMENT_ID` (e.g. `exp_001_gbdt_triplet_loss`). Hyperparameters, dataset versions, and strategy variants tested in research do NOT modify production trading configurations.

---

## Core Analytics Modules

### 1. Performance Metrics Engine
Calculates institutional performance statistics dynamically filtered by environment (`PAPER`, `DEMO`, `SANDBOX`) and instrument:
- **Trade Counts:** Total Trades, Wins, Losses
- **Win Rate:** Realized Win Rate (%)
- **P&L Metrics:** Gross Profit ($), Gross Loss ($), Net Profit ($)
- **Ratios:** Profit Factor ($x$), Expectancy ($+R$ per trade), Sharpe Ratio, Sortino Ratio
- **Execution Quality:** Transaction Costs ($), Avg Slippage (pips), Avg Execution Latency (ms), Max Drawdown (%)

### 2. Signal Quality Analytics by Confidence Buckets
Evaluates model calibration and signal conversion across 6 confidence buckets:
1. `0-50%` (Automatically rejected by qualification gates)
2. `50-60%`
3. `60-70%`
4. `70-80%`
5. `80-90%`
6. `90%+`

For each bucket, the system tracks:
- Total Generated Signals
- Qualified Signals
- Executed Trades
- Realized Win Rate (%) vs Predicted Probability
- Realized Expectancy ($+R$)

### 3. ML Model Monitoring & Calibration
Evaluates machine learning model health during production paper/demo operations:
- **Metrics:** Brier Score (target < 0.15), Log Loss, Calibration Slope (target = 1.0), Calibration Intercept (target = 0.0).
- **Predicted Probability vs Realized Win Rate Bar Chart:** Visualizes reliability diagrams across prediction bins.
- **Inference Telemetry:** Inference count, rejected predictions count, and data quality inference failure count.

### 4. Cost & Execution Quality Analysis
Breaks down all frictional losses to calculate True Net P&L:
$$\text{Net P\&L} = \text{Gross P\&L} - (\text{Spread Cost} + \text{Brokerage Commission} + \text{Financing/Fees} + \text{Slippage Impact})$$

### 5. Research Experiments Manager
Allows quantitative researchers to create, run, and document isolated experiments with custom:
- `datasetVersion`
- `featureVersion`
- `modelVersion`
- `strategyVersion`
- Custom hyperparameter overrides

---

## API References
- `GET /api/governance/research/metrics?env=PAPER&instrument=ALL`: Performance metrics
- `GET /api/governance/research/buckets`: Confidence bucket analytics
- `GET /api/governance/research/model-telemetry`: Model Brier score and calibration telemetry
- `GET /api/governance/research/experiments`: List research experiments
- `POST /api/governance/research/experiments/create`: Create new isolated experiment
- `GET /api/governance/data-quality`: Data quality report
- `GET /api/governance/daily-summary`: Daily operations summary
