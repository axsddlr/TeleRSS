import { Telegraf } from 'telegraf';
import { config } from '../config';
import { prisma } from '../db/client';

let botInstance: Telegraf | null = null;
let botStarted = false;
let botConnected = false;
let botConnecting = false;
let lastLaunchError: string | null = null;
let lastLaunchErrorAt: Date | null = null;
let lastConnectedAt: Date | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let launchInFlight: Promise<void> | null = null;

const RECONNECT_DELAY_MS = 15_000;

export function getBot(): Telegraf {
  if (!botInstance) {
    botInstance = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  }
  return botInstance;
}

export function getBotId(): number | undefined {
  return getBot().botInfo?.id;
}

export function getBotStatus() {
  const bot = getBot();
  return {
    started: botStarted,
    connecting: botConnecting,
    connected: botConnected,
    botId: bot.botInfo?.id ?? null,
    username: bot.botInfo?.username ?? null,
    lastConnectedAt,
    lastLaunchError,
    lastLaunchErrorAt,
  };
}

async function upsertChat(
  chatId: string | number,
  chatName: string,
  chatType: string,
  botId?: number,
): Promise<void> {
  if (!chatName) return;

  if (typeof botId === 'number') {
    try {
      const member = await getBot().telegram.getChatMember(chatId, botId);
      const isAdmin = member.status === 'administrator' || member.status === 'creator';
      await prisma.knownChat.upsert({
        where: { chatId: String(chatId) },
        create: { chatId: String(chatId), chatName, chatType, isAdmin },
        update: { chatName, chatType, isAdmin },
      });
      return;
    } catch {
      // Fall back to recording chat with unknown admin status.
    }
  }

  // If we can't check membership, still record the chat without admin status
  await prisma.knownChat.upsert({
    where: { chatId: String(chatId) },
    create: { chatId: String(chatId), chatName, chatType, isAdmin: false },
    update: { chatName, chatType },
  });
}

async function ensureBotInfo(): Promise<void> {
  const bot = getBot();
  if (bot.botInfo?.id) return;

  const me = await bot.telegram.getMe();
  bot.botInfo = me;
}

async function getBotIdSafe(): Promise<number | undefined> {
  try {
    await ensureBotInfo();
    return getBot().botInfo?.id;
  } catch {
    return undefined;
  }
}

export async function syncKnownChats(): Promise<{ updated: number; removed: number }> {
  const botId = await getBotIdSafe();
  if (!botId) {
    throw new Error('Bot not ready yet');
  }

  const chats = await prisma.knownChat.findMany();
  let updated = 0;
  let removed = 0;

  await Promise.all(
    chats.map(async (chat) => {
      try {
        const member = await getBot().telegram.getChatMember(chat.chatId, botId);
        if (member.status === 'left' || member.status === 'kicked') {
          await prisma.knownChat.delete({ where: { chatId: chat.chatId } });
          removed++;
        } else {
          const isAdmin = member.status === 'administrator' || member.status === 'creator';
          await prisma.knownChat.update({
            where: { chatId: chat.chatId },
            data: { isAdmin },
          });
          updated++;
        }
      } catch {
        // Chat may no longer be accessible; remove it
        await prisma.knownChat.delete({ where: { chatId: chat.chatId } }).catch(() => {});
        removed++;
      }
    }),
  );

  return { updated, removed };
}

export function setupChatTracking(): void {
  const bot = getBot();

  // Fires when bot membership status changes in a chat
  bot.on('my_chat_member', async (ctx) => {
    const update = ctx.myChatMember;
    const { chat, new_chat_member } = update;
    const status = new_chat_member.status;

    if (status === 'kicked' || status === 'left') {
      await prisma.knownChat.deleteMany({ where: { chatId: String(chat.id) } });
      return;
    }

    if (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel') {
      const chatName = chat.title ?? 'Untitled Chat';
      const botId = await getBotIdSafe();
      await upsertChat(chat.id, chatName, chat.type, botId).catch(() => {});
    }
  });

  // Passively track any group/supergroup/channel the bot receives messages from
  bot.on('message', async (ctx) => {
    const chat = ctx.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    const chatName = chat.title ?? 'Untitled Chat';
    const botId = await getBotIdSafe();
    await upsertChat(chat.id, chatName, chat.type, botId).catch(() => {});
  });

  bot.on('channel_post', async (ctx) => {
    const chat = ctx.chat;
    const chatName = chat.title ?? 'Untitled Chat';
    const botId = await getBotIdSafe();
    await upsertChat(chat.id, chatName, 'channel', botId).catch(() => {});
  });
}

function scheduleReconnect(): void {
  if (!botStarted || botConnected || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startBot();
  }, RECONNECT_DELAY_MS);
}

export async function startBot(): Promise<void> {
  if (botConnected) return;
  if (launchInFlight) {
    await launchInFlight;
    return;
  }

  const bot = getBot();
  botStarted = true;
  botConnecting = true;

  launchInFlight = (async () => {
    try {
      await bot.launch({
        allowedUpdates: ['my_chat_member', 'message', 'channel_post'],
      });
      await ensureBotInfo();

      botConnected = true;
      lastLaunchError = null;
      lastLaunchErrorAt = null;
      lastConnectedAt = new Date();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      console.log(`Telegram bot connected as @${bot.botInfo?.username ?? bot.botInfo?.id}`);
    } catch (err) {
      botConnected = false;
      lastLaunchError = err instanceof Error ? err.message : String(err);
      lastLaunchErrorAt = new Date();
      console.error('Bot launch error:', err);
      scheduleReconnect();
    } finally {
      botConnecting = false;
      launchInFlight = null;
    }
  })();

  await launchInFlight;
}

export async function stopBot(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (botInstance) {
    botInstance.stop('SIGTERM');
    botInstance = null;
  }
  botStarted = false;
  botConnecting = false;
  botConnected = false;
}
