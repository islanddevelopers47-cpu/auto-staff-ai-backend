import type Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { getEnv } from "../config/env.js";
import { generateId, hashPassword, verifyPassword } from "../utils/crypto.js";

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: "admin" | "user";
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export type UserPublic = Omit<User, "password_hash">;

export function ensureAdminUser(db: Database.Database): void {
  const existing = db
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get();
  if (existing) return;

  const env = getEnv();
  const id = generateId();
  const hash = bcrypt.hashSync(env.ADMIN_PASSWORD, 12);

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, display_name)
     VALUES (?, ?, ?, 'admin', 'Admin')`
  ).run(id, "admin", hash);
}

export function findUserByUsername(
  db: Database.Database,
  username: string
): User | undefined {
  return db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as User | undefined;
}

export function findUserById(
  db: Database.Database,
  id: string
): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | User
    | undefined;
}

export function listUsers(db: Database.Database): UserPublic[] {
  return db
    .prepare(
      "SELECT id, username, role, display_name, created_at, updated_at FROM users ORDER BY created_at"
    )
    .all() as UserPublic[];
}

export async function createUser(
  db: Database.Database,
  opts: { username: string; password: string; role?: "admin" | "user"; displayName?: string }
): Promise<UserPublic> {
  const id = generateId();
  const hash = await hashPassword(opts.password);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, display_name)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, opts.username, hash, opts.role ?? "user", opts.displayName ?? null);

  return {
    id,
    username: opts.username,
    role: opts.role ?? "user",
    display_name: opts.displayName ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function authenticateUser(
  db: Database.Database,
  username: string,
  password: string
): Promise<User | null> {
  const user = findUserByUsername(db, username);
  if (!user) return null;

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  return user;
}
