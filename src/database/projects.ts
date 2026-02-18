import type Database from "better-sqlite3";
import { generateId } from "../utils/crypto.js";

export interface Project {
  id: string;
  user_id: string;
  title: string;
  status: "active" | "completed" | "archived";
  integrations: string; // JSON array of integration names
  created_at: string;
  updated_at: string;
}

export interface ProjectAgent {
  id: string;
  project_id: string;
  agent_id: string;
  added_at: string;
}

export interface ProjectMessage {
  id: string;
  project_id: string;
  agent_id: string | null; // null for user messages
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ProjectWithDetails extends Project {
  agents: Array<{ id: string; agent_id: string; name?: string }>;
  messages: ProjectMessage[];
  message_count: number;
}

// --- Projects ---

export function createProject(
  db: Database.Database,
  opts: {
    userId: string;
    title: string;
    integrations?: string[];
    agentIds?: string[];
  }
): ProjectWithDetails {
  const id = generateId();
  db.prepare(
    `INSERT INTO projects (id, user_id, title, status, integrations)
     VALUES (?, ?, ?, 'active', ?)`
  ).run(id, opts.userId, opts.title, JSON.stringify(opts.integrations ?? []));

  // Add agents
  if (opts.agentIds?.length) {
    const stmt = db.prepare(
      `INSERT INTO project_agents (id, project_id, agent_id) VALUES (?, ?, ?)`
    );
    for (const agentId of opts.agentIds) {
      stmt.run(generateId(), id, agentId);
    }
  }

  return getProjectWithDetails(db, id)!;
}

export function getProject(db: Database.Database, id: string): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
}

export function getProjectWithDetails(
  db: Database.Database,
  id: string
): ProjectWithDetails | undefined {
  const project = getProject(db, id);
  if (!project) return undefined;

  const agents = db
    .prepare("SELECT id, agent_id FROM project_agents WHERE project_id = ? ORDER BY added_at")
    .all(id) as Array<{ id: string; agent_id: string }>;

  const messages = db
    .prepare("SELECT * FROM project_messages WHERE project_id = ? ORDER BY created_at")
    .all(id) as ProjectMessage[];

  return {
    ...project,
    agents,
    messages,
    message_count: messages.length,
  };
}

export function listProjects(
  db: Database.Database,
  userId: string,
  status?: string
): ProjectWithDetails[] {
  let query = "SELECT * FROM projects WHERE user_id = ?";
  const params: any[] = [userId];
  if (status) {
    query += " AND status = ?";
    params.push(status);
  }
  query += " ORDER BY updated_at DESC";

  const projects = db.prepare(query).all(...params) as Project[];

  return projects.map((p) => {
    const agents = db
      .prepare("SELECT id, agent_id FROM project_agents WHERE project_id = ?")
      .all(p.id) as Array<{ id: string; agent_id: string }>;

    const messageCount = db
      .prepare("SELECT COUNT(*) as count FROM project_messages WHERE project_id = ?")
      .get(p.id) as { count: number };

    return {
      ...p,
      agents,
      messages: [], // Don't load all messages for list view
      message_count: messageCount.count,
    };
  });
}

export function updateProject(
  db: Database.Database,
  id: string,
  updates: Partial<Pick<Project, "title" | "status" | "integrations">>
): void {
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    values.push(updates.title);
  }
  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.integrations !== undefined) {
    sets.push("integrations = ?");
    values.push(updates.integrations);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteProject(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM project_messages WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM project_agents WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

// --- Project Agents ---

export function addAgentToProject(
  db: Database.Database,
  projectId: string,
  agentId: string
): ProjectAgent {
  const id = generateId();
  db.prepare(
    `INSERT INTO project_agents (id, project_id, agent_id) VALUES (?, ?, ?)`
  ).run(id, projectId, agentId);

  return db.prepare("SELECT * FROM project_agents WHERE id = ?").get(id) as ProjectAgent;
}

export function removeAgentFromProject(
  db: Database.Database,
  projectId: string,
  agentId: string
): void {
  db.prepare(
    "DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?"
  ).run(projectId, agentId);
}

// --- Project Messages ---

export function addMessage(
  db: Database.Database,
  opts: {
    projectId: string;
    agentId: string | null;
    role: "user" | "assistant";
    content: string;
  }
): ProjectMessage {
  const id = generateId();
  db.prepare(
    `INSERT INTO project_messages (id, project_id, agent_id, role, content)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, opts.projectId, opts.agentId, opts.role, opts.content);

  // Update project's updated_at
  db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(opts.projectId);

  return db.prepare("SELECT * FROM project_messages WHERE id = ?").get(id) as ProjectMessage;
}

export function getProjectMessages(
  db: Database.Database,
  projectId: string,
  limit?: number
): ProjectMessage[] {
  let query = "SELECT * FROM project_messages WHERE project_id = ? ORDER BY created_at";
  if (limit) query += ` LIMIT ${limit}`;
  return db.prepare(query).all(projectId) as ProjectMessage[];
}
