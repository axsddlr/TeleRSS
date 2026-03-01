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
# openssl: required by Prisma; libc6-compat: glibc shim for native modules
RUN apk add --no-cache openssl libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/

# Install production deps only.
# Build tools (python3 make g++) are added so better-sqlite3 can compile from
# source if no musl prebuilt is available, then removed in the same layer so
# they add zero bytes to the final image. The pnpm store is also wiped here
# since node_modules/.pnpm already has hard-linked copies of every file.
RUN apk add --no-cache python3 make g++ \
  && pnpm install --frozen-lockfile --prod --filter backend \
  && apk del python3 make g++ \
  && rm -rf /root/.local/share/pnpm/store /var/cache/apk/*

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
