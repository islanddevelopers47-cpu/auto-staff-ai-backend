import { Router } from "express";
import type Database from "better-sqlite3";
import type { AgentRegistry } from "../../agents/agent-registry.js";
import {
  createWebBot,
  findBotById,
  findBotByEmbedToken,
  listWebBots,
  updateBot,
  deleteBot,
} from "../../database/bots.js";
import { authMiddleware } from "../../auth/middleware.js";
import { runAgent } from "../../agents/agent-runner.js";
import {
  resolveApiKeyForBot,
  findFallbackProvider,
  type ProviderName,
} from "../../agents/model-providers.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("web-bots");

export function createWebBotsRouter(
  db: Database.Database,
  agentRegistry: AgentRegistry
): Router {
  const router = Router();

  // --- Authenticated management endpoints ---

  // List web bots
  router.get("/web-bots", authMiddleware, (req, res) => {
    const userId = req.user!.role === "admin" ? undefined : req.user!.userId;
    const bots = listWebBots(db, userId);
    const result = bots.map((b) => ({
      ...b,
      config: JSON.parse(b.config),
      widget_config: JSON.parse(b.widget_config),
    }));
    res.json({ bots: result });
  });

  // Get single web bot
  router.get("/web-bots/:id", authMiddleware, (req, res) => {
    const bot = findBotById(db, String(req.params.id));
    if (!bot || bot.platform !== "web") {
      res.status(404).json({ error: "Web bot not found" });
      return;
    }
    res.json({
      ...bot,
      config: JSON.parse(bot.config),
      widget_config: JSON.parse(bot.widget_config),
    });
  });

  // Create a new web bot
  router.post("/web-bots", authMiddleware, (req, res) => {
    try {
      const body = req.body as {
        name?: string;
        agentId?: string;
        allowedOrigins?: string;
        widgetConfig?: Record<string, unknown>;
      };

      if (!body.name) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const bot = createWebBot(db, {
        userId: req.user!.userId,
        name: body.name,
        agentId: body.agentId,
        allowedOrigins: body.allowedOrigins,
        widgetConfig: body.widgetConfig,
      });

      res.status(201).json({
        ...bot,
        config: JSON.parse(bot.config),
        widget_config: JSON.parse(bot.widget_config),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to create web bot" });
    }
  });

  // Update a web bot
  router.patch("/web-bots/:id", authMiddleware, (req, res) => {
    const botId = String(req.params.id);
    const bot = findBotById(db, botId);
    if (!bot || bot.platform !== "web") {
      res.status(404).json({ error: "Web bot not found" });
      return;
    }

    const updates = req.body as Record<string, unknown>;
    const allowed = ["name", "agent_id", "allowed_origins", "widget_config", "enabled"];
    const filtered: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) {
        filtered[key] =
          key === "widget_config" ? JSON.stringify(updates[key]) : updates[key];
      }
    }

    updateBot(db, botId, filtered as any);
    const updated = findBotById(db, botId)!;
    res.json({
      ...updated,
      config: JSON.parse(updated.config),
      widget_config: JSON.parse(updated.widget_config),
    });
  });

  // Delete a web bot
  router.delete("/web-bots/:id", authMiddleware, (req, res) => {
    const bot = findBotById(db, String(req.params.id));
    if (!bot || bot.platform !== "web") {
      res.status(404).json({ error: "Web bot not found" });
      return;
    }
    deleteBot(db, bot.id);
    res.json({ ok: true });
  });

  // Get embed code for a web bot
  router.get("/web-bots/:id/embed", authMiddleware, (req, res) => {
    const bot = findBotById(db, String(req.params.id));
    if (!bot || bot.platform !== "web") {
      res.status(404).json({ error: "Web bot not found" });
      return;
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const embedCode = `<script src="${baseUrl}/widget.js" data-bot-token="${bot.embed_token}"></script>`;

    res.json({
      embedCode,
      embedToken: bot.embed_token,
      baseUrl,
    });
  });

  // --- Public endpoints (no auth) ---

  // Widget config endpoint
  router.get("/web-bots/config", (req, res) => {
    const token = String(req.query.token || "");
    if (!token) {
      res.status(400).json({ error: "token is required" });
      return;
    }
    const bot = findBotByEmbedToken(db, token);
    if (!bot) {
      res.status(404).json({ error: "Invalid bot token" });
      return;
    }
    res.json({
      name: bot.name,
      widgetConfig: JSON.parse(bot.widget_config),
    });
  });

  // Public chat endpoint (uses embed_token)
  router.post("/web-bots/chat", async (req, res) => {
    try {
      const { token, message, sessionId } = req.body as {
        token?: string;
        message?: string;
        sessionId?: string;
      };

      if (!token) {
        res.status(400).json({ error: "token is required" });
        return;
      }
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      // Find bot by embed token
      const bot = findBotByEmbedToken(db, token);
      if (!bot) {
        res.status(404).json({ error: "Invalid bot token" });
        return;
      }

      if (!bot.enabled) {
        res.status(403).json({ error: "This bot is currently disabled" });
        return;
      }

      // Check CORS / allowed origins
      const origin = req.get("origin") || req.get("referer") || "";
      if (bot.allowed_origins !== "*") {
        const allowed = bot.allowed_origins.split(",").map((o) => o.trim());
        const originMatches = allowed.some(
          (a) => origin.includes(a) || a === "*"
        );
        if (!originMatches) {
          res.status(403).json({ error: "Origin not allowed" });
          return;
        }
      }

      // Get agent
      const agent = bot.agent_id
        ? agentRegistry.getAgent(bot.agent_id)
        : agentRegistry.getDefaultAgent();

      if (!agent) {
        res.status(500).json({ error: "No agent configured for this bot" });
        return;
      }

      // Resolve API key
      let provider = agent.model_provider as ProviderName;
      let model = agent.model_name;
      let apiKey = resolveApiKeyForBot(db, bot.id, provider);

      if (!apiKey && provider !== "ollama") {
        const fallback = findFallbackProvider(db, bot.id, provider);
        if (fallback) {
          provider = fallback.provider;
          model = fallback.model;
          apiKey = fallback.apiKey;
        } else {
          res.status(500).json({ error: "Bot is not properly configured" });
          return;
        }
      }

      // Use session ID from client or generate one based on a random visitor ID
      const chatId = sessionId || `web-visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const result = await runAgent(db, agent, {
        botId: bot.id,
        chatId,
        chatType: "private",
        userMessage: message,
        senderName: "Website Visitor",
        apiKeyOverride: apiKey,
        providerOverride: provider,
        modelOverride: model,
      });

      log.info(`Web bot "${bot.name}" responded to visitor (${chatId})`);

      res.json({
        response: result.response,
        sessionId: chatId,
      });
    } catch (err: any) {
      log.error(`Web bot chat error: ${err?.message}`);
      res.status(500).json({ error: "Failed to process message" });
    }
  });

  return router;
}
