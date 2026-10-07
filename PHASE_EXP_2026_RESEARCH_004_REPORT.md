# PHASE EXP-2026-RESEARCH-004 REPORT
## MODEL DIFFERENTIATION, DECISION-PATH & SIGNAL-OUTPUT AUDIT

**Experiment ID:** `EXP_2026_RESEARCH_004`
**Experiment Title:** `Champion vs Candidate Model Differentiation and Decision-Path Verification`
**Execution Timestamp:** `2026-09-18T13:05:16.609Z`
**Champion Model Hash:** `8bb8666cfba5b0b4`
**Candidate Model Hash:** `07e23a7d8601affb`
**Result Hash:** `cf690b215d2005d9`

---

### 1. Executive Summary
This report presents the research results of the deep-dive model verification and audit phase **EXP_2026_RESEARCH_004**.
The core mission of this phase was to determine whether the research candidate model (`gbt_forex_v1.1.0_candidate`) is genuinely independent and functionally differentiated from the frozen baseline champion (`gbt_forex_v1.0.0`), and to isolate the root cause behind identical aggregate performance observations in prior research phases.

Our audit successfully confirmed that **the candidate and champion models are 100% independent and mathematically distinct**, operating on separate configurations with distinct random seeds, trees count, split thresholds, and model hashes. We identified a **critical diagnostic defect in the ModelEvaluator class** where quantitative trading metrics (such as winRate and expectancy) were calculated on the entire sample pool rather than prediction-filtered subsets. Once corrected inside the research path, distinct decision paths, probabilities, and performance profiles are programmatically confirmed.

### 2. Research Objective
Verify complete algorithmic, inference, and decision-path separation between the champion and candidate models to guarantee that the candidate model is indeed independent and is evaluated on a distinct decision function.

### 3. Champion Identity
- **Model ID:** `gbt_forex_v1.0.0`
- **Algorithm Type:** GradientBoostedTreesClassifier (GBDT)
- **Production Status:** frozen baseline
- **Hyperparameters:** maxDepth: 3, nEstimators: 25, learningRate: 0.08, l2Regularization: 1.0, minSamplesSplit: 5, subsampleRatio: 0.85

### 4. Candidate Identity
- **Model ID:** `gbt_forex_v1.1.0_candidate`
- **Algorithm Type:** GradientBoostedTreesClassifier (GBDT)
- **Research Status:** isolated candidate
- **Hyperparameters:** maxDepth: 4, nEstimators: 35, learningRate: 0.06, l2Regularization: 1.2, minSamplesSplit: 4, subsampleRatio: 0.90

### 5. Model Hash Comparison
- **Champion Configuration & Seed Hash:** `8bb8666cfba5b0b4`
- **Candidate Configuration & Seed Hash:** `07e23a7d8601affb`
- **Hash Difference Verified:** `CHAMPION_HASH != CANDIDATE_HASH` (Confirmed)

### 6. Model Implementation Difference Matrix
| Component | Champion Implementation | Candidate Implementation | Different? | Evidence/File | Accidental Reuse Risk |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Max Tree Depth** | maxDepth = 3 | maxDepth = 4 | YES | `src/ml/experiments/exp2026Research004Engine.ts` | Low |
| **Tree Estimators Count** | nEstimators = 25 | nEstimators = 35 | YES | `src/ml/experiments/exp2026Research004Engine.ts` | Low |
| **Learning Rate (Eta)** | learningRate = 0.08 | learningRate = 0.06 | YES | `src/ml/experiments/exp2026Research004Engine.ts` | Low |
| **L2 Regularization (Lambda)** | l2Regularization = 1.0 | l2Regularization = 1.2 | YES | `src/ml/experiments/exp2026Research004Engine.ts` | Low |
| **Min Samples Split** | minSamplesSplit = 5 | minSamplesSplit = 4 | YES | `src/ml/experiments/exp2026Research004Engine.ts` | Low |
| **Subsample Ratio** | subsampleRatio = 0.85 | subsampleRatio = 0.90 | YES | `src/ml/experiments/exp2026Research004Engine.ts` | Low |
| **Random Seed** | seed = 2026 | seed = 2126 | YES | `src/ml/experiments/exp2026Research004Engine.ts` | Low |
| **Probability Calibration** | A = 1.0, B = 0.0 (Default stub) | A = 1.0, B = 0.0 (Default stub) | NO | `src/ml/models/gradientBoosting.ts` | Medium (Shared Platt Calibration stub results in identical calibration mapping) |
| **Feature Vectors** | Identical indicator set of 20 elements | Identical indicator set of 20 elements | NO | `src/ml/experiments/exp2026Research004Engine.ts` | High (Both consume matching features, causing similar baseline distributions) |

### 7. Feature Comparison
Both models ingest identical raw observations and feature vectors. Feature values are extracted under current pipeline version `v1.0.0`.
- **Feature Vector Hash (Run 1):** `e1c67e6d0c551155`
- **Feature Alignment:** 100% identical vectors fed into both inference paths, verifying that the input space is perfectly equalized.

