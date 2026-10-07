# Phase 9.1 — Operational Readiness & Activation Controls

## Objective

Provide a read-only, pre-activation server-side operational readiness contract for the current Goldcrest production architecture.

Phase 9.1 does not:
- arm autonomous execution;
- change broker routing;
- change cTrader LIVE/DEMO selector behavior;
- submit broker orders;
- reintroduce PAPER or legacy trading modes.

## Readiness gates

The operational readiness result requires all of the following:
1. Production release integrity passes.
2. Configuration integrity passes.
3. Trading mode is LIVE_ONLY.
4. SQLite is initialized.
5. SQLite persistence has no recorded error.
6. Runtime lifecycle is RUNNING.
7. Durable audit logging is available.
8. Operator authentication is configured.
9. At least one LIVE broker credential set is configured.
10. At least one LIVE broker currently reports CONNECTED.
11. LIVE_AUTO_EXECUTION_ALLOWED is locked (false).

A passing evaluation returns HTTP 200 with READY. Any failed gate returns HTTP 503 with BLOCKED and the failed gate names.

## Operator endpoint

`GET /api/operations/readiness`

The endpoint is operator-authenticated and returns only operational state. It does not return credentials, account secrets, API keys, or order packets.

## Acceptance

`test/test_phase9_1_operational_readiness_certification.ts` contains 50 deterministic, broker-order-side-effect-free scenarios covering every readiness gate, failure aggregation, and result consistency.

## Unchanged safety boundary

The Phase 8 safety contract remains intact:
- LIVE_ONLY runtime mode.
- cTrader LIVE/DEMO API selector retained.
- Autonomous live execution is locked by default.
- Phase 9.4 provides the separate authenticated activation preflight before the gate can be unlocked.
- No broker order is submitted by the Phase 9.1 certification.
