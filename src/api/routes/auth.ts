import { Router } from "express";
import type Database from "better-sqlite3";
import { authenticateUser, createUser, findUserById } from "../../database/users.js";
import { signJwt } from "../../utils/crypto.js";
import { authMiddleware } from "../../auth/middleware.js";

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  router.post("/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        res.status(400).json({ error: "Username and password are required" });
        return;
      }

      const user = await authenticateUser(db, username, password);
      if (!user) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const token = signJwt({ userId: user.id, role: user.role });
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          displayName: user.display_name,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  router.post("/auth/register", async (req, res) => {
    try {
      const { username, password, displayName } = req.body as {
        username?: string;
        password?: string;
        displayName?: string;
      };

      if (!username || !password) {
        res.status(400).json({ error: "Username and password are required" });
        return;
      }
      if (password.length < 4) {
        res.status(400).json({ error: "Password must be at least 4 characters" });
        return;
      }

      const user = await createUser(db, { username, password, displayName });
      const token = signJwt({ userId: user.id, role: user.role });

      res.status(201).json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          displayName: user.display_name,
        },
      });
    } catch (err: any) {
      if (err?.message?.includes("UNIQUE constraint")) {
        res.status(409).json({ error: "Username already exists" });
        return;
      }
      res.status(500).json({ error: "Registration failed" });
    }
  });

  router.get("/auth/me", authMiddleware, (req, res) => {
    const user = findUserById(db, req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
    });
  });

  return router;
}
