import { EventEmitter } from "node:events";

export interface SessionStartedEvent {
  agentId: string;
  sessionId: string;
}

const CHANNEL = "session-started";
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function publishSessionStarted(event: SessionStartedEvent): void {
  emitter.emit(CHANNEL, event);
}

export function subscribeSessionStarted(
  onEvent: (event: SessionStartedEvent) => void,
  signal: AbortSignal,
): void {
  emitter.on(CHANNEL, onEvent);
  signal.addEventListener("abort", () => emitter.off(CHANNEL, onEvent), { once: true });
}
