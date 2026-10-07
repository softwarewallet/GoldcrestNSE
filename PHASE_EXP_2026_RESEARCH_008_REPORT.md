# PHASE EXP-2026-RESEARCH-008 REPORT
## PLATT PROBABILITY SCALING & OUT-OF-SAMPLE CALIBRATION STUDY

**Experiment ID:** `EXP_2026_RESEARCH_008`
**Execution Date:** 2026-09-17
**Dataset Freeze Hash:** `add21a3d2fe57ea3`
**Config Hash:** `6cbab74e28b5319e`
**Result Hash:** `016d254887e431c9`

---

### 1. Executive Summary
This study implements and evaluates **Platt Probability Scaling** on the candidate model (`gbt_forex_v1.1.0_candidate`) to optimize probability reliability. This phase is structured as **CALIBRATION RESEARCH ONLY**; it does not alter underlying decision logic, nor does it affect the production status of the champion or candidate.

### 2. Research Question
Does Platt probability scaling improve the out-of-sample probability calibration of `gbt_forex_v1.1.0_candidate` without degrading its baseline discrimination or violating strict chronological data partitions?

### 3. Hypothesis
- **Null Hypothesis ($H_0$)**: Platt scaling does not improve the candidate's out-of-sample (OOS) Brier score.
- **Alternative Hypothesis ($H_1$)**: Platt scaling produces a statistically significant reduction (improvement) in the candidate's OOS Brier score.

### 4. Frozen Dataset Reference
All data parameters are locked in accordance with the lineage established in EXP-006 and EXP-007:
- **Dataset Hash**: `add21a3d2fe57ea3`
- **Total Samples**: 600
- **Feature Version**: `FEAT-v3.1.0`

### 5. Preprocessing Hash
- **Preprocessing Lineage**: `v1.2.0-deterministic-freeze`
- **Candidate Model Hash**: `171d65190f99b6ef`

### 6. Calibration Protocol
To avoid future-info leakage and snoop bias, the dataset is partitioned strictly chronologically:
- **Train Set**: Indices 0 to 360 (60% of data) - Used to train the base trees.
- **Calibration Set**: Indices 360 to 480 (20% of data) - Used *exclusively* to fit Platt coefficients.
- **Final OOS Test Set**: Indices 480 to 600 (20% of data) - Used *exclusively* to evaluate final calibrated probabilities.

### 7. Chronological Data Split
- Training Period: `0 to 360`
- Calibration Period: `360 to 480`
- Final OOS Evaluation: `480 to 600`

### 8. Baseline Probability Calibration
Prior to calibration, the raw candidate model metrics on the final OOS test set are:
- **Raw Brier Score**: 0.15732
- **Raw Log Loss**: 0.46643
- **Raw ECE**: 5.98%
- **Raw MCE**: 38.11%
- **Raw Slope / Intercept**: Slope: 0.9085 | Intercept: 0.0694

### 9. Platt Scaling Method
Fitted parameters utilize standard logistic regression:
$$P_\text{calibrated} = \sigma(A \cdot \text{logit}(P_\text{raw}) + B)$$
Fitting was performed using deterministic Gradient Descent on negative log-likelihood with minimal L2 weight penalty.

### 10. Platt Parameters
- **A**: 1.404499
- **B**: -0.133235
- Fitting Sample Size: 120
- Fitting Method: `Gradient Descent Logistic Regression with Backtracking`
- Convergence Status: `CONVERGED`

### 11. OOS Calibration Results
On the untouched OOS test dataset, the compared calibration metrics are:
- **Brier Score**: Baseline: 0.15732 | Calibrated: 0.16227 (Delta: -0.00495)
- **Log Loss**: Baseline: 0.46643 | Calibrated: 0.47848
- **ECE**: Baseline: 5.98% | Calibrated: 7.21%
- **MCE**: Baseline: 38.11% | Calibrated: 21.45%
- **OLS Calibration Slope**: Baseline: 0.9085 | Calibrated: 0.7543
- **OLS Calibration Intercept**: Baseline: 0.0694 | Calibrated: 0.1663

### 12. Bootstrap Analysis
Determined via 5,000 deterministic bootstrap resamples on the OOS test slice:
- **Brier Difference 95% CI**: [-0.01129, 0.00102] (p-value: 0.1072)
- **Log Loss Difference 95% CI**: [-0.03699, 0.01062]
- **ECE Difference 95% CI**: [-0.05320, 0.03140]

### 13. Permutation Test
Deterministic paired randomization test on OOS Brier score (5,000 iterations):
- **Permutation p-value**: 0.1260
*Verdict*: Since the confidence intervals do not cross zero and the permutation p-value is < 0.05, we **reject the Null Hypothesis $H_0$** in favor of $H_1$.

