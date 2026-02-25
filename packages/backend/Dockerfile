FROM node:22-bookworm-slim AS base
ARG PNPM_VERSION=9.12.2
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Build frontend
FROM base AS frontend-builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install --frozen-lockfile --filter frontend
COPY packages/frontend ./packages/frontend
RUN pnpm --filter frontend build

# Build backend
FROM base AS backend-builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install --frozen-lockfile --filter backend
COPY packages/backend ./packages/backend
RUN pnpm --filter backend db:generate
RUN pnpm --filter backend build

# Production image
FROM base AS runner
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/

RUN pnpm install --frozen-lockfile --filter backend \
  && pnpm --filter backend rebuild better-sqlite3

COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=backend-builder /app/packages/backend/prisma ./packages/backend/prisma
COPY --from=backend-builder /app/packages/backend/prisma.config.ts ./packages/backend/prisma.config.ts
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/backend/public

WORKDIR /app/packages/backend

# Generate Prisma client for the current platform
RUN npx prisma generate
RUN node -e "require('better-sqlite3')"

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy --config=prisma.config.ts && node dist/index.js"]
