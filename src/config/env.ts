import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.string().default("3000"),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  JWT_SECRET: z.string().min(8).default("change-me-to-a-random-secret-string"),
  ADMIN_PASSWORD: z.string().min(4).default("admin123"),
  DATABASE_PATH: z.string().default("./data/autostaff.db"),
  OLLAMA_BASE_URL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  PUBLIC_URL: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().default("auto-staff-ai"),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_DRIVE_CLIENT_ID: z.string().optional(),
  GOOGLE_DRIVE_CLIENT_SECRET: z.string().optional(),
  VERCEL_CLIENT_ID: z.string().optional(),
  VERCEL_CLIENT_SECRET: z.string().optional(),
  NETLIFY_CLIENT_ID: z.string().optional(),
  NETLIFY_CLIENT_SECRET: z.string().optional(),
  DOCKER_HOST: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

let _env: EnvConfig | null = null;

export function loadEnv(): EnvConfig {
  dotenv.config();
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  _env = result.data;
  return _env;
}

export function getEnv(): EnvConfig {
  if (!_env) {
    return loadEnv();
  }
  return _env;
}

export function getPort(): number {
  return parseInt(getEnv().PORT, 10);
}

export function getHost(): string {
  return getEnv().HOST;
}

export function isDev(): boolean {
  return getEnv().NODE_ENV === "development";
}

export function isProd(): boolean {
  return getEnv().NODE_ENV === "production";
}

export function getDatabasePath(): string {
  const dbPath = getEnv().DATABASE_PATH;
  return path.resolve(dbPath);
}

export function getPublicUrl(): string | undefined {
  return getEnv().PUBLIC_URL || undefined;
}

export function getJwtSecret(): string {
  return getEnv().JWT_SECRET;
}
