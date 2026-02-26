import { Router, Request, Response, IRouter } from 'express';
import { prisma } from '../db/client';
import { getBotStatus, probeBotConnection, syncKnownChats } from '../bot/client';

export const botRouter: IRouter = Router();

// GET /api/bot/status
botRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    await probeBotConnection();
    const knownChats = await prisma.knownChat.count();
    res.json({ ...getBotStatus(), knownChats });
  } catch {
    res.status(500).json({ error: 'Failed to fetch bot status' });
  }
});

// GET /api/bot/chats
botRouter.get('/chats', async (req: Request, res: Response) => {
  const adminOnly = req.query.adminOnly === 'true';
  try {
    const chats = await prisma.knownChat.findMany({
      where: adminOnly ? { isAdmin: true } : undefined,
      orderBy: { chatName: 'asc' },
    });
    res.json(chats);
  } catch {
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
    res.status(500).json({ error: 'Failed to sync chats' });
  }
});
