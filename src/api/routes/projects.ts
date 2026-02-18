import { Router } from "express";
import type Database from "better-sqlite3";
import type { AgentRegistry } from "../../agents/agent-registry.js";
import { authMiddleware } from "../../auth/middleware.js";
import { createLogger } from "../../utils/logger.js";
import {
  createProject,
  getProjectWithDetails,
  listProjects,
  updateProject,
  deleteProject,
  addAgentToProject,
  removeAgentFromProject,
  addMessage,
} from "../../database/projects.js";
import { runAgent } from "../../agents/agent-runner.js";
import {
  resolveApiKeyForUser,
  findFallbackProviderForUser,
  type ProviderName,
} from "../../agents/model-providers.js";

const log = createLogger("projects-api");

export function createProjectsRouter(
  db: Database.Database,
  agentRegistry: AgentRegistry
): Router {
  const router = Router();

  // List projects
  router.get("/projects", authMiddleware, (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const projects = listProjects(db, req.user!.userId, status);
    
    // Enrich with agent names
    const enriched = projects.map((p) => ({
      ...p,
      integrations: JSON.parse(p.integrations),
      agents: p.agents.map((a) => {
        const agent = agentRegistry.getAgent(a.agent_id);
        return { ...a, name: agent?.name || "Unknown Agent" };
      }),
    }));
    
    res.json({ projects: enriched });
  });

  // Get single project
  router.get("/projects/:id", authMiddleware, (req, res) => {
    const project = getProjectWithDetails(db, String(req.params.id));
    if (!project || project.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    
    const enriched = {
      ...project,
      integrations: JSON.parse(project.integrations),
      agents: project.agents.map((a) => {
        const agent = agentRegistry.getAgent(a.agent_id);
        return { ...a, name: agent?.name || "Unknown Agent" };
      }),
      messages: project.messages.map((m) => {
        if (m.agent_id) {
          const agent = agentRegistry.getAgent(m.agent_id);
          return { ...m, agent_name: agent?.name || "Unknown Agent" };
        }
        return m;
      }),
    };
    
    res.json(enriched);
  });

  // Create project
  router.post("/projects", authMiddleware, (req, res) => {
    try {
      const { title, integrations, agentIds } = req.body as {
        title: string;
        integrations?: string[];
        agentIds?: string[];
      };
      
      if (!title) {
        res.status(400).json({ error: "title is required" });
        return;
      }
      
      const project = createProject(db, {
        userId: req.user!.userId,
        title,
        integrations,
        agentIds,
      });
      
      res.status(201).json({
        ...project,
        integrations: JSON.parse(project.integrations),
        agents: project.agents.map((a) => {
          const agent = agentRegistry.getAgent(a.agent_id);
          return { ...a, name: agent?.name || "Unknown Agent" };
        }),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update project
  router.patch("/projects/:id", authMiddleware, (req, res) => {
    const project = getProjectWithDetails(db, String(req.params.id));
    if (!project || project.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    
    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    
    if (body.title !== undefined) updates.title = body.title;
    if (body.status !== undefined) updates.status = body.status;
    if (body.integrations !== undefined) updates.integrations = JSON.stringify(body.integrations);
    
    updateProject(db, project.id, updates as any);
    
    const updated = getProjectWithDetails(db, project.id)!;
    res.json({
      ...updated,
      integrations: JSON.parse(updated.integrations),
      agents: updated.agents.map((a) => {
        const agent = agentRegistry.getAgent(a.agent_id);
        return { ...a, name: agent?.name || "Unknown Agent" };
      }),
    });
  });

  // Delete project
  router.delete("/projects/:id", authMiddleware, (req, res) => {
    const project = getProjectWithDetails(db, String(req.params.id));
    if (!project || project.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    deleteProject(db, project.id);
    res.json({ ok: true });
  });

  // Add agent to project
  router.post("/projects/:id/agents", authMiddleware, (req, res) => {
    const project = getProjectWithDetails(db, String(req.params.id));
    if (!project || project.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    
    const { agentId } = req.body as { agentId: string };
    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }
    
    addAgentToProject(db, project.id, agentId);
    const updated = getProjectWithDetails(db, project.id)!;
    
    res.status(201).json({
      agents: updated.agents.map((a) => {
        const agent = agentRegistry.getAgent(a.agent_id);
        return { ...a, name: agent?.name || "Unknown Agent" };
      }),
    });
  });

  // Remove agent from project
  router.delete("/projects/:id/agents/:agentId", authMiddleware, (req, res) => {
    const project = getProjectWithDetails(db, String(req.params.id));
    if (!project || project.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    
    removeAgentFromProject(db, project.id, String(req.params.agentId));
    res.json({ ok: true });
  });

  // Send message to project (chat with agents)
  router.post("/projects/:id/messages", authMiddleware, async (req, res) => {
    const project = getProjectWithDetails(db, String(req.params.id));
    if (!project || project.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    
    const { content, targetAgentId, mentions } = req.body as {
      content: string;
      targetAgentId?: string | null;
      mentions?: string[];
    };
    
    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    
    const userId = req.user!.userId;
    
    // Save user message
    const userMessage = addMessage(db, {
      projectId: project.id,
      agentId: null,
      role: "user",
      content,
    });
    
    // Determine which agents to respond
    let agentsToRun: Array<{ id: string; agent_id: string; name?: string }> = [];
    
    if (targetAgentId) {
      // Specific agent selected in sidebar
      const targetAgent = project.agents.find((a) => a.agent_id === targetAgentId);
      if (targetAgent) agentsToRun = [targetAgent];
    } else if (mentions && mentions.length > 0) {
      // @mentions in message
      agentsToRun = project.agents.filter((a) => {
        const agent = agentRegistry.getAgent(a.agent_id);
        if (!agent) return false;
        const nameLower = agent.name.toLowerCase().replace(/\s+/g, "");
        return mentions.some((m) => nameLower.includes(m.toLowerCase()));
      });
    }
    
    // If no specific agents targeted, use all agents
    if (agentsToRun.length === 0) {
      agentsToRun = project.agents;
    }
    
    const responseMessages: any[] = [];
    const integrationsUsed = JSON.parse(project.integrations) as string[];
    
    // Build context from recent messages
    const recentMessages = project.messages.slice(-20);
    let context = recentMessages
      .map((m) => {
        if (m.role === "user") return `User: ${m.content}`;
        const agentName = m.agent_id
          ? agentRegistry.getAgent(m.agent_id)?.name || "Agent"
          : "Agent";
        return `${agentName}: ${m.content}`;
      })
      .join("\n\n");
    
    context += `\n\nUser: ${content}`;
    
    if (integrationsUsed.length) {
      context += `\n\n[You have access to these integrations: ${integrationsUsed.join(", ")}]`;
    }
    
    for (const projectAgent of agentsToRun) {
      const agent = agentRegistry.getAgent(projectAgent.agent_id);
      if (!agent) continue;
      
      try {
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
            // Skip this agent if no API key
            continue;
          }
        }
        
        const result = await runAgent(db, agent, {
          botId: null,
          chatId: `project-${project.id}`,
          chatType: "private",
          userMessage: context,
          senderName: userId,
          apiKeyOverride: apiKey,
          providerOverride: provider,
          modelOverride: model,
          userId,
        });
        
        // Save agent response
        const agentMsg = addMessage(db, {
          projectId: project.id,
          agentId: agent.id,
          role: "assistant",
          content: result.response,
        });
        
        responseMessages.push({
          ...agentMsg,
          agent_name: agent.name,
        });
      } catch (err: any) {
        log.error(`Agent ${agent.name} failed:`, err);
        // Save error message
        const errorMsg = addMessage(db, {
          projectId: project.id,
          agentId: agent.id,
          role: "assistant",
          content: `[Error: ${err.message || "Failed to generate response"}]`,
        });
        responseMessages.push({
          ...errorMsg,
          agent_name: agent.name,
        });
      }
    }
    
    res.json({
      userMessage: { ...userMessage, role: "user" },
      messages: responseMessages,
    });
  });

  return router;
}
