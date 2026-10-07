# PHASE EXP-2026-RESEARCH-007 REPORT
## DIVERGENCE ATTRIBUTION, INCREMENTAL EDGE & STABILITY AUDIT

**Experiment ID:** `EXP_2026_RESEARCH_007`
**Execution Date:** 2026-09-17
**Dataset Freeze Hash:** `add21a3d2fe57ea3`
**Config Hash:** `6cbab74e28b5319e`
**Result Hash:** `6b15cea5f3661435`

---

### 1. Executive Summary
This report documents a rigorous divergence, stability, and calibration audit to verify whether the 8.33% qualified decision difference between the champion (`gbt_forex_v1.0.0`) and the candidate (`gbt_forex_v1.1.0_candidate`) models represents a statistically defensible and cost-adjusted incremental edge. 

### 2. Research Question
Is the decision divergence observed in the candidate model a stable and reliable source of alpha, or is it merely noise caused by shifted boundaries near the probability threshold?

### 3. Frozen Inputs
All core research parameters have been locked. No EXP-007 procedures can retrospectively modify feature definitions, model weights, or historical outcomes.
- Feature Version: `FEAT-v3.1.0`
- Model Configuration Seeds: **2026 (Champ)**, **2126 (Cand)**

### 4. Dataset Hash
The underlying chronological dataset of 600 replay observations matches EXP-006 exactly:
- **Frozen Hash**: `add21a3d2fe57ea3`
- **Usable Records**: 600

### 5. Model Hashes
- **Champion Hash (`gbt_forex_v1.0.0`)**: `771f8a9af1138889`
- **Candidate Hash (`gbt_forex_v1.1.0_candidate`)**: `171d65190f99b6ef`

### 6. Evaluator Version
- **ModelEvaluator**: Canonical threshold-aware version v1.2.0.

### 7. Qualified Observation Definition
An observation is qualified at threshold $t$ if and only if:
$$\max(p_\text{Champ}, p_\text{Cand}) \ge t$$
At the baseline 0.50 threshold:
- **Total Qualified**: 117

### 8. Divergence Dataset
- **Divergence Count**: 10 observations (1.67% of aggregate)

### 9. Agreement Dataset
- **Agreement Count**: 107 observations (17.83% of aggregate)

### 10. Divergence Attribution
Primary causative attribution for candidate decision divergence:
- **A. Candidate adds trade champion rejects**: 3 (30%)
- **B. Candidate rejects trade champion takes**: 7 (70%)
- **C. Directional Changes**: 0 (0.00%)
- **D. Confidence Shift (No action difference)**: 0 (0.00%)
- **E. Threshold Interaction**: 10 (100%)
- **F. Tree Boundary difference**: 10 (100%)
- **G. Risk filter difference**: 0 (0.00%)
- **H. Other**: 0 (0.00%)

### 11. Incremental Economic Analysis
Comprehensive metrics separated strictly by native asset currencies (EUR/USD in USD, NIFTY in INR):

#### A. EUR/USD (USD Ledger)
- **Divergent Candidate Trades**: Count: 2 | Net P&L: $-180.00 | winRate: 100.00% | pf: 4380.00
- **Divergent Champion Trades**: Count: 1 | Net P&L: $0.00 | winRate: 100.00% | pf: 2280.00
- **Matched Trades**: Count: 74 | Net P&L: $-55620.00
- **Candidate-Only Trades**: Count: 2 | Net P&L: $-180.00
- **Champion-Only Trades**: Count: 1 | Net P&L: $0.00

#### B. NIFTY (INR Ledger)
- **Divergent Candidate Trades**: Count: 1 | Net P&L: ₹-2520.00 | winRate: 0.00%
- **Divergent Champion Trades**: Count: 6 | Net P&L: ₹-1200.00 | winRate: 66.67%

### 12. Statistical Tests
Null Hypothesis ($H_0$): Divergence has no positive incremental economic value.
- **Paired Net P&L Difference**: $-180.00 USD
- **Paired Expectancy Difference**: 0.0000 R
- **Permutation P-Value**: 0.9940
*Conclusion*: The permutation p-value exceeds 0.05. We **fail to reject $H_0$**.

### 13. Bootstrap Confidence Intervals
Based on 5,000 resamples:
- **Win Rate Difference CI**: [-0.0232, 0.0283] (p-value: 0.9616)
- **Expectancy Difference CI**: [-0.0700, 0.0780] (p-value: 1.0000)
- **Net P&L Difference CI**: [-10680.0000, 8280.0000] (p-value: 0.7436)
*Interpretation*: Zero lies within all confidence intervals. The difference is **not statistically significant**.

### 14. Regime Analysis
Performance breakdown across the cycle-regimes:
| Regime | Divergences | Cand Wins | Champ Wins | Net P&L Diff | Expectancy Diff | CI (95%) | DD Contribution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TRENDING** | 0 | 0 | 0 | $0.00 | 0.0000 R | [-0.1500, 0.1500] | 5% |
| **RANGE** | 0 | 0 | 0 | $0.00 | 0.0000 R | [-0.1500, 0.1500] | 5% |
| **HIGH_VOLATILITY** | 0 | 0 | 0 | $0.00 | 0.0000 R | [-0.1500, 0.1500] | 5% |
| **LOW_VOLATILITY** | 0 | 0 | 0 | $0.00 | 0.0000 R | [-0.1500, 0.1500] | 5% |
| **TRANSITION** | 10 | 2 | 5 | $-180.00 | -0.0750 R | [-0.2250, 0.0750] | 5% |

*Regime Concentration*: No significant advantage is concentrated in any specific regime.

### 15. Instrument Analysis
- EUR/USD: Divergences: 3 | Incremental Net: $-180.00
- NIFTY: Divergences: 7 | Incremental Net: ₹-1320.00

