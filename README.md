# TeleRSS

Self-hosted RSS-to-Telegram bot with a web dashboard. Add RSS/Atom feeds, assign them to Telegram chats, and receive formatted posts automatically when new articles appear.

![](https://img.shields.io/badge/Node.js-TypeScript-blue) ![](https://img.shields.io/badge/React-Vite-61DAFB) ![](https://img.shields.io/badge/SQLite-Prisma-2D3748) ![](https://img.shields.io/badge/Telegram-Telegraf-26A5E4)

## Quick Start (Docker)

```bash
# 1. Create a bot with @BotFather on Telegram and copy the token
# 2. Clone and configure
git clone https://github.com/axsddlr/telerss.git
cd telerss
echo 'TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234gh' > .env

# 3. Start
docker compose up -d

# 4. Open http://localhost:3000 — the auto-generated admin password is in the logs
docker compose logs app | grep "Admin password"
```

## Local Development

### Requirements

- [Node.js](https://nodejs.org) 20.19+, 22.12+, or 24.0+
- [pnpm](https://pnpm.io) 8+ (`npm install -g pnpm`)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- The bot added as **admin** to any group/channel you want to post to

### Setup

```bash
# 1. Install dependencies
git clone https://github.com/axsddlr/telerss.git
cd telerss
pnpm install

# 2. Create a .env file in the backend package
cp .env.example packages/backend/.env
```

Edit `packages/backend/.env` — at minimum set the bot token:

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234gh
DATABASE_URL=file:./data/db.sqlite
PORT=3000
```

### Generate the database

```bash
# Stop any running dev server first on Windows (DLL lock)
pnpm db:generate        # generate Prisma client types
pnpm --filter backend db:push   # create the SQLite schema
```

### Start

```bash
pnpm dev
```

- Backend: `http://localhost:3000` (API, hot-reload via tsx)
- Frontend: `http://localhost:5173` (Vite dev server, proxies `/api` to backend)

Open `http://localhost:5173` in your browser. On first start, the server prints a random admin password to the console — copy it and log in.

### Production build

```bash
pnpm build   # frontend (tsc + vite) then backend (tsup)
pnpm start   # serves everything from packages/backend/dist
```

## Authentication

TeleRSS uses a single admin password. No user accounts, no database setup for auth.

**First run** — a random 16-character password is generated and printed once:

```
==============================================================
  TeleRSS — First-run credentials generated
==============================================================
  Admin password : Xk7mQ2vP9nR4wJhD
  Saved to       : /data/secrets.json
==============================================================
```

The password is persisted to `data/secrets.json` as a scrypt hash. It survives restarts — you won't see it again unless you delete the file.

**Set a permanent password** — log in with the generated password, go to **Settings → Security**.

**Forgot your password?** — add `ADMIN_PASSWORD=newpassword` to `.env`, restart, log in with it, then remove the env var.

**Sessions** — JWT stored in an httpOnly cookie, expires after 7 days.

**HTTPS deployments** — `secure: true` is the default for auth cookies. If you run without TLS (local dev, Portainer without proxy), set `INSECURE_COOKIES=true` in your `.env`.

## Docker

```bash
# Build and start
cp .env.example .env
# Edit .env: set TELEGRAM_BOT_TOKEN
docker compose up -d

# Read the auto-generated admin password
docker compose logs app | grep "Admin password"

# Stop (data in sqlite_data volume survives)
docker compose down

# Stop AND delete all data
docker compose down -v
```

The app is at `http://localhost:3000`. A volume `sqlite_data` persists the database and auth secrets at `/data`.

## Usage

### Add a feed

1. Go to **Feeds** → **Add Feed**
2. Paste an RSS/Atom URL (e.g. `https://feeds.bbci.co.uk/news/rss.xml`)
3. Give it a display name
4. Set check interval in minutes (default 15)
5. Click **Add Feed** — the URL is validated immediately

### Assign a feed to a Telegram chat

1. Go to **Channels** → **Assign Feed**
2. Pick a feed from the dropdown
3. Enter the Telegram **Chat ID**:
   - Get it via [@userinfobot](https://t.me/userinfobot) or [@RawDataBot](https://t.me/RawDataBot)
   - Group/supergroup IDs are negative (e.g. `-1001234567890`)
   - Your own user ID works too for direct messages
4. Optionally add a chat name for reference
5. Click **Assign**

New articles post to the chat on the next scheduled check. Use **Refresh** on the Feeds page to trigger an immediate fetch. Use **Force Push** to clear delivery history and re-send all current articles.

### Message format

```
📰 BBC News

BBC News - World

🔗 Article Title Here          ← Read more →
📝 Brief summary up to 200 characters…

🕐 Feb 23, 2026
```

Images from the feed are included when available. All messages get a "Read more →" link.

## OPML Import

Bulk-import feeds from any RSS reader that exports OPML:

1. Go to **Feeds** → **Import OPML**
2. Upload your `.opml` file
3. Review the detected feeds
4. Select which ones to import
5. Click **Import**

## Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from @BotFather |
| `DATABASE_URL` | Yes | — | SQLite path, e.g. `file:./data/db.sqlite` |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `ADMIN_PASSWORD` | No | auto-generated | Override the generated password |
| `JWT_SECRET` | No | auto-generated | Override the JWT signing secret |
| `INSECURE_COOKIES` | No | `false` | Set `true` to allow auth cookies over plain HTTP |
| `SECRETS_FILE_PATH` | No | `data/secrets.json` | Path for persisted auth credentials |
| `LOG_LEVEL` | No | `debug` (dev) / `info` (prod) | `debug`, `info`, `warn`, or `error` |
| `LOG_FORMAT` | No | `text` | Set `json` for structured JSON log output |

## API

All endpoints except `POST /api/auth/login` require `Authorization: Bearer <token>`. Rate limit: 60 req/min/IP.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Exchange password for JWT cookie |
| `GET` | `/api/auth/status` | Check if password is env-controlled |
| `POST` | `/api/auth/change-password` | Update admin password |
| `GET` | `/api/feeds` | List feeds (`?limit=&offset=`) |
| `POST` | `/api/feeds` | Create a feed |
| `PUT` | `/api/feeds/:id` | Update a feed |
| `DELETE` | `/api/feeds/:id` | Delete a feed (cascades) |
| `POST` | `/api/feeds/:id/refresh` | Trigger immediate fetch |
| `POST` | `/api/feeds/:id/force-push` | Clear history + re-send all items |
| `POST` | `/api/feeds/import` | Bulk import feeds (max 100) |
| `GET` | `/api/subscriptions` | List subscriptions (`?limit=&offset=`) |
| `POST` | `/api/subscriptions` | Create a subscription |
| `POST` | `/api/subscriptions/bulk` | Bulk create (max 50 feeds) |
| `PATCH` | `/api/subscriptions/:id` | Toggle active state |
| `DELETE` | `/api/subscriptions/:id` | Remove a subscription |
| `GET` | `/api/bot/status` | Bot connection status |
| `GET` | `/api/bot/chats` | Known chats (`?adminOnly=true&limit=&offset=`) |
| `POST` | `/api/bot/chats/sync` | Re-sync chat admin status |
| `GET` | `/api/stats` | Dashboard statistics |

## Architecture

```
packages/backend    Express + Telegraf + Prisma (SQLite) + node-cron
packages/frontend   React 18 + Vite + TanStack Query + Tailwind + Headless UI
```

- **Delivery pipeline** — write `DeliveredItem` to DB first (at-most-once), then send. Photos when available, fallback to text with link preview.
- **Scheduler** — in-memory `Map<feedId, ScheduledTask>` with per-feed cron expressions. Concurrency guard prevents overlapping checks.
- **Reddit adapter** — deprecated `.rss` endpoints are transparently converted to `old.reddit.com/.json` and transformed to RSS XML.
- **SSRF protection** — all feed URLs are validated against internal/private IP ranges before fetching.
- **CSRF** — double-submit cookie pattern, secret derived from bot token.
- **Audit logging** — JSON-structured audit events for auth, feed lifecycle, and destructive operations.

## Known Limitations

- **Cloudflare-protected feeds** — sites behind "Under Attack" / Turnstile challenges may require the JavaScript challenge to be solved. The built-in fetcher uses browser-like TLS fingerprinting via `got-scraping` and handles most sites, but hard-Cloudflare-blocked feeds will time out.
- **Reddit feeds** — Reddit's official `.rss` endpoints are deprecated. TeleRSS includes a built-in adapter that uses Reddit's JSON API via `old.reddit.com`, but rate limits apply to unauthenticated requests.
- **No test suite** — `pnpm build` is the current smoke check. A test framework is planned.

## Development Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Dev servers (backend :3000, frontend :5173) |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm db:generate` | Generate Prisma client (stop dev server on Windows first) |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm --filter backend db:push` | Push schema directly (dev) |
| `pnpm --filter backend lint` | Lint backend |
| `pnpm --filter frontend lint` | Lint frontend |
| `pnpm --filter backend exec npx tsc --noEmit` | Type-check backend |
| `pnpm --filter frontend exec npx tsc --noEmit` | Type-check frontend |

## Stack

| Layer | Library |
|-------|---------|
| Runtime | Node.js 20/22/24 |
| Backend framework | Express 4 |
| Database | SQLite via Prisma 7 + libsql adapter |
| Telegram | Telegraf 4 |
| RSS parsing | rss-parser |
| HTTP client | got-scraping (browser TLS impersonation) |
| Scheduling | node-cron |
| Auth | JWT + scrypt (built-in crypto) |
| Frontend | React 18 + Vite 5 |
| State | TanStack Query 5 |
| Styling | Tailwind CSS 3 + Headless UI |
| Package manager | pnpm workspaces |
| Container | Docker Compose |
