import type Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { getEnv } from "../config/env.js";
import { generateId, hashPassword, verifyPassword } from "../utils/crypto.js";

export interface User {
  id: string;
  username: string;
  password_hash: string | null;
  role: "admin" | "user";
  display_name: string | null;
  firebase_uid: string | null;
  email: string | null;
  photo_url: string | null;
  auth_provider: string;
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
    firebase_uid: null,
    email: null,
    photo_url: null,
    auth_provider: "local",
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
  if (!user.password_hash) return null;

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  return user;
}

export function findUserByFirebaseUid(
  db: Database.Database,
  firebaseUid: string
): User | undefined {
  return db
    .prepare("SELECT * FROM users WHERE firebase_uid = ?")
    .get(firebaseUid) as User | undefined;
}

export function findUserByEmail(
  db: Database.Database,
  email: string
): User | undefined {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as User | undefined;
}

export function createFirebaseUser(
  db: Database.Database,
  opts: {
    firebaseUid: string;
    email?: string;
    displayName?: string;
    photoUrl?: string;
    provider: string;
  }
): User {
  const id = generateId();
  // Use email prefix as username, or firebase UID as fallback
  let username = opts.email?.split("@")[0] || `user_${id.slice(0, 8)}`;

  // Ensure username is unique
  const existing = findUserByUsername(db, username);
  if (existing) {
    username = `${username}_${id.slice(0, 6)}`;
  }

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, display_name, firebase_uid, email, photo_url, auth_provider)
     VALUES (?, ?, NULL, 'user', ?, ?, ?, ?, ?)`
  ).run(
    id,
    username,
    opts.displayName ?? null,
    opts.firebaseUid,
    opts.email ?? null,
    opts.photoUrl ?? null,
    opts.provider
  );

  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User;
}

export function updateFirebaseUser(
  db: Database.Database,
  userId: string,
  opts: { displayName?: string; photoUrl?: string; email?: string }
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (opts.displayName !== undefined) { fields.push("display_name = ?"); values.push(opts.displayName); }
  if (opts.photoUrl !== undefined) { fields.push("photo_url = ?"); values.push(opts.photoUrl); }
  if (opts.email !== undefined) { fields.push("email = ?"); values.push(opts.email); }

  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(userId);

  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}
