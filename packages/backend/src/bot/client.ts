import { Telegraf } from 'telegraf';
import { config } from '../config';
import { prisma } from '../db/client';

let botInstance: Telegraf | null = null;

export function getBot(): Telegraf {
  if (!botInstance) {
    botInstance = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  }
  return botInstance;
}

export function getBotId(): number | undefined {
  return getBot().botInfo?.id;
}

async function upsertChat(
  chatId: string | number,
  chatName: string,
  chatType: string,
  botId: number,
): Promise<void> {
  try {
    const member = await getBot().telegram.getChatMember(chatId, botId);
    const isAdmin = member.status === 'administrator' || member.status === 'creator';
    await prisma.knownChat.upsert({
      where: { chatId: String(chatId) },
      create: { chatId: String(chatId), chatName, chatType, isAdmin },
      update: { chatName, chatType, isAdmin },
    });
  } catch (err) {
    // If we can't check membership, still record the chat without admin status
    await prisma.knownChat.upsert({
      where: { chatId: String(chatId) },
      create: { chatId: String(chatId), chatName, chatType, isAdmin: false },
      update: { chatName, chatType },
    });
  }
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
      const chatName = chat.title;
      const botId = getBotId();
      if (botId) {
        await upsertChat(chat.id, chatName, chat.type, botId);
      }
    }
  });

  // Passively track any group/supergroup/channel the bot receives messages from
  bot.on('message', async (ctx) => {
    const chat = ctx.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    const chatName = chat.title;
    const botId = getBotId();
    if (botId) {
      await upsertChat(chat.id, chatName, chat.type, botId).catch(() => {});
    }
  });

  bot.on('channel_post', async (ctx) => {
    const chat = ctx.chat;
    const chatName = chat.title;
    const botId = getBotId();
    if (botId) {
      await upsertChat(chat.id, chatName, 'channel', botId).catch(() => {});
    }
  });
}

export async function startBot(): Promise<void> {
  const bot = getBot();
  bot
    .launch({
      allowedUpdates: ['my_chat_member', 'message', 'channel_post'],
    })
    .catch((err) => {
      console.error('Bot launch error:', err);
    });
  console.log('Telegram bot started');
}

export async function stopBot(): Promise<void> {
  if (botInstance) {
    botInstance.stop('SIGTERM');
    botInstance = null;
  }
}
