import { Router, Request, Response, IRouter } from 'express';
import { prisma } from '../db/client';

export const statsRouter: IRouter = Router();

// GET /api/stats
statsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const [totalFeeds, totalSubs, itemsDelivered24h, recentActivity] = await Promise.all([
      prisma.feed.count({ where: { active: true } }),
      prisma.subscription.count({ where: { active: true } }),
      prisma.deliveredItem.count({
        where: {
          deliveredAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.deliveredItem.findMany({
        take: 20,
        orderBy: { deliveredAt: 'desc' },
        include: {
          feed: { select: { name: true } },
        },
      }),
    ]);

    res.json({
      totalFeeds,
      totalSubs,
      itemsDelivered24h,
      recentActivity: recentActivity.map((item) => ({
        id: item.id,
        feedName: item.feed.name,
        articleTitle: item.articleTitle,
        chatId: item.chatId,
        deliveredAt: item.deliveredAt,
      })),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});
