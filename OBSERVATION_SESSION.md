# Controlled Production Observation Session Log

## Active Observation Session
- **`OBSERVATION_SESSION_ID`**: `OBS_SESSION_20260917064513`
- **Start Timestamp**: `2026-09-17T06:45:13Z` (Epoch: `1789627513000`)
- **Release Baseline**: `RC-1.0.0-FINAL`
- **Release Version**: `v1.1.0-operations-research`
- **Configuration Version**: `v1.1.0-prod-hardened`
- **Configuration Hash**: `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- **Model Version**: `gbt_forex_v1.0.0` (Champion)
- **Feature Version**: `v1.0.0`
- **Active Execution Modes**:
  1. `PAPER` (Simulated Engine)
  2. `cTrader DEMO` (Fix/REST Broker Sandbox)
  3. `5paisa SANDBOX` (Open API Sandbox)
- **Monitored Instruments**: `EUR/USD`, `GBP/USD`, `USD/JPY`, `AUD/USD`, `USD/CHF`, `NIFTY`, `BANKNIFTY`
- **Monitored Timeframes**: `M15`, `H1`, `H4`, `D1`
- **Observation Session Status**: `ACTIVE`
- **Sample Status**: `INSUFFICIENT_SAMPLE_CONTINUE_OBSERVATION`

---

## Safety Invariant Audit
```typescript
LIVE_AUTO_EXECUTION_ALLOWED === false
```
- **Verification Status**: `LOCKED_SECURE`
- **Verification Timestamp**: `2026-09-17T06:45:13Z`
- **Verification Mechanism**: `LiveTradingGate.verifySafetyInvariant()` verified at runtime module initialization and Express router entry point.
- **Live Trading Block**: Hard-coded constant `false` enforced across all broker routing, risk gates, and API controllers.

---

## Session Activity Summary
- **Total Signals Observed**: `42`
- **Qualified Signals**: `35`
- **Rejected Signals**: `7` (Reasons: Spread Threshold Breach, Risk Exposure Cap)
- **Total Executed Trades Observed**: `26`
  - **PAPER Trades**: `14`
  - **cTrader DEMO Trades**: `8`
  - **5paisa SANDBOX Trades**: `4`
- **Reconciliation Check**: `26 / 26` Trades matched across Internal Memory, Broker Sandbox, and Firestore.
