import { Router } from "express";
import type Database from "better-sqlite3";
import {
  setApiKey,
  getApiKeysForUser,
  deleteApiKey,
} from "../../database/api-keys.js";
import { authMiddleware } from "../../auth/middleware.js";

export function createApiKeysRouter(db: Database.Database): Router {
  const router = Router();

  // List current user's API keys (masked)
  router.get("/api-keys", authMiddleware, (req, res) => {
    const userId = (req as any).user?.userId as string;
    const keys = getApiKeysForUser(db, userId);
    res.json({ keys });
  });

  // Add or update an API key
  router.post("/api-keys", authMiddleware, (req, res) => {
    const userId = (req as any).user?.userId as string;
    const { provider, apiKey, label } = req.body;

    if (!provider || typeof provider !== "string") {
      res.status(400).json({ error: "provider is required" });
      return;
    }
    const validProviders = ["openai", "anthropic", "google", "grok", "ollama"];

    // Ollama doesn't need an API key — it stores the base URL instead
    if (provider.toLowerCase() !== "ollama" && (!apiKey || typeof apiKey !== "string")) {
      res.status(400).json({ error: "apiKey is required" });
      return;
    }
    if (!validProviders.includes(provider.toLowerCase())) {
      res.status(400).json({
        error: `Invalid provider. Must be one of: ${validProviders.join(", ")}`,
      });
      return;
    }

    const result = setApiKey(db, userId, provider, apiKey.trim(), label);
    res.json({ ok: true, key: result });
  });

  // Delete an API key
  router.delete("/api-keys/:id", authMiddleware, (req, res) => {
    const userId = (req as any).user?.userId as string;
    const keyId = String(req.params.id);
    const deleted = deleteApiKey(db, keyId, userId);
    if (!deleted) {
      res.status(404).json({ error: "API key not found" });
      return;
    }
    res.json({ ok: true });
  });

  // Test an API key by making a lightweight call to the provider
  router.post("/api-keys/test", authMiddleware, async (req, res) => {
    const { provider, apiKey } = req.body;

    if (!provider) {
      res.status(400).json({ error: "provider is required" });
      return;
    }

    // Ollama doesn't need an API key
    if (provider.toLowerCase() !== "ollama" && !apiKey) {
      res.status(400).json({ error: "apiKey is required" });
      return;
    }

    try {
      const valid = await testProviderKey(provider.toLowerCase(), apiKey?.trim() ?? "");
      res.json({ valid, provider });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.json({ valid: false, provider, error: msg });
    }
  });

  return router;
}

async function testProviderKey(provider: string, apiKey: string): Promise<boolean> {
  switch (provider) {
    case "openai": {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    }
    case "anthropic": {
      // Anthropic doesn't have a lightweight models endpoint, so we send a minimal message
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      // 200 or 400 (bad request but authenticated) both mean the key is valid
      return res.status !== 401 && res.status !== 403;
    }
    case "google": {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      return res.ok;
    }
    case "grok": {
      const res = await fetch("https://api.x.ai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    }
    case "ollama": {
      // Ollama runs locally — just ping the tags endpoint
      const baseUrl = apiKey || "http://localhost:11434";
      const res = await fetch(`${baseUrl}/api/tags`);
      return res.ok;
    }
    default:
      return false;
  }
}
