# PHASE EXP-2026-RESEARCH-009 REPORT
## CALIBRATED PROBABILITY TRADING IMPACT STUDY

**Experiment ID:** `EXP_2026_RESEARCH_009`
**Date:** 2026-09-18

### 1. Trading Impact Comparison
| Threshold | Raw Trades | Raw PnL (R) | Cal Trades | Cal PnL (R) | Improvement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0.40 | 119 | 142.70 | 117 | 141.80 | -0.90 |
| 0.45 | 117 | 141.80 | 113 | 140.15 | -1.65 |
| 0.50 | 110 | 137.20 | 105 | 130.60 | -6.60 |
| 0.55 | 105 | 130.60 | 104 | 128.85 | -1.75 |
| 0.60 | 101 | 129.25 | 101 | 129.25 | +0.00 |

### 2. Efficiency Gains
At the standard 0.50 threshold:
- **Raw Expectancy**: 1.25 R per trade
- **Calibrated Expectancy**: 1.24 R per trade

### 3. Governance
- **Calibration Monotonicity**: PASSED
- **Safety Invariant**: LOCKED (LIVE_AUTO_EXECUTION_ALLOWED=false)
