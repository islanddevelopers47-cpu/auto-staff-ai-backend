import type Database from "better-sqlite3";
import { generateId } from "../utils/crypto.js";

export interface ApiKey {
  id: string;
  user_id: string;
  provider: string;
  api_key: string;
  label: string | null;
  created_at: string;
}

export interface ApiKeyPublic {
  id: string;
  provider: string;
  label: string | null;
  masked_key: string;
  created_at: string;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}

export function setApiKey(
  db: Database.Database,
  userId: string,
  provider: string,
  apiKey: string,
  label?: string
): ApiKeyPublic {
  const normalizedProvider = provider.toLowerCase().trim();
  const normalizedLabel = label?.trim() || "default";

  // Upsert: if key for this user+provider+label exists, update it
  const existing = db
    .prepare(
      "SELECT id FROM api_keys WHERE user_id = ? AND provider = ? AND label = ?"
    )
    .get(userId, normalizedProvider, normalizedLabel) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE api_keys SET api_key = ? WHERE id = ?"
    ).run(apiKey, existing.id);
    return {
      id: existing.id,
      provider: normalizedProvider,
      label: normalizedLabel,
      masked_key: maskKey(apiKey),
      created_at: new Date().toISOString(),
    };
  }

  const id = generateId();
  db.prepare(
    `INSERT INTO api_keys (id, user_id, provider, api_key, label)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, userId, normalizedProvider, apiKey, normalizedLabel);

  return {
    id,
    provider: normalizedProvider,
    label: normalizedLabel,
    masked_key: maskKey(apiKey),
    created_at: new Date().toISOString(),
  };
}

export function getApiKeysForUser(
  db: Database.Database,
  userId: string
): ApiKeyPublic[] {
  const rows = db
    .prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY provider, label")
    .all(userId) as ApiKey[];

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    label: row.label,
    masked_key: maskKey(row.api_key),
    created_at: row.created_at,
  }));
}

export function getRawApiKey(
  db: Database.Database,
  userId: string,
  provider: string,
  label?: string
): string | undefined {
  const normalizedLabel = label?.trim() || "default";
  const row = db
    .prepare(
      "SELECT api_key FROM api_keys WHERE user_id = ? AND provider = ? AND label = ?"
    )
    .get(userId, provider.toLowerCase(), normalizedLabel) as { api_key: string } | undefined;

  return row?.api_key;
}

/**
 * Get API key for a specific bot's owner + provider.
 * Looks up the bot's user_id, then finds their key for that provider.
 */
export function getApiKeyForBot(
  db: Database.Database,
  botId: string,
  provider: string
): string | undefined {
  const row = db
    .prepare(
      `SELECT ak.api_key FROM api_keys ak
       JOIN bots b ON b.user_id = ak.user_id
       WHERE b.id = ? AND ak.provider = ?
       ORDER BY ak.created_at ASC LIMIT 1`
    )
    .get(botId, provider.toLowerCase()) as { api_key: string } | undefined;

  return row?.api_key;
}

export function deleteApiKey(
  db: Database.Database,
  keyId: string,
  userId: string
): boolean {
  const result = db
    .prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
    .run(keyId, userId);
  return result.changes > 0;
}

/**
 * Check which providers have keys stored in the DB (from any user).
 */
export function getConfiguredProviders(
  db: Database.Database
): Record<string, boolean> {
  const rows = db
    .prepare("SELECT DISTINCT provider FROM api_keys")
    .all() as { provider: string }[];

  const providers: Record<string, boolean> = {
    openai: false,
    anthropic: false,
    google: false,
    ollama: true, // Ollama doesn't need an API key
  };

  for (const row of rows) {
    providers[row.provider] = true;
  }

  return providers;
}
