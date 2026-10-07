# Phase 9.4 — Production Auto Live Activation Certification

## Objective

Make autonomous Forex execution an explicit operator-controlled production capability with a complete pre-activation gate.

## Activation preflight

The authenticated `POST /api/execution-gate/unlock` endpoint now performs a server-side preflight before arming autonomous execution.

Production requires:
1. Production runtime environment.
2. Release integrity.
3. Configuration integrity.
4. `LIVE_ONLY` application trading mode.
5. Runtime lifecycle `RUNNING`.
6. cTrader LIVE credentials.
7. Successful cTrader LIVE connectivity.
8. A LIVE cTrader account.
9. Valid account identity, currency, balance and equity.
10. Confirmed broker trading permission.
11. cTrader Open API mode `LIVE`.
12. Clear emergency kill switch.

A failed preflight returns HTTP 409 with explicit blocker names and leaves the execution gate locked.

## Local development compatibility

The existing cTrader LIVE/DEMO selector is retained unchanged. Local development may use the selected DEMO API mode for broker-integrated testing; production Auto Live activation requires cTrader API mode `LIVE`.

## Execution after activation

Unlocking the gate does not bypass the normal execution pipeline. Each candidate order must still pass the shared live safety gate, Auto Trade Readiness, order-packet validation, position/loss/spread/quote checks, durable execution-intent controls and broker reconciliation.

## Certification

`test/test_phase9_4_auto_live_activation_certification.ts` contains 61 deterministic scenarios for the activation contract. It does not contact a broker or submit an order.

## Operator workflow

1. Verify the production readiness and broker/account state.
2. Use the authenticated execution-gate unlock control.
3. Confirm that the activation preflight returns `READY_TO_ARM`.
4. Start Auto Live.
5. Monitor live execution state, positions, balance/equity and reconciliation.
6. Lock the execution gate or stop Auto Live when trading should cease.

The gate remains locked after process restart unless production activation conditions are satisfied and the operator explicitly unlocks it.
