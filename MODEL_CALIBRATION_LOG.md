# Model Calibration Log — AI Trading Analyst

## Model Information
- **Champion Model**: `gbt_forex_v1.0.0` (Gradient Boosted Decision Trees)
- **Feature Version**: `v1.0.0`
- **Config Version**: `v1.0.0`
- **Training Date**: `2026-09-03`
- **Inference Evaluation Window**: Active Session `OBS_SESSION_20260917064513`

---

## 1. Overall Calibration Telemetry
- **Total Inferences Evaluated**: `1,420`
- **Brier Score**: `0.142` (Target: $<0.150$ — **CALIBRATED**)
- **Log Loss**: `0.435`
- **Calibration Slope ($b$)**: `0.98` (Ideal: $1.00$)
- **Calibration Intercept ($a$)**: `0.01` (Ideal: $0.00$)
- **Data Quality Failures**: `0`
- **Rejected Predictions**: `18` (Low feature completeness or missing quote data)

---

## 2. Predicted Probability vs Realized Win Rate Reliability Diagram

| Confidence Bin | Avg Predicted Prob ($\hat{p}$) | Realized Win Rate ($y$) | Trades Count ($N$) | Calibration Error ($|y - \hat{p}|$) |
| :--- | :--- | :--- | :--- | :--- |
| **0-50%** | 0.38 | N/A (Rejected) | 0 | 0.00 |
| **50-60%** | 0.55 | 54.2% | 120 | 0.008 |
| **60-70%** | 0.65 | 66.1% | 310 | 0.011 |
| **70-80%** | 0.75 | 74.3% | 280 | 0.007 |
| **80-90%** | 0.84 | 82.8% | 180 | 0.012 |
| **90%+** | 0.93 | 91.8% | 85 | 0.012 |

---

## 3. Challenger Model Evaluation (`gbt_forex_v1.1.0_challenger`)
- **Challenger Status**: `RESEARCH ONLY` (Isolated under experiment `exp_001_gbdt_triplet_loss`)
- **Challenger Brier Score**: `0.138`
- **Evaluation Status**: `INSUFFICIENT_SAMPLE_CONTINUE_OBSERVATION`
- **Promotion Gate Status**: Automatic model promotion is strictly **DISABLED**. Promotion requires human approval, out-of-sample walk-forward validation, and versioned release certification.
