import type Database from "better-sqlite3";

export interface IntegrationConfig {
  github_client_id?: string;
  github_client_secret?: string;
  google_drive_client_id?: string;
  google_drive_client_secret?: string;
  vercel_client_id?: string;
  vercel_client_secret?: string;
  netlify_client_id?: string;
  netlify_client_secret?: string;
  docker_host?: string;
}

function settingsKey(field: string): string {
  return `integration.${field}`;
}

function getVal(db: Database.Database, field: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(settingsKey(field)) as { value: string } | undefined;
  return row?.value;
}

function setVal(db: Database.Database, field: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  ).run(settingsKey(field), value);
}

function delVal(db: Database.Database, field: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(settingsKey(field));
}

export function getIntegrationConfig(db: Database.Database): IntegrationConfig {
  return {
    github_client_id: getVal(db, "github_client_id"),
    github_client_secret: getVal(db, "github_client_secret"),
    google_drive_client_id: getVal(db, "google_drive_client_id"),
    google_drive_client_secret: getVal(db, "google_drive_client_secret"),
    vercel_client_id: getVal(db, "vercel_client_id"),
    vercel_client_secret: getVal(db, "vercel_client_secret"),
    netlify_client_id: getVal(db, "netlify_client_id"),
    netlify_client_secret: getVal(db, "netlify_client_secret"),
    docker_host: getVal(db, "docker_host"),
  };
}

export function setIntegrationConfig(
  db: Database.Database,
  config: Partial<IntegrationConfig>
): void {
  const fields: Array<[keyof IntegrationConfig, string]> = [
    ["github_client_id", "github_client_id"],
    ["github_client_secret", "github_client_secret"],
    ["google_drive_client_id", "google_drive_client_id"],
    ["google_drive_client_secret", "google_drive_client_secret"],
    ["vercel_client_id", "vercel_client_id"],
    ["vercel_client_secret", "vercel_client_secret"],
    ["netlify_client_id", "netlify_client_id"],
    ["netlify_client_secret", "netlify_client_secret"],
    ["docker_host", "docker_host"],
  ];

  for (const [key, label] of fields) {
    const value = config[key];
    if (value !== undefined) {
      if (value === "") {
        delVal(db, label);
      } else {
        setVal(db, label, value);
      }
    }
  }
}

export function getMaskedConfig(db: Database.Database): Record<string, string> {
  const config = getIntegrationConfig(db);
  const mask = (v?: string) => v ? v.slice(0, 6) + "••••••••" : "";
  return {
    github_client_id: config.github_client_id || "",
    github_client_secret: mask(config.github_client_secret),
    google_drive_client_id: config.google_drive_client_id || "",
    google_drive_client_secret: mask(config.google_drive_client_secret),
    vercel_client_id: config.vercel_client_id || "",
    vercel_client_secret: mask(config.vercel_client_secret),
    netlify_client_id: config.netlify_client_id || "",
    netlify_client_secret: mask(config.netlify_client_secret),
    docker_host: config.docker_host || "",
  };
}

/**
 * Resolve an integration credential: DB first, then env fallback.
 */
export function resolveIntegrationCred(
  db: Database.Database,
  key: keyof IntegrationConfig,
  envFallback?: string
): string | undefined {
  return getVal(db, key) || envFallback || undefined;
}
