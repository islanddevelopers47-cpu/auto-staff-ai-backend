export interface TelegramBotConfig {
  token: string;
  mode: "polling" | "webhook";
  webhookUrl?: string;
  webhookPath?: string;
  webhookSecret?: string;
  allowFrom?: Array<string | number>;
  groupPolicy?: "open" | "disabled" | "allowlist";
  groupAllowFrom?: Array<string | number>;
  textChunkLimit?: number;
  streamMode?: "off" | "partial" | "block";
  replyToMode?: "off" | "first" | "all";
  mediaMaxMb?: number;
}

export interface InboundMessage {
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel";
  messageId: number;
  text: string;
  senderId: string;
  senderName: string;
  senderUsername?: string;
  replyToMessageId?: number;
  isCommand?: boolean;
  command?: string;
  commandArgs?: string;
  mediaType?: "photo" | "video" | "audio" | "document" | "voice" | "sticker";
  mediaFileId?: string;
}

export interface OutboundMessage {
  chatId: string | number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  replyToMessageId?: number;
}
