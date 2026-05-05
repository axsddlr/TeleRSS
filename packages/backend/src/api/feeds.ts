import { Router, Request, Response, IRouter } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client';
import { parseFeed } from '../rss/parser';
import { checkFeed } from '../rss/fetcher';
import { scheduleFeed, unscheduleFeed } from '../scheduler';
import { auditLog, createAuditEvent } from '../audit/logger';

export const feedsRouter: IRouter = Router();

// Maximum lengths for input validation
const MAX_URL_LENGTH = 2048;
const MAX_NAME_LENGTH = 100;
const MAX_CHECK_INTERVAL = 1440; // 24 hours in minutes
const MIN_CHECK_INTERVAL = 1;

// URL protocol allowlist for RSS feeds
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

const createFeedSchema = z.object({
  url: z.string()
    .min(1, 'URL is required')
    .max(MAX_URL_LENGTH, `URL must be less than ${MAX_URL_LENGTH} characters`)
    .url('Invalid feed URL')
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return ALLOWED_PROTOCOLS.includes(parsed.protocol);
        } catch {
          return false;
        }
      },
      { message: 'Only HTTP and HTTPS URLs are allowed' }
    ),
  name: z.string()
    .min(1, 'Name is required')
    .max(MAX_NAME_LENGTH, `Name must be less than ${MAX_NAME_LENGTH} characters`)
    .trim(),
  checkInterval: z.number()
    .int()
    .min(MIN_CHECK_INTERVAL, `Check interval must be at least ${MIN_CHECK_INTERVAL} minute`)
    .max(MAX_CHECK_INTERVAL, `Check interval must be at most ${MAX_CHECK_INTERVAL} minutes`)
    .default(15),
});

const importFeedsSchema = z.object({
  feeds: z.array(
    z.object({
      url: z.string()
        .min(1, 'URL is required')
        .max(MAX_URL_LENGTH, `URL must be less than ${MAX_URL_LENGTH} characters`)
        .url('Invalid feed URL')
        .refine(
          (url) => {
            try {
              const parsed = new URL(url);
              return ALLOWED_PROTOCOLS.includes(parsed.protocol);
            } catch {
              return false;
            }
          },
          { message: 'Only HTTP and HTTPS URLs are allowed' }
        ),
      name: z.string()
        .min(1, 'Name is required')
        .max(MAX_NAME_LENGTH, `Name must be less than ${MAX_NAME_LENGTH} characters`)
        .trim(),
      checkInterval: z.number()
        .int()
        .min(MIN_CHECK_INTERVAL, `Check interval must be at least ${MIN_CHECK_INTERVAL} minute`)
        .max(MAX_CHECK_INTERVAL, `Check interval must be at most ${MAX_CHECK_INTERVAL} minutes`)
        .optional(),
    })
  ).min(1, 'At least one feed is required')
    .max(100, 'Maximum 100 feeds per import'),
});

const updateFeedSchema = z.object({
  url: z.string()
    .min(1, 'URL cannot be empty')
    .max(MAX_URL_LENGTH, `URL must be less than ${MAX_URL_LENGTH} characters`)
    .url('Invalid feed URL')
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return ALLOWED_PROTOCOLS.includes(parsed.protocol);
        } catch {
          return false;
        }
      },
      { message: 'Only HTTP and HTTPS URLs are allowed' }
    )
    .optional(),
  name: z.string()
    .min(1, 'Name cannot be empty')
    .max(MAX_NAME_LENGTH, `Name must be less than ${MAX_NAME_LENGTH} characters`)
    .trim()
    .optional(),
  checkInterval: z.number()
    .int()
    .min(MIN_CHECK_INTERVAL, `Check interval must be at least ${MIN_CHECK_INTERVAL} minute`)
    .max(MAX_CHECK_INTERVAL, `Check interval must be at most ${MAX_CHECK_INTERVAL} minutes`)
    .optional(),
  active: z.boolean().optional(),
});

async function getValidatedFeedDescription(url: string): Promise<string | undefined> {
  const feedData = await parseFeed(url);
  return feedData.description;
}

function getFeedValidationMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes('Unique constraint')) {
      return 'A feed with this URL already exists';
    }

    if (
      err.message.includes('internal or private network') ||
      err.message.includes('local network host') ||
      err.message.includes('embedded credentials') ||
      err.message.includes('Could not resolve feed host') ||
      err.message.includes('Invalid content type') ||
      err.message.includes('Request timed out') ||
      err.message.includes('Too many redirects') ||
      err.message.includes('Only HTTP and HTTPS') ||
      err.message.includes('Feed response exceeds')
    ) {
      return err.message;
    }
  }

  return 'Could not fetch, validate, or parse the RSS feed at that URL';
}

async function throttledAllSettled<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );
  return results;
}

// GET /api/feeds?limit=50&offset=0
feedsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const feeds = await prisma.feed.findMany({
      ...(typeof limit === 'number' && !isNaN(limit) ? { take: limit } : {}),
      ...(typeof offset === 'number' && !isNaN(offset) ? { skip: offset } : {}),
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
  try {
    const feedDescription = await getValidatedFeedDescription(url);

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
    const message = getFeedValidationMessage(err);
    if (message === 'A feed with this URL already exists') {
      res.status(409).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
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

  // Validate feeds with limited concurrency to avoid exhausting file descriptors
  const validationResults = await throttledAllSettled(
    feeds.map((f) => async () => {
      const description = await getValidatedFeedDescription(f.url);
      return { ...f, description };
    }),
    5,
  );

  const imported: object[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const failed: Array<{ url: string; reason: string }> = [];

  await Promise.all(
    validationResults.map(async (result, i) => {
      const input = feeds[i];
      if (result.status === 'rejected') {
        failed.push({ url: input.url, reason: getFeedValidationMessage(result.reason) });
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
          failed.push({ url, reason: getFeedValidationMessage(err) });
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
    const updateData = { ...parsed.data } as typeof parsed.data & { description?: string };
    if (updateData.url) {
      updateData.description = await getValidatedFeedDescription(updateData.url);
    }

    const feed = await prisma.feed.update({
      where: { id },
      data: updateData,
    });

    // Reschedule if interval or active state changed
    if (updateData.checkInterval !== undefined || updateData.active !== undefined) {
      if (feed.active) {
        scheduleFeed(feed.id, feed.checkInterval);
      } else {
        unscheduleFeed(feed.id);
      }
    }

    res.json(feed);
  } catch (err: unknown) {
    const message = getFeedValidationMessage(err);
    if (message !== 'Could not fetch, validate, or parse the RSS feed at that URL') {
      if (message === 'A feed with this URL already exists') {
        res.status(409).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
      return;
    }

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

    auditLog(createAuditEvent(
      'feed.force-push',
      req,
      'success',
      { resourceType: 'feed', resourceId: id, resourceName: feed.name }
    ));

    const { count } = await prisma.deliveredItem.deleteMany({ where: { feedId: id } });
    checkFeed(id).catch((err) => console.error('Force-push error:', err));

    res.json({ cleared: count, message: 'Delivered history cleared, re-push triggered' });
  } catch {
    res.status(500).json({ error: 'Failed to force-push feed' });
  }
});
