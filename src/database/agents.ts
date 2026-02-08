import type Database from "better-sqlite3";
import { generateId } from "../utils/crypto.js";

export interface Agent {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  system_prompt: string;
  model_provider: string;
  model_name: string;
  temperature: number;
  max_tokens: number;
  skills: string;
  config: string;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentInput {
  userId?: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  modelProvider?: string;
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
  skills?: string[];
  config?: Record<string, unknown>;
  isBuiltin?: boolean;
}

export function createAgent(db: Database.Database, input: CreateAgentInput): Agent {
  const id = generateId();
  db.prepare(
    `INSERT INTO agents (id, user_id, name, description, system_prompt, model_provider, model_name, temperature, max_tokens, skills, config, is_builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId ?? null,
    input.name,
    input.description ?? null,
    input.systemPrompt ?? "You are a helpful assistant.",
    input.modelProvider ?? "openai",
    input.modelName ?? "gpt-4o-mini",
    input.temperature ?? 0.7,
    input.maxTokens ?? 4096,
    JSON.stringify(input.skills ?? []),
    JSON.stringify(input.config ?? {}),
    input.isBuiltin ? 1 : 0
  );

  return findAgentById(db, id)!;
}

export function findAgentById(db: Database.Database, id: string): Agent | undefined {
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent | undefined;
}

export function findAgentByName(db: Database.Database, name: string): Agent | undefined {
  return db.prepare("SELECT * FROM agents WHERE name = ?").get(name) as Agent | undefined;
}

export function listAgents(db: Database.Database, userId?: string): Agent[] {
  if (userId) {
    return db
      .prepare(
        "SELECT * FROM agents WHERE user_id = ? OR is_builtin = 1 ORDER BY is_builtin DESC, name"
      )
      .all(userId) as Agent[];
  }
  return db.prepare("SELECT * FROM agents ORDER BY is_builtin DESC, name").all() as Agent[];
}

export function updateAgent(
  db: Database.Database,
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
    system_prompt: string;
    model_provider: string;
    model_name: string;
    temperature: number;
    max_tokens: number;
    skills: string;
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

  db.prepare(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteAgent(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM agents WHERE id = ? AND is_builtin = 0").run(id);
}

export function countAgents(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM agents").get() as { count: number };
  return row.count;
}
