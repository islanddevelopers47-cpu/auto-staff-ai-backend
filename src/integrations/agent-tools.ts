import type Database from "better-sqlite3";
import { getConnectedAccount } from "../database/connected-accounts.js";
import * as github from "./github.js";
import * as gdrive from "./google-drive.js";
import * as vercelApi from "./vercel.js";
import * as netlifyApi from "./netlify.js";
import * as dockerApi from "./docker.js";
import { getEnv } from "../config/env.js";
import { resolveIntegrationCred } from "../database/integration-config.js";
import { updateAccessToken } from "../database/connected-accounts.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("agent-tools");

// Tool call pattern: [[TOOL:action|param1|param2|...]]
const TOOL_PATTERN = /\[\[TOOL:(\w+)\|([^\]]*)\]\]/g;

export interface ToolResult {
  tool: string;
  success: boolean;
  result: string;
}

/**
 * Build a system prompt section describing available integration tools for this user.
 */
export function buildIntegrationToolsPrompt(db: Database.Database, userId: string): string {
  const ghAccount = getConnectedAccount(db, userId, "github");
  const gdAccount = getConnectedAccount(db, userId, "google_drive");

  const vcAccount = getConnectedAccount(db, userId, "vercel");
  const ntAccount = getConnectedAccount(db, userId, "netlify");
  const env = getEnv();
  const dockerHost = resolveIntegrationCred(db, "docker_host", env.DOCKER_HOST);

  if (!ghAccount && !gdAccount && !vcAccount && !ntAccount && !dockerHost) return "";

  let prompt = "\n\n---\n\n# Integration Tools\n\n";
  prompt += "You have access to file management tools. To use a tool, output the exact syntax shown below.\n";
  prompt += "The system will execute the tool and provide the result.\n\n";

  if (ghAccount) {
    prompt += `## GitHub (connected as @${ghAccount.account_name})\n\n`;
    prompt += "Available tools:\n";
    prompt += "- `[[TOOL:github_list_repos]]` — List all repositories\n";
    prompt += "- `[[TOOL:github_list_files|owner/repo|path]]` — List files in a directory (path can be empty for root)\n";
    prompt += "- `[[TOOL:github_read_file|owner/repo|path]]` — Read a file's contents\n";
    prompt += "- `[[TOOL:github_write_file|owner/repo|path|content|commit message]]` — Create or update a file\n";
    prompt += "- `[[TOOL:github_delete_file|owner/repo|path|sha|commit message]]` — Delete a file (requires sha from read)\n\n";
  }

  if (gdAccount) {
    prompt += `## Google Drive (connected as ${gdAccount.account_name || gdAccount.account_email})\n\n`;
    prompt += "Available tools:\n";
    prompt += "- `[[TOOL:drive_list_files]]` — List files in root\n";
    prompt += "- `[[TOOL:drive_list_folder|folderId]]` — List files in a folder\n";
    prompt += "- `[[TOOL:drive_read_file|fileId]]` — Read a file's contents\n";
    prompt += "- `[[TOOL:drive_create_file|filename|content]]` — Create a new file\n";
    prompt += "- `[[TOOL:drive_update_file|fileId|content]]` — Update an existing file\n";
    prompt += "- `[[TOOL:drive_delete_file|fileId]]` — Delete a file\n\n";
  }

  if (vcAccount) {
    prompt += `## Vercel (connected as @${vcAccount.account_name})\n\n`;
    prompt += "Available tools:\n";
    prompt += "- `[[TOOL:vercel_list_projects]]` — List all Vercel projects\n";
    prompt += "- `[[TOOL:vercel_list_deployments|projectId]]` — List deployments (projectId optional)\n";
    prompt += "- `[[TOOL:vercel_deploy_status|deploymentId]]` — Check deployment status\n";
    prompt += "- `[[TOOL:vercel_deploy|projectName|files_json]]` — Deploy files (files_json is a JSON array of {file,data} objects)\n\n";
  }

  if (ntAccount) {
    prompt += `## Netlify (connected as ${ntAccount.account_name})\n\n`;
    prompt += "Available tools:\n";
    prompt += "- `[[TOOL:netlify_list_sites]]` — List all Netlify sites\n";
    prompt += "- `[[TOOL:netlify_list_deploys|siteId]]` — List deploys for a site\n";
    prompt += "- `[[TOOL:netlify_deploy_status|deployId]]` — Check deploy status\n";
    prompt += "- `[[TOOL:netlify_create_site|name]]` — Create a new site\n";
    prompt += "- `[[TOOL:netlify_deploy|siteId|files_json]]` — Deploy files (files_json is a JSON array of {path,content} objects)\n\n";
  }

  if (dockerHost) {
    prompt += `## Docker (host: ${dockerHost})\n\n`;
    prompt += "Available tools:\n";
    prompt += "- `[[TOOL:docker_list_containers]]` — List all containers\n";
    prompt += "- `[[TOOL:docker_container_logs|containerId|lines]]` — Get container logs (lines defaults to 50)\n";
    prompt += "- `[[TOOL:docker_start|containerId]]` — Start a container\n";
    prompt += "- `[[TOOL:docker_stop|containerId]]` — Stop a container\n";
    prompt += "- `[[TOOL:docker_restart|containerId]]` — Restart a container\n";
    prompt += "- `[[TOOL:docker_list_images]]` — List Docker images\n\n";
  }

  prompt += "**Important**: Only use one tool at a time. Wait for the result before using another tool.\n";
  prompt += "When you use a tool, explain to the user what you're doing.\n";

  return prompt;
}

