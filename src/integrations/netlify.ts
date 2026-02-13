import { createLogger } from "../utils/logger.js";
import crypto from "node:crypto";

const log = createLogger("netlify-integration");
const NETLIFY_API = "https://api.netlify.com/api/v1";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// --- Types ---

export interface NetlifySite {
  id: string;
  name: string;
  url: string;
  ssl_url: string;
  admin_url: string;
  created_at: string;
  updated_at: string;
  screenshot_url?: string;
}

export interface NetlifyDeploy {
  id: string;
  site_id: string;
  state: string;
  name: string;
  url: string;
  ssl_url: string;
  admin_url: string;
  created_at: string;
  updated_at: string;
  published_at?: string;
  title?: string;
  summary?: { messages: Array<{ type: string; title: string; description: string }> };
}

// --- Sites ---

export async function listSites(token: string): Promise<NetlifySite[]> {
  const res = await fetch(`${NETLIFY_API}/sites?per_page=50`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Netlify API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as NetlifySite[];
}

export async function getSite(token: string, siteId: string): Promise<NetlifySite> {
  const res = await fetch(`${NETLIFY_API}/sites/${siteId}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Netlify API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as NetlifySite;
}

// --- Deploys ---

export async function listDeploys(token: string, siteId: string): Promise<NetlifyDeploy[]> {
  const res = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys?per_page=20`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Netlify API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as NetlifyDeploy[];
}

export async function getDeployStatus(token: string, deployId: string): Promise<NetlifyDeploy> {
  const res = await fetch(`${NETLIFY_API}/deploys/${deployId}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Netlify API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as NetlifyDeploy;
}

/**
 * Deploy files to a Netlify site using the file digest API.
 * files: Array of { path: "/index.html", content: "<html>..." }
 */
export async function deployFiles(
  token: string,
  siteId: string,
  files: Array<{ path: string; content: string }>,
  title?: string
): Promise<NetlifyDeploy> {
  // Build file digest: sha1 hash → path mapping
  const fileHashes: Record<string, string> = {};
  const fileMap: Record<string, string> = {}; // sha1 → content

  for (const f of files) {
    const sha = crypto.createHash("sha1").update(f.content).digest("hex");
    const filePath = f.path.startsWith("/") ? f.path : `/${f.path}`;
    fileHashes[filePath] = sha;
    fileMap[sha] = f.content;
  }

  // Step 1: Create deploy with file digest
  const createBody: Record<string, unknown> = { files: fileHashes };
  if (title) createBody.title = title;

  const createRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) throw new Error(`Netlify deploy create error: ${createRes.status} ${await createRes.text()}`);
  const deploy = (await createRes.json()) as NetlifyDeploy & { required: string[] };

  // Step 2: Upload required files
  if (deploy.required && deploy.required.length > 0) {
    for (const sha of deploy.required) {
      const content = fileMap[sha];
      if (!content) continue;
      const uploadRes = await fetch(`${NETLIFY_API}/deploys/${deploy.id}/files${Object.entries(fileHashes).find(([, v]) => v === sha)?.[0] || ""}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        body: content,
      });
      if (!uploadRes.ok) {
        log.warn(`Failed to upload file (sha: ${sha}): ${uploadRes.status}`);
      }
    }
  }

  return deploy;
}

/**
 * Create a new Netlify site.
 */
export async function createSite(token: string, name?: string): Promise<NetlifySite> {
  const body: Record<string, unknown> = {};
  if (name) body.name = name;
  const res = await fetch(`${NETLIFY_API}/sites`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Netlify create site error: ${res.status} ${await res.text()}`);
  return (await res.json()) as NetlifySite;
}

// --- OAuth ---

export function getAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `https://app.netlify.com/authorize?${params}`;
}

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<{ access_token: string; token_type: string }> {
  const res = await fetch("https://api.netlify.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Netlify OAuth error: ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

export async function getNetlifyUser(token: string): Promise<{ slug: string; email: string; full_name: string; avatar_url: string }> {
  const res = await fetch(`${NETLIFY_API}/user`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Netlify user error: ${res.status}`);
  return (await res.json()) as any;
}
