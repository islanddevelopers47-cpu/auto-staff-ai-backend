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

  // Proxy Firebase auth handler through localhost to avoid cross-domain storage partitioning
  app.all("/__/auth/{*path}", async (req, res) => {
    try {
      const targetUrl = `https://auto-staff-ai.firebaseapp.com${req.originalUrl}`;
      const fetchHeaders: Record<string, string> = {};
      for (const [key, val] of Object.entries(req.headers)) {
        if (typeof val === "string" && key !== "host") fetchHeaders[key] = val;
      }
      const fetchOpts: RequestInit = {
        method: req.method,
        headers: fetchHeaders,
        redirect: "manual",
      };
      if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
        fetchOpts.body = JSON.stringify(req.body);
      }
      const upstream = await fetch(targetUrl, fetchOpts);
      // Forward status and headers
      res.status(upstream.status);
      upstream.headers.forEach((val, key) => {
        if (!["transfer-encoding", "content-encoding", "connection"].includes(key.toLowerCase())) {
          res.setHeader(key, val);
        }
      });
      const body = await upstream.arrayBuffer();
      res.end(Buffer.from(body));
    } catch (err: any) {
      log.error(`Firebase auth proxy error: ${err.message}`);
      res.status(502).send("Auth proxy error");
    }
  });

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