/**
 * Detect and execute any tool calls found in the agent's response.
 * Returns the results and the cleaned response.
 */
export async function executeToolCalls(
  db: Database.Database,
  userId: string,
  response: string
): Promise<{ results: ToolResult[]; hasTools: boolean }> {
  const matches = [...response.matchAll(TOOL_PATTERN)];
  if (matches.length === 0) return { results: [], hasTools: false };

  const results: ToolResult[] = [];

  for (const match of matches) {
    const action = match[1]!;
    const params = match[2]!.split("|").map((p) => p.trim());

    try {
      const result = await executeTool(db, userId, action, params);
      results.push({ tool: action, success: true, result });
    } catch (err: any) {
      results.push({ tool: action, success: false, result: `Error: ${err.message}` });
    }
  }

  return { results, hasTools: true };
}

async function executeTool(
  db: Database.Database,
  userId: string,
  action: string,
  params: string[]
): Promise<string> {
  const env = getEnv();

  // GitHub tools
  if (action.startsWith("github_")) {
    const account = getConnectedAccount(db, userId, "github");
    if (!account) return "GitHub is not connected. Please connect GitHub in the Integrations tab.";
    const token = account.access_token;

    switch (action) {
      case "github_list_repos": {
        const repos = await github.listRepos(token);
        const list = repos.slice(0, 30).map((r) => `- ${r.full_name}${r.private ? " (private)" : ""}: ${r.description || "No description"}`);
        return `Found ${repos.length} repositories:\n${list.join("\n")}`;
      }
      case "github_list_files": {
        const [repoFull, filePath = ""] = params;
        if (!repoFull) return "Error: repository is required (e.g., owner/repo)";
        const [owner, repo] = repoFull.split("/");
        if (!owner || !repo) return "Error: invalid repo format. Use owner/repo";
        const files = await github.listFiles(token, owner, repo, filePath);
        const list = files.map((f) => `- ${f.type === "dir" ? "📁" : "📄"} ${f.name}${f.size ? ` (${f.size} bytes)` : ""}`);
        return `Files in ${repoFull}/${filePath || "(root)"}:\n${list.join("\n")}`;
      }
      case "github_read_file": {
        const [repoFull2, filePath2] = params;
        if (!repoFull2 || !filePath2) return "Error: repository and path are required";
        const [owner2, repo2] = repoFull2.split("/");
        if (!owner2 || !repo2) return "Error: invalid repo format. Use owner/repo";
        const file = await github.readFile(token, owner2, repo2, filePath2);
        return `File: ${filePath2} (sha: ${file.sha})\n\`\`\`\n${file.content}\n\`\`\``;
      }
      case "github_write_file": {
        const [repoFull3, filePath3, content, message] = params;
        if (!repoFull3 || !filePath3 || content === undefined) return "Error: repository, path, and content are required";
        const [owner3, repo3] = repoFull3.split("/");
        if (!owner3 || !repo3) return "Error: invalid repo format. Use owner/repo";
        // Try to get existing sha for update
        let sha: string | undefined;
        try {
          const existing = await github.readFile(token, owner3, repo3, filePath3);
          sha = existing.sha;
        } catch { /* new file */ }
        const result = await github.createOrUpdateFile(
          token, owner3, repo3, filePath3, content,
          message || `${sha ? "Update" : "Create"} ${filePath3} via Claw Staffer agent`,
          sha
        );
        return `File ${sha ? "updated" : "created"}: ${filePath3} (sha: ${result.sha})`;
      }
      case "github_delete_file": {
        const [repoFull4, filePath4, sha4, message4] = params;
        if (!repoFull4 || !filePath4 || !sha4) return "Error: repository, path, and sha are required";
        const [owner4, repo4] = repoFull4.split("/");
        if (!owner4 || !repo4) return "Error: invalid repo format. Use owner/repo";
        await github.deleteFile(token, owner4, repo4, filePath4, sha4, message4 || `Delete ${filePath4} via Claw Staffer agent`);
        return `File deleted: ${filePath4}`;
      }
      default:
        return `Unknown GitHub tool: ${action}`;
    }
  }

  // Google Drive tools
  if (action.startsWith("drive_")) {
    const account = getConnectedAccount(db, userId, "google_drive");
    if (!account) return "Google Drive is not connected. Please connect Google Drive in the Integrations tab.";

    // Refresh token if needed
    let token = account.access_token;
    if (account.token_expires_at && new Date(account.token_expires_at) < new Date()) {
      if (!account.refresh_token || !env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET) {
        return "Google Drive token expired. Please reconnect in the Integrations tab.";
      }
      const refreshed = await gdrive.refreshAccessToken(env.GOOGLE_DRIVE_CLIENT_ID, env.GOOGLE_DRIVE_CLIENT_SECRET, account.refresh_token);
      const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      updateAccessToken(db, account.id, refreshed.access_token, expiresAt);
      token = refreshed.access_token;
    }

    switch (action) {
      case "drive_list_files": {
        const files = await gdrive.listFiles(token);
        const list = files.slice(0, 30).map((f) =>
          `- ${f.mimeType === "application/vnd.google-apps.folder" ? "📁" : "📄"} ${f.name} (id: ${f.id})`
        );
        return `Drive files:\n${list.join("\n")}`;
      }
      case "drive_list_folder": {
        const [folderId] = params;
        if (!folderId) return "Error: folderId is required";
        const files = await gdrive.listFiles(token, folderId);
        const list = files.slice(0, 30).map((f) =>
          `- ${f.mimeType === "application/vnd.google-apps.folder" ? "📁" : "📄"} ${f.name} (id: ${f.id})`
        );
        return `Folder contents:\n${list.join("\n")}`;
      }
      case "drive_read_file": {
        const [fileId] = params;
        if (!fileId) return "Error: fileId is required";
        const file = await gdrive.readFile(token, fileId);
        return `File: ${file.name} (${file.mimeType})\n\`\`\`\n${file.content}\n\`\`\``;
      }
      case "drive_create_file": {
        const [fileName, content = ""] = params;
        if (!fileName) return "Error: filename is required";
        const file = await gdrive.createFile(token, fileName, content);
        return `File created: ${file.name} (id: ${file.id})`;
      }
      case "drive_update_file": {
        const [fileId2, content2] = params;
        if (!fileId2 || content2 === undefined) return "Error: fileId and content are required";
        const file = await gdrive.updateFile(token, fileId2, content2);
        return `File updated: ${file.name} (id: ${file.id})`;
      }
      case "drive_delete_file": {
        const [fileId3] = params;
        if (!fileId3) return "Error: fileId is required";
        await gdrive.deleteFile(token, fileId3);
        return "File deleted successfully.";
      }
      default:
        return `Unknown Drive tool: ${action}`;
    }
  }

  // Vercel tools
  if (action.startsWith("vercel_")) {
    const account = getConnectedAccount(db, userId, "vercel");
    if (!account) return "Vercel is not connected. Please connect Vercel in the Integrations tab.";
    const token = account.access_token;

    switch (action) {
      case "vercel_list_projects": {
        const projects = await vercelApi.listProjects(token);
        const list = projects.slice(0, 30).map((p) => `- ${p.name} (framework: ${p.framework || "none"})`);
        return `Found ${projects.length} Vercel projects:\n${list.join("\n")}`;
      }
      case "vercel_list_deployments": {
        const [projectId] = params;
        const deployments = await vercelApi.listDeployments(token, projectId || undefined);
        const list = deployments.slice(0, 20).map((d) =>
          `- ${d.url} — ${d.state || d.readyState} (${new Date(d.created).toLocaleString()})`
        );
        return `Deployments:\n${list.join("\n")}`;
      }
      case "vercel_deploy_status": {
        const [deploymentId] = params;
        if (!deploymentId) return "Error: deploymentId is required";
        const d = await vercelApi.getDeployment(token, deploymentId);
        return `Deployment ${d.uid}: state=${d.state || d.readyState}, url=${d.url}`;
      }
      case "vercel_deploy": {
        const [name, filesJson] = params;
        if (!name || !filesJson) return "Error: projectName and files_json are required";
        let files: Array<{ file: string; data: string }>;
        try { files = JSON.parse(filesJson); } catch { return "Error: files_json must be valid JSON"; }
        const d = await vercelApi.createDeployment(token, name, files);
        return `Deployed! URL: ${d.url} (uid: ${d.uid}, state: ${d.state || d.readyState})`;
      }
      default:
        return `Unknown Vercel tool: ${action}`;
    }
  }

  // Netlify tools
  if (action.startsWith("netlify_")) {
    const account = getConnectedAccount(db, userId, "netlify");
    if (!account) return "Netlify is not connected. Please connect Netlify in the Integrations tab.";
    const token = account.access_token;

    switch (action) {
      case "netlify_list_sites": {
        const sites = await netlifyApi.listSites(token);
        const list = sites.slice(0, 30).map((s) => `- ${s.name}: ${s.ssl_url || s.url} (id: ${s.id})`);
        return `Found ${sites.length} Netlify sites:\n${list.join("\n")}`;
      }
      case "netlify_list_deploys": {
        const [siteId] = params;
        if (!siteId) return "Error: siteId is required";
        const deploys = await netlifyApi.listDeploys(token, siteId);
        const list = deploys.slice(0, 20).map((d) =>
          `- ${d.id}: ${d.state} — ${d.ssl_url || d.url} (${d.created_at})`
        );
        return `Deploys:\n${list.join("\n")}`;
      }
      case "netlify_deploy_status": {
        const [deployId] = params;
        if (!deployId) return "Error: deployId is required";
        const d = await netlifyApi.getDeployStatus(token, deployId);
        return `Deploy ${d.id}: state=${d.state}, url=${d.ssl_url || d.url}`;
      }
      case "netlify_create_site": {
        const [name] = params;
        const site = await netlifyApi.createSite(token, name || undefined);
        return `Site created: ${site.name} — ${site.ssl_url || site.url} (id: ${site.id})`;
      }
      case "netlify_deploy": {
        const [siteId, filesJson] = params;
        if (!siteId || !filesJson) return "Error: siteId and files_json are required";
        let files: Array<{ path: string; content: string }>;
        try { files = JSON.parse(filesJson); } catch { return "Error: files_json must be valid JSON"; }
        const d = await netlifyApi.deployFiles(token, siteId, files, "Deploy via Claw Staffer agent");
        return `Deployed! URL: ${d.ssl_url || d.url} (id: ${d.id}, state: ${d.state})`;
      }
      default:
        return `Unknown Netlify tool: ${action}`;
    }
  }

  // Docker tools
  if (action.startsWith("docker_")) {
    const env = getEnv();
    const host = resolveIntegrationCred(db, "docker_host", env.DOCKER_HOST) || "http://localhost:2375";

    switch (action) {
      case "docker_list_containers": {
        const containers = await dockerApi.listContainers(host);
        const list = containers.map((c) => {
          const name = c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12);
          return `- ${name} (${c.Image}) — ${c.State}: ${c.Status}`;
        });
        return `Docker containers:\n${list.join("\n") || "No containers found"}`;
      }
      case "docker_container_logs": {
        const [containerId, lines] = params;
        if (!containerId) return "Error: containerId is required";
        const tail = parseInt(lines || "50", 10);
        const logs = await dockerApi.getContainerLogs(host, containerId, tail);
        return `Logs for ${containerId} (last ${tail} lines):\n\`\`\`\n${logs.slice(0, 4000)}\n\`\`\``;
      }
      case "docker_start": {
        const [containerId] = params;
        if (!containerId) return "Error: containerId is required";
        await dockerApi.startContainer(host, containerId);
        return `Container ${containerId} started.`;
      }
      case "docker_stop": {
        const [containerId] = params;
        if (!containerId) return "Error: containerId is required";
        await dockerApi.stopContainer(host, containerId);
        return `Container ${containerId} stopped.`;
      }
      case "docker_restart": {
        const [containerId] = params;
        if (!containerId) return "Error: containerId is required";
        await dockerApi.restartContainer(host, containerId);
        return `Container ${containerId} restarted.`;
      }
      case "docker_list_images": {
        const images = await dockerApi.listImages(host);
        const list = images.map((i) => {
          const tags = i.RepoTags?.join(", ") || "<none>";
          const sizeMB = (i.Size / 1048576).toFixed(1);
          return `- ${tags} (${sizeMB} MB)`;
        });
        return `Docker images:\n${list.join("\n") || "No images found"}`;
      }
      default:
        return `Unknown Docker tool: ${action}`;
    }
  }

  return `Unknown tool: ${action}`;
}
