import { createLogger } from "../utils/logger.js";

const log = createLogger("google-drive-integration");
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
}

// --- Files ---

export async function listFiles(
  token: string,
  folderId?: string,
  query?: string
): Promise<DriveFile[]> {
  const q = folderId
    ? `'${folderId}' in parents and trashed = false`
    : query || "trashed = false";

  const params = new URLSearchParams({
    q,
    fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,parents)",
    pageSize: "100",
    orderBy: "modifiedTime desc",
  });

  const res = await fetch(`${DRIVE_API}/files?${params}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Google Drive API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { files: DriveFile[] };
  return data.files || [];
}

export async function readFile(
  token: string,
  fileId: string
): Promise<{ content: string; name: string; mimeType: string }> {
  // Get file metadata first
  const metaRes = await fetch(`${DRIVE_API}/files/${fileId}?fields=name,mimeType`, {
    headers: headers(token),
  });
  if (!metaRes.ok) throw new Error(`Google Drive API error: ${metaRes.status} ${await metaRes.text()}`);
  const meta = (await metaRes.json()) as { name: string; mimeType: string };

  // For Google Docs/Sheets/etc, export as plain text
  let contentUrl: string;
  if (meta.mimeType.startsWith("application/vnd.google-apps.")) {
    const exportMime = meta.mimeType.includes("spreadsheet")
      ? "text/csv"
      : "text/plain";
    contentUrl = `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
  } else {
    contentUrl = `${DRIVE_API}/files/${fileId}?alt=media`;
  }

  const res = await fetch(contentUrl, { headers: headers(token) });
  if (!res.ok) throw new Error(`Google Drive API error: ${res.status} ${await res.text()}`);
  const content = await res.text();
  return { content, name: meta.name, mimeType: meta.mimeType };
}

export async function createFile(
  token: string,
  name: string,
  content: string,
  mimeType: string = "text/plain",
  folderId?: string
): Promise<DriveFile> {
  const metadata: Record<string, unknown> = { name, mimeType };
  if (folderId) metadata.parents = [folderId];

  // Multipart upload
  const boundary = "autostaff_boundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`, {
    method: "POST",
    headers: {
      ...headers(token),
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Google Drive API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as DriveFile;
}

export async function updateFile(
  token: string,
  fileId: string,
  content: string,
  mimeType: string = "text/plain"
): Promise<DriveFile> {
  const res = await fetch(
    `${UPLOAD_API}/files/${fileId}?uploadType=media&fields=id,name,mimeType,webViewLink`,
    {
      method: "PATCH",
      headers: {
        ...headers(token),
        "Content-Type": mimeType,
      },
      body: content,
    }
  );
  if (!res.ok) throw new Error(`Google Drive API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as DriveFile;
}

export async function deleteFile(token: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Google Drive API error: ${res.status} ${await res.text()}`);
}

// --- OAuth ---

export function getAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth error: ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth refresh error: ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

export async function getDriveUserInfo(token: string): Promise<{ email: string; name: string; picture: string }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: headers(token),
  });
  if (!res.ok) {
    // Fallback: return placeholder if userinfo scope wasn't granted
    log.warn(`Google userinfo failed (${res.status}), using fallback`);
    return { email: "unknown", name: "Google Drive User", picture: "" };
  }
  return (await res.json()) as any;
}
