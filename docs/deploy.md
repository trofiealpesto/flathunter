# Deployment

## Recommended topology

- `Vercel`: serves the static frontend built from `apps/web/dist`.
- `Vercel /api proxy`: forwards browser requests from `/api/*` to your real backend using `API_ORIGIN`.
- `API service`: runs `apps/api` on a normal Node container host.
- `Worker service`: runs `apps/worker` on a Playwright-capable container host.
- `Postgres`: any managed Postgres reachable through `DATABASE_URL`.

This split is intentional:

- the frontend benefits from Vercel CDN and instant previews
- the API stays same-origin to the browser through the Vercel proxy
- Playwright-based scraping and auth refresh stay off Vercel Functions, where browser-heavy long-running work is the wrong fit for this repo

The repo now includes a single-VM Oracle deployment profile in `infra/oracle/`:

- `infra/oracle/docker-compose.yml`: API, worker loop, Postgres, and Caddy reverse proxy
- `infra/oracle/.env.example`: Oracle VM env template
- `infra/oracle/Caddyfile`: TLS termination for `api.<your-domain>`

For the full Oracle rollout, see [docs/deploy-oracle.md](./deploy-oracle.md).

## Vercel project

- Root directory: repository root
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm --filter @flathunter/web build`
- Output directory: `apps/web/dist`
- Config file: `vercel.json`

### Required Vercel environment variables

- `API_ORIGIN=https://<api-service-domain>`

The Vercel proxy function in `api/[[...path]].ts` forwards every browser `/api/*` request to `API_ORIGIN` and preserves cookies on the browser-facing origin.

## API service

Use the existing Dockerfile:

- Root: repository root
- Dockerfile: `apps/api/Dockerfile`

Required environment variables:

- `NODE_ENV=production`
- `DATABASE_URL=<managed-postgres-url>`
- `PORT=4000`
- `APP_ORIGIN=https://<your-vercel-domain>`
- `SESSION_SECRET=<long-random-secret>`
- `PORTAL_SECRETS_KEY=<long-random-secret>`
- `ADMIN_GITHUB_LOGIN=<github-login>`
- `GITHUB_CLIENT_ID=<github-oauth-app-id>`
- `GITHUB_CLIENT_SECRET=<github-oauth-app-secret>`
- `SCRAPER_PROXY_URL=<optional>`

Notes:

- `APP_ORIGIN` must point to the Vercel frontend domain because OAuth callback and session redirects terminate there.
- Source auth refresh and browser bootstrap stay on this service, not on Vercel.
- On remote deployments, set `ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP=false`. The local browser bootstrap flow only works when the API process can open a visible browser on your machine.

## Worker service

Use the existing Dockerfile:

- Root: repository root
- Dockerfile: `apps/worker/Dockerfile`

Required environment variables:

- `NODE_ENV=production`
- `DATABASE_URL=<managed-postgres-url>`
- `PORTAL_SECRETS_KEY=<same-value-as-api>`
- `IMMOWELT_SEARCH_URL=https://www.immowelt.de/liste/berlin/wohnungen/mieten`
- `IMMOWELT_ENABLE_LIVE_BROWSER=true`
- `SCRAPER_PROXY_URL=<optional>`
- `CAPSOLVER_API_KEY=<optional>`
- `GEMINI_API_KEY=<required for semantic classification and English analyst>`
- `GEMINI_API_BASE_URL=<optional, defaults to Google Gemini Developer API>`

Run mode:

- continuous loop with `pnpm --filter @flathunter/worker run start:loop`
- or one-shot cron invoking `pnpm --filter @flathunter/worker run start`

The Oracle compose profile runs the continuous loop from the built artifact: `node apps/worker/dist/dev.js`.

## Postgres

You can use Neon, Railway Postgres, Supabase Postgres, or another standard Postgres provider.
If you want to keep everything on one Oracle VM, the repo includes a self-hosted Postgres service in `infra/oracle/docker-compose.yml`.

Before first production boot:

```bash
pnpm install
pnpm db:migrate
```

Run migrations against the production `DATABASE_URL`.

## GitHub OAuth app

Configure two callback URLs:

- Local development: `http://localhost:3000/api/auth/github/callback`
- Production: `https://<your-vercel-domain>/api/auth/github/callback`

Only the login configured in `ADMIN_GITHUB_LOGIN` is accepted after OAuth succeeds.

## Minimal rollout order

1. Create the private Git repository and push this repo.
2. Provision Postgres and collect `DATABASE_URL`.
3. Deploy the API container.
4. Set `API_ORIGIN` in Vercel to the API public URL.
5. Deploy the Vercel frontend.
6. Update the GitHub OAuth production callback URL to the Vercel domain.
7. Deploy the worker container and enable its loop or cron schedule.

If you are following the Oracle path, step 3-7 are collapsed into the Oracle compose stack plus one `API_ORIGIN` env on Vercel.

## Manual checks

After deployment:

1. Open the Vercel app and confirm `/api/auth/session` returns `authenticated: false` instead of a proxy error.
2. Complete GitHub login and verify the session cookie is set on the Vercel domain.
3. If the API is remote, run manual browser bootstrap locally against the same database. Do not expect `Open browser login` on the Oracle host to open a browser on your laptop.
4. Trigger one worker run and confirm Immowelt no longer shows a degraded status unless there are real invalid/error detail failures.
