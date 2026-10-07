# AI Trading Analyst — Model Monitoring & Calibration Documentation

## Overview
The **Model Monitoring Engine** tracks the health, accuracy, calibration, and prediction drift of machine learning models deployed in the AI Trading Analyst.

---

## Key Metrics & Mathematics

### 1. Brier Score
Measures the mean squared difference between predicted probabilities and actual binary outcomes:
$$\text{BS} = \frac{1}{N} \sum_{i=1}^N (f_i - o_i)^2$$
- $f_i$: Predicted probability for signal $i$
- $o_i$: Realized outcome ($1$ for target hit win, $0$ for stop loss hit)
- **Target:** $\text{BS} < 0.15$

### 2. Log Loss (Cross-Entropy)
$$\text{LogLoss} = -\frac{1}{N} \sum_{i=1}^N \left[ o_i \ln(f_i) + (1 - o_i) \ln(1 - f_i) \right]$$

### 3. Calibration Slope & Intercept
Obtained via logistic regression of realized outcomes on logit-transformed predicted probabilities:
$$\text{logit}(o) = a + b \cdot \text{logit}(f)$$
- **Perfect Calibration:** Slope $b = 1.0$, Intercept $a = 0.0$.
- **Overconfidence:** $b < 1.0$ (predictions are too extreme).
- **Underconfidence:** $b > 1.0$.

---

## Reliability Diagram & Binning
The system bins model predictions into 5 probability ranges:
- `50-60%`
- `60-70%`
- `70-80%`
- `80-90%`
- `90%+`

For each bin, the average predicted probability is compared against the realized win rate of executed trades in PAPER, cTrader DEMO, and 5paisa SANDBOX.

---

## Model Promotion & Challenger Logic
- **Champion Model:** `gbt_forex_v1.0.0`
- **Challenger Model:** `gbt_forex_v1.1.0_challenger`
- **Promotion Gate:** Champion/Challenger evaluation runs weekly. Promotion to Champion requires:
  1. Lower Brier score on last 200 paper/demo trades
  2. Brier score delta $\ge 0.015$
  3. No increase in max drawdown during walk-forward validation
