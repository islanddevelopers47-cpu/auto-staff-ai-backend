import { Router } from "express";
import type Database from "better-sqlite3";
import type { AgentRegistry } from "../../agents/agent-registry.js";
import { authMiddleware } from "../../auth/middleware.js";
import { createLogger } from "../../utils/logger.js";
import {
  createTask,
  getTaskWithAssignments,
  listTasks,
  updateTask,
  deleteTask,
  addAssignment,
  removeAssignment,
  updateAssignment,
} from "../../database/agent-tasks.js";
import { runAgent } from "../../agents/agent-runner.js";
import {
  resolveApiKeyForUser,
  findFallbackProviderForUser,
  type ProviderName,
} from "../../agents/model-providers.js";

const log = createLogger("agent-tasks-api");

export function createAgentTasksRouter(
  db: Database.Database,
  agentRegistry: AgentRegistry
): Router {
  const router = Router();

  // List tasks
  router.get("/tasks", authMiddleware, (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const tasks = listTasks(db, req.user!.userId, status);
    // Enrich assignments with agent names
    const enriched = tasks.map((t) => ({
      ...t,
      integrations: JSON.parse(t.integrations),
      assignments: t.assignments.map((a) => {
        const agent = agentRegistry.getAgent(a.agent_id);
        return { ...a, agent_name: agent?.name || "Unknown Agent" };
      }),
    }));
    res.json({ tasks: enriched });
  });

  // Get single task
  router.get("/tasks/:id", authMiddleware, (req, res) => {
    const task = getTaskWithAssignments(db, String(req.params.id));
    if (!task || task.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const enriched = {
      ...task,
      integrations: JSON.parse(task.integrations),
      assignments: task.assignments.map((a) => {
        const agent = agentRegistry.getAgent(a.agent_id);
        return { ...a, agent_name: agent?.name || "Unknown Agent" };
      }),
    };
    res.json(enriched);
  });

  // Create task
  router.post("/tasks", authMiddleware, (req, res) => {
    try {
      const { title, description, priority, integrations, agentIds } = req.body as {
        title: string;
        description?: string;
        priority?: string;
        integrations?: string[];
        agentIds?: string[];
      };
      if (!title) {
        res.status(400).json({ error: "title is required" });
        return;
      }
      const task = createTask(db, {
        userId: req.user!.userId,
        title,
        description,
        priority,
        integrations,
        agentIds,
      });
      res.status(201).json({
        ...task,
        integrations: JSON.parse(task.integrations),
        assignments: task.assignments.map((a) => {
          const agent = agentRegistry.getAgent(a.agent_id);
          return { ...a, agent_name: agent?.name || "Unknown Agent" };
        }),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update task
  router.patch("/tasks/:id", authMiddleware, (req, res) => {
    const task = getTaskWithAssignments(db, String(req.params.id));
    if (!task || task.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) updates.status = body.status;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.integrations !== undefined) updates.integrations = JSON.stringify(body.integrations);
    if (body.result !== undefined) updates.result = body.result;

    updateTask(db, task.id, updates as any);
    const updated = getTaskWithAssignments(db, task.id)!;
    res.json({
      ...updated,
      integrations: JSON.parse(updated.integrations),
      assignments: updated.assignments.map((a) => {
        const agent = agentRegistry.getAgent(a.agent_id);
        return { ...a, agent_name: agent?.name || "Unknown Agent" };
      }),
    });
  });

  // Delete task
  router.delete("/tasks/:id", authMiddleware, (req, res) => {
    const task = getTaskWithAssignments(db, String(req.params.id));
    if (!task || task.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    deleteTask(db, task.id);
    res.json({ ok: true });
  });

  // Add agent to task
  router.post("/tasks/:id/agents", authMiddleware, (req, res) => {
    const task = getTaskWithAssignments(db, String(req.params.id));
    if (!task || task.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const { agentId, role } = req.body as { agentId: string; role?: string };
    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }
    const assignment = addAssignment(db, task.id, agentId, role || "worker");
    const agent = agentRegistry.getAgent(agentId);
    res.status(201).json({ ...assignment, agent_name: agent?.name || "Unknown Agent" });
  });

  // Remove agent from task
  router.delete("/tasks/:id/agents/:assignmentId", authMiddleware, (req, res) => {
    const task = getTaskWithAssignments(db, String(req.params.id));
    if (!task || task.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    removeAssignment(db, String(req.params.assignmentId));
    res.json({ ok: true });
  });

  // Run task — execute all assigned agents sequentially
  router.post("/tasks/:id/run", authMiddleware, async (req, res) => {
    const task = getTaskWithAssignments(db, String(req.params.id));
    if (!task || task.user_id !== req.user!.userId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!task.assignments.length) {
      res.status(400).json({ error: "No agents assigned to this task" });
      return;
    }

    const userId = req.user!.userId;

    // Mark task as running
    updateTask(db, task.id, { status: "running", started_at: new Date().toISOString() });

    // Build the task prompt with integration context
    const integrationsUsed = JSON.parse(task.integrations) as string[];
    let taskPrompt = task.title;
    if (task.description) taskPrompt += `\n\nDetails: ${task.description}`;
    if (integrationsUsed.length) {
      taskPrompt += `\n\nYou have access to these integrations for this task: ${integrationsUsed.join(", ")}. Use the appropriate tools.`;
    }

    const results: Array<{ agentId: string; agentName: string; status: string; output: string }> = [];
    let allSuccess = true;

    for (const assignment of task.assignments) {
      const agent = agentRegistry.getAgent(assignment.agent_id);
      if (!agent) {
        updateAssignment(db, assignment.id, { status: "failed", output: "Agent not found" });
        results.push({ agentId: assignment.agent_id, agentName: "Unknown", status: "failed", output: "Agent not found" });
        allSuccess = false;
        continue;
      }

      updateAssignment(db, assignment.id, { status: "running", started_at: new Date().toISOString() });

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
            const errMsg = `No API key for ${provider}`;
            updateAssignment(db, assignment.id, {
              status: "failed",
              output: errMsg,
              completed_at: new Date().toISOString(),
            });
            results.push({ agentId: agent.id, agentName: agent.name, status: "failed", output: errMsg });
            allSuccess = false;
            continue;
          }
        }

        // Include previous agents' outputs as context
        let contextMessage = taskPrompt;
        if (results.length > 0) {
          contextMessage += "\n\n--- Previous agents' outputs ---\n";
          for (const r of results) {
            contextMessage += `\n[${r.agentName}]: ${r.output.slice(0, 2000)}\n`;
          }
          contextMessage += "\n--- End of previous outputs ---\nContinue the task based on the above.";
        }

        const result = await runAgent(db, agent, {
          botId: null,
          chatId: `task-${task.id}-${agent.id}`,
          chatType: "private",
          userMessage: contextMessage,
          senderName: userId,
          apiKeyOverride: apiKey,
          providerOverride: provider,
          modelOverride: model,
          userId,
        });

        updateAssignment(db, assignment.id, {
          status: "completed",
          output: result.response,
          completed_at: new Date().toISOString(),
        });
        results.push({ agentId: agent.id, agentName: agent.name, status: "completed", output: result.response });
      } catch (err: any) {
        const errMsg = err?.message || "Unknown error";
        updateAssignment(db, assignment.id, {
          status: "failed",
          output: errMsg,
          completed_at: new Date().toISOString(),
        });
        results.push({ agentId: agent.id, agentName: agent.name, status: "failed", output: errMsg });
        allSuccess = false;
      }
    }

    // Compile final result
    const finalResult = results
      .map((r) => `## ${r.agentName} (${r.status})\n${r.output}`)
      .join("\n\n---\n\n");

    updateTask(db, task.id, {
      status: allSuccess ? "completed" : "failed",
      result: finalResult,
      completed_at: new Date().toISOString(),
    });

    const final = getTaskWithAssignments(db, task.id)!;
    res.json({
      ...final,
      integrations: JSON.parse(final.integrations),
      assignments: final.assignments.map((a) => {
        const ag = agentRegistry.getAgent(a.agent_id);
        return { ...a, agent_name: ag?.name || "Unknown Agent" };
      }),
    });
  });

  return router;
}
