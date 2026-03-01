FROM node:22-bookworm-slim AS base
ARG PNPM_VERSION=10.30.3
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

# Production image — Alpine for a small final layer
FROM node:22-alpine AS runner
WORKDIR /app

ARG PNPM_VERSION=10.30.3
# openssl: required by the Prisma query engine
RUN apk add --no-cache openssl \
  && corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/

# Production deps only; no native modules, so no build tools needed.
# Wipe the pnpm content-store after install — node_modules/.pnpm already
# holds the package files via hard links, so the store is redundant in the image.
RUN pnpm install --frozen-lockfile --prod --filter backend \
  && rm -rf /root/.local/share/pnpm/store /var/cache/apk/*

COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=backend-builder /app/packages/backend/prisma ./packages/backend/prisma
COPY --from=backend-builder /app/packages/backend/prisma.config.ts ./packages/backend/prisma.config.ts
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/backend/public

WORKDIR /app/packages/backend

# Generate Prisma client + download the correct query-engine binary for this
# platform. DATABASE_URL is only needed for schema validation at generate time.
RUN DATABASE_URL="file:./dev.db" npx prisma generate

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy --config=prisma.config.ts && node dist/index.js"]
