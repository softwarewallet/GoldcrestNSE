# Phase 9.5 — Controlled Production Go-Live Validation

Phase 9.5 adds a final operator-facing validation boundary between a release being operationally ready and the execution gate being unlocked for autonomous live trading.

## Purpose

The validation evaluates the production runtime, configuration, LIVE cTrader connectivity/account state, persisted-account consistency, execution-intent cleanliness, and activation safety without arming the execution gate and without submitting any broker order.

## Validation gates

The certification covers 24 deterministic gates covering production environment, release integrity, configuration integrity, LIVE_ONLY trading mode, SQLite initialization and persistence, runtime lifecycle, audit logging, operator authentication, cTrader LIVE credentials and verification, connection, LIVE account identity, account ID and currency, positive balance and equity, trading permission, LIVE API mode, kill switch, execution-gate locked state, unresolved execution intents, account-state consistency, and the no-order invariant.

## Operator workflow

1. Start the production application with autonomous execution locked.
2. Authenticate as operator.
3. Run GET /api/operations/go-live-validation.
4. Require HTTP 200 and status READY_FOR_ACTIVATION.
5. Review every returned check and confirm no unresolved execution intents.
6. Use POST /api/execution-gate/unlock.
7. After unlock succeeds, use POST /api/auto-trading/start.
8. Continue to observe positions, orders, execution intents, runtime health, and reconciliation.

The Phase 9.5 endpoint does not unlock the gate and does not place an order. The existing Phase 9.4 unlock endpoint repeats the activation preflight immediately before arming, so a passed Phase 9.5 validation is a readiness checkpoint rather than a bypass of the final activation gate.

## cTrader API selector

The existing cTrader LIVE/DEMO selector is preserved. Phase 9.5 requires LIVE API mode for production autonomous activation; the selector remains available for cTrader transport/account discovery.

## Certification

test/test_phase9_5_production_go_live_validation_certification.ts contains 80 deterministic broker-free scenarios and is wired into npm test.
