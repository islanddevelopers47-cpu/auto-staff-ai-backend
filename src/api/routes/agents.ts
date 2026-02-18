import { Router } from "express";
import type Database from "better-sqlite3";
import type { AgentRegistry } from "../../agents/agent-registry.js";
import { createAgent, findAgentById, updateAgent, deleteAgent } from "../../database/agents.js";
import { getAvailableProviders, getDefaultModels, resolveApiKeyForUser, findFallbackProviderForUser, type ProviderName } from "../../agents/model-providers.js";
import { runAgent } from "../../agents/agent-runner.js";
import { authMiddleware } from "../../auth/middleware.js";

export function createAgentsRouter(db: Database.Database, agentRegistry: AgentRegistry): Router {
  const router = Router();

  router.get("/agents", authMiddleware, (_req, res) => {
    const agents = agentRegistry.getAllAgents();
    res.json({
      agents: agents.map((a) => ({
        ...a,
        skills: JSON.parse(a.skills),
        config: JSON.parse(a.config),
      })),
    });
  });

  router.get("/agents/:id", authMiddleware, (req, res) => {
    const agent = findAgentById(db, String(req.params.id));
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json({ ...agent, skills: JSON.parse(agent.skills), config: JSON.parse(agent.config) });
  });

  router.post("/agents", authMiddleware, (req, res) => {
    try {
      const body = req.body as {
        name?: string;
        description?: string;
        systemPrompt?: string;
        modelProvider?: string;
        modelName?: string;
        temperature?: number;
        maxTokens?: number;
        skills?: string[];
        config?: Record<string, unknown>;
      };

      if (!body.name) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      // Check for duplicate agent name
      const existingAgent = db.prepare(
        "SELECT id FROM agents WHERE user_id = ? AND LOWER(name) = LOWER(?)"
      ).get(req.user!.userId, body.name);
      if (existingAgent) {
        res.status(400).json({ error: "An agent with this name already exists. Please choose a unique name." });
        return;
      }

      const agent = createAgent(db, {
        userId: req.user!.userId,
        name: body.name,
        description: body.description,
        systemPrompt: body.systemPrompt,
        modelProvider: body.modelProvider,
        modelName: body.modelName,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        skills: body.skills,
        config: body.config,
      });

      agentRegistry.invalidateCache();
      res.status(201).json({ ...agent, skills: JSON.parse(agent.skills), config: JSON.parse(agent.config) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to create agent" });
    }
  });

  router.patch("/agents/:id", authMiddleware, (req, res) => {
    const agentId = String(req.params.id);
    const agent = findAgentById(db, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (agent.is_builtin && req.user!.role !== "admin") {
      res.status(403).json({ error: "Cannot modify built-in agents" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    // Check for duplicate name if updating name
    if (body.name !== undefined && body.name !== agent.name) {
      const existingAgent = db.prepare(
        "SELECT id FROM agents WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id != ?"
      ).get(agent.user_id, body.name, agentId);
      if (existingAgent) {
        res.status(400).json({ error: "An agent with this name already exists. Please choose a unique name." });
        return;
      }
      updates.name = body.name;
    } else if (body.name !== undefined) {
      updates.name = body.name;
    }
    if (body.description !== undefined) updates.description = body.description;
    if (body.system_prompt !== undefined) updates.system_prompt = body.system_prompt;
    if (body.systemPrompt !== undefined) updates.system_prompt = body.systemPrompt;
    if (body.model_provider !== undefined) updates.model_provider = body.model_provider;
    if (body.modelProvider !== undefined) updates.model_provider = body.modelProvider;
    if (body.model_name !== undefined) updates.model_name = body.model_name;
    if (body.modelName !== undefined) updates.model_name = body.modelName;
    if (body.temperature !== undefined) updates.temperature = body.temperature;
    if (body.max_tokens !== undefined) updates.max_tokens = body.max_tokens;
    if (body.maxTokens !== undefined) updates.max_tokens = body.maxTokens;
    if (body.skills !== undefined) updates.skills = JSON.stringify(body.skills);
    if (body.config !== undefined) updates.config = JSON.stringify(body.config);

    updateAgent(db, agentId, updates as any);
    agentRegistry.invalidateCache();

    const updated = findAgentById(db, agentId)!;
    res.json({ ...updated, skills: JSON.parse(updated.skills), config: JSON.parse(updated.config) });
  });

  router.delete("/agents/:id", authMiddleware, (req, res) => {
    const agentId = String(req.params.id);
    const agent = findAgentById(db, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (agent.is_builtin) {
      res.status(400).json({ error: "Cannot delete built-in agents" });
      return;
    }

    deleteAgent(db, agentId);
    agentRegistry.invalidateCache();
    res.json({ ok: true });
  });

  router.get("/providers", authMiddleware, (_req, res) => {
    const providers = getAvailableProviders();
    const result = providers.map((p) => ({
      ...p,
      models: getDefaultModels(p.name),
    }));
    res.json({ providers: result });
  });

  router.get("/providers/:name/models", authMiddleware, (req, res) => {
    const name = String(req.params.name) as ProviderName;
    const models = getDefaultModels(name);
    res.json({ provider: name, models });
  });

  // Direct agent chat — runs agent pipeline without a bot
  router.post("/agents/:id/chat", authMiddleware, async (req, res) => {
    try {
      const agentId = String(req.params.id);
      const agent = agentRegistry.getAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      const { message } = req.body as { message?: string };
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      const userId = req.user!.userId;

      // Resolve API key with fallback
      let provider = agent.model_provider as ProviderName;
      let model = agent.model_name;
      let apiKey = resolveApiKeyForUser(db, userId, provider);

      if (!apiKey && provider !== "ollama") {
        const fallback = findFallbackProviderForUser(db, userId, provider);
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
        botId: null,
        chatId: `agent-chat-${userId}-${agentId}`,
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
        model: result.model,
        provider,
        usage: result.usage,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Agent chat failed" });
    }
  });

  return router;
}
