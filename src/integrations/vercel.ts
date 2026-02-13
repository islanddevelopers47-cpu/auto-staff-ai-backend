import { createLogger } from "../utils/logger.js";

const log = createLogger("vercel-integration");
const VERCEL_API = "https://api.vercel.com";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// --- Types ---

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  updatedAt: number;
  latestDeployments?: VercelDeployment[];
}

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: string;
  created: number;
  readyState?: string;
  inspectorUrl?: string;
}

// --- Projects ---

export async function listProjects(token: string): Promise<VercelProject[]> {
  const res = await fetch(`${VERCEL_API}/v9/projects?limit=50`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { projects: VercelProject[] };
  return data.projects || [];
}

export async function getProject(token: string, nameOrId: string): Promise<VercelProject> {
  const res = await fetch(`${VERCEL_API}/v9/projects/${encodeURIComponent(nameOrId)}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as VercelProject;
}

// --- Deployments ---

export async function listDeployments(
  token: string,
  projectId?: string
): Promise<VercelDeployment[]> {
  const params = new URLSearchParams({ limit: "20" });
  if (projectId) params.set("projectId", projectId);
  const res = await fetch(`${VERCEL_API}/v6/deployments?${params}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { deployments: VercelDeployment[] };
  return data.deployments || [];
}

export async function getDeployment(token: string, deploymentId: string): Promise<VercelDeployment> {
  const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as VercelDeployment;
}

/**
 * Create a deployment with inline file contents.
 * files: Array of { file: "path/to/file.js", data: "file content string" }
 */
export async function createDeployment(
  token: string,
  name: string,
  files: Array<{ file: string; data: string }>,
  projectId?: string
): Promise<VercelDeployment> {
  const body: Record<string, unknown> = {
    name,
    files: files.map((f) => ({
      file: f.file,
      data: f.data,
    })),
    projectSettings: { framework: null },
  };
  if (projectId) body.project = projectId;

  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Vercel deploy error: ${res.status} ${await res.text()}`);
  return (await res.json()) as VercelDeployment;
}

// --- OAuth ---

export function getAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `https://vercel.com/integrations/oauthv2-exchange?${params}`;
}

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<{ access_token: string; token_type: string; team_id?: string }> {
  const res = await fetch(`${VERCEL_API}/v2/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Vercel OAuth error: ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

export async function getVercelUser(token: string): Promise<{ username: string; email: string; name: string; avatar?: string }> {
  const res = await fetch(`${VERCEL_API}/v2/user`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Vercel user error: ${res.status}`);
  const data = (await res.json()) as any;
  const u = data.user;
  return { username: u.username, email: u.email, name: u.name || u.username, avatar: u.avatar };
}
