import { Router } from "express";
import type Database from "better-sqlite3";
import type { BotManager } from "../../telegram/bot-manager.js";
import type { AgentRegistry } from "../../agents/agent-registry.js";
import { getAvailableProvidersWithDb } from "../../agents/model-providers.js";
import { listBots } from "../../database/bots.js";
import { authMiddleware } from "../../auth/middleware.js";

export function createSetupRouter(
  db: Database.Database,
  botManager: BotManager,
  agentRegistry: AgentRegistry
): Router {
  const router = Router();

  // Get setup status — is the system configured?
  router.get("/setup/status", authMiddleware, (_req, res) => {
    const userId = (_req as any).user?.userId as string | undefined;
    const providers = getAvailableProvidersWithDb(db, userId);
    const hasProvider = providers.some((p) => p.configured);
    const bots = listBots(db);
    const hasBots = bots.length > 0;
    const hasRunningBot = bots.some((b) => botManager.isRunning(b.id));
    const agents = agentRegistry.getAllAgents();
    const hasAgent = agents.length > 0;

    res.json({
      complete: hasProvider && hasBots && hasAgent,
      steps: {
        provider: { done: hasProvider, label: "Configure an AI provider" },
        agent: { done: hasAgent, label: "Set up an AI agent" },
        bot: { done: hasBots, label: "Add a Telegram bot" },
        running: { done: hasRunningBot, label: "Start a bot" },
      },
      providers: providers.map((p) => ({ name: p.name, configured: p.configured })),
      botCount: bots.length,
      agentCount: agents.length,
      runningBotCount: bots.filter((b) => botManager.isRunning(b.id)).length,
    });
  });

  return router;
}
