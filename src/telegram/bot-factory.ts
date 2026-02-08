import { Bot, webhookCallback } from "grammy";
import type { Context } from "grammy";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { createLogger } from "../utils/logger.js";
import type { InboundMessage } from "./types.js";

const log = createLogger("telegram-bot-factory");

export type MessageHandler = (msg: InboundMessage, botId: string) => Promise<void>;

export interface BotInstance {
  bot: Bot;
  botInfo: { id: number; username: string; first_name: string };
  stop: () => Promise<void>;
  sendMessage: (chatId: string | number, text: string, options?: {
    parseMode?: "HTML" | "MarkdownV2" | "Markdown";
    replyToMessageId?: number;
  }) => Promise<number | undefined>;
  getWebhookCallback: () => any;
}

export async function createBotInstance(
  token: string,
  botId: string,
  onMessage: MessageHandler
): Promise<BotInstance> {
  const bot = new Bot(token);

  // Apply throttler to avoid hitting Telegram rate limits
  bot.api.config.use(apiThrottler());

  // Get bot info
  const me = await bot.api.getMe();
  log.info(`Bot connected: @${me.username} (${me.id})`);

  // Register message handler
  bot.on("message:text", async (ctx) => {
    const msg = extractMessage(ctx, me.username);
    if (msg) {
      try {
        await onMessage(msg, botId);
      } catch (err) {
        log.error(`Error handling message in chat ${msg.chatId}: ${err}`);
      }
    }
  });

  // Handle edited messages
  bot.on("edited_message:text", async (ctx) => {
    // Optionally handle edits - for now, log and ignore
    log.debug(`Edited message in chat ${ctx.editedMessage?.chat.id}`);
  });

  // Handle callback queries (inline button presses)
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    log.debug(`Callback query: ${ctx.callbackQuery.data}`);
  });

  // Error handler
  bot.catch((err) => {
    log.error(`Bot error: ${err.message}`);
  });

  const sendMessage = async (
    chatId: string | number,
    text: string,
    options?: { parseMode?: "HTML" | "MarkdownV2" | "Markdown"; replyToMessageId?: number }
  ): Promise<number | undefined> => {
    try {
      // Chunk long messages
      const chunks = chunkText(text, 4096);
      let lastMsgId: number | undefined;

      for (const chunk of chunks) {
        const sent = await bot.api.sendMessage(chatId, chunk, {
          parse_mode: options?.parseMode,
          reply_parameters: options?.replyToMessageId
            ? { message_id: options.replyToMessageId }
            : undefined,
        });
        lastMsgId = sent.message_id;
      }
      return lastMsgId;
    } catch (err) {
      log.error(`Failed to send message to ${chatId}: ${err}`);
      throw err;
    }
  };

  const stop = async () => {
    try {
      await bot.stop();
    } catch {
      // ignore
    }
  };

  const getWebhookCallback = () => {
    return webhookCallback(bot, "http");
  };

  return {
    bot,
    botInfo: { id: me.id, username: me.username, first_name: me.first_name },
    stop,
    sendMessage,
    getWebhookCallback,
  };
}

function extractMessage(ctx: Context, botUsername: string): InboundMessage | null {
  const msg = ctx.message;
  if (!msg || !msg.text) return null;

  const chatType = msg.chat.type as "private" | "group" | "supergroup" | "channel";
  const senderId = String(msg.from?.id ?? "unknown");
  const senderName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Unknown";

  let text = msg.text;
  let isCommand = false;
  let command: string | undefined;
  let commandArgs: string | undefined;

  // Check if it's a command
  if (text.startsWith("/")) {
    isCommand = true;
    const parts = text.split(/\s+/);
    command = parts[0]!.slice(1).split("@")[0]; // Remove /prefix and @botname
    commandArgs = parts.slice(1).join(" ");
  }

  // In groups, check for bot mention
  if (chatType === "group" || chatType === "supergroup") {
    const mentionPattern = new RegExp(`@${botUsername}\\b`, "i");
    if (!isCommand && !mentionPattern.test(text)) {
      // Not mentioned in group, skip
      return null;
    }
    // Remove the mention from text
    text = text.replace(mentionPattern, "").trim();
  }

  return {
    chatId: String(msg.chat.id),
    chatType,
    messageId: msg.message_id,
    text: isCommand ? (commandArgs ?? "") : text,
    senderId,
    senderName,
    senderUsername: msg.from?.username,
    replyToMessageId: msg.reply_to_message?.message_id,
    isCommand,
    command,
    commandArgs,
  };
}

function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split on paragraph boundary
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt < maxLength * 0.3) {
      // Try single newline
      splitAt = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      // Try space
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      // Hard split
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
