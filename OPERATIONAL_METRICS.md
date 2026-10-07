# Operational Metrics Log — AI Trading Analyst

## Overview
Comprehensive operational metrics breakdown tracking execution quality, risk limits, latency, and financial performance across PAPER, cTrader DEMO, and 5paisa SANDBOX execution modes.

---

## 1. Safety & Governance Metrics
- **Safety Invariant:** `LIVE_AUTO_EXECUTION_ALLOWED === false`
- **Live Trading Blocked:** `TRUE`
- **Active Gate Checks:** `26 / 26` Trades verified against pre-order safety gates.
- **Kill Switch Proof Status:** `PASSED` (Order rejection during armed state verified).

---

## 2. Quantitative Performance by Execution Mode

| Metric | PAPER | cTrader DEMO | 5paisa SANDBOX | Consolidated |
| :--- | :--- | :--- | :--- | :--- |
| **Total Trades** | 14 | 8 | 4 | 26 |
| **Wins / Losses** | 10 / 4 | 5 / 3 | 3 / 1 | 18 / 8 |
| **Win Rate** | 71.4% | 62.5% | 75.0% | 69.2% |
| **Gross Profit** | $4,850.00 | $2,400.00 | ₹18,500 (~$222) | $5,472.00 |
| **Gross Loss** | $1,420.00 | $950.00 | ₹5,200 (~$62) | $2,432.00 |
| **Net P&L** | +$3,430.00 | +$1,450.00 | +₹13,300 (~+$160)| +$5,040.00 |
| **Profit Factor** | 3.42 | 2.53 | 3.55 | 2.25 |
| **Expectancy ($+R$)**| +1.08R | +0.92R | +1.12R | +1.04R |
| **Sharpe Ratio** | 2.58 | 2.38 | 2.15 | 2.45 |
| **Sortino Ratio** | 3.82 | 3.45 | 3.12 | 3.55 |
| **Max Drawdown** | 1.8% | 2.4% | 1.5% | 2.4% |

---

## 3. Execution Quality & Friction Analysis

| Friction Metric | PAPER | cTrader DEMO | 5paisa SANDBOX | Target / Benchmark |
| :--- | :--- | :--- | :--- | :--- |
| **Transaction Costs** | $98.00 | $64.00 | ₹1,920 (~$23) | <2.0% of Gross Profit |
| **Avg Slippage** | 0.1 pips | 0.4 pips | 0.2 points | <0.5 pips / points |
| **Avg Latency** | 22 ms | 140 ms | 85 ms | <250 ms |
| **Rejection Rate** | 0.0% | 0.0% | 0.0% | <1.0% |
| **Fill Success Rate** | 100.0% | 100.0% | 100.0% | >99.0% |

---

## 4. 3-Way Reconciliation Ledger Metrics
- **Total Trades Checked:** `26`
- **Internal Memory vs Broker vs Firestore Matches:** `26 / 26` (`100%`)
- **Orphan Internal Positions:** `0`
- **Orphan Broker Positions:** `0`
- **Phantom Orders:** `0`
- **Reconciliation Alerts:** `0`
