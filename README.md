# 📰 TeleRSS

A self-hosted RSS-to-Telegram bot with a web dashboard. Add RSS feeds, assign them to Telegram chats, and receive automatically formatted posts whenever new articles are published.

![Stack](https://img.shields.io/badge/Node.js-TypeScript-blue) ![Stack](https://img.shields.io/badge/React-Vite-61DAFB) ![Stack](https://img.shields.io/badge/SQLite-Prisma-2D3748) ![Stack](https://img.shields.io/badge/Telegram-Telegraf-26A5E4)

---

## Features

- **Web dashboard** — manage feeds and subscriptions from a browser UI
- **Per-feed polling intervals** — configure each feed to check every N minutes
- **Deduplication** — articles are tracked so they're never sent twice
- **Multiple chat targets** — one feed can post to many Telegram chats
- **Manual refresh** — trigger an immediate fetch from the dashboard
- **Active/inactive toggles** — pause a feed or subscription without deleting it
- **Formatted messages** — clickable title, truncated description, date, and feed name
- **Single-admin authentication** — password-protected dashboard, no user accounts to manage
- **OPML import** — bulk-import feeds from any RSS reader export

---

## Prerequisites

- A Telegram bot token — create one via [@BotFather](https://t.me/BotFather)
- Your bot must be added to any target group/channel as an **admin** (or at least have permission to send messages)

---

## Local Development

### 1. Install dependencies

[pnpm](https://pnpm.io) is required (v8+).

```bash
npm install -g pnpm
pnpm install
```

### 2. Configure environment

```bash
cp .env.example packages/backend/.env
```

Edit `packages/backend/.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
DATABASE_URL=file:./data/db.sqlite
PORT=3000

# Optional — omit to use auto-generated credentials (see Authentication below)
# ADMIN_PASSWORD=your-strong-password
# JWT_SECRET=a-long-random-string
```

### 3. Set up the database

```bash
cd packages/backend
pnpm db:generate   # generate Prisma client
pnpm db:push       # create the SQLite schema
cd ../..
```

### 4. Start the dev servers

```bash
pnpm dev
```

This starts:
- **Backend** on `http://localhost:3000` (API + hot reload via tsx)
- **Frontend** on `http://localhost:5173` (Vite dev server, proxies `/api` to backend)

Open `http://localhost:5173` in your browser.

---

## Authentication

TeleRSS protects the dashboard with a single admin password. No user accounts or database setup needed.

### First run

On first start the server generates a random password, prints it **once** to the log, and saves it (as a scrypt hash) to `data/secrets.json`:

```
==============================================================
  TeleRSS — First-run credentials generated
==============================================================
  Admin password : Xk7mQ2vP9nR4wJhD
  Saved to       : /data/secrets.json
==============================================================
```

For Docker: `docker compose logs app` to read it.

The generated password persists across restarts — you won't see it again unless you delete `data/secrets.json`.

### Setting a permanent password

Log in with the generated password, then go to **Settings → Security** and change it. No restart or config file editing needed.

### Resetting a forgotten password

Set `ADMIN_PASSWORD=newpassword` in your `.env`, restart the server, then log in with that password. Remove the env var afterwards to hand control back to `data/secrets.json`.

### Sessions

JWTs are stored in `localStorage` and expire after 7 days. Click the arrow icon at the bottom of the sidebar to log out.

---

## Docker

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### 2. Build and start

```bash
docker compose up --build
```

The app will be available at `http://localhost:3000`.

To run in the background:

```bash
docker compose up --build -d
```

### 3. Stop

```bash
docker compose down
```

Data is persisted in a Docker volume (`sqlite_data`). To also remove the volume:

```bash
docker compose down -v
```

---

## Usage

### Adding a feed

1. Go to **Feeds** → click **Add Feed**
2. Paste an RSS feed URL (e.g. `https://feeds.bbci.co.uk/news/rss.xml`)
3. Give it a display name and set a check interval (in minutes)
4. Click **Add Feed** — the URL is validated immediately

### Assigning a feed to a Telegram chat

1. Go to **Subscriptions** → click **Assign Feed to Chat**
2. Select a feed from the dropdown
3. Enter the Telegram **Chat ID** of the target group or channel
   - Get it via [@userinfobot](https://t.me/userinfobot) or by inspecting your bot's `getUpdates` response
   - Group/supergroup IDs are negative (e.g. `-1001234567890`)
   - Your own user ID works too for direct messages
4. Optionally enter a human-readable chat name
5. Click **Assign**

New articles will be posted to that chat on the next scheduled check. Use **Refresh** on the Feeds page to trigger an immediate fetch.

### Message format

```
📰 BBC News

BBC News - World

🔗 Article Title Here

📝 Brief summary of the article up to 200 characters…

🕐 Feb 23, 2026
```

---

## Project Structure

```
TeleRSS/
├── docker-compose.yml
├── .env.example
├── pnpm-workspace.yaml
├── packages/
│   ├── backend/
│   │   ├── Dockerfile
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── src/
│   │       ├── index.ts          # Express entry point
│   │       ├── config.ts         # Typed env config
│   │       ├── api/              # REST routes
│   │       ├── auth/             # Credential generation, hashing, persistence
│   │       ├── middleware/       # JWT auth middleware
│   │       ├── bot/              # Telegraf client + message formatter
│   │       ├── rss/              # Feed parser + fetcher
│   │       ├── scheduler/        # node-cron per-feed jobs
│   │       └── db/               # Prisma singleton
│   └── frontend/
│       └── src/
│           ├── pages/            # Dashboard, Feeds, Subscriptions
│           ├── components/       # Layout, modals, FeedCard
│           └── lib/api.ts        # Typed fetch client
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Exchange password for JWT |
| `GET` | `/api/auth/status` | Check if password is env-controlled |
| `POST` | `/api/auth/change-password` | Update admin password |
| `GET` | `/api/feeds` | List all feeds |
| `POST` | `/api/feeds` | Create a feed |
| `PUT` | `/api/feeds/:id` | Update a feed |
| `DELETE` | `/api/feeds/:id` | Delete a feed (cascades subscriptions) |
| `POST` | `/api/feeds/:id/refresh` | Trigger immediate feed check |
| `GET` | `/api/subscriptions` | List all subscriptions |
| `POST` | `/api/subscriptions` | Create a subscription |
| `PATCH` | `/api/subscriptions/:id` | Toggle active state |
| `DELETE` | `/api/subscriptions/:id` | Remove a subscription |
| `GET` | `/api/stats` | Dashboard stats |

All routes except `POST /api/auth/login` require a `Authorization: Bearer <token>` header.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + TypeScript + Express |
| Frontend | React + Vite + Tailwind CSS |
| Database | SQLite via Prisma ORM |
| Telegram | Telegraf |
| RSS parsing | rss-parser |
| Scheduling | node-cron |
| Auth | JWT (jsonwebtoken) + scrypt (built-in Node.js) |
| Containerization | Docker Compose |
| Package manager | pnpm workspaces |
