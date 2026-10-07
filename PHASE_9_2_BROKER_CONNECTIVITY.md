# Phase 9.2 — LIVE Broker Connectivity & Account Verification

## Objective

Provide a protected, read-only diagnostic for both active LIVE broker adapters.

The verification layer distinguishes:
- `VERIFIED`: the configured broker connection test succeeded and returned authoritative account identity/currency/financial fields.
- `CONFIGURED_UNAVAILABLE`: credentials exist but the broker or authoritative account state could not be verified.
- `NOT_CONFIGURED`: no required LIVE credentials are configured.

## Safety boundaries

Phase 9.2:
- does not submit orders;
- does not modify positions or orders;
- does not alter broker routing;
- does not alter the cTrader LIVE/DEMO API selector;
- never fabricates account balances, equity, currency, or connection state;
- does not return raw account IDs, API keys, access tokens, or other credentials from the diagnostic endpoint.

For cTrader, the selected `cTraderApiMode` is checked against the connection result and its expected WebSocket endpoint:
- LIVE → `wss://live.ctraderapi.com:5036`
- DEMO → `wss://demo.ctraderapi.com:5036`

## Operator endpoint

`GET /api/operations/brokers/verify`

The endpoint requires operator authentication. It executes connection tests only for brokers with configured LIVE credentials and returns sanitized verification state.

HTTP status:
- `200`: at least one configured LIVE broker is currently connected.
- `503`: no LIVE broker is connected, or no LIVE broker is configured.

## Acceptance

`test/test_phase9_2_broker_connectivity_certification.ts` contains 40 deterministic, broker-order-side-effect-free scenarios covering configured/unconfigured brokers, connection failures, authoritative account fields, and cTrader API-mode integrity.
