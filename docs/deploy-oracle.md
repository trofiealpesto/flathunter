# Oracle Deploy

This profile keeps the browser app on Vercel and runs the backend stack on one Oracle VM:

- `apps/web` on `Vercel`
- `apps/api` on the VM
- `apps/worker` on the VM in continuous loop mode
- `Postgres` on the same VM via Docker
- `Caddy` on the VM for HTTPS on `api.<your-domain>`

## What the repo now ships

- `infra/oracle/docker-compose.yml`
- `infra/oracle/Caddyfile`
- `infra/oracle/.env.example`
- `make oracle-config`
- `make oracle-up`
- `make oracle-down`
- `make oracle-logs`

## Assumptions

- You already have a Vercel project for the frontend.
- You control a domain and can point `api.<your-domain>` to the Oracle VM public IP.
- You are fine with self-hosted Postgres on the same VM.
- Manual browser bootstrap is local-only in this architecture. The Oracle API host will not open a browser on your laptop.

## 1. Provision the Oracle VM

Use Ubuntu on an Oracle VM that can run Docker comfortably. The current worker image tag is multi-arch, so the compose stack is valid for ARM-based Oracle A1 as well as x86 VMs.

Open these inbound ports in the Oracle network security list and local firewall:

- `22/tcp`
- `80/tcp`
- `443/tcp`

## 2. Install Docker

Install Docker Engine and the Compose plugin on the VM, then clone this repository there.

## 3. Configure environment

Copy the template:

```bash
cp infra/oracle/.env.example infra/oracle/.env
```

Set at least:

- `APP_ORIGIN=https://<your-vercel-domain>`
- `API_DOMAIN=api.<your-domain>`
- `ACME_EMAIL=<your-email>`
- `POSTGRES_PASSWORD=<long-random-password>`
- `DATABASE_URL=postgres://flathunter:<same-password>@postgres:5432/flathunter`
- `SESSION_SECRET=<long-random-secret>`
- `PORTAL_SECRETS_KEY=<long-random-secret>`
- `ADMIN_GITHUB_LOGIN=<your-github-login>`
- `GITHUB_CLIENT_ID=<github-oauth-client-id>`
- `GITHUB_CLIENT_SECRET=<github-oauth-client-secret>`

Keep this flag off on the VM:

```bash
ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP=false
```

That makes `Open browser login` return a clear idle message instead of trying to launch Chromium on the server.

## 4. Point DNS

Create an `A` record:

- `api.<your-domain>` -> `<oracle-vm-public-ip>`

Wait until the record resolves publicly before starting Caddy, otherwise certificate issuance will fail.

## 5. Validate and start the stack

```bash
make oracle-config
make oracle-up
make oracle-logs
```

`oracle-up` does this:

- starts Postgres
- runs DB migrations once
- starts the API
- starts the worker loop from `apps/worker/dist/dev.js`
- exposes the API publicly through Caddy with HTTPS

## 6. Configure Vercel

Set this environment variable on the Vercel project:

```bash
API_ORIGIN=https://api.<your-domain>
```

Then deploy the frontend again so the `/api/*` proxy points to the Oracle host.

## 7. GitHub OAuth

Set the production callback URL in your GitHub OAuth app to:

```text
https://<your-vercel-domain>/api/auth/github/callback
```

The browser always talks to Vercel. Vercel proxies that callback to the Oracle API.

## 8. Post-deploy application settings

Recommended on a free or small Oracle VM:

- use `gemini-2.5-flash-lite` for the classifier and `gemini-2.5-flash` for the on-demand analyst
- set `GEMINI_API_KEY` instead of running a local model daemon
- keep `WORKER_DEV_INTERVAL_MS=300000` or slower
- use `SCRAPER_PROXY_URL` only if you actually have a proxy endpoint

## Manual source auth on Oracle

`Refresh session` works on the remote API host because it is headless.

`Open browser login` is intentionally disabled on the VM. If a portal needs interactive login or challenge solving:

1. run the API locally with the same production `DATABASE_URL`
2. temporarily set `ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP=true` in your local env
3. complete `Open browser login` locally
4. save the browser session to the shared production database
5. switch the local flag off again when done

This keeps the deployed backend simple and avoids fake browser prompts on the server.
