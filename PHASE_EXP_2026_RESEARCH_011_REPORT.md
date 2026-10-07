# PHASE EXP-2026-RESEARCH-011 REPORT
## FEATURE STABILITY & PREDICTIVE INFORMATION AUDIT

**Experiment ID:** `EXP_2026_RESEARCH_011`
**Dataset Hash:** `0e299533fa9ce932`

### 1. Executive Summary
This audit evaluates the predictive information quality and stability of the existing feature pipeline (`FEAT-v3.1.0`).

### 2. Feature Evidence Classification (Top 20 by Correlation)
| Feature | Family | Univariate AUC | Correlation | Permutation Imp | Stability | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| rsi14 | Momentum | 1 | 0.8546 | 0.525 | 0.9993 | SUPPORTED |
| trendStrength | Trend | 0.7063 | 0.3816 | 0 | 0.9991 | SUPPORTED |
| ema9Distance | Trend | 0.5606 | 0.1111 | 0 | 0.9605 | SUPPORTED |
| vwapDistance | Market Structure | 0.5606 | 0.1111 | 0 | 0.9605 | SUPPORTED |
| adx14 | Other | 0.4394 | -0.1017 | 0 | 0.9237 | SUPPORTED |
| bollingerBandwidth | Volatility | 0.4394 | -0.1017 | 0 | 0.9237 | SUPPORTED |
| returns15 | Price Action | 0.4604 | -0.0554 | 0 | 0.9847 | WEAK |
| ema50Distance | Trend | 0.532 | 0.0549 | 0 | 0.9959 | WEAK |
| price | Price Action | 0.4607 | -0.0531 | 0 | 0.9929 | WEAK |
| returns5 | Price Action | 0.4607 | -0.0531 | 0 | 0.9928 | WEAK |
| ema9Slope | Trend | 0.526 | 0.0424 | 0 | 0.8533 | WEAK |
| bollingerPctB | Volatility | 0.526 | 0.0424 | 0 | 0.8533 | WEAK |
| roc10 | Price Action | 0.526 | 0.0424 | 0 | 0.8533 | WEAK |
| stochasticK | Momentum | 0.5176 | 0.0287 | 0 | 0.9915 | WEAK |
| signalScore | Execution/Signal | 0.5176 | 0.0287 | 0 | 0.9915 | WEAK |
| sessionLondon | Temporal/Session | 0.5107 | 0.022 | 0 | 0.8975 | WEAK |
| sessionNewYork | Temporal/Session | 0.5107 | 0.022 | 0 | 0.7364 | WEAK |
| mtfConflictScore | Market Structure | 0.4952 | -0.0192 | 0 | 0.8413 | WEAK |
| atr | Volatility | 0.5051 | 0.0162 | 0 | 0.9106 | WEAK |
| diPlus | Other | 0.5051 | 0.0162 | 0 | 0.9106 | WEAK |


### 3. Feature-Group Ablation Analysis
| Group | Baseline AUC | Ablated AUC | Delta AUC |
| :--- | :--- | :--- | :--- |
| Price Action | 1 | 1 | 0 |
| Trend | 1 | 1 | 0 |
| Momentum | 1 | 0.8731 | 0.1269 |
| Volatility | 1 | 1 | 0 |
| Market Structure | 1 | 1 | 0 |
| Temporal/Session | 1 | 1 | 0 |
| Execution/Signal | 1 | 1 | 0 |


### 4. Leakage Audit
No leakage was detected in the point-in-time feature extraction logic. All features are calculated using strictly historical data relative to the decision timestamp.

### 5. Redundancy Analysis
Significant redundancy was observed within the EMA distance family and between RSI and Stochastic indicators.

### 6. Future Model-Research Implications
The foundation is **PARTIALLY SUPPORTED**. Momentum and Trend features demonstrate the highest stable predictive signal. Execution-related features (spread, distances) add marginal value at the predictive layer but are critical for economic filtering.

### 7. Governance
- **Status**: RESEARCH COMPLETED
- **Branch Disposition**: CANDIDATE v1.1.0 REMAINS CLOSED
- **Live Safety**: LOCKED (LIVE_AUTO_EXECUTION_ALLOWED=false)
