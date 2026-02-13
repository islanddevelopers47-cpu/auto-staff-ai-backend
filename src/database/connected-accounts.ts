import type Database from "better-sqlite3";
import { generateId } from "../utils/crypto.js";

export interface ConnectedAccount {
  id: string;
  user_id: string;
  provider: "github" | "google_drive" | "vercel" | "netlify";
  access_token: string;
  refresh_token: string | null;
  account_name: string | null;
  account_email: string | null;
  account_avatar: string | null;
  scopes: string | null;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ConnectedAccountPublic = Omit<ConnectedAccount, "access_token" | "refresh_token">;

export function getConnectedAccount(
  db: Database.Database,
  userId: string,
  provider: string
): ConnectedAccount | undefined {
  return db
    .prepare("SELECT * FROM connected_accounts WHERE user_id = ? AND provider = ?")
    .get(userId, provider) as ConnectedAccount | undefined;
}

export function listConnectedAccounts(
  db: Database.Database,
  userId: string
): ConnectedAccountPublic[] {
  const rows = db
    .prepare(
      "SELECT id, user_id, provider, account_name, account_email, account_avatar, scopes, token_expires_at, created_at, updated_at FROM connected_accounts WHERE user_id = ? ORDER BY created_at"
    )
    .all(userId) as ConnectedAccountPublic[];
  return rows;
}

export function upsertConnectedAccount(
  db: Database.Database,
  opts: {
    userId: string;
    provider: "github" | "google_drive" | "vercel" | "netlify";
    accessToken: string;
    refreshToken?: string;
    accountName?: string;
    accountEmail?: string;
    accountAvatar?: string;
    scopes?: string;
    tokenExpiresAt?: string;
  }
): ConnectedAccount {
  const existing = getConnectedAccount(db, opts.userId, opts.provider);

  if (existing) {
    db.prepare(
      `UPDATE connected_accounts SET
        access_token = ?, refresh_token = ?, account_name = ?, account_email = ?,
        account_avatar = ?, scopes = ?, token_expires_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      opts.accessToken,
      opts.refreshToken ?? existing.refresh_token,
      opts.accountName ?? existing.account_name,
      opts.accountEmail ?? existing.account_email,
      opts.accountAvatar ?? existing.account_avatar,
      opts.scopes ?? existing.scopes,
      opts.tokenExpiresAt ?? existing.token_expires_at,
      existing.id
    );
    return db.prepare("SELECT * FROM connected_accounts WHERE id = ?").get(existing.id) as ConnectedAccount;
  }

  const id = generateId();
  db.prepare(
    `INSERT INTO connected_accounts (id, user_id, provider, access_token, refresh_token, account_name, account_email, account_avatar, scopes, token_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.userId,
    opts.provider,
    opts.accessToken,
    opts.refreshToken ?? null,
    opts.accountName ?? null,
    opts.accountEmail ?? null,
    opts.accountAvatar ?? null,
    opts.scopes ?? null,
    opts.tokenExpiresAt ?? null
  );
  return db.prepare("SELECT * FROM connected_accounts WHERE id = ?").get(id) as ConnectedAccount;
}

export function deleteConnectedAccount(
  db: Database.Database,
  userId: string,
  provider: string
): boolean {
  const result = db
    .prepare("DELETE FROM connected_accounts WHERE user_id = ? AND provider = ?")
    .run(userId, provider);
  return result.changes > 0;
}

export function updateAccessToken(
  db: Database.Database,
  id: string,
  accessToken: string,
  expiresAt?: string
): void {
  db.prepare(
    `UPDATE connected_accounts SET access_token = ?, token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(accessToken, expiresAt ?? null, id);
}
