import { Telegraf } from 'telegraf';
import { prisma } from '../db/client';
import { parseFeed, ParsedItem } from './parser';
import { getBot } from '../bot/client';
import { formatArticleMessage, FormattedArticle } from '../bot/formatter';
import { logger } from '../lib/logger';
import { getTelegramErrorDescription } from '../lib/telegram-errors';
import { bus } from '../lib/events';

type TopicResolverInput = {
  subscriptionId: string;
  chatId: string;
  feedName: string;
  topicName?: string | null;
  topicNameKey?: string | null;
  topicThreadId?: number | null;
  forceRecreate?: boolean;
};

let topicResolver: ((input: TopicResolverInput) => Promise<number | null>) | null = null;

export function setTopicResolver(resolver: (input: TopicResolverInput) => Promise<number | null>): void {
  topicResolver = resolver;
}

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNABORTED',
  'ECONNREFUSED',
  'EPIPE',
]);
const PER_CHAT_MIN_INTERVAL_MS = 1_250;
const RETRY_AFTER_BUFFER_MS = 500;
const MAX_ITEMS_PER_RUN = 50;

const chatDeliveryQueue = new Map<string, Promise<void>>();
const lastChatSendAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTelegramError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  const maybeErr = err as {
    code?: unknown;
    errno?: unknown;
    status?: unknown;
    statusCode?: unknown;
    response?: { error_code?: unknown };
    cause?: { code?: unknown };
  };

  const networkCodeCandidates = [
    maybeErr.code,
    maybeErr.errno,
    maybeErr.cause?.code,
  ];

  for (const candidate of networkCodeCandidates) {
    if (typeof candidate === 'string' && RETRYABLE_NETWORK_CODES.has(candidate)) {
      return true;
    }
  }

  const statusCandidates = [
    maybeErr.response?.error_code,
    maybeErr.status,
    maybeErr.statusCode,
  ];

  for (const candidate of statusCandidates) {
    if (typeof candidate === 'number' && (candidate === 429 || candidate >= 500)) {
      return true;
    }
  }

  return false;
}

function getTelegramRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;

  const maybeErr = err as {
    response?: { parameters?: { retry_after?: unknown } };
  };

  const retryAfter = maybeErr.response?.parameters?.retry_after;
  if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter) || retryAfter <= 0) {
    return null;
  }

  return retryAfter * 1_000 + RETRY_AFTER_BUFFER_MS;
}

async function withChatDeliveryLock<T>(chatId: string, task: () => Promise<T>): Promise<T> {
  const previous = chatDeliveryQueue.get(chatId) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  chatDeliveryQueue.set(chatId, previous.catch(() => {}).then(() => current));

  await previous.catch(() => {});

  try {
    const now = Date.now();
    const lastSentAt = lastChatSendAt.get(chatId) ?? 0;
    const waitMs = Math.max(0, lastSentAt + PER_CHAT_MIN_INTERVAL_MS - now);
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    return await task();
  } finally {
    lastChatSendAt.set(chatId, Date.now());
    release();
    const queued = chatDeliveryQueue.get(chatId);
    if (queued === current) {
      chatDeliveryQueue.delete(chatId);
    }
  }
}

