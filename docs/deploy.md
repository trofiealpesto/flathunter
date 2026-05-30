# Deployment

## Recommended topology

The default production path is a generic self-hosted Docker Compose stack. It is not tied to Oracle, Vercel, Netlify, or another deploy platform.

- `web-http` or `web-https`: Caddy serving the built frontend from `apps/web`.
- `/api/*`: proxied by Caddy to the internal API service.
- `api`: Fastify app from `apps/api`.
- `worker`: Playwright-capable scraper loop from `apps/worker`.
- `postgres`: self-hosted Postgres with a persistent Docker volume.
- `migrate`: one-shot migration service run by the Makefile on deploy.

The stack lives in `infra/production/`.

## Configure the server env

Copy the template on the production server:

```bash
cp infra/production/.env.example infra/production/.env
```

Set at least:

- `POSTGRES_PASSWORD=<long-random-password>`
- `DATABASE_URL=postgres://flathunter:<same-password>@postgres:5432/flathunter`
- `SESSION_SECRET=<long-random-secret>`
- `PORTAL_SECRETS_KEY=<long-random-secret>`
- `ADMIN_GITHUB_LOGIN=<your-github-login>`
- `GITHUB_CLIENT_ID=<github-oauth-client-id>`
- `GITHUB_CLIENT_SECRET=<github-oauth-client-secret>`

Keep this off on remote servers:

```bash
ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP=false
```

## Deploy

HTTP on port 80:

```bash
make prod-deploy PROD_SCHEME=http PROD_HOST=flathunter.example.com PROD_PORT=80
```

HTTPS on port 443:

```bash
make prod-deploy PROD_SCHEME=https PROD_HOST=flathunter.example.com PROD_PORT=443
```

`prod-deploy` does this:

- checks the current branch matches `PROD_BRANCH` (`main` by default)
- pulls `origin/$(PROD_BRANCH)` with `--ff-only`
- validates the production compose config
- rebuilds Docker images for web, API, worker, and migrations
- starts Postgres
- runs migrations
- starts the API, worker, and selected web service

To deploy another branch:

```bash
make prod-deploy PROD_BRANCH=<branch-name> PROD_HOST=flathunter.example.com
```

To use an explicit public origin instead of the derived `PROD_SCHEME://PROD_HOST[:PROD_PORT]`:

```bash
make prod-deploy PROD_APP_ORIGIN=https://flathunter.example.com
```

## Stop and logs

Stop every production service without deleting volumes:

```bash
make prod-stop
```

Tail production logs:

```bash
make prod-logs
```

## GitHub OAuth app

Configure the production callback URL to match the public web origin:

```text
https://flathunter.example.com/api/auth/github/callback
```

Use `http://.../api/auth/github/callback` if you deploy with `PROD_SCHEME=http`.

## HTTPS notes

The HTTPS profile uses Caddy automatic certificates. For public Let's Encrypt certificates:

- `PROD_HOST` must be a real DNS name pointing to the server
- port `443/tcp` must reach the server
- port `80/tcp` should also reach the server for ACME HTTP validation

If TLS is terminated by another reverse proxy or load balancer, deploy this stack with `PROD_SCHEME=http` on an internal port and put that proxy in front of it.

## Optional Vercel frontend

The repo still supports the split Vercel frontend setup:

- frontend build command: `pnpm --filter @flathunter/web build`
- output directory: `apps/web/dist`
- required Vercel env var: `API_ORIGIN=https://<api-service-domain>`

That path is optional. The generic `prod-deploy` stack serves the frontend itself.
