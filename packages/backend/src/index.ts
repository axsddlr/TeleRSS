import express from 'express';
import path from 'path';
import { config } from './config';
import { initSecrets } from './auth/secrets';
import { apiRouter } from './api/router';
import { startBot, stopBot, setupChatTracking } from './bot/client';
import { startScheduler, stopScheduler } from './scheduler';
import { prisma } from './db/client';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api', apiRouter);

// Serve frontend static files in production
if (config.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '..', 'public');
  app.use(express.static(frontendDist));

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

async function main() {
  // Resolve auth credentials before anything else
  initSecrets();

  // Run DB migrations
  await prisma.$connect();
  console.log('Database connected');

  // Register bot update handlers, then start polling
  setupChatTracking();
  await startBot();

  // Start scheduler
  await startScheduler();

  // Start HTTP server
  const server = app.listen(config.PORT, () => {
    console.log(`TeleRSS server running on http://localhost:${config.PORT}`);
  });

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
