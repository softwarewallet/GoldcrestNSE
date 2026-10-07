# Goldcrest Auto-Live Runtime

Goldcrest currently supports autonomous live execution for the deterministic Forex strategy `fx_structure_v2a` through cTrader LIVE. Indian/5paisa automation remains separate until an authoritative live Indian strategy engine is wired; the existing 5paisa live adapter is available for guarded autonomous routing.

## Local / private runtime

Keep Goldcrest bound to loopback for private desktop use:

    NODE_ENV=development
    HOST=127.0.0.1
    PORT=3000

The localhost operator-login screen is bypassed only for non-production loopback requests. Production still requires the operator session.

## Runtime gates

Autonomous execution is effective only when all of these are true:

    LIVE_TRADING_ENABLED=true
    GOLDCREST_AUTO_TRADING_ENABLED=true
    GOLDCREST_AUTONOMOUS_LIVE_EXECUTION=true
    GOLDCREST_PRODUCTION_STRATEGY_ID=fx_structure_v2a
    GOLDCREST_PRODUCTION_STRATEGY_APPROVED=true
    GOLDCREST_AUTO_TRADING_START_ON_BOOT=true

cTrader LIVE credentials and a valid GOLDCREST_OPERATOR_API_KEY are also required.

## Current safety limits

The application defaults remain:

- risk per trade: 1%
- maximum daily loss: 3%
- maximum simultaneous positions: 5
- maximum trades per day: 20
- maximum consecutive losses: 3
- maximum spread: 30 bps
- maximum Forex trade notional: $200

The maximum Forex notional must be compatible with the broker's minimum order size. Goldcrest fails closed when the configured maximum is too small to satisfy the broker minimum rather than increasing the order silently.

## Market-open confirmation and pre-open preparation

Before Auto Live is armed, Goldcrest checks the current session state for both supported markets:

    cTrader / Forex
    5paisa / Indian markets

If at least one supported market is open, the normal Auto Live loop can start.

If both markets are closed, the Start control returns the exact confirmation prompt:

    Markets are closed, do you still want to start Auto Live

Selecting **No** abandons the start request. Selecting **Yes** arms Auto Live in `PREPARING` state rather than submitting an order.

While `PREPARING`, Goldcrest repeatedly refreshes live cTrader market data and evaluates multi-timeframe trend/structure across the configured Forex pairs. It also checks live macro-news coverage through the GDELT DOC 2.0 source and records headline risk indicators in the runtime audit log. No order is submitted during the preparation phase.

When a supported market session opens, the service moves from `PREPARING` into the live execution cycle and the existing signal, risk, readiness, execution-intent, broker, and reconciliation gates still apply.

## Auto-trading loop

The service refreshes live cTrader data, evaluates the multi-timeframe Forex strategy, checks the current bid/ask against the strategy entry zone, calculates quantity from risk and broker constraints, then sends the order through the full Goldcrest safety chain:

Signal -> validator -> live gate -> readiness -> autonomous permission -> durable execution intent -> broker -> reconciliation.

The loop does not use synthetic candles or synthetic quotes.

## Operational controls

Authenticated local API endpoints:

    GET  /api/auto-trading/status
    POST /api/auto-trading/start
    POST /api/auto-trading/stop

The loop also refuses to continue when the emergency kill switch is active or autonomous permission is withdrawn.

## Date-wise runtime audit logs

When enabled from Settings -> LIVE RUNTIME LOG, Goldcrest writes one plain-text file per calendar date:

    logs/goldcrest-live-YYYY-MM-DD.log

The default audit timezone for the filename is Asia/Kolkata; override with GOLDCREST_LOG_TIMEZONE when needed. The log archive endpoint lists all available daily files, and a specific date can be opened/downloaded without touching other dates.

Recommended audit workflow:

    START LIVE LOG
    run the live test
    STOP LIVE LOG
    provide the relevant logs/goldcrest-live-YYYY-MM-DD.log file for audit

Older dates remain untouched when a new date begins, so the archive can be used for historical incident, execution, and reconciliation reviews.