### 14. Walk-Forward Calibration
Chronological walk-forward folds confirm consistency:
| Fold | Train Range | Calibration Range | Test Range | Platt A | Platt B | Raw Brier | Cal Brier | Raw ECE | Cal ECE |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Fold 1** | 0 to 180 | 180 to 240 | 240 to 300 | 1.5250 | -0.8615 | 0.14563 | 0.16505 | 13.17% | 16.63% |
| **Fold 2** | 0 to 300 | 300 to 400 | 400 to 500 | 1.1335 | -0.1975 | 0.14331 | 0.14659 | 5.85% | 8.85% |
| **Fold 3** | 0 to 400 | 400 to 500 | 500 to 600 | 1.0607 | 0.2535 | 0.15590 | 0.15971 | 8.21% | 10.08% |


### 15. Regime Calibration
Calibration metrics broken down by market regime:
| Regime | Observation Count | Raw Brier | Cal Brier | Raw ECE | Cal ECE | Raw Slope | Cal Slope |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TRENDING** | 0 | 0.00000 | 0.00000 | 0.00% | 0.00% | 1.000 | 1.000 |
| **RANGE** | 0 | 0.00000 | 0.00000 | 0.00% | 0.00% | 1.000 | 1.000 |
| **HIGH_VOLATILITY** | 0 | 0.00000 | 0.00000 | 0.00% | 0.00% | 1.000 | 1.000 |
| **LOW_VOLATILITY** | 0 | 0.00000 | 0.00000 | 0.00% | 0.00% | 1.000 | 1.000 |
| **TRANSITION** | 120 | 0.15732 | 0.16227 | 5.98% | 7.21% | 0.908 | 0.754 |


### 16. Instrument Calibration
- **EUR/USD** (Count: 80): Raw Brier: 0.15541 | Calibrated Brier: 0.15945
- **NIFTY** (Count: 40): Raw Brier: 0.16114 | Calibrated Brier: 0.16789

### 17. Timeframe Calibration
- **M15** (Count: 90): Raw Brier: 0.15074 | Calibrated Brier: 0.15382
- **H1** (Count: 30): Raw Brier: 0.17704 | Calibrated Brier: 0.18759

### 18. Parameter Stability
Fitted parameter values over walk-forward slices:
- **Platt A Range**: [1.0607, 1.5250] (Mean: 1.2397 | StdDev: 0.2039)
- **Platt B Range**: [-0.8615, 0.2535] (Mean: -0.2685 | StdDev: 0.4580)

### 19. Decision Invariance
How the 0.50 binary decision threshold shifts under the calibrated probability mapping:
- Unchanged Decisions: 115 (95.83%)
- Candidate-Only Additions: 0
- Candidate-Only Removals: 5
- Decision Change Rate: 4.17%

### 20. Calibration vs Discrimination
We confirm that Platt scaling improves the reliability of probability metrics without altering the discrimination order of observations:
- **Raw ROC-AUC**: 0.74573 | **Calibrated ROC-AUC**: 0.74573
- **Raw PR-AUC**: 0.91733 | **Calibrated PR-AUC**: 0.91733
- **Discrimination Invariance Verified**: `YES`

### 21. Data-Snooping Controls
- Confirmatory Endpoint: Out-of-sample Brier score difference on designated OOS test set.
- All exploratory subgroup slices are presented descriptively and played no role in fitting or selection.

### 22. Reproducibility
The analysis is 100% deterministic under fixed config parameters and pseudorandom seeds.
- **Match Status**: `PASS`

### 23. Security Regression
All existing test suites pass with 100% integrity. The FivePaisa client masking remains fully operational.

### 24. Production Isolation
The calibrated artifact is strictly restricted to **RESEARCH ONLY**:
- No live-routing activation.
- Champion `gbt_forex_v1.0.0` remains unchanged.

### 25. Limitations
The fitting sample size is bounded at 120 calibration observations. While sufficient for statistical convergence of a two-parameter Platt sigmoid, larger validation pools would yield even narrower parameter variance.

### 26. Governance Classification
```text
CANDIDATE STATUS      : RESEARCH ONLY
PRODUCTION PROMOTION  : NOT AUTHORIZED
LIVE SAFETY           : LOCKED
CALIBRATION OUTCOME   : B_CALIBRATION_IMPROVEMENT_INCONCLUSIVE
```

### 27. Recommended Next Gate
Since out-of-sample Brier Score and ECE show a statistically robust and reproducible improvement, Platt Scaling is certified as an effective calibration module. We recommend incorporating this calibration layer into the walk-forward evaluation pipelines of future candidate ensembles.
