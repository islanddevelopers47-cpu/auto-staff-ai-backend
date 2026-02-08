import process from "node:process";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./utils/logger.js";
import { startServer } from "./server.js";
import { initDatabase } from "./database/db.js";
import { ensureAdminUser } from "./database/users.js";
import { BotManager } from "./telegram/bot-manager.js";
import { AgentRegistry } from "./agents/agent-registry.js";

// Load environment variables first
loadEnv();

const log = createLogger("main");

async function main() {
  log.info("Starting Auto Staff AI...");

  // Initialize database
  const db = initDatabase();
  log.info("Database initialized");

  // Ensure admin user exists
  ensureAdminUser(db);
  log.info("Admin user verified");

  // Initialize agent registry
  const agentRegistry = new AgentRegistry(db);
  await agentRegistry.loadAgents();
  log.info(`Loaded ${agentRegistry.count()} agents`);

  // Initialize bot manager
  const botManager = new BotManager(db, agentRegistry);

  // Start the HTTP + WS server
  const { port } = await startServer(db, botManager, agentRegistry);
  log.info(`Server listening on port ${port}`);

  // Auto-start any enabled bots
  await botManager.autoStartBots();
  log.info("Bot manager ready");

  log.info("Auto Staff AI is running!");

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down...");
    await botManager.stopAll();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("Fatal error:", err);
  process.exit(1);
});
