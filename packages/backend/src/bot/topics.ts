import { prisma } from '../db/client';
import { getBot } from './client';

const MAX_TOPIC_NAME_LENGTH = 128;
const FORUM_CAPABILITY_TTL_MS = 5 * 60 * 1000;

const forumCapabilityCache = new Map<string, { isForum: boolean; checkedAt: number }>();

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
  }).catch(() => {});

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
      }).catch(() => {});
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
    }).catch(() => {});

    return threadId;
  } catch (err) {
    const reason = getTelegramErrorDescription(err);
    console.warn(
      `Failed to create topic "${topicName}" for chat ${input.chatId}: ${reason}`,
    );
    return null;
  }
}
