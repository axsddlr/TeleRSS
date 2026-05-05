import { Router, Request, Response, IRouter } from 'express';
import { prisma } from '../db/client';
import { getBotStatus, probeBotConnection, syncKnownChats } from '../bot/client';
import { logger } from '../lib/logger';

export const botRouter: IRouter = Router();

// GET /api/bot/status
botRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    await probeBotConnection();
    const knownChats = await prisma.knownChat.count();
    res.json({ ...getBotStatus(), knownChats });
  } catch (err) {
    logger.error('Failed to fetch bot status', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch bot status' });
  }
});

// GET /api/bot/chats?adminOnly=true&limit=50&offset=0
botRouter.get('/chats', async (req: Request, res: Response) => {
  const adminOnly = req.query.adminOnly === 'true';
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const chats = await prisma.knownChat.findMany({
      where: adminOnly ? { isAdmin: true } : undefined,
      ...(typeof limit === 'number' && !isNaN(limit) ? { take: limit } : {}),
      ...(typeof offset === 'number' && !isNaN(offset) ? { skip: offset } : {}),
      orderBy: { chatName: 'asc' },
    });
    res.json(chats);
  } catch (err) {
    logger.error('Failed to fetch known chats', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch known chats' });
  }
});

// POST /api/bot/chats/sync
botRouter.post('/chats/sync', async (_req: Request, res: Response) => {
  try {
    const result = await syncKnownChats();
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Bot not ready yet') {
      res.status(503).json({ error: 'Bot not ready yet' });
      return;
    }
    logger.error('Failed to sync chats', { error: String(err) });
    res.status(500).json({ error: 'Failed to sync chats' });
  }
});
