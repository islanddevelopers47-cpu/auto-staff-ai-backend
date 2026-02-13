import { Router } from "express";
import type Database from "better-sqlite3";
import type { BotManager } from "../../telegram/bot-manager.js";
import { createBot, listBots, findBotById, updateBot, deleteBot } from "../../database/bots.js";
import { listSessions } from "../../database/sessions.js";
import { authMiddleware } from "../../auth/middleware.js";
import { runAgent } from "../../agents/agent-runner.js";
import { resolveApiKeyForBot, findFallbackProvider, type ProviderName } from "../../agents/model-providers.js";

export function createBotsRouter(db: Database.Database, botManager: BotManager): Router {
  const router = Router();

  // List all bots
  router.get("/bots", authMiddleware, (req, res) => {
    const userId = req.user!.role === "admin" ? undefined : req.user!.userId;
    const bots = listBots(db, userId);
    const result = bots.map((b) => ({
      ...b,
      config: JSON.parse(b.config),
      isRunning: botManager.isRunning(b.id),
    }));
    res.json({ bots: result });
  });

  // Get single bot
  router.get("/bots/:id", authMiddleware, (req, res) => {
    const bot = findBotById(db, String(req.params.id));
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    res.json({
      ...bot,
      config: JSON.parse(bot.config),
      isRunning: botManager.isRunning(bot.id),
    });
  });

  // Create a new bot
  router.post("/bots", authMiddleware, async (req, res) => {
    try {
      const { name, telegramToken, agentId, mode } = req.body as {
        name?: string;
        telegramToken?: string;
        agentId?: string;
        mode?: "polling" | "webhook";
      };

      if (!name || !telegramToken) {
        res.status(400).json({ error: "name and telegramToken are required" });
        return;
      }

      const bot = createBot(db, {
        userId: req.user!.userId,
        name,
        telegramToken,
        agentId,
        mode,
      });

      res.status(201).json(bot);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to create bot" });
    }
  });

  // Update a bot
  router.patch("/bots/:id", authMiddleware, (req, res) => {
    const botId = String(req.params.id);
    const bot = findBotById(db, botId);
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    const updates = req.body as Record<string, unknown>;
    const allowed = ["name", "telegram_token", "agent_id", "mode", "webhook_url", "enabled", "config"];
    const filtered: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) {
        filtered[key] = key === "config" ? JSON.stringify(updates[key]) : updates[key];
      }
    }

    updateBot(db, botId, filtered as any);
    const updated = findBotById(db, botId);
    res.json(updated);
  });

  // Delete a bot
  router.delete("/bots/:id", authMiddleware, async (req, res) => {
    const bot = findBotById(db, String(req.params.id));
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    // Stop the bot first
    if (botManager.isRunning(bot.id)) {
      await botManager.stopBot(bot.id);
    }

    deleteBot(db, bot.id);
    res.json({ ok: true });
  });

  // Start a bot
  router.post("/bots/:id/start", authMiddleware, async (req, res) => {
    try {
      const bot = findBotById(db, String(req.params.id));
      if (!bot) {
        res.status(404).json({ error: "Bot not found" });
        return;
      }
      await botManager.startBot(bot.id);
      res.json({ ok: true, status: "running" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to start bot" });
    }
  });

  // Stop a bot
  router.post("/bots/:id/stop", authMiddleware, async (req, res) => {
    try {
      await botManager.stopBot(String(req.params.id));
      res.json({ ok: true, status: "stopped" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to stop bot" });
    }
  });

  // Restart a bot
  router.post("/bots/:id/restart", authMiddleware, async (req, res) => {
    try {
      await botManager.restartBot(String(req.params.id));
      res.json({ ok: true, status: "running" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to restart bot" });
    }
  });

  // Get bot sessions
  router.get("/bots/:id/sessions", authMiddleware, (req, res) => {
    const sessions = listSessions(db, String(req.params.id));
    res.json({ sessions });
  });

  // Validate a Telegram token
  router.post("/bots/validate-token", authMiddleware, async (req, res) => {
    try {
      const { token } = req.body as { token?: string };
      if (!token) {
        res.status(400).json({ error: "token is required" });
        return;
      }

      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = (await response.json()) as any;

      if (!data.ok) {
        res.status(400).json({ error: "Invalid Telegram bot token", details: data.description });
        return;
      }

      res.json({
        valid: true,
        bot: {
          id: data.result.id,
          username: data.result.username,
          firstName: data.result.first_name,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to validate token" });
    }
  });

  // Chat test endpoint — runs agent pipeline via API
  router.post("/bots/:id/chat", authMiddleware, async (req, res) => {
    try {
      const botId = String(req.params.id);
      const bot = findBotById(db, botId);
      if (!bot) {
        res.status(404).json({ error: "Bot not found" });
        return;
      }

      const { message } = req.body as { message?: string };
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      // Get the bot's agent
      const agentRegistry = botManager.getAgentRegistry();
      const agent = bot.agent_id
        ? agentRegistry.getAgent(bot.agent_id)
        : agentRegistry.getDefaultAgent();

      if (!agent) {
        res.status(400).json({ error: "No agent configured for this bot" });
        return;
      }

      // Resolve API key with fallback
      let provider = agent.model_provider as ProviderName;
      let model = agent.model_name;
      let apiKey = resolveApiKeyForBot(db, botId, provider);

      if (!apiKey && provider !== "ollama") {
        const fallback = findFallbackProvider(db, botId, provider);
        if (fallback) {
          provider = fallback.provider;
          model = fallback.model;
          apiKey = fallback.apiKey;
        } else {
          res.status(400).json({
            error: `No API key configured for ${provider}. Add one in Settings → API Keys.`,
          });
          return;
        }
      }

      const result = await runAgent(db, agent, {
        botId,
        chatId: `web-test-${req.user!.userId}`,
        chatType: "private",
        userMessage: message,
        senderName: req.user!.userId,
        apiKeyOverride: apiKey,
        providerOverride: provider,
        modelOverride: model,
      });

      res.json({
        response: result.response,
        model: result.model,
        usage: result.usage,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Agent run failed" });
    }
  });

  return router;
}
