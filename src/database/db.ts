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
  {
    name: "002_sessions_nullable_bot_id",
    sql: `
      -- Recreate sessions table with nullable bot_id to support agent-only chats
      CREATE TABLE sessions_new (
        id TEXT PRIMARY KEY,
        bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL,
        chat_type TEXT NOT NULL DEFAULT 'private' CHECK (chat_type IN ('private', 'group', 'supergroup', 'channel')),
        agent_id TEXT,
        title TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO sessions_new SELECT * FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
      CREATE UNIQUE INDEX idx_sessions_bot_chat ON sessions(bot_id, chat_id);
    `,
  },
  {
    name: "003_web_bots",
    sql: `
      -- Add platform column (telegram or web) and embed_token for web bots
      ALTER TABLE bots ADD COLUMN platform TEXT NOT NULL DEFAULT 'telegram' CHECK (platform IN ('telegram', 'web'));
      ALTER TABLE bots ADD COLUMN embed_token TEXT;
      ALTER TABLE bots ADD COLUMN allowed_origins TEXT NOT NULL DEFAULT '*';
      ALTER TABLE bots ADD COLUMN widget_config TEXT NOT NULL DEFAULT '{}';

      -- Recreate bots table with nullable telegram_token
      CREATE TABLE bots_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'telegram' CHECK (platform IN ('telegram', 'web')),
        telegram_token TEXT,
        telegram_bot_username TEXT,
        telegram_bot_id TEXT,
        agent_id TEXT,
        status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('running', 'stopped', 'error')),
        mode TEXT NOT NULL DEFAULT 'polling' CHECK (mode IN ('polling', 'webhook')),
        webhook_url TEXT,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        error_message TEXT,
        embed_token TEXT,
        allowed_origins TEXT NOT NULL DEFAULT '*',
        widget_config TEXT NOT NULL DEFAULT '{}',
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO bots_new (id, user_id, name, platform, telegram_token, telegram_bot_username, telegram_bot_id, agent_id, status, mode, webhook_url, enabled, error_message, config, created_at, updated_at)
        SELECT id, user_id, name, 'telegram', telegram_token, telegram_bot_username, telegram_bot_id, agent_id, status, mode, webhook_url, enabled, error_message, config, created_at, updated_at FROM bots;
      DROP TABLE bots;
      ALTER TABLE bots_new RENAME TO bots;
      CREATE UNIQUE INDEX idx_bots_embed_token ON bots(embed_token);
    `,
  },
  {
    name: "004_firebase_auth",
    sql: `
      -- Add Firebase auth fields to users table
      ALTER TABLE users ADD COLUMN firebase_uid TEXT;
      ALTER TABLE users ADD COLUMN email TEXT;
      ALTER TABLE users ADD COLUMN photo_url TEXT;
      ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local';
      CREATE UNIQUE INDEX idx_users_firebase_uid ON users(firebase_uid);
      CREATE UNIQUE INDEX idx_users_email ON users(email);

      -- Make password_hash nullable for Firebase users (they don't have local passwords)
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        display_name TEXT,
        firebase_uid TEXT,
        email TEXT,
        photo_url TEXT,
        auth_provider TEXT NOT NULL DEFAULT 'local',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, username, password_hash, role, display_name, firebase_uid, email, photo_url, auth_provider, created_at, updated_at)
        SELECT id, username, password_hash, role, display_name, firebase_uid, email, photo_url, auth_provider, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE UNIQUE INDEX idx_users_firebase_uid2 ON users(firebase_uid);
      CREATE UNIQUE INDEX idx_users_email2 ON users(email);
    `,
  },
  {
    name: "005_connected_accounts",
    sql: `
      CREATE TABLE IF NOT EXISTS connected_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('github', 'google_drive')),
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        account_name TEXT,
        account_email TEXT,
        account_avatar TEXT,
        scopes TEXT,
        token_expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_connected_accounts_user_provider ON connected_accounts(user_id, provider);
    `,
  },
  {
    name: "006_agent_tasks",
    sql: `
      CREATE TABLE agent_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        integrations TEXT NOT NULL DEFAULT '[]',
        result TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE agent_task_assignments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'worker',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        output TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_task_assignments_task ON agent_task_assignments(task_id);
      CREATE INDEX idx_agent_tasks_user ON agent_tasks(user_id, status);
    `,
  },
  {
    name: "007_projects",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
        integrations TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_projects_user ON projects(user_id, status);

      CREATE TABLE project_agents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_project_agents_project ON project_agents(project_id);
      CREATE UNIQUE INDEX idx_project_agents_unique ON project_agents(project_id, agent_id);

      CREATE TABLE project_messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_project_messages_project ON project_messages(project_id);
    `,
  },
];
