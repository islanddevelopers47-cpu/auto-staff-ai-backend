import type Database from "better-sqlite3";
import type { Agent } from "../database/agents.js";
import {
  chatCompletion,
  type ChatMessage,
  type ProviderName,
} from "./model-providers.js";
import {
  findOrCreateSession,
  getSessionHistory,
  addMessage,
} from "../database/sessions.js";
import { buildSkillsPrompt } from "./skills-loader.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("agent-runner");

export interface RunAgentInput {
  botId: string;
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel";
  userMessage: string;
  telegramMessageId?: number;
  senderName?: string;
  apiKeyOverride?: string;
  providerOverride?: ProviderName;
  modelOverride?: string;
}

export interface RunAgentResult {
  response: string;
  sessionId: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function runAgent(
  db: Database.Database,
  agent: Agent,
  input: RunAgentInput
): Promise<RunAgentResult> {
  // Find or create session
  const session = findOrCreateSession(
    db,
    input.botId,
    input.chatId,
    input.chatType,
    agent.id
  );

  // Save user message
  addMessage(db, session.id, "user", input.userMessage, input.telegramMessageId, {
    senderName: input.senderName,
  });

  // Get conversation history
  const historyLimit = getHistoryLimit(agent);
  const history = getSessionHistory(db, session.id, historyLimit);

  // Build messages array for the LLM
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(agent, input) },
  ];

  for (const msg of history) {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  // Call the LLM
  log.info(
    `Running agent "${agent.name}" (${agent.model_provider}/${agent.model_name}) for chat ${input.chatId}`
  );

  try {
    const effectiveProvider = input.providerOverride ?? (agent.model_provider as ProviderName);
    const effectiveModel = input.modelOverride ?? agent.model_name;

    log.info(`Calling ${effectiveProvider}/${effectiveModel}`);

    const result = await chatCompletion(
      effectiveProvider,
      {
        model: effectiveModel,
        messages,
        temperature: agent.temperature,
        maxTokens: agent.max_tokens,
      },
      input.apiKeyOverride
    );

    // Save assistant response
    addMessage(db, session.id, "assistant", result.content);

    return {
      response: result.content,
      sessionId: session.id,
      model: result.model,
      usage: result.usage,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`Agent run failed: ${errorMsg}`);
    throw err;
  }
}

function buildSystemPrompt(agent: Agent, input: RunAgentInput): string {
  let prompt = agent.system_prompt;

  // Add context
  const now = new Date().toISOString();
  prompt += `\n\nCurrent date and time: ${now}`;

  if (input.senderName) {
    prompt += `\nYou are talking to: ${input.senderName}`;
  }

  if (input.chatType === "group" || input.chatType === "supergroup") {
    prompt += "\nThis is a group chat. Keep responses relevant and concise.";
  }

  // Add skills context
  try {
    const skills = JSON.parse(agent.skills) as string[];
    if (skills.length > 0) {
      const skillsPrompt = buildSkillsPrompt(skills);
      if (skillsPrompt) {
        prompt += skillsPrompt;
      }
    }
  } catch {
    // ignore
  }

  return prompt;
}

function getHistoryLimit(agent: Agent): number {
  try {
    const config = JSON.parse(agent.config) as Record<string, unknown>;
    if (typeof config.historyLimit === "number") {
      return config.historyLimit;
    }
  } catch {
    // ignore
  }
  return 50;
}
