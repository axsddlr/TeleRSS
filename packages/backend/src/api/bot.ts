import { Router, Request, Response, IRouter } from 'express';
import { prisma } from '../db/client';
import { getBot, getBotId } from '../bot/client';

export const botRouter: IRouter = Router();

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
  const botId = getBotId();
  if (!botId) {
    res.status(503).json({ error: 'Bot not ready yet' });
    return;
  }

  const chats = await prisma.knownChat.findMany();
  let updated = 0;
  let removed = 0;

  await Promise.all(
    chats.map(async (chat) => {
      try {
        const member = await getBot().telegram.getChatMember(chat.chatId, botId);
        if (member.status === 'left' || member.status === 'kicked') {
          await prisma.knownChat.delete({ where: { chatId: chat.chatId } });
          removed++;
        } else {
          const isAdmin = member.status === 'administrator' || member.status === 'creator';
          await prisma.knownChat.update({
            where: { chatId: chat.chatId },
            data: { isAdmin },
          });
          updated++;
        }
      } catch {
        // Chat may no longer be accessible; remove it
        await prisma.knownChat.delete({ where: { chatId: chat.chatId } }).catch(() => {});
        removed++;
      }
    }),
  );

  res.json({ updated, removed });
});
