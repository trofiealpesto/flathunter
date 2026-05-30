# FlatHunter

Personal dashboard to discover, score, and review Berlin apartment listings across multiple portals.

## Stack

- `apps/web`: React + Vite + shadcn/ui Nova
- `apps/api`: Fastify + GitHub OAuth + signed cookie sessions
- `apps/worker`: Playwright + deterministic scoring + Ollama-backed semantic classification
- `packages/db`: Drizzle schema + repositories + migrations
- `packages/shared`: shared types, schemas, and scoring utilities

## Quick start

1. Install Node 22 and pnpm 10:

   ```bash
   npm install -g pnpm@10.33.0
   ```

2. Copy `.env.example` to `.env` and fill in the GitHub OAuth values.
3. Start local dependencies:

   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```

4. Install and migrate:

   ```bash
   pnpm install
   pnpm db:migrate
   ```

5. Run the API and web app:

   ```bash
   pnpm dev
   ```

6. Run the worker manually:

   ```bash
   pnpm worker:run
   ```

7. Run the continuous local worker loop:

   ```bash
   pnpm worker:dev
   ```

## Makefile shortcuts

The repo ships with a `Makefile` that loads `.env` automatically.

```bash
make dev
```

This starts Docker dependencies, applies migrations, and launches the web app, API, and the continuous local worker loop.
If `pnpm` is not installed yet, `make` installs `pnpm@10.33.0` automatically.
If `nvm` is installed, `make` also switches to the Node version declared in `.nvmrc` automatically.

Useful extras:

```bash
make worker
make worker-dev
make test
make infra-down
```

Production server shortcuts:

```bash
cp infra/production/.env.example infra/production/.env
make prod-deploy
make prod-stop
```

`prod-deploy` is intended to be run from the cloned repo on the production server. It pulls the latest `origin/main`, rebuilds the production Docker images, applies migrations, and starts the full stack: frontend, `/api` reverse proxy, API, worker, Postgres, and Caddy.

Choose the public web scheme, host, and port from `make`:

```bash
make prod-deploy PROD_SCHEME=http PROD_HOST=flathunter.example.com PROD_PORT=80
make prod-deploy PROD_SCHEME=https PROD_HOST=flathunter.example.com PROD_PORT=443
```

`prod-stop` stops the full production stack without deleting persistent volumes.

## GitHub OAuth callback URLs

- Local: `http://localhost:3000/api/auth/github/callback`
- Vercel: `https://<your-vercel-domain>/api/auth/github/callback`

## Live scraping defaults

- Local development is `live-first` by default.
- `IMMOWELT_ENABLE_LIVE_BROWSER=true` enables the Playwright scraper.
- `WORKER_DEV_INTERVAL_MS=300000` runs the local worker loop every 5 minutes.
- Fixture mode is still available from `Settings`, but it is no longer the default.

## Multi-source backend

- The worker now orchestrates the active sources `IMMOWELT` and `WG_GESUCHT` through a shared adapter registry.
- Source credentials and browser storage state are persisted per portal in encrypted DB tables.
- `PORTAL_SECRETS_KEY` is required to encrypt/decrypt source credentials and session state.
- `CAPSOLVER_API_KEY` is reserved for challenge solving integrations.
- `SCRAPER_PROXY_URL` can be used to route Playwright traffic through a shared proxy.
- You do not need developer accounts or official platform APIs for the current scraping architecture. Use regular end-user accounts for the portals you want to authenticate.

### Source strategy

- `IMMOWELT`: primary scraping source, enabled by default, credentials optional.
- `WG_GESUCHT`: secondary scraping source, credentials and session refresh required before enablement.
- `IMMOSCOUT24`: retired from active source management. Historical listings stay queryable.
- `KLEINANZEIGEN`: retired from active source management for now. Historical listings stay queryable.

The current product direction is scraping-first for consumer discovery. Official portal APIs are not required for normal use and are not the main integration path.

### Source setup in the UI

1. Open `Sources` in the web app.
2. Select the portal you want to configure.
3. Enter the portal login/email and password in the `Authentication` section.
4. Click `Save credentials`.
5. Click `Refresh session`.

If the portal returns `Challenge required`:

1. Click `Open browser login`.
2. Complete login or the anti-bot challenge in the opened local browser window.
3. Return to the UI and click `Save browser session`.

If the refresh succeeds:

- the session is stored encrypted in the database
- the source status changes to `Session valid`
- the source is enabled automatically

If the refresh fails:

- the source stays disabled
- the UI shows `Auth failed` or `Challenge required`
- `lastAuthError` explains what happened

`IMMOWELT` keeps its current live flow and does not require credentials by default, but the same auth section is still available if you want to validate the session explicitly.

### Source auth routes

- `GET /api/sources/:portal/auth`
- `PUT /api/sources/:portal/auth`
- `POST /api/sources/:portal/auth/refresh`
- `DELETE /api/sources/:portal/auth`

`POST /api/sources/:portal/auth/refresh` validates the current source access path and updates the persisted auth/session summary for that source.

## Deployment

See [docs/deploy.md](docs/deploy.md).
For the older split `Vercel + Oracle backend` rollout, use [docs/deploy-oracle.md](docs/deploy-oracle.md).

### Recommended production topology

- `Caddy`: serves the built frontend and reverse-proxies `/api/*` to the API.
- `API service`: runs `apps/api`.
- `Worker service`: runs `apps/worker` in loop mode for live scraping.
- `Postgres`: runs in the same compose stack by default.

The generic production profile lives in `infra/production/` and is not tied to a specific hosting provider.