async function runWithTelegramRetry<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const maxAttempts = 5;
  let attempt = 1;
  let waitMs = 600;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryableTelegramError(err)) {
        throw err;
      }

      const retryAfterMs = getTelegramRetryAfterMs(err);
      const effectiveWaitMs = retryAfterMs ?? waitMs;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Telegram ${operation} failed (attempt ${attempt}/${maxAttempts})`,
        { reason, retryInMs: effectiveWaitMs },
      );
      await sleep(effectiveWaitMs);
      attempt++;
      waitMs = Math.min(waitMs * 2, 10_000);
    }
  }
}

function isMissingTopicError(err: unknown): boolean {
  const description = getTelegramErrorDescription(err).toLowerCase();
  return (
    description.includes('message thread not found') ||
    description.includes('topic was deleted') ||
    description.includes('message thread is not found')
  );
}

async function sendArticle(
  bot: Telegraf,
  chatId: string,
  article: FormattedArticle,
  messageThreadId?: number,
): Promise<void> {
  const replyMarkup = article.link
    ? { inline_keyboard: [[{ text: 'Read more →', url: article.link }]] }
    : undefined;
  const threadOptions = typeof messageThreadId === 'number'
    ? { message_thread_id: messageThreadId }
    : {};

  await withChatDeliveryLock(chatId, async () => {
    if (article.imageUrl) {
      const imageUrl = article.imageUrl;
      try {
        await runWithTelegramRetry('sendPhoto', () =>
          bot.telegram.sendPhoto(chatId, imageUrl, {
            caption: article.caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
            ...threadOptions,
          }),
        );
        bus.emit('delivery:success');
        return;
      } catch (err) {
        if (isRetryableTelegramError(err)) {
          throw err;
        }
      }
    }

    await runWithTelegramRetry('sendMessage', () =>
      bot.telegram.sendMessage(chatId, article.text, {
        parse_mode: 'HTML',
        link_preview_options: { show_above_text: true },
        reply_markup: replyMarkup,
        ...threadOptions,
      }),
    );
    bus.emit('delivery:success');
  });
}

async function deliverToSubscription(
  bot: Telegraf,
  sub: {
    id: string;
    chatId: string;
    chatName?: string | null;
    topicName?: string | null;
    topicNameKey?: string | null;
    topicThreadId?: number | null;
    active: boolean;
  },
  formatted: FormattedArticle,
  feedName: string,
  resolvedThreadIds: Map<string, number | null>,
): Promise<boolean> {
  let threadId = resolvedThreadIds.get(sub.id);
  if (threadId === undefined) {
    threadId = sub.topicThreadId;
    if (threadId == null) {
      threadId = await topicResolver!({
        subscriptionId: sub.id,
        chatId: sub.chatId,
        feedName,
        topicName: sub.topicName,
        topicNameKey: sub.topicNameKey,
        topicThreadId: sub.topicThreadId,
      });
    }
    resolvedThreadIds.set(sub.id, threadId);
  }

  try {
    await sendArticle(bot, sub.chatId, formatted, threadId ?? undefined);
    return true;
  } catch (err) {
    if (typeof threadId === 'number' && isMissingTopicError(err)) {
      try {
        const recreatedThreadId = await topicResolver!({
          subscriptionId: sub.id,
          chatId: sub.chatId,
          feedName,
          topicName: sub.topicName,
          topicNameKey: sub.topicNameKey,
          topicThreadId: sub.topicThreadId,
          forceRecreate: true,
        });
        resolvedThreadIds.set(sub.id, recreatedThreadId);

        if (typeof recreatedThreadId === 'number') {
          await sendArticle(bot, sub.chatId, formatted, recreatedThreadId);
          return true;
        }
      } catch (recreateErr) {
        logger.error(
          `Failed to recreate topic for chat ${sub.chatId}`,
          { feedName: feedName, error: String(recreateErr) },
        );
      }
    }

    logger.error(`Failed to send message to chat ${sub.chatId}`, { error: String(err) });
    return false;
  }
}

async function deliverNewItems(
  feedId: string,
  feedName: string,
  bot: Telegraf,
  subscriptions: {
    id: string;
    chatId: string;
    chatName?: string | null;
    topicName?: string | null;
    topicNameKey?: string | null;
    topicThreadId?: number | null;
    active: boolean;
  }[],
  itemsToSend: ParsedItem[],
): Promise<number> {
  if (subscriptions.length === 0) return 0;

  // Batch lookup: fetch all already-delivered GUIDs in a single query
  const itemGuids = itemsToSend.filter((i) => i.guid).map((i) => i.guid);
  const deliveredGuids = new Set(
    itemGuids.length > 0
      ? (
          await prisma.deliveredItem.findMany({
            where: { feedId, articleGuid: { in: itemGuids } },
            select: { articleGuid: true },
          })
        ).map((d: { articleGuid: string }) => d.articleGuid)
      : [],
  );

  let newItemCount = 0;
  const resolvedThreadIds = new Map<string, number | null>();

  for (const item of itemsToSend) {
    if (!item.guid) continue;
    if (deliveredGuids.has(item.guid)) continue;
    if (newItemCount >= MAX_ITEMS_PER_RUN) break;

    const formatted = formatArticleMessage({
      feedName,
      title: item.title,
      link: item.link,
      description: item.description,
      pubDate: item.pubDate,
      imageUrl: item.imageUrl,
      author: item.author,
    });

    let sentToAny = false;
    for (const sub of subscriptions) {
      const delivered = await deliverToSubscription(bot, sub, formatted, feedName, resolvedThreadIds);
      if (delivered) sentToAny = true;
    }

    if (!sentToAny) {
      logger.warn(
        `No deliveries succeeded for "${feedName}" item`,
        { itemTitle: item.title ?? item.guid },
      );
      continue;
    }

    try {
      await prisma.deliveredItem.create({
        data: {
          feedId,
          articleGuid: item.guid,
          articleTitle: item.title,
          chatId: subscriptions[0]?.chatId,
        },
      });
      newItemCount++;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unique constraint')) continue;
      logger.error('Error recording delivered item', { error: String(err) });
    }
  }

  return newItemCount;
}

export async function checkFeed(feedId: string): Promise<void> {
  const feed = await prisma.feed.findUnique({
    where: { id: feedId },
    include: {
      subscriptions: {
        where: { active: true },
      },
    },
  });

  if (!feed || !feed.active) return;
  if (feed.subscriptions.length === 0) return;

  let parsedFeed;
  try {
    parsedFeed = await parseFeed(feed.url);
  } catch (err) {
    logger.error(`Failed to parse feed ${feed.url}`, { error: String(err) });
    await prisma.feed.update({
      where: { id: feedId },
      data: { lastCheckedAt: new Date() },
    });
    return;
  }

  const itemsToSend = [...parsedFeed.items].sort((a, b) => {
    const aTime = a.pubDate?.getTime() ?? 0;
    const bTime = b.pubDate?.getTime() ?? 0;
    return aTime - bTime;
  });

  const bot = getBot();
  const newItemCount = await deliverNewItems(feedId, feed.name, bot, feed.subscriptions, itemsToSend);

  await prisma.feed.update({
    where: { id: feedId },
    data: { lastCheckedAt: new Date() },
  });

  if (newItemCount > 0) {
    logger.info(`Feed "${feed.name}": delivered ${newItemCount} new item(s)`);
  }
}
