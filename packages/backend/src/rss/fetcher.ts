import { Telegraf } from 'telegraf';
import { prisma } from '../db/client';
import { parseFeed } from './parser';
import { getBot } from '../bot/client';
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

async function runWithTelegramRetry<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;
  let attempt = 1;
  let waitMs = 600;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryableTelegramError(err)) {
        throw err;
      }

      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `Telegram ${operation} failed (attempt ${attempt}/${maxAttempts}): ${reason}. Retrying in ${waitMs}ms...`,
      );
      await sleep(waitMs);
      attempt++;
      waitMs *= 2;
    }
  }
}

async function sendArticle(bot: Telegraf, chatId: string, article: FormattedArticle): Promise<void> {
  const replyMarkup = article.link
    ? { inline_keyboard: [[{ text: 'Read more →', url: article.link }]] }
    : undefined;

  if (article.imageUrl) {
    try {
      await runWithTelegramRetry('sendPhoto', () =>
        bot.telegram.sendPhoto(chatId, article.imageUrl, {
          caption: article.caption,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        }),
      );
      return;
    } catch {
      // Image URL invalid or unreachable — fall through to text message
    }
  }

  await runWithTelegramRetry('sendMessage', () =>
    bot.telegram.sendMessage(chatId, article.text, {
      parse_mode: 'HTML',
      link_preview_options: { show_above_text: true },
      reply_markup: replyMarkup,
    }),
  );
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

    // Record as delivered BEFORE sending — prevents re-delivery if the process
    // crashes after a successful Telegram send but before the DB write.
    try {
      await prisma.deliveredItem.create({
        data: {
          feedId,
          articleGuid: item.guid,
          articleTitle: item.title,
          chatId: feed.subscriptions[0]?.chatId,
        },
      });
    } catch (err) {
      // Unique constraint = another process already claimed this item; skip it.
      if (err instanceof Error && err.message.includes('Unique constraint')) continue;
      console.error('Error recording delivered item:', err);
      continue;
    }

    newItemCount++;

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
        try {
          await sendArticle(bot, sub.chatId, formatted);
        } catch (err) {
          console.error(`Failed to send message to chat ${sub.chatId}:`, err);
        }
      }
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
