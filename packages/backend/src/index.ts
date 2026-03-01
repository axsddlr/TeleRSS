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
    },
  },
  crossOriginEmbedderPolicy: false, // Disabled for SPA compatibility
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Parse cookies for httpOnly JWT

// Additional security headers
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// API routes
app.use('/api', apiRouter);

// Serve frontend static files in production
if (config.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '..', 'public');
  app.use(express.static(frontendDist));

  // SPA fallback - use 404 handler instead of serving index.html for unknown API routes
  app.use(notFoundHandler);
}

// Global error handler - must be last
app.use(errorHandler);

async function main() {
  // Resolve auth credentials before anything else
  initSecrets();

  // Run DB migrations
  await prisma.$connect();
  console.log('Database connected');

  // Start HTTP server
  const server = app.listen(config.PORT, () => {
    console.log(`TeleRSS server running on http://localhost:${config.PORT}`);
  });

  // Register bot update handlers, then start polling (without blocking HTTP startup)
  setupChatTracking();
  void startBot();

  // Start scheduler without blocking the API/UI if it fails
  try {
    await startScheduler();
  } catch (err) {
    console.error('Scheduler startup error:', err);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close(async () => {
      stopScheduler();
      await stopBot();
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
