import { Router, Request, Response, IRouter } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client';
import {
  buildTopicNameFromFeed,
  ensureTopicForSubscription,
  normalizeTopicName,
} from '../bot/topics';

export const subscriptionsRouter: IRouter = Router();

const createSubSchema = z.object({
  feedId: z.string().min(1),
  chatId: z.string().min(1, 'Chat ID is required'),
  chatName: z.string().optional(),
});

const bulkCreateSubSchema = z.object({
  feedIds: z.array(z.string().min(1)).min(1),
  chatId: z.string().min(1, 'Chat ID is required'),
  chatName: z.string().optional(),
});

// GET /api/subscriptions
subscriptionsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const subs = await prisma.subscription.findMany({
      include: { feed: { select: { id: true, name: true, url: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(subs);
  } catch {
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// POST /api/subscriptions
subscriptionsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createSubSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { feedId, chatId, chatName } = parsed.data;

  try {
    const feed = await prisma.feed.findUnique({
      where: { id: feedId },
      select: { id: true, name: true },
    });
    if (!feed) {
      res.status(404).json({ error: 'Feed not found' });
      return;
    }

    const topicName = buildTopicNameFromFeed(feed.name);
    const topicNameKey = normalizeTopicName(topicName);

    const sub = await prisma.subscription.create({
      data: { feedId, chatId, chatName, topicName, topicNameKey },
      include: { feed: { select: { id: true, name: true, url: true } } },
    });

    const topicThreadId = await ensureTopicForSubscription({
      subscriptionId: sub.id,
      chatId,
      feedName: feed.name,
      topicName,
      topicNameKey,
      topicThreadId: sub.topicThreadId,
    });

    if (typeof topicThreadId === 'number') {
      sub.topicThreadId = topicThreadId;
    }

    res.status(201).json(sub);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      res.status(409).json({ error: 'This feed is already subscribed to that chat' });
      return;
    }
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// POST /api/subscriptions/bulk
subscriptionsRouter.post('/bulk', async (req: Request, res: Response) => {
  const parsed = bulkCreateSubSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { feedIds, chatId, chatName } = parsed.data;

  try {
    const feeds = await prisma.feed.findMany({
      where: { id: { in: feedIds } },
      select: { id: true, name: true },
    });
    const feedNameById = new Map(feeds.map((feed) => [feed.id, feed.name]));

    const results = await Promise.allSettled(
      feedIds.map(async (feedId) => {
        const feedName = feedNameById.get(feedId);
        if (!feedName) throw new Error(`Feed ${feedId} not found`);

        const topicName = buildTopicNameFromFeed(feedName);
        const topicNameKey = normalizeTopicName(topicName);

        const sub = await prisma.subscription.create({
          data: { feedId, chatId, chatName, topicName, topicNameKey },
        });

        await ensureTopicForSubscription({
          subscriptionId: sub.id,
          chatId,
          feedName,
          topicName,
          topicNameKey,
          topicThreadId: sub.topicThreadId,
        });
      }),
    );
    const created = results.filter((r) => r.status === 'fulfilled').length;
    res.json({ created });
  } catch {
    res.status(500).json({ error: 'Failed to create subscriptions' });
  }
});

// PATCH /api/subscriptions/:id
subscriptionsRouter.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const schema = z.object({ active: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  try {
    const sub = await prisma.subscription.update({
      where: { id },
      data: { active: parsed.data.active },
      include: { feed: { select: { id: true, name: true, url: true } } },
    });
    res.json(sub);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Record to update not found')) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// DELETE /api/subscriptions/:id
subscriptionsRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.subscription.delete({ where: { id } });
    res.status(204).send();
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Record to delete does not exist')) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});
