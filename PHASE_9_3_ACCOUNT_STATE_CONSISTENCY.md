# Phase 9.3 — Live Account State Consistency

## Objective

Ensure the LIVE account card and the three-hour balance history remain linked to the same authoritative broker account.

## Source of truth

- The LIVE balance card reads the current account state from `/api/brokers/status`, which is backed by the LIVE broker adapter.
- The balance-history report reads persisted snapshots captured from the same LIVE broker adapters.
- A historical value is expected to differ from the current live value when the account changes after the snapshot was captured.
- Account identity and currency must match exactly after normalization.

## Consistency states

- `ALIGNED`: same LIVE account and currency, valid fields, and history is within the operational freshness window.
- `STALE_HISTORY`: same account and currency, but the history point is older than the operational freshness window.
- `ACCOUNT_MISMATCH`: history belongs to a different account identity.
- `CURRENCY_MISMATCH`: history currency differs from the current account currency.
- `HISTORY_UNAVAILABLE`: no valid captured LIVE snapshot is available.
- `LIVE_ACCOUNT_UNAVAILABLE`: current authoritative LIVE account state is unavailable or invalid.

Current-vs-history balance, equity and margin differences are reported as deltas and are not treated as faults when the account identity and historical timestamp are valid.

## Operator endpoint

`GET /api/operations/account-consistency`

The endpoint is operator-authenticated and returns masked account identifiers, current LIVE values, latest historical values, freshness, and consistency state.

HTTP status:
- `200`: all evaluated broker account states are consistent.
- `503`: one or more required account states are unavailable or inconsistent.

## Acceptance

`test/test_phase9_3_account_state_consistency_certification.ts` contains 27 deterministic cases covering identity, currency, validity, freshness, deltas and result determinism.

No order, position or broker account mutation is performed by the certification.
