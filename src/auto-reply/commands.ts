import type Database from "better-sqlite3";
import type { InboundMessage } from "../telegram/types.js";
import type { AgentRegistry } from "../agents/agent-registry.js";
import { clearSessionHistory, findOrCreateSession } from "../database/sessions.js";
import { findBotById } from "../database/bots.js";
import { getAvailableProviders, getDefaultModels } from "../agents/model-providers.js";

export async function handleCommand(
  db: Database.Database,
  botId: string,
  msg: InboundMessage,
  agentRegistry: AgentRegistry
): Promise<string | null> {
  const cmd = msg.command?.toLowerCase();
  if (!cmd) return null;

  switch (cmd) {
    case "start":
      return handleStart(db, botId);
    case "help":
      return handleHelp();
    case "status":
      return handleStatus(db, botId, agentRegistry);
    case "reset":
      return handleReset(db, botId, msg);
    case "models":
      return handleModels();
    case "agent":
      return handleAgent(db, botId, agentRegistry);
    case "agents":
      return handleAgents(agentRegistry);
    default:
      return null; // Unknown command, let agent handle it
  }
}

function handleStart(db: Database.Database, botId: string): string {
  const bot = findBotById(db, botId);
  const name = bot?.name ?? "Claw Staffer";
  return (
    `👋 Welcome to ${name}!\n\n` +
    `I'm powered by Claw Staffer. Send me any message and I'll respond using AI.\n\n` +
    `Commands:\n` +
    `/help - Show available commands\n` +
    `/status - Show bot status\n` +
    `/reset - Clear conversation history\n` +
    `/models - List available AI models\n` +
    `/agent - Show current agent info\n` +
    `/agents - List all available agents`
  );
}

function handleHelp(): string {
  return (
    `📖 Available Commands:\n\n` +
    `/start - Welcome message\n` +
    `/help - Show this help message\n` +
    `/status - Show bot and agent status\n` +
    `/reset - Clear conversation history for this chat\n` +
    `/models - List available AI models and providers\n` +
    `/agent - Show current agent configuration\n` +
    `/agents - List all available agents\n\n` +
    `Just send any message to chat with the AI agent!`
  );
}

function handleStatus(
  db: Database.Database,
  botId: string,
  agentRegistry: AgentRegistry
): string {
  const bot = findBotById(db, botId);
  if (!bot) return "Bot not found.";

  const agent = bot.agent_id
    ? agentRegistry.getAgent(bot.agent_id)
    : agentRegistry.getDefaultAgent();

  const providers = getAvailableProviders();
  const configuredProviders = providers
    .filter((p) => p.configured)
    .map((p) => p.name)
    .join(", ");

  return (
    `📊 Bot Status\n\n` +
    `Name: ${bot.name}\n` +
    `Status: ${bot.status}\n` +
    `Mode: ${bot.mode}\n` +
    `Bot Username: @${bot.telegram_bot_username ?? "unknown"}\n\n` +
    `🤖 Agent: ${agent?.name ?? "Default"}\n` +
    `Model: ${agent?.model_provider ?? "none"}/${agent?.model_name ?? "none"}\n` +
    `Temperature: ${agent?.temperature ?? "N/A"}\n\n` +
    `🔑 Configured Providers: ${configuredProviders || "none"}`
  );
}

function handleReset(
  db: Database.Database,
  botId: string,
  msg: InboundMessage
): string {
  const session = findOrCreateSession(db, botId, msg.chatId, msg.chatType);
  clearSessionHistory(db, session.id);
  return "🔄 Conversation history cleared. Starting fresh!";
}

function handleModels(): string {
  const providers = getAvailableProviders();
  let text = "🧠 Available AI Models:\n\n";

  for (const provider of providers) {
    const status = provider.configured ? "✅" : "❌";
    const models = getDefaultModels(provider.name);
    text += `${status} ${provider.name}\n`;
    for (const model of models) {
      text += `  • ${model}\n`;
    }
    text += "\n";
  }

  if (!providers.some((p) => p.configured)) {
    text += "⚠️ No providers configured. Add API keys in the Claw Staffer dashboard.";
  }

  return text;
}

function handleAgent(
  db: Database.Database,
  botId: string,
  agentRegistry: AgentRegistry
): string {
  const bot = findBotById(db, botId);
  if (!bot) return "Bot not found.";

  const agent = bot.agent_id
    ? agentRegistry.getAgent(bot.agent_id)
    : agentRegistry.getDefaultAgent();

  if (!agent) return "No agent configured.";

  let skills: string[] = [];
  try {
    skills = JSON.parse(agent.skills);
  } catch {
    // ignore
  }

  return (
    `🤖 Current Agent\n\n` +
    `Name: ${agent.name}\n` +
    `Description: ${agent.description ?? "N/A"}\n` +
    `Provider: ${agent.model_provider}\n` +
    `Model: ${agent.model_name}\n` +
    `Temperature: ${agent.temperature}\n` +
    `Max Tokens: ${agent.max_tokens}\n` +
    `Skills: ${skills.length > 0 ? skills.join(", ") : "none"}\n` +
    `Built-in: ${agent.is_builtin ? "Yes" : "No"}`
  );
}

function handleAgents(agentRegistry: AgentRegistry): string {
  const agents = agentRegistry.getAllAgents();
  if (agents.length === 0) return "No agents available.";

  let text = "🤖 Available Agents:\n\n";
  for (const agent of agents) {
    const tag = agent.is_builtin ? " [built-in]" : "";
    text += `• ${agent.name}${tag} — ${agent.model_provider}/${agent.model_name}\n`;
    if (agent.description) {
      text += `  ${agent.description}\n`;
    }
  }

  return text;
}
