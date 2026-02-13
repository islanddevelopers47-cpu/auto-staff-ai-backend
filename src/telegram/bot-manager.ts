import type Database from "better-sqlite3";
import { run } from "@grammyjs/runner";
import { createBotInstance, type BotInstance, type MessageHandler } from "./bot-factory.js";
import { listEnabledBots, setBotStatus, findBotById, type Bot } from "../database/bots.js";
import { findAgentById } from "../database/agents.js";
import type { AgentRegistry } from "../agents/agent-registry.js";
import { runAgent } from "../agents/agent-runner.js";
import { resolveApiKeyForBot, findFallbackProvider, type ProviderName } from "../agents/model-providers.js";
import { handleCommand } from "../auto-reply/commands.js";
import { createLogger } from "../utils/logger.js";
import { getPublicUrl } from "../config/env.js";
import type { EventBus } from "../gateway/events.js";

const log = createLogger("bot-manager");

export class BotManager {
  private db: Database.Database;
  private agentRegistry: AgentRegistry;
  private runningBots: Map<string, BotInstance> = new Map();
  private runners: Map<string, ReturnType<typeof run>> = new Map();
  public eventBus?: EventBus;

  constructor(db: Database.Database, agentRegistry: AgentRegistry) {
    this.db = db;
    this.agentRegistry = agentRegistry;
  }

  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  async autoStartBots(): Promise<void> {
    const bots = listEnabledBots(this.db);
    log.info(`Auto-starting ${bots.length} enabled bots...`);

    for (const bot of bots) {
      try {
        await this.startBot(bot.id);
      } catch (err) {
        log.error(`Failed to auto-start bot ${bot.name}: ${err}`);
        setBotStatus(this.db, bot.id, "error", String(err));
      }
    }
  }

