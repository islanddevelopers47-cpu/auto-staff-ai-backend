import type { Express } from "express";
import type Database from "better-sqlite3";
import type { BotManager } from "../../telegram/bot-manager.js";
import type { AgentRegistry } from "../../agents/agent-registry.js";
import { createHealthRouter } from "./health.js";
import { createAuthRouter } from "./auth.js";
import { createBotsRouter } from "./bots.js";
import { createAgentsRouter } from "./agents.js";
import { createSessionsRouter } from "./sessions.js";
import { createSetupRouter } from "./setup.js";
import { createSkillsRouter } from "./skills.js";
import { createApiKeysRouter } from "./api-keys.js";
import { createWebBotsRouter } from "./web-bots.js";
import { createIntegrationsRouter } from "./integrations.js";
import { createAgentTasksRouter } from "./agent-tasks.js";
import { createProjectsRouter } from "./projects.js";

export function registerRoutes(
  app: Express,
  db: Database.Database,
  botManager: BotManager,
  agentRegistry: AgentRegistry
): void {
  // Health check (no /api prefix)
  app.use("/api", createHealthRouter());

  // Auth routes
  app.use("/api", createAuthRouter(db));

  // Bot management routes
  app.use("/api", createBotsRouter(db, botManager));

  // Agent management routes
  app.use("/api", createAgentsRouter(db, agentRegistry));

  // Session/history routes
  app.use("/api", createSessionsRouter(db));

  // Setup wizard routes
  app.use("/api", createSetupRouter(db, botManager, agentRegistry));

  // Skills routes
  app.use("/api", createSkillsRouter());

  // API keys management routes
  app.use("/api", createApiKeysRouter(db));

  // Web bots routes
  app.use("/api", createWebBotsRouter(db, agentRegistry));

  // Integrations routes (GitHub, Google Drive, Vercel, Netlify, Docker)
  app.use("/api", createIntegrationsRouter(db));

  // Agent tasks routes
  app.use("/api", createAgentTasksRouter(db, agentRegistry));

  // Projects routes
  app.use("/api", createProjectsRouter(db, agentRegistry));

  // Telegram webhook endpoint (per-bot)
  app.post("/api/telegram/webhook/:botId", (req, res) => {
    const instance = botManager.getBotInstance(String(req.params.botId));
    if (!instance) {
      res.status(404).json({ error: "Bot not found or not running" });
      return;
    }
    const callback = instance.getWebhookCallback();
    callback(req, res);
  });
}
