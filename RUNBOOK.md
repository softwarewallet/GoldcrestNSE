# GOLDCCREST PRODUCTION DISASTER-RECOVERY RUNBOOK

**RELEASE TRACK:** Production LIVE-only analyst
**PERSISTENCE:** SQLite at data/trading_analyst.sqlite on durable storage
**EXECUTION SAFETY:** LIVE_AUTO_EXECUTION_ALLOWED === false

## A. Application Failure (Crash / OOM)
- **Detection:** Container health check failure, process exit, or unresponsive frontend.
- **Containment:** Restart the single production container.
- **Action:** Preserve the durable /app/data volume.
- **Verification:** /api/health returns 200 and /api/health/ready returns ready.
- **Reconciliation:** On startup Goldcrest attempts LIVE cTrader and 5paisa reconciliation snapshots.
- **Recovery:** Verify broker status and account balances before normal operator use.
- **Audit:** Record release, restart time, and container logs.

## B. Database Failure / Corruption
- **Detection:** SQLite initialization, read, or write errors.
- **Containment:** Do not continue state-changing operations.
- **Action:** Stop the application, preserve the affected database, and restore the latest verified SQLite backup.
- **Verification:** Run application health/readiness checks and inspect database statistics.
- **Recovery:** Confirm settings remain LIVE_ONLY and safety invariant remains false.
- **Audit:** Record backup identifier, restore time, and affected release.

## C. Broker Failure (API Disconnect)
- **Detection:** Broker status reports authentication, timeout, unavailable, stale-data, or account errors.
- **Containment:** Treat the affected broker's account/market state as unavailable; do not synthesize balances or prices.
- **Action:** Verify broker credentials/session and upstream broker status.
- **Verification:** Refresh the affected broker account and market-data endpoints.
- **Reconciliation:** Capture broker snapshots after reconnect and compare authoritative positions/orders.
- **Recovery:** Resume operator analysis only after the affected broker reports authoritative data.
- **Audit:** Record the broker, error code, time window, and reconciliation result.

## D. Security Incident / Operator Session
- **Detection:** Unexpected authentication failures, suspicious request volume, or attempted access to protected APIs.
- **Containment:** Revoke/rotate the GOLDCREST_OPERATOR_API_KEY at the deployment secret store and restart the service.
- **Action:** Review reverse-proxy and application logs.
- **Verification:** Confirm unauthenticated protected requests receive 401/503 as appropriate.
- **Recovery:** Issue a new high-entropy operator key and verify same-origin browser login.
- **Audit:** Preserve relevant logs and timestamps.

## E. Live Execution Safety
The permanent invariant is:

`LIVE_AUTO_EXECUTION_ALLOWED === false`

Live broker connectivity is permitted for account state, market data, positions, orders, reconciliation and validation. Autonomous live-money order submission must remain blocked.

If any test or code path appears capable of submitting an autonomous live order:
1. Stop the production service.
2. Preserve logs and the current release.
3. Verify both LIVE adapter placeOrder implementations reject autonomous execution.
4. Verify the server dispatch boundary rejects autonomous execution.
5. Do not restore service until the invariant is confirmed.

## F. Release Rollback
- Keep the previous production container image/tag available.
- Stop the current release.
- Restore the previous known-good image.
- Restore a compatible SQLite backup only when required.
- Start the previous release and verify health/readiness.
- Never roll back into a configuration that enables autonomous live execution.

## G. Database Backup
Back up the SQLite database from the durable volume before releases and on a scheduled basis.

Recommended retention:
- current verified backup
- previous verified backup
- release/version identifier
- backup timestamp

For a consistent backup, stop the application briefly or use a SQLite-consistent backup mechanism.

## H. Production Smoke Test
After every deployment:
1. Open the HTTPS application URL.
2. Complete operator login.
3. Confirm header shows cTrader and 5paisa.
4. Confirm both balance cards display authoritative LIVE account data when broker sessions are valid.
5. Open broker status and confirm each broker's actual connection state.
6. Confirm LIVE_ONLY mode.
7. Confirm autonomous live execution remains disabled.
8. Confirm SQLite data survives a container restart.
9. Check logs for startup/reconciliation errors.
