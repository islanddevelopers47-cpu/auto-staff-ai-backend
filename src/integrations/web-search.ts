import { createLogger } from "../utils/logger.js";

const log = createLogger("web-search");

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Search the web using DuckDuckGo's HTML lite interface.
 * Returns top results with title, URL, and snippet.
 */
export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ClawStaffer/1.0)",
    },
  });

  if (!res.ok) {
    log.error(`DuckDuckGo search failed: ${res.status}`);
    throw new Error(`Search failed with status ${res.status}`);
  }

  const html = await res.text();
  return parseDuckDuckGoResults(html, maxResults);
}

function parseDuckDuckGoResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo lite HTML has results in class="result " blocks
  const resultBlocks = html.split(/class="result\s/g).slice(1);

  for (const block of resultBlocks) {
    if (results.length >= max) break;

    // Extract title and URL from result__a
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    // Extract snippet from result__snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

    if (titleMatch) {
      let href = titleMatch[1] || "";
      const title = stripHtml(titleMatch[2] || "");
      const snippet = snippetMatch ? stripHtml(snippetMatch[1] || "") : "";

      // DuckDuckGo wraps URLs in a redirect — extract the actual URL
      const uddgMatch = href.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        href = decodeURIComponent(uddgMatch[1]);
      }

      if (title && href && !href.includes("duckduckgo.com")) {
        results.push({ title: title.trim(), url: href, snippet: snippet.trim() });
      }
    }
  }

  return results;
}

/**
 * Fetch a URL and extract readable text content.
 * Strips HTML tags and returns a trimmed text preview.
 */
export async function webFetch(targetUrl: string, maxChars = 4000): Promise<string> {
  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ClawStaffer/1.0)",
      Accept: "text/html,application/xhtml+xml,text/plain,application/json",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${targetUrl}: ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (contentType.includes("application/json")) {
    return text.slice(0, maxChars);
  }

  // Extract text from HTML
  const readable = extractReadableText(text);
  return readable.slice(0, maxChars);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractReadableText(html: string): string {
  // Remove script and style tags entirely
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Replace block elements with newlines
  text = text
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  // Decode HTML entities and clean up whitespace
  text = stripHtml(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
