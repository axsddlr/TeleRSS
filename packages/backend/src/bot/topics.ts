import { prisma } from '../db/client';
import { getBot } from './client';
import { logger } from '../lib/logger';
import { getTelegramErrorDescription } from '../lib/telegram-errors';

const MAX_TOPIC_NAME_LENGTH = 128;
const FORUM_CAPABILITY_TTL_MS = 5 * 60 * 1000;

const forumCapabilityCache = new Map<string, { isForum: boolean; checkedAt: number }>();
const MAX_FORUM_CACHE_SIZE = 500;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildTopicNameFromFeed(feedName: string): string {
  const normalized = normalizeWhitespace(feedName);
  const fallback = normalized.length > 0 ? normalized : 'Feed Updates';
  return fallback.slice(0, MAX_TOPIC_NAME_LENGTH);
}

export function normalizeTopicName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

async function isForumEnabledSupergroup(chatId: string): Promise<boolean> {
  const now = Date.now();
  const cached = forumCapabilityCache.get(chatId);
  if (cached && now - cached.checkedAt < FORUM_CAPABILITY_TTL_MS) {
    return cached.isForum;
  }

  try {
    const chat = await getBot().telegram.getChat(chatId);
    const isForum = chat.type === 'supergroup' && Boolean((chat as { is_forum?: boolean }).is_forum);
    forumCapabilityCache.set(chatId, { isForum, checkedAt: now });
    if (forumCapabilityCache.size > MAX_FORUM_CACHE_SIZE) {
      const firstKey = forumCapabilityCache.keys().next().value;
      if (firstKey !== undefined) forumCapabilityCache.delete(firstKey);
    }
    return isForum;
  } catch {
    return false;
  }
}

interface EnsureTopicInput {
  subscriptionId: string;
  chatId: string;
  feedName: string;
  topicName?: string | null;
  topicNameKey?: string | null;
  topicThreadId?: number | null;
  forceRecreate?: boolean;
}

export async function ensureTopicForSubscription(input: EnsureTopicInput): Promise<number | null> {
  const topicName = buildTopicNameFromFeed(input.topicName ?? input.feedName);
  const topicNameKey = normalizeTopicName(input.topicNameKey ?? topicName);
  if (!topicNameKey) return null;

  await prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: { topicName, topicNameKey },
  }).catch((err) => {
    logger.warn(`Failed to update topic name for sub ${input.subscriptionId}`, { error: String(err) });
  });

  if (!input.forceRecreate && typeof input.topicThreadId === 'number') {
    return input.topicThreadId;
  }

  if (input.forceRecreate) {
    await prisma.subscription.updateMany({
      where: {
        chatId: input.chatId,
        topicNameKey,
      },
      data: { topicThreadId: null },
    });
  } else {
    const existing = await prisma.subscription.findFirst({
      where: {
        chatId: input.chatId,
        topicNameKey,
        topicThreadId: { not: null },
      },
      select: { topicThreadId: true },
    });

    if (typeof existing?.topicThreadId === 'number') {
      await prisma.subscription.update({
        where: { id: input.subscriptionId },
        data: {
          topicName,
          topicNameKey,
          topicThreadId: existing.topicThreadId,
        },
      }).catch((err) => {
      logger.warn(`Failed to link existing topic for sub ${input.subscriptionId}`, { error: String(err) });
    });
      return existing.topicThreadId;
    }
  }

  const isForum = await isForumEnabledSupergroup(input.chatId);
  if (!isForum) return null;

  try {
    const created = await getBot().telegram.createForumTopic(input.chatId, topicName);
    const threadId = created.message_thread_id;

    await prisma.subscription.updateMany({
      where: {
        chatId: input.chatId,
        topicNameKey,
        topicThreadId: null,
      },
      data: {
        topicName,
        topicNameKey,
        topicThreadId: threadId,
      },
    });

    await prisma.subscription.update({
      where: { id: input.subscriptionId },
      data: {
        topicName,
        topicNameKey,
        topicThreadId: threadId,
      },
    }).catch((err) => {
      logger.warn(`Failed to persist topic thread ID for sub ${input.subscriptionId}`, { error: String(err) });
    });

    return threadId;
  } catch (err) {
    const reason = getTelegramErrorDescription(err);
    logger.warn(`Failed to create topic "${topicName}" for chat ${input.chatId}`, { reason });
    return null;
  }
}
