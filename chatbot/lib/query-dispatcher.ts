/**
 * QueryResponseDispatcher — interface + two concrete implementations.
 *
 * consumeQueryEvents() calls the dispatcher for every parsed query() event.
 * Each implementation decides how to forward the event to its sink:
 *   - SseQueryDispatcher  → ChatSseEvent via send() (used by chat/route.ts)
 *   - A2AQueryDispatcher  → A2A artifact-update via eventBus (used by QueryAgentExecutor)
 */

import { randomUUID } from "node:crypto";
import type { ExecutionEventBus } from "@a2a-js/sdk/server";
import type { ChatSseEvent } from "@/lib/chat-sse";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface QueryResponseDispatcher {
  onSession(sessionId: string): void;
  onNewTurn(): void;
  onTextDelta(text: string): void;
  onThinking(text: string): void;
  onToolCall(name: string): void;
  onToolInput(content: string): void;
  onTurnEnd(): void;
  onResult(result: string): void;
}

// ─── SSE implementation ───────────────────────────────────────────────────────

/**
 * Forwards query() events as SSE events to the chat client.
 * Tracks turn count internally to inject \n\n separators between turns.
 */
export class SseQueryDispatcher implements QueryResponseDispatcher {
  private textTurnCount = 0;

  constructor(private readonly send: (event: ChatSseEvent) => void) {}

  onSession(sessionId: string): void {
    this.send({ type: "session", sessionId });
  }

  onNewTurn(): void {
    // Inject turn separator: "meow.Here's how..." → "meow.\n\nHere's how..."
    if (this.textTurnCount > 0) this.send({ type: "text", content: "\n\n" });
  }

  onTextDelta(text: string): void {
    if (this.textTurnCount === 0) this.textTurnCount = 1;
    this.send({ type: "text", content: text });
  }

  onThinking(text: string): void {
    this.send({ type: "thinking", content: text });
  }

  onToolCall(name: string): void {
    this.send({ type: "tool_call", name });
  }

  onToolInput(content: string): void {
    this.send({ type: "tool_input", content });
  }

  onTurnEnd(): void {
    if (this.textTurnCount > 0) this.textTurnCount++;
  }

  onResult(result: string): void {
    if (result) this.send({ type: "result", content: result });
  }
}

// ─── A2A implementation ───────────────────────────────────────────────────────

/**
 * Forwards query() events as A2A artifact-update events via the execution event bus.
 * Session and turn boundary events are no-ops (A2A manages its own task lifecycle).
 */
export class A2AQueryDispatcher implements QueryResponseDispatcher {
  constructor(
    private readonly eventBus: ExecutionEventBus,
    private readonly taskId: string,
    private readonly contextId: string,
  ) {}

  onSession(_sessionId: string): void {} // no-op: session IDs are for SSE clients

  onNewTurn(): void {} // no-op: A2A task state is managed by the executor

  onTurnEnd(): void {} // no-op

  onTextDelta(text: string): void {
    this.publish("stream", text);
  }

  onThinking(text: string): void {
    this.publish("thinking", text);
  }

  onToolCall(name: string): void {
    this.publish("tool-call", name);
  }

  onToolInput(content: string): void {
    this.publish("tool-input", content);
  }

  onResult(result: string): void {
    if (result) this.publish("final-output", result);
  }

  private publish(name: string, text: string): void {
    this.eventBus.publish({
      kind: "artifact-update",
      taskId: this.taskId,
      contextId: this.contextId,
      artifact: {
        artifactId: randomUUID(),
        name,
        parts: [{ kind: "text", text }],
      },
    });
  }
}
