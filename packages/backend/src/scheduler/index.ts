import cron from 'node-cron';
import { prisma } from '../db/client';
import { checkFeed } from '../rss/fetcher';

const jobs = new Map<string, cron.ScheduledTask>();

function intervalToCron(minutes: number): string {
  if (minutes < 1) minutes = 1;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `0 */${hours} * * *`;
  }
  return `*/${minutes} * * * *`;
}

export async function startScheduler(): Promise<void> {
  const feeds = await prisma.feed.findMany({
    where: { active: true },
  });

  for (const feed of feeds) {
    scheduleFeed(feed.id, feed.checkInterval);
  }

  console.log(`Scheduler started with ${feeds.length} active feed(s)`);
}

export function scheduleFeed(feedId: string, intervalMinutes: number): void {
  // Remove existing job if any
  unscheduleFeed(feedId);

  const cronExpr = intervalToCron(intervalMinutes);
  const task = cron.schedule(cronExpr, async () => {
    try {
      await checkFeed(feedId);
    } catch (err) {
      console.error(`Scheduler error for feed ${feedId}:`, err);
    }
  });

  jobs.set(feedId, task);
}

export function unscheduleFeed(feedId: string): void {
  const existing = jobs.get(feedId);
  if (existing) {
    existing.stop();
    jobs.delete(feedId);
  }
}

export function stopScheduler(): void {
  for (const [id, task] of jobs.entries()) {
    task.stop();
    jobs.delete(id);
  }
  console.log('Scheduler stopped');
}
