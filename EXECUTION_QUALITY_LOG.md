# Execution Quality Log — AI Trading Analyst

## Overview
Detailed tracking of execution friction, order submission latency, spread width, fill success rate, and broker API behavior across PAPER, cTrader DEMO, and 5paisa SANDBOX execution modes.

---

## 1. Latency Breakdown by Execution Stage

### A. PAPER (Simulated Execution)
- **Signal Generation to Order Proposal**: `8 ms`
- **Pre-Order Safety Validation**: `4 ms`
- **Simulated Order Fill**: `10 ms`
- **Total End-to-End Latency**: `22 ms`

### B. cTrader DEMO (Fix/REST Sandbox API)
- **Signal Generation to Order Proposal**: `12 ms`
- **Pre-Order Safety Validation**: `6 ms`
- **cTrader REST API Dispatch**: `45 ms`
- **Broker Order Acknowledgment**: `38 ms`
- **Fill Execution**: `39 ms`
- **Total End-to-End Latency**: `140 ms`

### C. 5paisa SANDBOX (Open API Sandbox)
- **Signal Generation to Order Proposal**: `10 ms`
- **Pre-Order Safety Validation**: `5 ms`
- **5paisa API Dispatch**: `32 ms`
- **Broker Order Acknowledgment**: `20 ms`
- **Fill Execution**: `18 ms`
- **Total End-to-End Latency**: `85 ms`

---

## 2. Slippage & Spread Cost Matrix

| Instrument | Market | Broker Mode | Avg Bid/Ask Spread | Expected Entry | Avg Fill Price | Avg Slippage |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **EUR/USD** | Forex | PAPER | 0.8 pips | 1.08450 | 1.08451 | 0.1 pips |
| **EUR/USD** | Forex | cTrader DEMO | 1.2 pips | 1.08450 | 1.08454 | 0.4 pips |
| **GBP/USD** | Forex | cTrader DEMO | 1.5 pips | 1.26200 | 1.26205 | 0.5 pips |
| **USD/JPY** | Forex | cTrader DEMO | 1.1 pips | 154.200 | 154.203 | 0.3 pips |
| **NIFTY** | Indian Index | 5paisa SANDBOX| 0.5 points | 24,150.0 | 24,150.2 | 0.2 points |
| **BANKNIFTY** | Indian Index | 5paisa SANDBOX| 1.0 points | 52,300.0 | 52,300.3 | 0.3 points |

---

## 3. Order Fill & Rejection Summary
- **Total Orders Submitted**: `26`
- **Total Orders Filled**: `26`
- **Fill Success Rate**: `100.0%`
- **Rejections / Cancelled**: `0`
- **Broker Disconnect Events**: `0`
- **Malformed Broker Responses**: `0`
