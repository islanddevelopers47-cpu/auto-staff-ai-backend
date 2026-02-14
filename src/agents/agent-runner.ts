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
import { buildIntegrationToolsPrompt, executeToolCalls } from "../integrations/agent-tools.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("agent-runner");

export interface RunAgentInput {
  botId: string | null;
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel";
  userMessage: string;
  telegramMessageId?: number;
  senderName?: string;
  apiKeyOverride?: string;
  providerOverride?: ProviderName;
  modelOverride?: string;
  userId?: string;
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
  let systemPrompt = buildSystemPrompt(agent, input);

  // Add tools context (web tools always available; integration tools if user has connected accounts)
  const toolsPrompt = buildIntegrationToolsPrompt(db, input.userId || "");
  if (toolsPrompt) systemPrompt += toolsPrompt;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
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

    let finalContent = result.content;

    // Check for tool calls and execute them (max 3 rounds)
    {
      let toolRound = 0;
      let currentContent = result.content;
      while (toolRound < 3) {
        const { results: toolResults, hasTools } = await executeToolCalls(db, input.userId || "", currentContent);
        if (!hasTools) break;

        // Add tool results to conversation and get follow-up
        const toolResultText = toolResults.map(r =>
          `[Tool Result: ${r.tool}] ${r.success ? r.result : `ERROR: ${r.result}`}`
        ).join("\n\n");

        messages.push({ role: "assistant", content: currentContent });
        messages.push({ role: "user", content: `Tool execution results:\n\n${toolResultText}\n\nPlease continue your response based on these results.` });

        const followUp = await chatCompletion(
          effectiveProvider,
          { model: effectiveModel, messages, temperature: agent.temperature, maxTokens: agent.max_tokens },
          input.apiKeyOverride
        );
        currentContent = followUp.content;
        toolRound++;
      }
      finalContent = currentContent;
    }

    // Save assistant response
    addMessage(db, session.id, "assistant", finalContent);

    return {
      response: finalContent,
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