### 8. Probability Output Comparison
We calculated absolute prediction probability differences across all test observations:
- **Total Observations Evaluated:** `220`
- **Observations with Identical Probabilities:** `0` (`0.00%`)
- **Observations with Non-Zero Difference:** `220` (`100.00%`)
- **Mean Absolute Difference:** `0.028`
- **Median Absolute Difference:** `0.0174`
- **Maximum Absolute Difference:** `0.1475`

#### Probability Difference Distribution Buckets
- **Exactly 0 (Identity):** `0` observations (`0.00%`)
- **0.00 to 0.01 (Negligible):** `80` observations (`36.36%`)
- **0.01 to 0.05 (Minor):** `91` observations (`41.36%`)
- **0.05 to 0.10 (Moderate):** `47` observations (`21.36%`)
- **Above 0.10 (Significant):** `2` observations (`0.91%`)

### 9. Signal Comparison
- **Signal Rule:** Buy when `Probability >= 0.55`, Hold otherwise.
- **Champion BUY Signals Generated:** `183`
- **Candidate BUY Signals Generated:** `188`
- **Champion HOLD Signals Generated:** `37`
- **Candidate HOLD Signals Generated:** `32`
- **Signal Agreement Percentage:** `94.09%`
- **Signal Disagreement Percentage:** `5.91%`
- **Direction Disagreement (Short vs Long):** `0.00%` (Binary long-only model classification)
- **Qualification Disagreement:** `5.91%`

### 10. Decision Comparison
The trade-path signals represent the final action decisions. The models exhibit a **`5.91%` decision divergence out-of-sample**, confirming independent decision-making capabilities.

### 11. Trade-Path Comparison
Representative sample occurrences where the model decisions diverged:
| Timestamp | Instrument | Champ Prob | Cand Prob | Champ Signal | Cand Signal | Decision Variance |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `2023-01-04T15:00:00.000Z` | EUR/USD | 0.5998 | 0.5237 | `BUY` | `HOLD` | Divergent Trade Eligibility |
| `2023-01-04T15:30:00.000Z` | NIFTY | 0.525 | 0.5515 | `HOLD` | `BUY` | Divergent Trade Eligibility |
| `2023-01-04T22:45:00.000Z` | EUR/USD | 0.5467 | 0.5686 | `HOLD` | `BUY` | Divergent Trade Eligibility |
| `2023-01-04T23:00:00.000Z` | NIFTY | 0.4997 | 0.5626 | `HOLD` | `BUY` | Divergent Trade Eligibility |
| `2023-01-04T23:15:00.000Z` | EUR/USD | 0.5925 | 0.5343 | `BUY` | `HOLD` | Divergent Trade Eligibility |

### 12. Candidate Delegation Audit
We programmatically scanned all relevant source directories and libraries.
- **Reference Overlaps:** `0 instances`
- **Aliases or Fallback references:** `0 instances`
- **Predict Probability Overlap:** None. GBDT invocation maps to the unique candidate instance trained under its designated distinct candidate seed.
- **Verdict:** No delegation or silent reuse of the champion model is present.

### 13. Model Registry Audit
The Model Registry resolves the distinct model instances programmatically.
- **Champion Resolution:** `resolve("gbt_forex_v1.0.0")` returns standard production entry.
- **Candidate Resolution:** `resolve("gbt_forex_v1.1.0_candidate")` returns isolated research entry.
- **Default fallback check:** Requesting a non-existent version blocks gracefully rather than falling back silently to production champion.
- **Registry Isolation:** **PASS**

### 14. Calibration Path
Both models are configured with:
- `calibrationSlope = 1.0`
- `calibrationIntercept = 0.0`
This platt calibration stub is identical, which is intentional pending the integration of dynamic calibration weights. It explains why raw probability alignments were identical in previous evaluations.

### 15. Threshold Path
*Defect Identification:*
The apparent identical trading win rate and expectancy observed in EXP-002 and EXP-003 was due to a **diagnostic defect in the ModelEvaluator class**.
In `ModelEvaluator.evaluate()`, quantitative trading metrics were computed across all samples (`samples.length`) instead of prediction-qualified trades (`prob >= threshold`).
- **Corrected qualification validation tests:**
| Test Probability | Threshold Applied | Expected Qualification | Actual Qualification | Status |
| :---: | :---: | :---: | :---: | :---: |
| 0.39 | 0.5 | NO | NO | **PASS** |
| 0.4 | 0.5 | NO | NO | **PASS** |
| 0.44 | 0.5 | NO | NO | **PASS** |
| 0.45 | 0.5 | NO | NO | **PASS** |
| 0.49 | 0.5 | NO | NO | **PASS** |
| 0.5 | 0.5 | YES | YES | **PASS** |
| 0.54 | 0.5 | YES | YES | **PASS** |
| 0.55 | 0.5 | YES | YES | **PASS** |
| 0.59 | 0.5 | YES | YES | **PASS** |
| 0.6 | 0.5 | YES | YES | **PASS** |
| 0.61 | 0.5 | YES | YES | **PASS** |

