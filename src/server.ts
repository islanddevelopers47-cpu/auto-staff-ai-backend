import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import path from "node:path";
import type Database from "better-sqlite3";
import type { BotManager } from "./telegram/bot-manager.js";
import type { AgentRegistry } from "./agents/agent-registry.js";
import { registerRoutes } from "./api/routes/index.js";
import { EventBus } from "./gateway/events.js";
import { attachWebSocketServer } from "./gateway/ws-server.js";
import { getPort, getHost, isDev } from "./config/env.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("server");

export async function startServer(
  db: Database.Database,
  botManager: BotManager,
  agentRegistry: AgentRegistry
): Promise<{ port: number; eventBus: EventBus }> {
  const app = express();
  const httpServer = createServer(app);

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging in dev
  if (isDev()) {
    app.use((req, _res, next) => {
      log.debug(`${req.method} ${req.url}`);
      next();
    });
  }

  // Event bus
  const eventBus = new EventBus();
  botManager.setEventBus(eventBus);

  // WebSocket server
  attachWebSocketServer(httpServer, eventBus);

  // API routes
  registerRoutes(app, db, botManager, agentRegistry);

  // Serve static test UI
  const publicDir = path.resolve(process.cwd(), "public");
  app.use(express.static(publicDir));

  // SPA fallback — serve index.html for non-API routes
  app.get("/{*path}", (req, res) => {
    if (req.url.startsWith("/api/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(path.join(publicDir, "index.html"));
  });

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    log.error("Unhandled error:", err);
    const statusCode = err.statusCode ?? 500;
    res.status(statusCode).json({
      error: err.message ?? "Internal server error",
    });
  });

  // Start listening
  const port = getPort();
  const host = getHost();

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      resolve({ port, eventBus });
    });
  });
}