  async startBot(botId: string): Promise<BotInstance> {
    // Stop if already running
    if (this.runningBots.has(botId)) {
      await this.stopBot(botId);
    }

    const botRecord = findBotById(this.db, botId);
    if (!botRecord) {
      throw new Error(`Bot ${botId} not found`);
    }

    log.info(`Starting bot "${botRecord.name}" (${botId})...`);

    const messageHandler: MessageHandler = async (msg, id) => {
      await this.handleInboundMessage(id, msg);
    };

    try {
      if (!botRecord.telegram_token) {
        throw new Error("Bot has no Telegram token configured");
      }

      const instance = await createBotInstance(
        botRecord.telegram_token,
        botId,
        messageHandler
      );

      // Update bot info in DB
      setBotStatus(this.db, botId, "running");
      const { updateBot } = await import("../database/bots.js");
      updateBot(this.db, botId, {
        telegram_bot_username: instance.botInfo.username,
        telegram_bot_id: String(instance.botInfo.id),
      });

      // Start polling or webhook
      const publicUrl = getPublicUrl();
      if (botRecord.mode === "webhook" && publicUrl) {
        // Webhook mode — the Express handler is registered in the server
        const webhookUrl = `${publicUrl}/api/telegram/webhook/${botId}`;
        await instance.bot.api.setWebhook(webhookUrl);
        log.info(`Bot "${botRecord.name}" webhook set to ${webhookUrl}`);
      } else {
        // Polling mode
        const runner = run(instance.bot);
        this.runners.set(botId, runner);
        log.info(`Bot "${botRecord.name}" started polling`);
      }

      this.runningBots.set(botId, instance);

      // Emit event
      this.eventBus?.emit("bot:started", { botId, name: botRecord.name });

      return instance;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to start bot "${botRecord.name}": ${errMsg}`);
      setBotStatus(this.db, botId, "error", errMsg);
      throw err;
    }
  }

  async stopBot(botId: string): Promise<void> {
    const instance = this.runningBots.get(botId);
    if (!instance) return;

    log.info(`Stopping bot ${botId}...`);

    // Stop runner if polling
    const runner = this.runners.get(botId);
    if (runner) {
      runner.stop();
      this.runners.delete(botId);
    }

    // Remove webhook if set
    try {
      await instance.bot.api.deleteWebhook();
    } catch {
      // ignore
    }

    await instance.stop();
    this.runningBots.delete(botId);
    setBotStatus(this.db, botId, "stopped");

    this.eventBus?.emit("bot:stopped", { botId });
  }

  async stopAll(): Promise<void> {
    const ids = [...this.runningBots.keys()];
    for (const id of ids) {
      await this.stopBot(id);
    }
  }

  async restartBot(botId: string): Promise<void> {
    await this.stopBot(botId);
    await this.startBot(botId);
  }

  isRunning(botId: string): boolean {
    return this.runningBots.has(botId);
  }

  getBotInstance(botId: string): BotInstance | undefined {
    return this.runningBots.get(botId);
  }

  getRunningBotIds(): string[] {
    return [...this.runningBots.keys()];
  }

  private async handleInboundMessage(
    botId: string,
    msg: import("./types.js").InboundMessage
  ): Promise<void> {
    const botRecord = findBotById(this.db, botId);
    if (!botRecord) return;

    const instance = this.runningBots.get(botId);
    if (!instance) return;

    // Emit inbound event
    this.eventBus?.emit("message:inbound", {
      botId,
      chatId: msg.chatId,
      text: msg.text,
      sender: msg.senderName,
    });

    // Handle commands
    if (msg.isCommand && msg.command) {
      const cmdResult = await handleCommand(
        this.db,
        botId,
        msg,
        this.agentRegistry
      );
      if (cmdResult) {
        await instance.sendMessage(msg.chatId, cmdResult, {
          replyToMessageId: msg.messageId,
        });
        return;
      }
    }

    // Skip empty messages
    if (!msg.text.trim()) return;

    // Send typing indicator
    try {
      await instance.bot.api.sendChatAction(Number(msg.chatId), "typing");
    } catch {
      // ignore
    }

    // Get agent for this bot
    const agentId = botRecord.agent_id;
    const agent = agentId
      ? this.agentRegistry.getAgent(agentId)
      : this.agentRegistry.getDefaultAgent();

    if (!agent) {
      await instance.sendMessage(
        msg.chatId,
        "No AI agent configured for this bot. Use /help for setup instructions.",
        { replyToMessageId: msg.messageId }
      );
      return;
    }

    // Resolve API key from DB for this bot's provider
    let provider = agent.model_provider as ProviderName;
    let model = agent.model_name;
    let apiKey = resolveApiKeyForBot(this.db, botId, provider);

    // If primary provider has no key, try to fall back to another provider
    if (!apiKey && provider !== "ollama") {
      const fallback = findFallbackProvider(this.db, botId, provider);
      if (fallback) {
        log.info(
          `No key for ${provider}, falling back to ${fallback.provider}/${fallback.model}`
        );
        provider = fallback.provider;
        model = fallback.model;
        apiKey = fallback.apiKey;
      } else {
        // No provider has a key at all
        await instance.sendMessage(
          msg.chatId,
          `⚠️ No API key configured.\n\n` +
            `Please add at least one AI provider API key in the Claw Staffer dashboard:\n` +
            `Settings → API Keys\n\n` +
            `Supported: OpenAI, Anthropic, Google Gemini`,
          { replyToMessageId: msg.messageId }
        );
        return;
      }
    }

    log.info(
      `Using provider ${provider}/${model} for bot ${botId} (key: ${apiKey ? "found" : "env"})`
    );

    // Run the agent
    try {
      const result = await runAgent(this.db, agent, {
        botId,
        chatId: msg.chatId,
        chatType: msg.chatType,
        userMessage: msg.text,
        telegramMessageId: msg.messageId,
        senderName: msg.senderName,
        apiKeyOverride: apiKey,
        providerOverride: provider,
        modelOverride: model,
      });

      // Send response
      await instance.sendMessage(msg.chatId, result.response, {
        replyToMessageId: msg.messageId,
      });

      // Emit outbound event
      this.eventBus?.emit("message:outbound", {
        botId,
        chatId: msg.chatId,
        text: result.response,
        model: result.model,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error(`Agent error for bot ${botId}: ${errMsg}`);

      // Provide specific error feedback
      let userMessage: string;
      if (errMsg.includes("API key") || errMsg.includes("401") || errMsg.includes("403")) {
        userMessage =
          `🔑 API key error for ${provider}. Your key may be invalid or expired.\n\n` +
          `Please check your API key in the Claw Staffer dashboard → Settings → API Keys.`;
      } else if (errMsg.includes("429") || errMsg.includes("rate limit")) {
        userMessage = "⏳ Rate limit reached. Please wait a moment and try again.";
      } else if (errMsg.includes("timeout") || errMsg.includes("ECONNREFUSED")) {
        userMessage = `🔌 Could not connect to ${provider}. The service may be down. Please try again later.`;
      } else {
        userMessage = `❌ Error processing your message: ${errMsg}`;
      }

      await instance.sendMessage(msg.chatId, userMessage, {
        replyToMessageId: msg.messageId,
      });

      this.eventBus?.emit("agent:error", {
        botId,
        chatId: msg.chatId,
        error: errMsg,
      });
    }
  }
}
