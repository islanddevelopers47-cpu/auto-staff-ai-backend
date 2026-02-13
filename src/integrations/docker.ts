import { createLogger } from "../utils/logger.js";

const log = createLogger("docker-integration");

const DEFAULT_HOST = "http://localhost:2375";

function apiUrl(host: string, path: string): string {
  return `${host}${path}`;
}

// --- Types ---

export interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Ports: Array<{ PrivatePort: number; PublicPort?: number; Type: string }>;
}

export interface DockerImage {
  Id: string;
  RepoTags: string[] | null;
  Size: number;
  Created: number;
}

// --- Containers ---

export async function listContainers(host: string = DEFAULT_HOST, all = true): Promise<DockerContainer[]> {
  const res = await fetch(apiUrl(host, `/containers/json?all=${all}`));
  if (!res.ok) throw new Error(`Docker API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as DockerContainer[];
}

export async function getContainerLogs(
  host: string = DEFAULT_HOST,
  containerId: string,
  tail: number = 100
): Promise<string> {
  const res = await fetch(apiUrl(host, `/containers/${containerId}/logs?stdout=true&stderr=true&tail=${tail}`));
  if (!res.ok) throw new Error(`Docker API error: ${res.status} ${await res.text()}`);
  const buf = await res.arrayBuffer();
  // Docker log stream has 8-byte header per frame; strip them for plain text
  const raw = Buffer.from(buf);
  let output = "";
  let i = 0;
  while (i < raw.length) {
    if (i + 8 <= raw.length) {
      const frameSize = raw.readUInt32BE(i + 4);
      if (i + 8 + frameSize <= raw.length) {
        output += raw.subarray(i + 8, i + 8 + frameSize).toString("utf-8");
        i += 8 + frameSize;
        continue;
      }
    }
    // Fallback: treat rest as plain text
    output += raw.subarray(i).toString("utf-8");
    break;
  }
  return output;
}

export async function startContainer(host: string = DEFAULT_HOST, containerId: string): Promise<void> {
  const res = await fetch(apiUrl(host, `/containers/${containerId}/start`), { method: "POST" });
  if (!res.ok && res.status !== 304) throw new Error(`Docker start error: ${res.status} ${await res.text()}`);
}

export async function stopContainer(host: string = DEFAULT_HOST, containerId: string): Promise<void> {
  const res = await fetch(apiUrl(host, `/containers/${containerId}/stop`), { method: "POST" });
  if (!res.ok && res.status !== 304) throw new Error(`Docker stop error: ${res.status} ${await res.text()}`);
}

export async function restartContainer(host: string = DEFAULT_HOST, containerId: string): Promise<void> {
  const res = await fetch(apiUrl(host, `/containers/${containerId}/restart`), { method: "POST" });
  if (!res.ok) throw new Error(`Docker restart error: ${res.status} ${await res.text()}`);
}

export async function removeContainer(host: string = DEFAULT_HOST, containerId: string, force = false): Promise<void> {
  const res = await fetch(apiUrl(host, `/containers/${containerId}?force=${force}`), { method: "DELETE" });
  if (!res.ok) throw new Error(`Docker remove error: ${res.status} ${await res.text()}`);
}

// --- Images ---

export async function listImages(host: string = DEFAULT_HOST): Promise<DockerImage[]> {
  const res = await fetch(apiUrl(host, "/images/json"));
  if (!res.ok) throw new Error(`Docker API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as DockerImage[];
}

// --- Health check ---

export async function pingDocker(host: string = DEFAULT_HOST): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(host, "/_ping"), { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
