import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getDatabasePath } from "../config/env.js";

let _db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  const dbPath = getDatabasePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  _db = db;
  return db;
}

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return _db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT name FROM migrations")
      .all()
      .map((r: any) => r.name)
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.name)) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare("INSERT INTO migrations (name) VALUES (?)").run(
          migration.name
        );
      })();
    }
  }
}

const MIGRATIONS = [
  {
    name: "001_initial",
    sql: `
      -- Users table
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        display_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Bots table
      CREATE TABLE bots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        telegram_token TEXT NOT NULL,
        telegram_bot_username TEXT,
        telegram_bot_id TEXT,
        agent_id TEXT,
        status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('running', 'stopped', 'error')),
        mode TEXT NOT NULL DEFAULT 'polling' CHECK (mode IN ('polling', 'webhook')),
        webhook_url TEXT,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        error_message TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Agents table
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT,
        system_prompt TEXT NOT NULL DEFAULT 'You are a helpful assistant.',
        model_provider TEXT NOT NULL DEFAULT 'openai',
        model_name TEXT NOT NULL DEFAULT 'gpt-4o-mini',
        temperature REAL NOT NULL DEFAULT 0.7,
        max_tokens INTEGER NOT NULL DEFAULT 4096,
        skills TEXT NOT NULL DEFAULT '[]',
        config TEXT NOT NULL DEFAULT '{}',
        is_builtin BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Chat sessions table
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL,
        chat_type TEXT NOT NULL DEFAULT 'private' CHECK (chat_type IN ('private', 'group', 'supergroup', 'channel')),
        agent_id TEXT,
        title TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(bot_id, chat_id)
      );

      -- Messages table (conversation history)
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        telegram_message_id INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_messages_session ON messages(session_id, created_at);

      -- Settings table (key-value config store)
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- API keys table (per-user provider keys)
      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        api_key TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, provider, label)
      );
    `,
  },
];
