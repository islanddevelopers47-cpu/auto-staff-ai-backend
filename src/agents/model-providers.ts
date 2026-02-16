import { createLogger } from "../utils/logger.js";
import { getEnv } from "../config/env.js";
import { getApiKeyForBot, getRawApiKey } from "../database/api-keys.js";
import type Database from "better-sqlite3";

const log = createLogger("model-providers");

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export type ProviderName = "openai" | "anthropic" | "google" | "ollama" | "grok";

interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

function getProviderConfig(provider: ProviderName): ProviderConfig {
  const env = getEnv();
  // API keys are NEVER read from env vars — each user must supply their own via the UI.
  // Only base URLs come from config.
  switch (provider) {
    case "openai":
      return { baseUrl: "https://api.openai.com/v1" };
    case "anthropic":
      return { baseUrl: "https://api.anthropic.com" };
    case "google":
      return { baseUrl: "https://generativelanguage.googleapis.com" };
    case "ollama":
      return { baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434" };
    case "grok":
      return { baseUrl: "https://api.x.ai/v1" };
  }
}

export async function chatCompletion(
  provider: ProviderName,
  options: ChatCompletionOptions,
  apiKeyOverride?: string
): Promise<ChatCompletionResult> {
  switch (provider) {
    case "openai":
      return openaiCompletion(options, apiKeyOverride);
    case "anthropic":
      return anthropicCompletion(options, apiKeyOverride);
    case "google":
      return googleCompletion(options, apiKeyOverride);
    case "ollama":
      return ollamaCompletion(options);
    case "grok":
      return grokCompletion(options, apiKeyOverride);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function openaiCompletion(
  options: ChatCompletionOptions,
  apiKeyOverride?: string
): Promise<ChatCompletionResult> {
  const config = getProviderConfig("openai");
  const apiKey = apiKeyOverride ?? config.apiKey;
  if (!apiKey) throw new Error("OpenAI API key not configured");

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error(`OpenAI API error ${response.status}: ${body}`);
    throw new Error(`OpenAI API error: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content ?? "",
    model: data.model ?? options.model,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
    finishReason: choice?.finish_reason,
  };
}

async function anthropicCompletion(
  options: ChatCompletionOptions,
  apiKeyOverride?: string
): Promise<ChatCompletionResult> {
  const config = getProviderConfig("anthropic");
  const apiKey = apiKeyOverride ?? config.apiKey;
  if (!apiKey) throw new Error("Anthropic API key not configured");

  // Extract system message
  const systemMsg = options.messages.find((m) => m.role === "system");
  const nonSystemMessages = options.messages.filter((m) => m.role !== "system");

  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      system: systemMsg?.content,
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error(`Anthropic API error ${response.status}: ${body}`);
    throw new Error(`Anthropic API error: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;
  const textBlock = data.content?.find((b: any) => b.type === "text");

  return {
    content: textBlock?.text ?? "",
    model: data.model ?? options.model,
    usage: data.usage
      ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
        }
      : undefined,
    finishReason: data.stop_reason,
  };
}

async function googleCompletion(
  options: ChatCompletionOptions,
  apiKeyOverride?: string
): Promise<ChatCompletionResult> {
  const config = getProviderConfig("google");
  const apiKey = apiKeyOverride ?? config.apiKey;
  if (!apiKey) throw new Error("Google AI API key not configured");

  // Convert messages to Gemini format
  const systemMsg = options.messages.find((m) => m.role === "system");
  const nonSystemMessages = options.messages.filter((m) => m.role !== "system");

  const contents = nonSystemMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const model = options.model || "gemini-pro";
  const url = `${config.baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body: any = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 4096,
    },
  };

  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const respBody = await response.text();
    log.error(`Google AI API error ${response.status}: ${respBody}`);
    throw new Error(`Google AI API error: ${response.status} ${respBody}`);
  }

  const data = (await response.json()) as any;
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? "";

  return {
    content: text,
    model: model,
    usage: data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount ?? 0,
          completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: data.usageMetadata.totalTokenCount ?? 0,
        }
      : undefined,
    finishReason: candidate?.finishReason,
  };
}

async function ollamaCompletion(
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const config = getProviderConfig("ollama");

  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 4096,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error(`Ollama API error ${response.status}: ${body}`);
    throw new Error(`Ollama API error: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;

  return {
    content: data.message?.content ?? "",
    model: data.model ?? options.model,
    usage: data.eval_count
      ? {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        }
      : undefined,
    finishReason: data.done ? "stop" : undefined,
  };
}

async function grokCompletion(
  options: ChatCompletionOptions,
  apiKeyOverride?: string
): Promise<ChatCompletionResult> {
  const config = getProviderConfig("grok");
  const apiKey = apiKeyOverride ?? config.apiKey;
  if (!apiKey) throw new Error("xAI (Grok) API key not configured");

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error(`Grok API error ${response.status}: ${body}`);
    throw new Error(`Grok API error: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content ?? "",
    model: data.model ?? options.model,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
    finishReason: choice?.finish_reason,
  };
}

export function getAvailableProviders(): { name: ProviderName; configured: boolean }[] {
  const env = getEnv();
  // Without a user context we can only confirm Ollama (no API key needed)
  return [
    { name: "openai", configured: false },
    { name: "anthropic", configured: false },
    { name: "google", configured: false },
    { name: "grok", configured: false },
    { name: "ollama", configured: !!env.OLLAMA_BASE_URL },
  ];
}

/**
 * Check provider availability for a specific user — only their own DB keys count.
 */
export function getAvailableProvidersWithDb(
  db: Database.Database,
  userId?: string
): { name: ProviderName; configured: boolean }[] {
  const env = getEnv();
  return [
    {
      name: "openai",
      configured: userId ? !!getRawApiKey(db, userId, "openai") : false,
    },
    {
      name: "anthropic",
      configured: userId ? !!getRawApiKey(db, userId, "anthropic") : false,
    },
    {
      name: "google",
      configured: userId ? !!getRawApiKey(db, userId, "google") : false,
    },
    {
      name: "grok",
      configured: userId ? !!getRawApiKey(db, userId, "grok") : false,
    },
    { name: "ollama", configured: !!env.OLLAMA_BASE_URL },
  ];
}

/**
 * Resolve the API key for a provider given a bot ID.
 * ONLY returns the bot owner's own key — never another user's.
 */
export function resolveApiKeyForBot(
  db: Database.Database,
  botId: string,
  provider: ProviderName
): string | undefined {
  // Only the bot owner's key — no cross-user fallback, no env var fallback
  return getApiKeyForBot(db, botId, provider);
}

/**
 * When the agent's preferred provider has no key, find a fallback provider
 * that DOES have a key configured (DB or env). Returns the provider, its
 * default model, and the API key — or undefined if nothing is available.
 */
export function findFallbackProvider(
  db: Database.Database,
  botId: string,
  excludeProvider?: ProviderName
): { provider: ProviderName; model: string; apiKey: string } | undefined {
  const candidates: ProviderName[] = ["openai", "anthropic", "google", "grok", "ollama"];
  for (const p of candidates) {
    if (p === excludeProvider) continue;
    if (p === "ollama") continue; // skip ollama as fallback (needs local setup)
    const key = resolveApiKeyForBot(db, botId, p);
    if (key) {
      const models = getDefaultModels(p);
      return { provider: p, model: models[0], apiKey: key };
    }
  }
  return undefined;
}

/**
 * Resolve API key for a provider given a user ID (no bot context).
 * ONLY returns this user's own key — never another user's.
 */
export function resolveApiKeyForUser(
  db: Database.Database,
  userId: string,
  provider: ProviderName
): string | undefined {
  // Only this user's key — no cross-user fallback, no env var fallback
  return getRawApiKey(db, userId, provider);
}

/**
 * Find a fallback provider for a user when the preferred provider has no key.
 */
export function findFallbackProviderForUser(
  db: Database.Database,
  userId: string,
  excludeProvider?: ProviderName
): { provider: ProviderName; model: string; apiKey: string } | undefined {
  const candidates: ProviderName[] = ["openai", "anthropic", "google", "grok", "ollama"];
  for (const p of candidates) {
    if (p === excludeProvider) continue;
    if (p === "ollama") continue;
    const key = resolveApiKeyForUser(db, userId, p);
    if (key) {
      const models = getDefaultModels(p);
      return { provider: p, model: models[0], apiKey: key };
    }
  }
  return undefined;
}

export function getDefaultModels(provider: ProviderName): string[] {
  switch (provider) {
    case "openai":
      return ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1", "o1-mini"];
    case "anthropic":
      return [
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229",
      ];
    case "google":
      return ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"];
    case "grok":
      return ["grok-3", "grok-3-mini", "grok-2", "grok-2-mini"];
    case "ollama":
      return ["llama3.2", "llama3.1", "mistral", "codellama", "phi3"];
  }
}
