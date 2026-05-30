FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

RUN npm install -g pnpm@10.33.0

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile=false

COPY . .

RUN pnpm --filter @flathunter/worker build

CMD ["node", "apps/worker/dist/index.js"]
