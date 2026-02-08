import { Router } from "express";
import type Database from "better-sqlite3";
import { getSessionHistory, clearSessionHistory, listSessions } from "../../database/sessions.js";
import { authMiddleware } from "../../auth/middleware.js";

export function createSessionsRouter(db: Database.Database): Router {
  const router = Router();

  router.get("/sessions/:sessionId/messages", authMiddleware, (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = getSessionHistory(db, String(req.params.sessionId), limit);
    res.json({ messages });
  });

  router.delete("/sessions/:sessionId/messages", authMiddleware, (req, res) => {
    clearSessionHistory(db, String(req.params.sessionId));
    res.json({ ok: true });
  });

  return router;
}
