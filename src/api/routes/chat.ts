import { Router } from "express";
import type Database from "better-sqlite3";
import type { AgentRegistry } from "../../agents/agent-registry.js";
import { authMiddleware } from "../../auth/middleware.js";
import { createLogger } from "../../utils/logger.js";
import { runAgent } from "../../agents/agent-runner.js";
import {
  resolveApiKeyForUser,
  findFallbackProviderForUser,
  type ProviderName,
} from "../../agents/model-providers.js";

const log = createLogger("chat-api");

export function createChatRouter(
  db: Database.Database,
  agentRegistry: AgentRegistry
): Router {
  const router = Router();

  /**
   * POST /api/chat
   * Body: { agentId, message, sessionId? }
   * Runs the agent against the message and returns the response.
   * If the agent uses "mlx" (on-device) provider, falls back to the user's
   * first available cloud provider.
   */
  router.post("/chat", authMiddleware, async (req, res) => {
    const { agentId, message, sessionId } = req.body as {
      agentId: string;
      message: string;
      sessionId?: string;
    };

    if (!agentId || !message) {
      res.status(400).json({ error: "agentId and message are required" });
      return;
    }

    const agent = agentRegistry.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const userId = req.user!.userId;
    const rawProvider = agent.model_provider as string;
    let provider = rawProvider as ProviderName;
    let model = agent.model_name;
    const isOnDevice = rawProvider === "mlx";
    let apiKey = isOnDevice ? null : resolveApiKeyForUser(db, userId, provider);

    // "mlx" is an on-device provider — not available server-side.
    // Fall back to any cloud provider the user has configured.
    if (isOnDevice || !apiKey) {
      const fallback = findFallbackProviderForUser(db, userId, isOnDevice ? undefined : provider);
      if (!fallback) {
        res.status(422).json({
          error: "No API key configured. Add an API key in Settings to use agents.",
        });
        return;
      }
      provider = fallback.provider;
      model = fallback.model;
      apiKey = fallback.apiKey;
    }

    const chatId = sessionId ?? `mobile-${userId}-${agentId}`;

    try {
      const result = await runAgent(db, agent, {
        botId: null,
        chatId,
        chatType: "private",
        userMessage: message,
        senderName: userId,
        apiKeyOverride: apiKey,
        providerOverride: provider,
        modelOverride: model,
        userId,
      });

      res.json({
        response: result.response,
        sessionId: result.sessionId,
        model: result.model,
      });
    } catch (err: any) {
      log.error(`Chat failed for agent ${agentId}: ${err.message}`);
      res.status(500).json({ error: err.message ?? "Inference failed" });
    }
  });

  return router;
}
