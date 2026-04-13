FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@10.33.0

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile=false

COPY . .

RUN pnpm --filter @flathunter/api build

CMD ["node", "apps/api/dist/index.js"]
