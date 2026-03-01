import { Router, Request, Response, IRouter } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client';
import { parseFeed } from '../rss/parser';
import { checkFeed } from '../rss/fetcher';
import { scheduleFeed, unscheduleFeed } from '../scheduler';
import { auditLog, createAuditEvent } from '../audit/logger';

export const feedsRouter: IRouter = Router();

const createFeedSchema = z.object({
  url: z.string().url('Invalid feed URL'),
  name: z.string().min(1, 'Name is required').max(100),
  checkInterval: z.number().int().min(1).max(1440).default(15),
});

const importFeedsSchema = z.object({
  feeds: z.array(
    z.object({
      url: z.string().url(),
      name: z.string().min(1).max(100),
      checkInterval: z.number().int().min(1).max(1440).optional(),
    })
  ).min(1),
});

const updateFeedSchema = z.object({
  url: z.string().url().optional(),
  name: z.string().min(1).max(100).optional(),
  checkInterval: z.number().int().min(1).max(1440).optional(),
  active: z.boolean().optional(),
});

// GET /api/feeds
feedsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const feeds = await prisma.feed.findMany({
      include: {
        _count: {
          select: { subscriptions: { where: { active: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(feeds);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feeds' });
  }
});

// POST /api/feeds
feedsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createFeedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { url, name, checkInterval } = parsed.data;

  // Validate the feed URL by parsing it
  let feedDescription: string | undefined;
  try {
    const feedData = await parseFeed(url);
    feedDescription = feedData.description;
  } catch {
    res.status(400).json({ error: 'Could not fetch or parse RSS feed at that URL' });
    return;
  }

  try {
    const feed = await prisma.feed.create({
      data: {
        url,
        name,
        description: feedDescription,
        checkInterval,
      },
    });

    scheduleFeed(feed.id, feed.checkInterval);
    
    // Audit log feed creation
    auditLog(createAuditEvent(
      'feed.create',
      req,
      'success',
      { resourceType: 'feed', resourceId: feed.id, resourceName: feed.name }
    ));
    
    res.status(201).json(feed);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      res.status(409).json({ error: 'A feed with this URL already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create feed' });
  }
});

// POST /api/feeds/import
feedsRouter.post('/import', async (req: Request, res: Response) => {
  const parsed = importFeedsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { feeds } = parsed.data;

  // Validate all feeds in parallel
  const validationResults = await Promise.allSettled(
    feeds.map(async (f) => {
      const feedData = await parseFeed(f.url);
      return { ...f, description: feedData.description };
    })
  );

  const imported: object[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const failed: Array<{ url: string; reason: string }> = [];

  await Promise.all(
    validationResults.map(async (result, i) => {
      const input = feeds[i];
      if (result.status === 'rejected') {
        failed.push({ url: input.url, reason: 'Could not fetch or parse feed' });
        return;
      }

      const { url, name, checkInterval = 15, description } = result.value;
      try {
        const feed = await prisma.feed.create({
          data: { url, name, description, checkInterval },
        });
        scheduleFeed(feed.id, feed.checkInterval);
        imported.push(feed);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('Unique constraint')) {
          skipped.push({ url, reason: 'duplicate' });
        } else {
          failed.push({ url, reason: 'Database error' });
        }
      }
    })
  );

  res.json({ imported, skipped, failed });
});

// PUT /api/feeds/:id
feedsRouter.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const parsed = updateFeedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const feed = await prisma.feed.update({
      where: { id },
      data: parsed.data,
    });

    // Reschedule if interval or active state changed
    if (parsed.data.checkInterval !== undefined || parsed.data.active !== undefined) {
      if (feed.active) {
        scheduleFeed(feed.id, feed.checkInterval);
      } else {
        unscheduleFeed(feed.id);
      }
    }

    res.json(feed);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Record to update not found')) {
      res.status(404).json({ error: 'Feed not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to update feed' });
  }
});

// DELETE /api/feeds/:id
feedsRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Get feed info before deletion for audit log
    const feed = await prisma.feed.findUnique({ where: { id } });
    unscheduleFeed(id);
    await prisma.feed.delete({ where: { id } });
    
    // Audit log feed deletion
    auditLog(createAuditEvent(
      'feed.delete',
      req,
      'success',
      { resourceType: 'feed', resourceId: id, resourceName: feed?.name }
    ));
    
    res.status(204).send();
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Record to delete does not exist')) {
      res.status(404).json({ error: 'Feed not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to delete feed' });
  }
});

// POST /api/feeds/:id/refresh
feedsRouter.post('/:id/refresh', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const feed = await prisma.feed.findUnique({ where: { id } });
    if (!feed) {
      res.status(404).json({ error: 'Feed not found' });
      return;
    }

    // Audit log feed refresh
    auditLog(createAuditEvent(
      'feed.refresh',
      req,
      'success',
      { resourceType: 'feed', resourceId: id, resourceName: feed.name }
    ));

    // Run check in background
    checkFeed(id).catch((err) => console.error('Refresh error:', err));

    res.json({ message: 'Feed refresh triggered' });
  } catch {
    res.status(500).json({ error: 'Failed to trigger refresh' });
  }
});

// POST /api/feeds/:id/force-push
// Clears delivered-item history for this feed then re-runs the check,
// causing all current feed items to be re-sent to Telegram.
feedsRouter.post('/:id/force-push', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const feed = await prisma.feed.findUnique({ where: { id } });
    if (!feed) {
      res.status(404).json({ error: 'Feed not found' });
      return;
    }

    const { count } = await prisma.deliveredItem.deleteMany({ where: { feedId: id } });
    checkFeed(id).catch((err) => console.error('Force-push error:', err));

    res.json({ cleared: count, message: 'Delivered history cleared, re-push triggered' });
  } catch {
    res.status(500).json({ error: 'Failed to force-push feed' });
  }
});
