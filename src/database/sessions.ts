import type Database from "better-sqlite3";
import { generateId } from "../utils/crypto.js";

export interface Session {
  id: string;
  bot_id: string | null;
  chat_id: string;
  chat_type: "private" | "group" | "supergroup" | "channel";
  agent_id: string | null;
  title: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  telegram_message_id: number | null;
  metadata: string;
  created_at: string;
}

export function findOrCreateSession(
  db: Database.Database,
  botId: string | null,
  chatId: string,
  chatType: string,
  agentId?: string | null,
  title?: string
): Session {
  let existing: Session | undefined;
  if (botId) {
    existing = db
      .prepare("SELECT * FROM sessions WHERE bot_id = ? AND chat_id = ?")
      .get(botId, chatId) as Session | undefined;
  } else {
    existing = db
      .prepare("SELECT * FROM sessions WHERE bot_id IS NULL AND chat_id = ?")
      .get(chatId) as Session | undefined;
  }

  if (existing) return existing;

  const id = generateId();
  db.prepare(
    `INSERT INTO sessions (id, bot_id, chat_id, chat_type, agent_id, title)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, botId ?? null, chatId, chatType, agentId ?? null, title ?? null);

  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session;
}

export function getSessionHistory(
  db: Database.Database,
  sessionId: string,
  limit: number = 50
): Message[] {
  return db
    .prepare(
      `SELECT * FROM messages WHERE session_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(sessionId, limit)
    .reverse() as Message[];
}

export function addMessage(
  db: Database.Database,
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  telegramMessageId?: number,
  metadata?: Record<string, unknown>
): Message {
  const id = generateId();
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, telegram_message_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    sessionId,
    role,
    content,
    telegramMessageId ?? null,
    JSON.stringify(metadata ?? {})
  );

  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Message;
}

export function clearSessionHistory(
  db: Database.Database,
  sessionId: string
): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
}

export function listSessions(
  db: Database.Database,
  botId: string
): Session[] {
  return db
    .prepare(
      "SELECT * FROM sessions WHERE bot_id = ? ORDER BY updated_at DESC"
    )
    .all(botId) as Session[];
}

export function getSessionMessageCount(
  db: Database.Database,
  sessionId: string
): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?")
    .get(sessionId) as { count: number };
  return row.count;
}
