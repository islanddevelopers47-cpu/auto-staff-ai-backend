import type Database from "better-sqlite3";
import { generateId } from "../utils/crypto.js";

export interface Bot {
  id: string;
  user_id: string;
  name: string;
  platform: "telegram" | "web";
  telegram_token: string | null;
  telegram_bot_username: string | null;
  telegram_bot_id: string | null;
  agent_id: string | null;
  status: "running" | "stopped" | "error";
  mode: "polling" | "webhook";
  webhook_url: string | null;
  enabled: boolean;
  error_message: string | null;
  embed_token: string | null;
  allowed_origins: string;
  widget_config: string;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface CreateBotInput {
  userId: string;
  name: string;
  telegramToken: string;
  agentId?: string;
  mode?: "polling" | "webhook";
  webhookUrl?: string;
  config?: Record<string, unknown>;
}

export function createBot(db: Database.Database, input: CreateBotInput): Bot {
  const id = generateId();
  const config = JSON.stringify(input.config ?? {});

  db.prepare(
    `INSERT INTO bots (id, user_id, name, telegram_token, agent_id, mode, webhook_url, config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId,
    input.name,
    input.telegramToken,
    input.agentId ?? null,
    input.mode ?? "polling",
    input.webhookUrl ?? null,
    config
  );

  return findBotById(db, id)!;
}

export function findBotById(db: Database.Database, id: string): Bot | undefined {
  return db.prepare("SELECT * FROM bots WHERE id = ?").get(id) as Bot | undefined;
}

export function listBots(db: Database.Database, userId?: string): Bot[] {
  if (userId) {
    return db
      .prepare("SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as Bot[];
  }
  return db.prepare("SELECT * FROM bots ORDER BY created_at DESC").all() as Bot[];
}

export function listEnabledBots(db: Database.Database): Bot[] {
  return db
    .prepare("SELECT * FROM bots WHERE enabled = 1 AND platform = 'telegram' ORDER BY created_at")
    .all() as Bot[];
}

export function updateBot(
  db: Database.Database,
  id: string,
  updates: Partial<{
    name: string;
    telegram_token: string;
    telegram_bot_username: string;
    telegram_bot_id: string;
    agent_id: string | null;
    status: string;
    mode: string;
    webhook_url: string | null;
    enabled: boolean;
    error_message: string | null;
    config: string;
  }>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE bots SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteBot(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM bots WHERE id = ?").run(id);
}

export interface CreateWebBotInput {
  userId: string;
  name: string;
  agentId?: string;
  allowedOrigins?: string;
  widgetConfig?: Record<string, unknown>;
}

export function createWebBot(db: Database.Database, input: CreateWebBotInput): Bot {
  const id = generateId();
  const embedToken = generateId() + generateId(); // longer token for security
  const widgetConfig = JSON.stringify(input.widgetConfig ?? {
    primaryColor: "#6C5CE7",
    position: "bottom-right",
    greeting: "Hi! How can I help you today?",
    placeholder: "Type a message...",
    title: input.name,
  });

  db.prepare(
    `INSERT INTO bots (id, user_id, name, platform, agent_id, embed_token, allowed_origins, widget_config, status)
     VALUES (?, ?, ?, 'web', ?, ?, ?, ?, 'running')`
  ).run(
    id,
    input.userId,
    input.name,
    input.agentId ?? null,
    embedToken,
    input.allowedOrigins ?? "*",
    widgetConfig
  );

  return findBotById(db, id)!;
}

export function findBotByEmbedToken(db: Database.Database, embedToken: string): Bot | undefined {
  return db.prepare("SELECT * FROM bots WHERE embed_token = ? AND platform = 'web'").get(embedToken) as Bot | undefined;
}

export function listWebBots(db: Database.Database, userId?: string): Bot[] {
  if (userId) {
    return db
      .prepare("SELECT * FROM bots WHERE platform = 'web' AND user_id = ? ORDER BY created_at DESC")
      .all(userId) as Bot[];
  }
  return db.prepare("SELECT * FROM bots WHERE platform = 'web' ORDER BY created_at DESC").all() as Bot[];
}

export function listTelegramBots(db: Database.Database, userId?: string): Bot[] {
  if (userId) {
    return db
      .prepare("SELECT * FROM bots WHERE platform = 'telegram' AND user_id = ? ORDER BY created_at DESC")
      .all(userId) as Bot[];
  }
  return db.prepare("SELECT * FROM bots WHERE platform = 'telegram' ORDER BY created_at DESC").all() as Bot[];
}

export function setBotStatus(
  db: Database.Database,
  id: string,
  status: "running" | "stopped" | "error",
  errorMessage?: string
): void {
  db.prepare(
    `UPDATE bots SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, errorMessage ?? null, id);
}
