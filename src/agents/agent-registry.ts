import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  createAgent,
  findAgentById,
  findAgentByName,
  listAgents,
  countAgents,
  type Agent,
  type CreateAgentInput,
} from "../database/agents.js";
import { loadSkillsFromDir } from "./skills-loader.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("agent-registry");

export class AgentRegistry {
  private db: Database.Database;
  private agentCache: Map<string, Agent> = new Map();

  constructor(db: Database.Database) {
    this.db = db;
  }

  async loadAgents(): Promise<void> {
    // Load skills from the skills directory
    const skills = loadSkillsFromDir();
    log.info(`Loaded ${skills.length} skills`);

    // Load built-in agents from JSON files
    await this.loadBuiltinAgents();

    // Refresh cache
    this.refreshCache();
  }

  private async loadBuiltinAgents(): Promise<void> {
    const agentsDir = path.resolve(process.cwd(), "agents");

    // Collect names of built-in agents that still have a JSON definition
    const validNames = new Set<string>();
    if (fs.existsSync(agentsDir)) {
      const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const filePath = path.join(agentsDir, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          const def = JSON.parse(raw) as CreateAgentInput & { id?: string };
          validNames.add(def.name);

          // Create only if not already present
          const existing = findAgentByName(this.db, def.name);
          if (!existing?.is_builtin) {
            createAgent(this.db, { ...def, isBuiltin: true });
            log.info(`Loaded built-in agent: ${def.name}`);
          }
        } catch (err) {
          log.warn(`Failed to load agent from ${file}: ${err}`);
        }
      }
    }

    // Remove any built-in agents from DB whose JSON file no longer exists
    const existing = this.db
      .prepare("SELECT id, name FROM agents WHERE is_builtin = 1")
      .all() as { id: string; name: string }[];
    for (const agent of existing) {
      if (!validNames.has(agent.name)) {
        this.db.prepare("DELETE FROM agents WHERE id = ?").run(agent.id);
        log.info(`Removed built-in agent no longer in agents dir: ${agent.name}`);
      }
    }
  }

  private refreshCache(): void {
    this.agentCache.clear();
    const agents = listAgents(this.db);
    for (const agent of agents) {
      this.agentCache.set(agent.id, agent);
    }
  }

  getAgent(id: string): Agent | undefined {
    // Check cache first
    const cached = this.agentCache.get(id);
    if (cached) return cached;

    // Fall back to DB
    const agent = findAgentById(this.db, id);
    if (agent) {
      this.agentCache.set(agent.id, agent);
    }
    return agent;
  }

  getDefaultAgent(): Agent | undefined {
    // Return the first built-in agent, or the first agent
    const agents = listAgents(this.db);
    return agents.find((a) => a.is_builtin) ?? agents[0];
  }

  getAllAgents(): Agent[] {
    return listAgents(this.db);
  }

  count(): number {
    return countAgents(this.db);
  }

  invalidateCache(): void {
    this.agentCache.clear();
  }
}
