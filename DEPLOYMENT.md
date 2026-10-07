# Goldcrest Production Deployment

## Production target

**Public application:** https://trade.goldcrestfinman.com

Goldcrest is a stateful Node/Express application with SQLite persistence. Deploy it as a single persistent Linux server/container instance with durable storage mounted at /app/data.

Do not deploy the application server as a stateless serverless function while SQLite is authoritative. Multiple instances can create divergent SQLite databases.

## Required production environment

Copy .env.example to .env and set:

- NODE_ENV=production
- HOST=0.0.0.0
- PORT=3000
- GOLDCREST_DOMAIN=trade.goldcrestfinman.com
- GOLDCREST_OPERATOR_API_KEY=<high-entropy-secret>
- cTrader LIVE credentials
- 5paisa LIVE credentials

Optional:
- GEMINI_API_KEY
- TRUST_PROXY=true when using the bundled Caddy reverse proxy.

Keep .env outside Git. Never put broker credentials or the operator key in frontend build variables.

## DNS and network

Create the DNS record:

- `trade.goldcrestfinman.com` A/AAAA -> production Linux server public IP

Allow inbound TCP 80 and 443 on the server/firewall. Do not expose TCP 3000 publicly.

The bundled Caddy service terminates HTTPS for `trade.goldcrestfinman.com` and proxies internally to Goldcrest on port 3000.

## Safety state

The production deployment must preserve:
- TRADING_MODE=LIVE_ONLY
- LIVE_AUTO_EXECUTION_ALLOWED=false
- LIVE_TRADING_ENABLED=false
- AUTO_EXECUTION_ENABLED=false

Broker connectivity is allowed for account, market-data, positions and order observation. Autonomous live-money order submission remains permanently blocked.

## Docker deployment

1. Install Docker Engine and Compose on the production Linux host.
2. Clone the repository.
3. Create the production .env from .env.example.
4. Enter the actual cTrader LIVE and 5paisa LIVE credentials directly into the server-side .env. Do not commit them to Git.
5. Generate a strong GOLDCREST_OPERATOR_API_KEY and keep it server-side.
6. Start with:
   `docker compose up -d --build`
7. Verify:
   `docker compose ps`
8. Verify local health:
   `curl -fsS http://127.0.0.1:3000/api/health`
9. Verify HTTPS:
   `curl -fsS https://trade.goldcrestfinman.com/api/health`
10. Verify readiness:
   `curl -i https://trade.goldcrestfinman.com/api/health/ready`
11. Open https://trade.goldcrestfinman.com and complete the operator login.
12. Verify both LIVE broker balance cards and broker status.
13. Take the first verified SQLite backup before normal production use.

## Release procedure

For each release:
- `git pull --ff-only origin main`
- `docker compose build`
- `docker compose up -d`
- `docker compose ps`
- `docker compose logs --tail=200 goldcrest`

Verify:
- /api/health returns HTTP 200.
- /api/health/ready returns HTTP 200.
- HTTPS is valid for trade.goldcrestfinman.com.
- Operator login succeeds.
- cTrader and 5paisa balance cards show authoritative LIVE account data when credentials/session are valid.
- Broker status identifies unavailable/authentication failures explicitly when a broker is not ready.
- SQLite data remains present after container restart.
- No PAPER/DEMO workflow is exposed as an active trading mode.
- LIVE_AUTO_EXECUTION_ALLOWED remains false.

## Database backup

Back up the SQLite database from the durable volume before upgrades and on a scheduled basis. A safe application-level backup should copy the database while the application is stopped or use a SQLite-consistent backup mechanism.

At minimum retain:
- current database backup
- previous known-good database backup
- release/version identifier
- backup timestamp

## Final production checklist

- [ ] Linux production server provisioned.
- [ ] Docker Engine and Compose installed.
- [ ] DNS for trade.goldcrestfinman.com points to the production server.
- [ ] TCP 80 and 443 allowed.
- [ ] TCP 3000 not publicly exposed.
- [ ] TLS enabled by Caddy.
- [ ] GOLDCREST_OPERATOR_API_KEY configured.
- [ ] cTrader LIVE credentials verified.
- [ ] 5paisa LIVE credentials/session verified.
- [ ] /api/health/ready returns ready.
- [ ] Both balance cards display authoritative broker data.
- [ ] SQLite volume is durable and backed up.
- [ ] No broker credentials committed to Git.
- [ ] Autonomous live order submission remains disabled.

Do not put broker credentials or the operator key into Git or Vite frontend variables.
