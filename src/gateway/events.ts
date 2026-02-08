import { EventEmitter } from "node:events";
import { createLogger } from "../utils/logger.js";

const log = createLogger("events");

export type EventType =
  | "bot:started"
  | "bot:stopped"
  | "bot:error"
  | "message:inbound"
  | "message:outbound"
  | "agent:error"
  | "system:info";

export interface EventPayload {
  botId?: string;
  chatId?: string;
  text?: string;
  sender?: string;
  model?: string;
  error?: string;
  name?: string;
  message?: string;
  [key: string]: unknown;
}

export class EventBus extends EventEmitter {
  emit(event: EventType, payload: EventPayload): boolean {
    log.debug(`Event: ${event}`, payload);
    return super.emit(event, payload);
  }

  onEvent(event: EventType, handler: (payload: EventPayload) => void): void {
    this.on(event, handler);
  }

  onAny(handler: (event: EventType, payload: EventPayload) => void): void {
    const events: EventType[] = [
      "bot:started",
      "bot:stopped",
      "bot:error",
      "message:inbound",
      "message:outbound",
      "agent:error",
      "system:info",
    ];
    for (const event of events) {
      this.on(event, (payload: EventPayload) => handler(event, payload));
    }
  }
}
