# PHASE EXP-2026-RESEARCH-010 REPORT
## FORMAL MODEL GOVERNANCE, PROMOTION READINESS & RESEARCH CLOSURE REVIEW

**Date:** 2026-09-18
**Review ID:** `EXP_2026_RESEARCH_010`

### 1. Executive Summary
This document provides a formal governance closure for the research branch comparing `gbt_forex_v1.0.0` (Champion) and `gbt_forex_v1.1.0_candidate`. Despite intensive research across comparison, divergence, calibration, and trading impact, the candidate has failed to demonstrate a statistically significant or economically persistent advantage over the production champion.

### 2. Governance Objective
To determine the documented research disposition of the candidate using evidence from EXP-006 through EXP-009.

### 3. Evidence Sources
- **EXP-006**: Corrected Model Comparison
- **EXP-007**: Divergence Attribution & Stability
- **EXP-008**: Platt Probability Scaling
- **EXP-009**: Calibrated Trading Impact

### 4. Artifact Hashes
- **Dataset Hash**: `add21a3d2fe57ea3`
- **Champion Model (`gbt_forex_v1.0.0`)**: `771f8a9af1138889`
- **Candidate Model (`gbt_forex_v1.1.0_candidate`)**: `171d65190f99b6ef`
- **Calibrated Artifact**: `gbt_forex_v1.1.0_candidate_platt_research`

### 5. Evidence Hierarchy
| Level | Layer | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | Model/Code Integrity | **PASS** | Evaluator v1.2.0 confirmed correct. |
| 2 | Data Integrity | **PASS** | Chronological splits verified. No leakage. |
| 3 | Probability Calibration | **IMPROVED** | Platt scaling improved OOS Brier/ECE scores. |
| 4 | Predictive Discrimination | **UNCHANGED** | ROC-AUC/PR-AUC invariant under scaling. |
| 5 | Trading Decision Quality | **INSUFFICIENT** | Net P&L delta is not statistically significant. |
| 6 | Economic Significance | **INSUFFICIENT** | Improvement decays under friction; not persistent. |
| 7 | Temporal/Regime Robustness| **FAIL** | Performance unstable across sequential windows. |
| 8 | Production Readiness | **FAIL** | Fails to meet the 95% significance gate for edge. |

### 6. Promotion Gate Matrix
| Criterion | Status |
| :--- | :--- |
| 1. Correct evaluator | **PASS** |
| 2. No leakage | **PASS** |
| 3. Reproducibility | **PASS** |
| 4. Model differentiation | **PASS** |
| 5. Calibration quality | **PASS** |
| 6. Predictive discrimination | **PASS** |
| 7. Incremental trading edge | **FAIL** |
| 8. Statistical significance | **FAIL** |
| 9. Economic significance | **FAIL** |
| 10. Regime stability | **FAIL** |
| 11. Temporal stability | **FAIL** |
| 12. Friction robustness | **FAIL** |
| 13. Risk stability | **FAIL** |
| 14. Production isolation | **PASS** |
| 15. Security integrity | **PASS** |
| 16. Live safety | **PASS** |

### 7. Established Findings
- **Evaluator Correctness**: The threshold-aware ModelEvaluator v1.2.0 is correctly implemented.
- **Calibration Module**: Platt scaling effectively improves the reliability of the candidate's probabilities.
- **Model Baseline**: The candidate demonstrates a minor but non-significant point-estimate improvement.

### 8. Unresolved Questions
- Why does improved probability calibration (EXP-008) not translate into improved trading expectancy (EXP-009) at fixed thresholds?
- Are the current feature sets (`FEAT-v3.1.0`) saturated for this market regime?

### 9. Limitations
- **Sample Size**: Finite OOS sample (600 records) limits the resolution of statistical significance for small edges.
- **Friction**: Strategy remains highly sensitive to slippage exceeding 1.5 pips.

### 10. Candidate Disposition
**C. RESEARCH CLOSED — CANDIDATE NOT SUPPORTED FOR PROMOTION**

### 11. Final Governance Statement
The research candidate demonstrates no reproducible incremental edge that justifies displacing the existing production champion. The current research branch is hereby closed. Production handlers must continue to load only the authorized `gbt_forex_v1.0.0` weights.

---

### FINAL GOVERNANCE BLOCK

EXP-006 EVIDENCE:
STATISTICAL EVIDENCE: INSUFFICIENT

EXP-007 EVIDENCE:
INCREMENTAL EDGE: INSUFFICIENT

EXP-008 CALIBRATION:
B_CALIBRATION_IMPROVEMENT_INCONCLUSIVE

EXP-009 TRADING IMPACT:
INCONCLUSIVE / NOT SUPPORTED

INCREMENTAL EDGE:
INSUFFICIENT

STATISTICAL EVIDENCE:
INSUFFICIENT

ECONOMIC EVIDENCE:
INSUFFICIENT

REGIME ROBUSTNESS:
UNSTABLE

TEMPORAL ROBUSTNESS:
UNSTABLE

FRICTION ROBUSTNESS:
DEGRADED

RISK STABILITY:
INSUFFICIENT EVIDENCE

PRODUCTION ISOLATION:
PASS

LIVE SAFETY:
LOCKED

CANDIDATE STATUS:
RESEARCH ONLY

PRODUCTION PROMOTION:
NOT AUTHORIZED
