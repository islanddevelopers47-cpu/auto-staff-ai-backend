import type Database from "better-sqlite3";
import { generateId } from "../utils/crypto.js";

export interface AgentTask {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  integrations: string; // JSON array of integration names
  result: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskAssignment {
  id: string;
  task_id: string;
  agent_id: string;
  role: string;
  status: "pending" | "running" | "completed" | "failed";
  output: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AgentTaskWithAssignments extends AgentTask {
  assignments: TaskAssignment[];
}

// --- Tasks ---

export function createTask(
  db: Database.Database,
  opts: {
    userId: string;
    title: string;
    description?: string;
    priority?: string;
    integrations?: string[];
    agentIds?: string[];
  }
): AgentTaskWithAssignments {
  const id = generateId();
  db.prepare(
    `INSERT INTO agent_tasks (id, user_id, title, description, priority, integrations)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.userId,
    opts.title,
    opts.description ?? null,
    opts.priority ?? "medium",
    JSON.stringify(opts.integrations ?? [])
  );

  // Create assignments
  if (opts.agentIds?.length) {
    const stmt = db.prepare(
      `INSERT INTO agent_task_assignments (id, task_id, agent_id, role) VALUES (?, ?, ?, ?)`
    );
    for (const agentId of opts.agentIds) {
      stmt.run(generateId(), id, agentId, "worker");
    }
  }

  return getTaskWithAssignments(db, id)!;
}

export function getTask(db: Database.Database, id: string): AgentTask | undefined {
  return db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(id) as AgentTask | undefined;
}

export function getTaskWithAssignments(
  db: Database.Database,
  id: string
): AgentTaskWithAssignments | undefined {
  const task = getTask(db, id);
  if (!task) return undefined;
  const assignments = db
    .prepare("SELECT * FROM agent_task_assignments WHERE task_id = ? ORDER BY created_at")
    .all(id) as TaskAssignment[];
  return { ...task, assignments };
}

export function listTasks(
  db: Database.Database,
  userId: string,
  status?: string
): AgentTaskWithAssignments[] {
  let sql = "SELECT * FROM agent_tasks WHERE user_id = ?";
  const params: unknown[] = [userId];
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC";
  const tasks = db.prepare(sql).all(...params) as AgentTask[];
  return tasks.map((t) => {
    const assignments = db
      .prepare("SELECT * FROM agent_task_assignments WHERE task_id = ? ORDER BY created_at")
      .all(t.id) as TaskAssignment[];
    return { ...t, assignments };
  });
}

export function updateTask(
  db: Database.Database,
  id: string,
  updates: Partial<{
    title: string;
    description: string | null;
    status: string;
    priority: string;
    integrations: string;
    result: string | null;
    started_at: string | null;
    completed_at: string | null;
  }>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE agent_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteTask(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM agent_tasks WHERE id = ?").run(id);
}

// --- Assignments ---

export function addAssignment(
  db: Database.Database,
  taskId: string,
  agentId: string,
  role: string = "worker"
): TaskAssignment {
  const id = generateId();
  db.prepare(
    `INSERT INTO agent_task_assignments (id, task_id, agent_id, role) VALUES (?, ?, ?, ?)`
  ).run(id, taskId, agentId, role);
  return db.prepare("SELECT * FROM agent_task_assignments WHERE id = ?").get(id) as TaskAssignment;
}

export function removeAssignment(db: Database.Database, assignmentId: string): void {
  db.prepare("DELETE FROM agent_task_assignments WHERE id = ?").run(assignmentId);
}

export function updateAssignment(
  db: Database.Database,
  assignmentId: string,
  updates: Partial<{
    status: string;
    output: string | null;
    started_at: string | null;
    completed_at: string | null;
  }>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  values.push(assignmentId);
  db.prepare(`UPDATE agent_task_assignments SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}
