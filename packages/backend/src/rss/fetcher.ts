import { Telegraf } from 'telegraf';
import { prisma } from '../db/client';
import { parseFeed } from './parser';
import { getBot, markBotApiHealthy } from '../bot/client';
import { ensureTopicForSubscription } from '../bot/topics';
import { formatArticleMessage, FormattedArticle } from '../bot/formatter';

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
      console.warn(
        `Telegram ${operation} failed (attempt ${attempt}/${maxAttempts}): ${reason}. Retrying in ${effectiveWaitMs}ms...`,
      );
      await sleep(effectiveWaitMs);
      attempt++;
      waitMs = Math.min(waitMs * 2, 10_000);
    }
  }
}

function getTelegramErrorDescription(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);

  const maybeErr = err as {
    response?: { description?: unknown };
    description?: unknown;
    message?: unknown;
  };

  if (typeof maybeErr.response?.description === 'string') return maybeErr.response.description;
  if (typeof maybeErr.description === 'string') return maybeErr.description;
  if (typeof maybeErr.message === 'string') return maybeErr.message;
  return String(err);
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
      try {
        await runWithTelegramRetry('sendPhoto', () =>
          bot.telegram.sendPhoto(chatId, article.imageUrl, {
            caption: article.caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
            ...threadOptions,
          }),
        );
        markBotApiHealthy();
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
    markBotApiHealthy();
  });
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
    console.error(`Failed to parse feed ${feed.url}:`, err);
    await prisma.feed.update({
      where: { id: feedId },
      data: { lastCheckedAt: new Date() },
    });
    return;
  }

  const bot = getBot();
  let newItemCount = 0;

  const itemsToSend = [...parsedFeed.items].sort((a, b) => {
    const aTime = a.pubDate?.getTime() ?? 0;
    const bTime = b.pubDate?.getTime() ?? 0;
    return aTime - bTime;
  });

  for (const item of itemsToSend) {
    if (!item.guid) continue;

    // Check if already delivered
    const existing = await prisma.deliveredItem.findUnique({
      where: {
        feedId_articleGuid: {
          feedId,
          articleGuid: item.guid,
        },
      },
    });

    if (existing) continue;
    let sentToAnySubscription = false;

    // Send to all active subscriptions
    if (feed.subscriptions.length > 0) {
      const formatted = formatArticleMessage({
        feedName: feed.name,
        title: item.title,
        link: item.link,
        description: item.description,
        pubDate: item.pubDate,
        imageUrl: item.imageUrl,
        author: item.author,
      });

      for (const sub of feed.subscriptions) {
        let threadId = sub.topicThreadId;
        if (threadId == null) {
          threadId = await ensureTopicForSubscription({
            subscriptionId: sub.id,
            chatId: sub.chatId,
            feedName: feed.name,
            topicName: sub.topicName,
            topicNameKey: sub.topicNameKey,
            topicThreadId: sub.topicThreadId,
          });
        }

        try {
          await sendArticle(bot, sub.chatId, formatted, threadId ?? undefined);
          sentToAnySubscription = true;
        } catch (err) {
          if (typeof threadId === 'number' && isMissingTopicError(err)) {
            try {
              const recreatedThreadId = await ensureTopicForSubscription({
                subscriptionId: sub.id,
                chatId: sub.chatId,
                feedName: feed.name,
                topicName: sub.topicName,
                topicNameKey: sub.topicNameKey,
                topicThreadId: sub.topicThreadId,
                forceRecreate: true,
              });

              if (typeof recreatedThreadId === 'number') {
                await sendArticle(bot, sub.chatId, formatted, recreatedThreadId);
                sentToAnySubscription = true;
                continue;
              }
            } catch (recreateErr) {
              console.error(
                `Failed to recreate topic for chat ${sub.chatId} and feed ${feed.name}:`,
                recreateErr,
              );
            }
          }

          console.error(`Failed to send message to chat ${sub.chatId}:`, err);
        }
      }
    }
    if (!sentToAnySubscription) {
      console.warn(
        `No deliveries succeeded for "${feed.name}" item "${item.title ?? item.guid}". Will retry on next run.`,
      );
      continue;
    }

    try {
      await prisma.deliveredItem.create({
        data: {
          feedId,
          articleGuid: item.guid,
          articleTitle: item.title,
          chatId: feed.subscriptions[0]?.chatId,
        },
      });
      newItemCount++;
    } catch (err) {
      // Unique constraint = another process already claimed this item; skip it.
      if (err instanceof Error && err.message.includes('Unique constraint')) continue;
      console.error('Error recording delivered item:', err);
    }
  }

  await prisma.feed.update({
    where: { id: feedId },
    data: { lastCheckedAt: new Date() },
  });

  if (newItemCount > 0) {
    console.log(`Feed "${feed.name}": delivered ${newItemCount} new item(s)`);
  }
}