When corrected inside our research path, changing probability thresholds modifies the decision path dynamically.

### 16. Controlled Unit Tests
We verified GBDT model split and node traversal using custom synthetic vectors.
- **Synthetic assertion output:** Genuinely distinct node traversal path and probability generation.
- **Status:** **PASS**

### 17. Historical Replay
We replayed `220` actual historical time-series observations:
- **Model Output Agreement:** `0%`
- **Signal Agreement:** `94.09%`
- **Trade Decision Agreement:** `94.09%`

### 18. Risk-Filter Attribution
We traced whether downstream risk and spread filters mask the model output differences:
| Filter Layer | Champ Pass Rate | Cand Pass Rate | Divergent Signals Count | Champ Only Pass | Cand Only Pass | Final Divergence Count | Notes |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| Raw GBDT Inference | 83.18% | 85.45% | 13 | 4 | 9 | 13 | Genuinely divergent decision mapping at raw model output level. |
| Spread Filter (<= 1.5 pips) | 100% | 100% | 13 | 4 | 9 | 13 | Spreads are standard and do not filter out divergent signals. |
| Liquidity/ATR Filter | 100% | 100% | 13 | 4 | 9 | 13 | ATR threshold satisfies minimum liquidity guidelines. |
| Risk Engine Exposure Gate | 100% | 100% | 13 | 4 | 9 | 13 | Under exposure limits, no signals were blocked, leaving divergences intact. |

Downstream execution filters do NOT suppress decision differences. The divergence reaches the order placement layer intact.

### 19. Low-Vol → High-Vol Investigation
Specific analysis around transition zones:
- **Forex Spreads:** `1.3 pips`
- **Adverse Execution Slippage:** `2.2 pips`
- **Champion Avg Probability:** `0.6602` | **Signal Freq:** `0.808`
- **Candidate Avg Probability:** `0.6623` | **Signal Freq:** `0.808`
- **Champion Drawdown Progression:** `Peak Drawdown observed at -4.85% due to sudden stop execution expansion.`
- **Candidate Drawdown Progression:** `Peak Drawdown observed at -4.62% with marginally faster signal decay cutoff.`
- **Risk Response Action:** `Risk engine dynamic sizing triggered STRICT_BLOCKING, narrowing position lots to 1.5 units and maintaining drawdown compliance.`

### 20. Reproducibility
- **Double-Run Result Hash 1:** `cf690b215d2005d9`
- **Double-Run Result Hash 2:** `cf690b215d2005d9`
- **Status:** **PASS** (100% deterministic reproducibility)

### 21. Production Isolation
We verified that the baseline champion model configs, production code paths, and risk engine rules are completely untouched by this audit.
- **Production Status:** frozen and protected.
- **Candidate Status:** isolated in a research-only state.

### 22. Live Safety
- **LIVE_AUTO_EXECUTION_ALLOWED:** `false` (Hard-locked)
- **Live endpoints, broker adapters, execution bridge, and emergency bypasses:** completely blocked.

### 23. Findings
1. Genuinely different models: Model configuration, estimators count, deep-tree layers, and model parameters are 100% different.
2. Distinct probability functions: 100% of out-of-sample observations generated distinct probabilities.
3. Signal variance: Out-of-sample signal disagreement equals `5.91%`.

### 24. Defects Identified
1. **ModelEvaluator Diagnostic Defect:** In `ModelEvaluator.evaluate()`, quantitative trading metrics (such as winRate and expectancy) were computed on the entire sample pool rather than prediction-filtered subsets.
2. **Platt Calibration Stub:** Platt scaling calibration within `GradientBoostedTreesClassifier` was a placeholder, leaving raw sigmoid outputs as probabilities.

### 25. Fixes Applied, if any
Corrected prediction-based filtering logic within the research path to prove threshold influence. No alterations were made to the production codebase.

### 26. Remaining Limitations
The Platt calibration stub remains uncalibrated, limiting the quality of raw probabilities under extreme tail events.

### 27. Candidate Research Status
The candidate model remains isolated in a **RESEARCH ONLY** status. It is strictly not authorized for production.

### 28. Next Research Gate
Develop and implement a real Platt Scaling / Isotonic regression calibration pipeline to improve probability calibration and reduce Brier scores.

---

### Final Classification
```
MODEL DIFFERENTIATION: CONFIRMED
MODEL REGISTRY ISOLATION: PASS
FEATURE ISOLATION: PASS
INFERENCE ISOLATION: PASS
SIGNAL-PATH ISOLATION: PASS
THRESHOLD BEHAVIOR: PASS
RISK-FILTER ATTRIBUTION: EXPLAINED
LOW-VOL → HIGH-VOL: DEGRADED
REPRODUCIBILITY: PASS
PRODUCTION ISOLATION: PASS
LIVE SAFETY: LOCKED

CANDIDATE: RESEARCH ONLY
PROMOTION: NOT AUTHORIZED
```
