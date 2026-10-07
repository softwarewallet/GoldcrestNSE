# Goldcrest Production Readiness

## Current operating model

- User-facing trading mode: LIVE_ONLY.
- FOREX routes to cTrader LIVE.
- Indian equity, futures and options route to 5paisa LIVE.
- SQLite is the application persistence layer.
- Broker APIs are authoritative for live account and market state.
- Autonomous live-money order submission is permanently disabled by `LIVE_AUTO_EXECUTION_ALLOWED === false`.
- PAPER/DEMO HTTP workflows are retired and return HTTP 410.

## Production hardening completed

- HTTP security headers.
- `X-Powered-By` disabled.
- Request IDs.
- JSON request-size limit.
- In-process API rate limiting.
- Configurable trusted-proxy handling.
- Liveness and readiness endpoints.
- Production runtime target pinned to Node 24 LTS.
- GitHub Actions typecheck + production-build verification.
- Synthetic cTrader Forex quote/candle fallbacks removed from the main server path.
- Synthetic 5paisa option-chain generation removed.
- Unknown 5paisa option scrip codes no longer use deterministic fake IDs.

## Remaining production blockers

### 1. cTrader authoritative market-data and state certification
Implemented in the adapter:
- live bid/ask retrieval through cTrader Open API spot subscription;
- historical trendbars;
- authoritative symbol-id discovery from the authenticated account;
- broker reconciliation retrieval for current positions and orders;
- no synthetic quote/candle fallback.

Remaining certification items:
- verify cTrader price scaling across all supported symbol digit configurations;
- add persistent quote/subscription caching with explicit stale thresholds for production throughput;
- implement true historical order/deal retrieval rather than treating reconcile state as history;
- certify account equity/margin semantics against broker responses.

### 2. API authentication / authorization
Implemented for sensitive operator APIs with GOLDCREST_OPERATOR_API_KEY, including broker operations, governance, configuration, notes, reconciliation and database statistics. The key comparison uses a timing-safe comparison.

Remaining item:
- provide a secure browser/session authentication flow so the frontend can call protected operator APIs without embedding a long-lived operator secret in the public JavaScript bundle.

### 3. 5paisa authoritative market-data and instrument certification
Implemented:
- live underlying feed routing;
- historical candles;
- option-chain routing with fail-closed behavior;
- authoritative positions and open-order retrieval;
- ScripMaster-backed instrument lookup.

Remaining certification items:
- expand and validate the full equity/futures/options instrument universe;
- implement true order/trade history rather than reusing the current order book;
- validate derivative contract mapping (expiry/strike/CE/PE) against the broker master.

### 4. SQLite deployment topology
SQLite is appropriate for the current single-instance architecture. A multi-instance deployment should not be introduced without changing the persistence/concurrency strategy.

### 5. Broker reconciliation
A SQLite reconciliation-snapshot table and broker snapshot API are now present. cTrader and 5paisa live state should be captured after startup/reconnect and on an operational schedule, with broker state remaining authoritative and local state never treated as broker truth.

## Required release gates

1. `npm run lint`
2. `npm run build`
3. CI green on the production branch.
4. cTrader live quote + historical-data certification.
5. 5paisa live market-data and account reconciliation certification.
6. Authentication/authorization certification.
7. Kill-switch and autonomous-execution safety regression tests.
8. Backup/restore test for SQLite.
9. Production reverse-proxy/TLS deployment test.


## Latest production hardening

- Browser operator authentication now uses a server-side `GOLDCREST_OPERATOR_API_KEY` to issue an HttpOnly, SameSite=Strict, same-origin session cookie. The secret is never embedded in the frontend bundle.
- Cookie-backed state-changing operator requests are rejected when their `Origin` is cross-origin; direct server/API clients may continue using the operator header.
- The public ML research/training API is retired with HTTP 410 while the research program remains CLOSED. No EXP-012 or new research workflow is exposed.
- 5paisa order history now uses the broker TradeBook endpoint rather than treating the current OrderBook as historical execution history.
- cTrader account mapping now derives equity from broker balance plus reconciled unrealized P/L and maps broker-reported used margin/free margin when available; missing balance is fail-closed.
