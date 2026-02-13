import { createLogger } from "../utils/logger.js";

const log = createLogger("github-integration");
const GITHUB_API = "https://api.github.com";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "AutoStaffAI",
  };
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  html_url: string;
}

export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir";
  download_url: string | null;
  html_url: string;
}

export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  content: string;
  encoding: string;
  size: number;
}

// --- Repos ---

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const res = await fetch(`${GITHUB_API}/user/repos?per_page=100&sort=updated`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as GitHubRepo[];
}

// --- Files ---

export async function listFiles(
  token: string,
  owner: string,
  repo: string,
  path: string = "",
  branch?: string
): Promise<GitHubFile[]> {
  let url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  if (branch) url += `?ref=${branch}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  const data = await res.json() as GitHubFile | GitHubFile[];
  return Array.isArray(data) ? data : [data];
}

export async function readFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch?: string
): Promise<{ content: string; sha: string }> {
  let url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  if (branch) url += `?ref=${branch}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as GitHubFileContent;
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
}

export async function createOrUpdateFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
  branch?: string
): Promise<{ sha: string; html_url: string }> {
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString("base64"),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return { sha: data.content.sha, html_url: data.content.html_url };
}

export async function deleteFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  sha: string,
  message: string,
  branch?: string
): Promise<void> {
  const body: Record<string, string> = { message, sha };
  if (branch) body.branch = branch;

  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
}

// --- OAuth ---

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<{ access_token: string; scope: string; token_type: string }> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) throw new Error(`GitHub OAuth error: ${res.status}`);
  const data = (await res.json()) as any;
  if (data.error) throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  return data;
}

export async function getGitHubUser(token: string): Promise<{ login: string; email: string | null; avatar_url: string; name: string | null }> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return (await res.json()) as any;
}
