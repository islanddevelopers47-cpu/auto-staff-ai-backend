import { Router } from "express";
import type Database from "better-sqlite3";
import { authMiddleware } from "../../auth/middleware.js";
import { getEnv } from "../../config/env.js";
import { createLogger } from "../../utils/logger.js";
import {
  getConnectedAccount,
  listConnectedAccounts,
  upsertConnectedAccount,
  deleteConnectedAccount,
  updateAccessToken,
} from "../../database/connected-accounts.js";
import * as github from "../../integrations/github.js";
import * as gdrive from "../../integrations/google-drive.js";
import * as vercel from "../../integrations/vercel.js";
import * as netlify from "../../integrations/netlify.js";
import * as docker from "../../integrations/docker.js";
import { signJwt, verifyJwt } from "../../utils/crypto.js";
import {
  resolveIntegrationCred,
  getMaskedConfig,
  setIntegrationConfig,
} from "../../database/integration-config.js";

const log = createLogger("integrations-api");

export function createIntegrationsRouter(db: Database.Database): Router {
  const router = Router();
  const env = getEnv();

  function getBaseUrl(): string {
    return env.PUBLIC_URL || `http://localhost:${env.PORT}`;
  }

  // Resolve credentials from DB first, then env fallback
  function ghClientId() { return resolveIntegrationCred(db, "github_client_id", env.GITHUB_CLIENT_ID); }
  function ghClientSecret() { return resolveIntegrationCred(db, "github_client_secret", env.GITHUB_CLIENT_SECRET); }
  function gdClientId() { return resolveIntegrationCred(db, "google_drive_client_id", env.GOOGLE_DRIVE_CLIENT_ID); }
  function gdClientSecret() { return resolveIntegrationCred(db, "google_drive_client_secret", env.GOOGLE_DRIVE_CLIENT_SECRET); }
  function vcClientId() { return resolveIntegrationCred(db, "vercel_client_id", env.VERCEL_CLIENT_ID); }
  function vcClientSecret() { return resolveIntegrationCred(db, "vercel_client_secret", env.VERCEL_CLIENT_SECRET); }
  function ntClientId() { return resolveIntegrationCred(db, "netlify_client_id", env.NETLIFY_CLIENT_ID); }
  function ntClientSecret() { return resolveIntegrationCred(db, "netlify_client_secret", env.NETLIFY_CLIENT_SECRET); }
  function dockerHost() { return resolveIntegrationCred(db, "docker_host", env.DOCKER_HOST) || "http://localhost:2375"; }

  // --- Admin: Get/Set integration OAuth config ---
  router.get("/integrations/config", authMiddleware, (req, res) => {
    if (req.user!.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
    res.json(getMaskedConfig(db));
  });

  router.post("/integrations/config", authMiddleware, (req, res) => {
    if (req.user!.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
    setIntegrationConfig(db, req.body);
    res.json({ ok: true, config: getMaskedConfig(db) });
  });

  // --- List connected accounts ---
  router.get("/integrations", authMiddleware, (req, res) => {
    const accounts = listConnectedAccounts(db, req.user!.userId);
    const githubConfigured = !!(ghClientId() && ghClientSecret());
    const driveConfigured = !!(gdClientId() && gdClientSecret());
    const vercelConfigured = !!(vcClientId() && vcClientSecret());
    const netlifyConfigured = !!(ntClientId() && ntClientSecret());
    const dockerConfigured = !!resolveIntegrationCred(db, "docker_host", env.DOCKER_HOST);
    res.json({ accounts, providers: { github: githubConfigured, google_drive: driveConfigured, vercel: vercelConfigured, netlify: netlifyConfigured, docker: dockerConfigured } });
  });

  // --- Disconnect account ---
  router.delete("/integrations/:provider", authMiddleware, (req, res) => {
    const provider = String(req.params.provider);
    if (!["github", "google_drive", "vercel", "netlify"].includes(provider)) {
      res.status(400).json({ error: "Invalid provider" });
      return;
    }
    deleteConnectedAccount(db, req.user!.userId, provider);
    res.json({ success: true });
  });

  // ==================== GITHUB ====================

  // Start GitHub OAuth flow (uses shared callback at /api/auth/github/callback)
  router.get("/integrations/github/connect", authMiddleware, (req, res) => {
    const clientId = ghClientId();
    if (!clientId) {
      res.status(503).json({ error: "GitHub integration not configured" });
      return;
    }
    // State contains real userId — the shared callback uses this to distinguish login vs integration connect
    const state = signJwt({ userId: req.user!.userId, role: req.user!.role });
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo&state=${state}`;
    res.json({ url });
  });

  // --- GitHub: List repos ---
  router.get("/integrations/github/repos", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "github");
      if (!account) { res.status(404).json({ error: "GitHub not connected" }); return; }
      const repos = await github.listRepos(account.access_token);
      res.json({ repos });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- GitHub: List files in repo ---
  router.get("/integrations/github/repos/:owner/:repo/files", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "github");
      if (!account) { res.status(404).json({ error: "GitHub not connected" }); return; }
      const path = String(req.query.path || "");
      const branch = req.query.branch ? String(req.query.branch) : undefined;
      const files = await github.listFiles(account.access_token, String(req.params.owner), String(req.params.repo), path, branch);
      res.json({ files });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- GitHub: Read file ---
  router.get("/integrations/github/repos/:owner/:repo/file", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "github");
      if (!account) { res.status(404).json({ error: "GitHub not connected" }); return; }
      const path = req.query.path ? String(req.query.path) : "";
      if (!path) { res.status(400).json({ error: "path is required" }); return; }
      const branch = req.query.branch ? String(req.query.branch) : undefined;
      const file = await github.readFile(account.access_token, String(req.params.owner), String(req.params.repo), path, branch);
      res.json(file);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- GitHub: Create/update file ---
  router.put("/integrations/github/repos/:owner/:repo/file", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "github");
      if (!account) { res.status(404).json({ error: "GitHub not connected" }); return; }
      const { path, content, message, sha, branch } = req.body as {
        path: string; content: string; message?: string; sha?: string; branch?: string;
      };
      if (!path || content === undefined) { res.status(400).json({ error: "path and content are required" }); return; }
      const result = await github.createOrUpdateFile(
        account.access_token, String(req.params.owner), String(req.params.repo),
        path, content, message || `Update ${path} via Claw Staffer`, sha, branch
      );
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- GitHub: Delete file ---
  router.delete("/integrations/github/repos/:owner/:repo/file", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "github");
      if (!account) { res.status(404).json({ error: "GitHub not connected" }); return; }
      const { path, sha, message, branch } = req.body as {
        path: string; sha: string; message?: string; branch?: string;
      };
      if (!path || !sha) { res.status(400).json({ error: "path and sha are required" }); return; }
      await github.deleteFile(
        account.access_token, String(req.params.owner), String(req.params.repo),
        path, sha, message || `Delete ${path} via Claw Staffer`, branch
      );
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ==================== GOOGLE DRIVE ====================

  // Start Google Drive OAuth flow
  router.get("/integrations/google-drive/connect", authMiddleware, (req, res) => {
    const driveId = gdClientId();
    if (!driveId) {
      res.status(503).json({ error: "Google Drive integration not configured" });
      return;
    }
    const state = signJwt({ userId: req.user!.userId, role: req.user!.role });
    const redirectUri = `${getBaseUrl()}/api/integrations/google-drive/callback`;
    const url = gdrive.getAuthUrl(driveId, redirectUri, state);
    res.json({ url });
  });

  // Google Drive OAuth callback
  router.get("/integrations/google-drive/callback", async (req, res) => {
    try {
      const { code, state } = req.query as { code?: string; state?: string };
      if (!code || !state) {
        res.status(400).send("Missing code or state");
        return;
      }

      const payload = verifyJwt(state);
      if (!payload) {
        res.status(401).send("Invalid state token");
        return;
      }

      const redirectUri = `${getBaseUrl()}/api/integrations/google-drive/callback`;
      const tokenData = await gdrive.exchangeCodeForTokens(
        gdClientId()!,
        gdClientSecret()!,
        code,
        redirectUri
      );

      const userInfo = await gdrive.getDriveUserInfo(tokenData.access_token);

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      upsertConnectedAccount(db, {
        userId: payload.userId,
        provider: "google_drive",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accountName: userInfo.name,
        accountEmail: userInfo.email,
        accountAvatar: userInfo.picture,
        scopes: tokenData.scope,
        tokenExpiresAt: expiresAt,
      });

      res.send(`<html><body><script>window.opener?.postMessage({type:'integration_connected',provider:'google_drive'},'*');window.close();</script><p>Google Drive connected! You can close this window.</p></body></html>`);
    } catch (err: any) {
      log.error(`Google Drive OAuth error: ${err.message}`);
      res.status(500).send(`Google Drive connection failed: ${err.message}`);
    }
  });

  // Helper: get a valid Drive token, refreshing if needed
  async function getDriveToken(userId: string): Promise<string> {
    const account = getConnectedAccount(db, userId, "google_drive");
    if (!account) throw new Error("Google Drive not connected");

    // Check if token is expired
    if (account.token_expires_at && new Date(account.token_expires_at) < new Date()) {
      if (!account.refresh_token) throw new Error("Token expired and no refresh token");
      const refreshed = await gdrive.refreshAccessToken(
        gdClientId()!,
        gdClientSecret()!,
        account.refresh_token
      );
      const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      updateAccessToken(db, account.id, refreshed.access_token, expiresAt);
      return refreshed.access_token;
    }
    return account.access_token;
  }

  // --- Drive: List files ---
  router.get("/integrations/google-drive/files", authMiddleware, async (req, res) => {
    try {
      const token = await getDriveToken(req.user!.userId);
      const folderId = req.query.folderId ? String(req.query.folderId) : undefined;
      const query = req.query.q ? String(req.query.q) : undefined;
      const files = await gdrive.listFiles(token, folderId, query);
      res.json({ files });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- Drive: Read file ---
  router.get("/integrations/google-drive/files/:fileId", authMiddleware, async (req, res) => {
    try {
      const token = await getDriveToken(req.user!.userId);
      const file = await gdrive.readFile(token, String(req.params.fileId));
      res.json(file);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- Drive: Create file ---
  router.post("/integrations/google-drive/files", authMiddleware, async (req, res) => {
    try {
      const token = await getDriveToken(req.user!.userId);
      const { name, content, mimeType, folderId } = req.body as {
        name: string; content: string; mimeType?: string; folderId?: string;
      };
      if (!name || content === undefined) { res.status(400).json({ error: "name and content are required" }); return; }
      const file = await gdrive.createFile(token, name, content, mimeType, folderId);
      res.json(file);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- Drive: Update file ---
  router.patch("/integrations/google-drive/files/:fileId", authMiddleware, async (req, res) => {
    try {
      const token = await getDriveToken(req.user!.userId);
      const { content, mimeType } = req.body as { content: string; mimeType?: string };
      if (content === undefined) { res.status(400).json({ error: "content is required" }); return; }
      const file = await gdrive.updateFile(token, String(req.params.fileId), content, mimeType);
      res.json(file);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- Drive: Delete file ---
  router.delete("/integrations/google-drive/files/:fileId", authMiddleware, async (req, res) => {
    try {
      const token = await getDriveToken(req.user!.userId);
      await gdrive.deleteFile(token, String(req.params.fileId));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ==================== VERCEL ====================

  router.get("/integrations/vercel/connect", authMiddleware, (req, res) => {
    const clientId = vcClientId();
    if (!clientId) { res.status(503).json({ error: "Vercel integration not configured" }); return; }
    const state = signJwt({ userId: req.user!.userId, role: req.user!.role });
    const redirectUri = `${getBaseUrl()}/api/integrations/vercel/callback`;
    const url = vercel.getAuthUrl(clientId, redirectUri, state);
    res.json({ url });
  });

  router.get("/integrations/vercel/callback", async (req, res) => {
    try {
      const { code, state } = req.query as { code?: string; state?: string };
      if (!code || !state) { res.status(400).send("Missing code or state"); return; }
      const payload = verifyJwt(state);
      if (!payload) { res.status(401).send("Invalid state token"); return; }

      const redirectUri = `${getBaseUrl()}/api/integrations/vercel/callback`;
      const tokenData = await vercel.exchangeCodeForToken(vcClientId()!, vcClientSecret()!, code, redirectUri);
      const userInfo = await vercel.getVercelUser(tokenData.access_token);

      upsertConnectedAccount(db, {
        userId: payload.userId,
        provider: "vercel",
        accessToken: tokenData.access_token,
        accountName: userInfo.username,
        accountEmail: userInfo.email,
        accountAvatar: userInfo.avatar,
      });

      res.send(`<html><body><script>window.opener?.postMessage({type:'integration_connected',provider:'vercel'},'*');window.close();</script><p>Vercel connected! You can close this window.</p></body></html>`);
    } catch (err: any) {
      log.error(`Vercel OAuth error: ${err.message}`);
      res.status(500).send(`Vercel connection failed: ${err.message}`);
    }
  });

  router.get("/integrations/vercel/projects", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "vercel");
      if (!account) { res.status(404).json({ error: "Vercel not connected" }); return; }
      const projects = await vercel.listProjects(account.access_token);
      res.json({ projects });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get("/integrations/vercel/deployments", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "vercel");
      if (!account) { res.status(404).json({ error: "Vercel not connected" }); return; }
      const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
      const deployments = await vercel.listDeployments(account.access_token, projectId);
      res.json({ deployments });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get("/integrations/vercel/deployments/:id", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "vercel");
      if (!account) { res.status(404).json({ error: "Vercel not connected" }); return; }
      const deployment = await vercel.getDeployment(account.access_token, String(req.params.id));
      res.json(deployment);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/integrations/vercel/deploy", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "vercel");
      if (!account) { res.status(404).json({ error: "Vercel not connected" }); return; }
      const { name, files, projectId } = req.body as {
        name: string; files: Array<{ file: string; data: string }>; projectId?: string;
      };
      if (!name || !files?.length) { res.status(400).json({ error: "name and files are required" }); return; }
      const deployment = await vercel.createDeployment(account.access_token, name, files, projectId);
      res.json(deployment);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ==================== NETLIFY ====================

  router.get("/integrations/netlify/connect", authMiddleware, (req, res) => {
    const clientId = ntClientId();
    if (!clientId) { res.status(503).json({ error: "Netlify integration not configured" }); return; }
    const state = signJwt({ userId: req.user!.userId, role: req.user!.role });
    const redirectUri = `${getBaseUrl()}/api/integrations/netlify/callback`;
    const url = netlify.getAuthUrl(clientId, redirectUri, state);
    res.json({ url });
  });

  router.get("/integrations/netlify/callback", async (req, res) => {
    try {
      const { code, state } = req.query as { code?: string; state?: string };
      if (!code || !state) { res.status(400).send("Missing code or state"); return; }
      const payload = verifyJwt(state);
      if (!payload) { res.status(401).send("Invalid state token"); return; }

      const redirectUri = `${getBaseUrl()}/api/integrations/netlify/callback`;
      const tokenData = await netlify.exchangeCodeForToken(ntClientId()!, ntClientSecret()!, code, redirectUri);
      const userInfo = await netlify.getNetlifyUser(tokenData.access_token);

      upsertConnectedAccount(db, {
        userId: payload.userId,
        provider: "netlify",
        accessToken: tokenData.access_token,
        accountName: userInfo.slug || userInfo.full_name,
        accountEmail: userInfo.email,
        accountAvatar: userInfo.avatar_url,
      });

      res.send(`<html><body><script>window.opener?.postMessage({type:'integration_connected',provider:'netlify'},'*');window.close();</script><p>Netlify connected! You can close this window.</p></body></html>`);
    } catch (err: any) {
      log.error(`Netlify OAuth error: ${err.message}`);
      res.status(500).send(`Netlify connection failed: ${err.message}`);
    }
  });

  router.get("/integrations/netlify/sites", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "netlify");
      if (!account) { res.status(404).json({ error: "Netlify not connected" }); return; }
      const sites = await netlify.listSites(account.access_token);
      res.json({ sites });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get("/integrations/netlify/sites/:siteId/deploys", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "netlify");
      if (!account) { res.status(404).json({ error: "Netlify not connected" }); return; }
      const deploys = await netlify.listDeploys(account.access_token, String(req.params.siteId));
      res.json({ deploys });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/integrations/netlify/deploy", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "netlify");
      if (!account) { res.status(404).json({ error: "Netlify not connected" }); return; }
      const { siteId, files, title } = req.body as {
        siteId: string; files: Array<{ path: string; content: string }>; title?: string;
      };
      if (!siteId || !files?.length) { res.status(400).json({ error: "siteId and files are required" }); return; }
      const deploy = await netlify.deployFiles(account.access_token, siteId, files, title);
      res.json(deploy);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/integrations/netlify/sites", authMiddleware, async (req, res) => {
    try {
      const account = getConnectedAccount(db, req.user!.userId, "netlify");
      if (!account) { res.status(404).json({ error: "Netlify not connected" }); return; }
      const { name } = req.body as { name?: string };
      const site = await netlify.createSite(account.access_token, name);
      res.json(site);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ==================== DOCKER ====================

  router.get("/integrations/docker/ping", authMiddleware, async (_req, res) => {
    try {
      const ok = await docker.pingDocker(dockerHost());
      res.json({ connected: ok, host: dockerHost() });
    } catch (err: any) { res.json({ connected: false, error: err.message }); }
  });

  router.get("/integrations/docker/containers", authMiddleware, async (req, res) => {
    try {
      const all = req.query.all !== "false";
      const containers = await docker.listContainers(dockerHost(), all);
      res.json({ containers });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get("/integrations/docker/containers/:id/logs", authMiddleware, async (req, res) => {
    try {
      const tail = parseInt(String(req.query.tail || "100"), 10);
      const logs = await docker.getContainerLogs(dockerHost(), String(req.params.id), tail);
      res.json({ logs });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/integrations/docker/containers/:id/start", authMiddleware, async (req, res) => {
    try {
      await docker.startContainer(dockerHost(), String(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/integrations/docker/containers/:id/stop", authMiddleware, async (req, res) => {
    try {
      await docker.stopContainer(dockerHost(), String(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/integrations/docker/containers/:id/restart", authMiddleware, async (req, res) => {
    try {
      await docker.restartContainer(dockerHost(), String(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get("/integrations/docker/images", authMiddleware, async (_req, res) => {
    try {
      const images = await docker.listImages(dockerHost());
      res.json({ images });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return router;
}
