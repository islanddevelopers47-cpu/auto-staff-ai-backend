import { Router } from "express";
import type Database from "better-sqlite3";
import { authenticateUser, createUser, findUserById, findUserByUsername, findUserByFirebaseUid, findUserByEmail, createFirebaseUser, updateFirebaseUser } from "../../database/users.js";
import { signJwt, verifyJwt, generateId } from "../../utils/crypto.js";
import { authMiddleware } from "../../auth/middleware.js";
import { verifyFirebaseToken, isFirebaseEnabled } from "../../auth/firebase.js";
import { resolveIntegrationCred } from "../../database/integration-config.js";
import { upsertConnectedAccount } from "../../database/connected-accounts.js";
import { getEnv } from "../../config/env.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("auth");

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  // Legacy local login (admin, existing local users)
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
          email: user.email,
          photoUrl: user.photo_url,
          authProvider: user.auth_provider,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Firebase token exchange — frontend sends Firebase ID token, backend returns local JWT
  router.post("/auth/firebase", async (req, res) => {
    try {
      if (!isFirebaseEnabled()) {
        res.status(503).json({ error: "Firebase authentication is not configured" });
        return;
      }

      const { idToken } = req.body as { idToken?: string };
      if (!idToken) {
        res.status(400).json({ error: "idToken is required" });
        return;
      }

      const fbUser = await verifyFirebaseToken(idToken);
      if (!fbUser) {
        res.status(401).json({ error: "Invalid Firebase token" });
        return;
      }

      // Find or create local user
      let user = findUserByFirebaseUid(db, fbUser.uid);

      if (!user) {
        user = createFirebaseUser(db, {
          firebaseUid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName,
          photoUrl: fbUser.photoURL,
          provider: fbUser.provider,
        });
      } else {
        updateFirebaseUser(db, user.id, {
          displayName: fbUser.displayName,
          photoUrl: fbUser.photoURL,
          email: fbUser.email,
        });
        // Re-fetch to get updated data
        user = findUserById(db, user.id)!;
      }

      const token = signJwt({ userId: user.id, role: user.role });

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          displayName: user.display_name,
          email: user.email,
          photoUrl: user.photo_url,
          authProvider: user.auth_provider,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Firebase authentication failed" });
    }
  });

  // Check if Firebase is enabled (public endpoint for frontend)
  router.get("/auth/providers", (_req, res) => {
    res.json({
      local: true,
      firebase: isFirebaseEnabled(),
    });
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
          email: user.email,
          photoUrl: user.photo_url,
          authProvider: user.auth_provider,
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

  // --- Direct GitHub OAuth Sign-In (bypasses Firebase) ---
  router.get("/auth/github/login", (_req, res) => {
    const env = getEnv();
    const clientId = resolveIntegrationCred(db, "github_client_id", env.GITHUB_CLIENT_ID);
    if (!clientId) {
      res.status(503).json({ error: "GitHub OAuth not configured" });
      return;
    }
    const state = signJwt({ userId: "__github_login__", role: "user" });
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=read:user,user:email&state=${state}`;
    res.redirect(url);
  });

  router.get("/auth/github/callback", async (req, res) => {
    try {
      const code = String(req.query.code || "");
      const state = String(req.query.state || "");
      const env = getEnv();
      const clientId = resolveIntegrationCred(db, "github_client_id", env.GITHUB_CLIENT_ID);
      const clientSecret = resolveIntegrationCred(db, "github_client_secret", env.GITHUB_CLIENT_SECRET);
      if (!code || !clientId || !clientSecret) {
        res.status(400).send("Missing code or GitHub not configured");
        return;
      }

      // Exchange code for access token
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const tokenData = (await tokenRes.json()) as any;
      if (!tokenData.access_token) {
        res.status(401).send("GitHub token exchange failed");
        return;
      }

      // Get GitHub user info
      const ghUserRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" },
      });
      const ghUser = (await ghUserRes.json()) as any;

      // Get email if not public
      let email = ghUser.email;
      if (!email) {
        try {
          const emailsRes = await fetch("https://api.github.com/user/emails", {
            headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" },
          });
          const emails = (await emailsRes.json()) as any[];
          const primary = emails?.find((e: any) => e.primary) || emails?.[0];
          email = primary?.email;
        } catch { /* email scope may not be granted for integration-only connect */ }
      }

      // Check state to determine if this is a LOGIN or INTEGRATION CONNECT
      const statePayload = state ? verifyJwt(state) : null;
      const isLogin = !statePayload || statePayload.userId === "__github_login__";

      if (isLogin) {
        // --- SIGN-IN FLOW ---
        // Send the GitHub access token back to the frontend so it can
        // sign into Firebase using signInWithCredential (no popup/redirect needed)
        res.send(`<html><body><script>
          if (window.opener) {
            window.opener.postMessage({
              type: 'github_oauth_token',
              accessToken: '${tokenData.access_token}',
              ghUser: ${JSON.stringify({ login: ghUser.login, name: ghUser.name, email, avatar_url: ghUser.avatar_url })}
            }, '*');
            window.close();
          } else {
            document.body.innerHTML = '<p>Sign-in complete. You can close this window.</p>';
          }
        </script><p>Signing in...</p></body></html>`);
      } else {
        // --- INTEGRATION CONNECT FLOW ---
        upsertConnectedAccount(db, {
          userId: statePayload.userId,
          provider: "github",
          accessToken: tokenData.access_token,
          accountName: ghUser.login,
          accountEmail: email ?? undefined,
          accountAvatar: ghUser.avatar_url,
          scopes: tokenData.scope,
        });
        res.send(`<html><body><script>window.opener?.postMessage({type:'integration_connected',provider:'github'},'*');window.close();</script><p>GitHub connected! You can close this window.</p></body></html>`);
      }
    } catch (err: any) {
      log.error(`GitHub auth callback error: ${err.message}`);
      res.status(500).send(`GitHub connection failed: ${err.message}`);
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
      email: user.email,
      photoUrl: user.photo_url,
      authProvider: user.auth_provider,
    });
  });

  return router;
}
