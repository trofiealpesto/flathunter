FROM node:22-slim AS builder

WORKDIR /app

RUN npm install -g pnpm@10.33.0

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile=false

COPY . .

RUN pnpm --filter @flathunter/web build

FROM caddy:2.9.1-alpine

COPY infra/production/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/apps/web/dist /srv
