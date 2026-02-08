import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { EventBus, EventType, EventPayload } from "./events.js";
import { verifyJwt } from "../utils/crypto.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("ws-server");

export function attachWebSocketServer(
  httpServer: Server,
  eventBus: EventBus
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    // Authenticate via query param token
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Missing token");
      return;
    }

    const payload = verifyJwt(token);
    if (!payload) {
      ws.close(4001, "Invalid token");
      return;
    }

    log.info(`WebSocket client connected: ${payload.userId}`);

    // Send welcome message
    sendJson(ws, {
      type: "connected",
      userId: payload.userId,
      role: payload.role,
    });

    // Forward events to this client
    const handler = (event: EventType, data: EventPayload) => {
      if (ws.readyState === WebSocket.OPEN) {
        sendJson(ws, { type: "event", event, data });
      }
    };
    eventBus.onAny(handler);

    ws.on("close", () => {
      log.info(`WebSocket client disconnected: ${payload.userId}`);
      eventBus.removeListener("bot:started", () => {});
    });

    ws.on("error", (err) => {
      log.error(`WebSocket error: ${err.message}`);
    });
  });

  log.info("WebSocket server attached at /ws");
  return wss;
}

function sendJson(ws: WebSocket, data: unknown): void {
  try {
    ws.send(JSON.stringify(data));
  } catch {
    // ignore
  }
}
