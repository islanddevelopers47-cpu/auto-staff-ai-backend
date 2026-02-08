import { Router } from "express";
import type Database from "better-sqlite3";
import type { AgentRegistry } from "../../agents/agent-registry.js";
import { createAgent, findAgentById, updateAgent, deleteAgent } from "../../database/agents.js";
import { getAvailableProviders, getDefaultModels, type ProviderName } from "../../agents/model-providers.js";
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

    if (body.name !== undefined) updates.name = body.name;
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

  return router;
}