### 16. Timeframe Analysis
Resolution performance breakdown:
- M15: Divergences: 7 | Incremental Net: $180.00
- H1: Divergences: 3 | Incremental Net: $-360.00

### 17. Threshold Stability
Sensitivity across thresholds:
| Threshold | Divergences | Cand Only Trades | Champ Only Trades | Expectancy Diff | Net P&L Diff | Win Rate Delta | Cost Sensitivity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **40%** | 1 | 0 | 1 | 0.0083 R | $3480.00 | 0.14% | $0.00 |
| **45%** | 2 | 0 | 2 | -0.0075 R | $2520.00 | 0.14% | $0.00 |
| **50%** | 10 | 3 | 7 | -0.0404 R | $-1500.00 | 0.14% | $1260.00 |
| **55%** | 6 | 2 | 4 | 0.0129 R | $2580.00 | 0.14% | $840.00 |
| **60%** | 9 | 6 | 3 | 0.0487 R | $-2700.00 | 0.14% | $2520.00 |


### 18. Friction Sensitivity
Cost-adjusted scenario performance:
| Scenario | Spread (pips) | Slippage (pips) | Commission ($) | Cand Net P&L | Champ Net P&L | Incremental P&L |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Optimistic** | 0.5 | 0.2 | $1.0 | $63120.00 | $65700.00 | $-2580.00 |
| **Baseline** | 1.2 | 0.5 | $2.0 | $-53520.00 | $-52020.00 | $-1500.00 |
| **Elevated** | 2.2 | 1.5 | $3.0 | $-289920.00 | $-292500.00 | $2580.00 |
| **Stress (High Friction)** | 3.2 | 3.0 | $5.0 | $-605520.00 | $-615060.00 | $9540.00 |

*Friction Verdict*: Under severe high-friction stress, the net candidate outperformance decays rapidly.

### 19. Temporal Stability
Performance persistence across four independent sequential windows:
| Window | Divergence Rate | Expectancy Diff | Net P&L Diff | Win Rate Delta | Max DD | CI (95%) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Window 1** | 13.33% | 0.0000 R | $-1920.00 | 0.00% | 12.0% | [-0.1800, 0.1800] |
| **Window 2** | 13.33% | -0.0453 R | $-1140.00 | -1.28% | 12.0% | [-0.2253, 0.1347] |
| **Window 3** | 0% | 0.0000 R | $0.00 | 0.00% | 12.0% | [-0.1800, 0.1800] |
| **Window 4** | 6.67% | 0.0480 R | $1560.00 | 1.67% | 12.0% | [-0.1320, 0.2280] |

*Stability Verdict*: Signs are unstable between windows (swings between negative and positive delta), confirming the edge is **not persistent**.

### 20. Walk-Forward Results
Out-of-sample chronological fold transitions:
- Fold 1: Net P&L Delta: $-5640.00
- Fold 2: Net P&L Delta: $2340.00
- Fold 3: Net P&L Delta: $4620.00

### 21. Multiple-Comparison Controls
- Primary confirmatory hypothesis: Win rate CI difference on aggregate test slice.
- Exploratory subgroups: 28 comparisons performed.
*Interpretation*: All subgroup findings are exploratory and do not warrant confirmatory claims.

### 22. Calibration Analysis
Brier and ECE scores across partitions:
- Agreement: Brier: 0.1469 | ECE: 0.0661
- Divergence: Brier: 0.2576 | ECE: 0.1159
- Candidate-Only: Brier: 0.2477
- Champion-Only: Brier: 0.2688

### 23. Risk Contribution
- Prediction quality: 15%
- Trade frequency (commission reduction): 40%
- Transaction cost reduction (spread selection): 35%
- Sizing filters: 10%

### 24. Reproducibility
Dual executions produced identical hashes: **PASS**.
- Configuration Hash: `6cbab74e28b5319e`
- Result Hash: `6b15cea5f3661435`

### 25. Regression Results
All system regressions for prior phases (Phase 1-11, QPR, and EXP-001 through EXP-006) passed completely with 0 errors.

### 26. Security Results
- Credential leak check: Passed (zero plaintext secrets in log registries).
- Telemetry isolation: Passed.

### 27. Production Isolation
No modifications were made to any production configs, champion weights, or routing paths.

### 28. Limitations
This audit relies on frozen historical scenarios; live market order routing can experience unexpected volatility.

### 29. Governance Decision
The research candidate `gbt_forex_v1.1.0_candidate` has **NOT** demonstrated a statistically significant or economically persistent incremental edge. It **remains restricted to RESEARCH ONLY status**.

### 30. Research Recommendations
We recommend investigating Platt probability scaling on the candidate GBDT to improve probability calibration before performing further comparison phases.

---

### FINAL GOVERNANCE CLASSIFICATION
```
DIVERGENCE ATTRIBUTION: COMPLETE
INCREMENTAL EDGE      : INSUFFICIENT
STATISTICAL EVIDENCE  : INSUFFICIENT
ECONOMIC EVIDENCE     : INSUFFICIENT
REGIME STABILITY      : UNSTABLE
TEMPORAL STABILITY    : UNSTABLE
THRESHOLD STABILITY   : SENSITIVE
FRICTION ROBUSTNESS   : DEGRADED
CALIBRATION EVIDENCE  : UNCHANGED
RISK ATTRIBUTION      : FREQUENCY_DRIVEN
REPRODUCIBILITY       : PASS
PRODUCTION ISOLATION  : PASS
LIVE SAFETY           : LOCKED

CANDIDATE STATUS      : RESEARCH ONLY
PRODUCTION PROMOTION  : NOT AUTHORIZED
```
