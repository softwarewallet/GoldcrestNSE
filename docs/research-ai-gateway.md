# Research AI Gateway Contract

Goldcrest uses one optional research-only connection named `LLAMA_GATEWAY`. The remote server may orchestrate both Llama and Qwen internally. Goldcrest never creates a separate Qwen network connection.

## Request

POST `/predict`

Headers:
- `Content-Type: application/json`
- `Accept: application/json`
- Optional `Authorization: Bearer <token>`

Body:

```json
{
  "gateway": "LLAMA",
  "llamaModel": "llama3.3",
  "qwenModel": "qwen3",
  "payload": {
    "task": "RESEARCH_PREDICTION",
    "horizon": "1D",
    "features": {}
  }
}
```

The `features` object contains only information known at signal time. Realized P&L, final outcome, and holding duration are intentionally excluded.

## Response

The preferred response envelope is:

```json
{
  "consensus": {
    "direction": "UP",
    "confidence": 82,
    "modelAgreement": 0.91,
    "reasoning": "…",
    "invalidation": "…"
  },
  "qwen": {
    "direction": "UP",
    "confidence": 84
  },
  "llama": {
    "direction": "UP",
    "confidence": 80
  }
}
```

### Required consensus fields

- `direction`: `UP`, `DOWN`, or `FLAT`
- `confidence`: numeric 0–1 or 0–100
- `modelAgreement`: optional numeric 0–1 or 0–100
- `reasoning`: optional string
- `invalidation`: optional string

Goldcrest normalizes 0–100 probabilities to 0–1 internally.

For compatibility, the server may return a `prediction` object instead of `consensus`, or the prediction fields at the top level. Goldcrest currently accepts those legacy envelopes.

## Health

GET `/health` should return HTTP 2xx when the gateway is ready to accept prediction requests.

Goldcrest also exposes an operator-authenticated connectivity check at `POST /api/research-ai/server/test-prediction`. It sends a synthetic signal-time payload through the configured gateway and validates the returned direction, confidence, and optional model agreement without creating a broker order or writing execution state.

## Operational rules

1. The gateway is optional. Goldcrest must operate normally when it is disabled or unavailable.
2. The gateway is research-only and must not authorize, size, submit, modify, or close broker orders.
3. The gateway receives no broker credentials, access tokens, account identifiers, or execution secrets.
4. Qwen remains an internal/optional model behind the single Llama gateway connection.
5. Invalid direction or probability responses are rejected rather than silently converted.
6. Network failures and non-JSON responses are surfaced as research-service errors.
7. Research predictions are persisted with a model version so baseline and gateway observations can be evaluated separately.
