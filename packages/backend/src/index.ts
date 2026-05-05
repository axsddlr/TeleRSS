import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { config } from './config';
import { initSecrets } from './auth/secrets';
import { apiRouter } from './api/router';
import { startBot, stopBot, setupChatTracking } from './bot/client';
import { startScheduler, stopScheduler } from './scheduler';
import { prisma } from './db/client';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { logger } from './lib/logger';
import { doubleCsrf } from 'csrf-csrf';

const app = express();

// Security headers - must be first
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Required for inline styles
      imgSrc: ["'self'", 'data:', 'https:', 'http:'], // Allow images from feed sources
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: null, // Disable — app may run on HTTP (no HTTPS proxy)
    },
  },
  crossOriginEmbedderPolicy: false, // Disabled for SPA compatibility
}));

// Request size limits - prevent DoS via large payloads
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser()); // Parse cookies for httpOnly JWT and CSRF

// CSRF protection - must be after cookieParser
// Uses double-submit cookie pattern (CSRF token in cookie + header)
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => config.TELEGRAM_BOT_TOKEN,
  cookieName: '_csrf',
  cookieOptions: {
    secure: !config.INSECURE_COOKIES,
    sameSite: 'strict',
    httpOnly: true,
  },
});

app.get('/api/auth/csrf-token', (req, res) => {
  const csrfToken = generateToken(req, res, false, false);
  res.json({ csrfToken });
});

app.use(doubleCsrfProtection);

// Additional security headers
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Track active requests for graceful shutdown (drain before DB disconnect)
let activeRequests = 0;
app.use((_req, res, next) => {
  activeRequests++;
  let done = false;
  const decrement = () => {
    if (!done) {
      done = true;
      activeRequests--;
    }
  };
  res.on('finish', decrement);
  res.on('close', decrement);
  next();
});

// Health check endpoint (no auth required, for monitoring)
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok' as 'ok' | 'degraded' | 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: false,
      bot: false,
    },
  };

  // Check database connectivity
  try {
    await prisma.feed.count({ take: 1 });
    health.checks.database = true;
  } catch {
    health.status = 'degraded';
  }

  // Check bot status
  try {
    const botStatus = await import('./bot/client').then(m => m.getBotStatus());
    health.checks.bot = botStatus.connected || botStatus.started;
    if (!health.checks.bot) {
      health.status = 'degraded';
    }
  } catch {
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// API routes
app.use('/api', apiRouter);

// Return JSON 404 for unmatched /api/* routes (in dev mode, before SPA fallback)
app.use('/api', notFoundHandler);

// Serve frontend static files in production
if (config.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '..', 'public');
  app.use(express.static(frontendDist));

  // SPA fallback — serve index.html for all non-API routes so BrowserRouter
  // can handle client-side navigation (e.g. /login, /settings on full reload)
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Global error handler - must be last
app.use(errorHandler);

async function main() {
  // Resolve auth credentials before anything else
  await initSecrets();

  // Run DB migrations
  await prisma.$connect();
  logger.info('Database connected');

  // Start HTTP server
  const server = app.listen(config.PORT, () => {
    logger.info(`TeleRSS server running on http://localhost:${config.PORT}`);
  });

  // Register bot update handlers, then start polling (without blocking HTTP startup)
  setupChatTracking();
  void startBot();

  // Start scheduler without blocking the API/UI if it fails
  try {
    await startScheduler();
  } catch (err) {
    logger.error('Scheduler startup error', { error: String(err) });
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    server.close();

    // Drain in-flight requests before disconnecting the database
    const DRAIN_TIMEOUT_MS = 10_000;
    const drainStart = Date.now();
    while (activeRequests > 0 && Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (activeRequests > 0) {
      logger.warn(`Forcing shutdown with ${activeRequests} request(s) still in-flight`);
    }

    stopScheduler();
    await stopBot();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Failed to start server', { error: String(err) });
  process.exit(1);
});
