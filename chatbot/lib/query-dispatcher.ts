/**
 * QueryResponseDispatcher — interface + two concrete implementations.
 *
 * consumeQueryEvents() calls the dispatcher for every parsed query() event.
 * Each implementation decides how to forward the event to its sink:
 *   - SseQueryDispatcher  → ChatSseEvent via send() (used by chat/route.ts)
 *   - A2AQueryDispatcher  → A2A artifact-update via eventBus (used by QueryAgentExecutor)
 */

import type { ChatSseEvent } from "@/lib/chat-sse";
import type { ExecutorPublisher } from "@/a2a/lib/executor-publisher";

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
  constructor(private readonly publisher: ExecutorPublisher) {}

  onSession(_sessionId: string): void {} // no-op: session IDs are for SSE clients

  onNewTurn(): void {} // no-op: A2A task state is managed by the executor

  onTurnEnd(): void {} // no-op

  onTextDelta(_text: string): void {} // no-op: text deltas flood the workflow panel

  onThinking(_text: string): void {} // no-op: thinking tokens are not meaningful workflow steps

  onToolCall(name: string): void {
    this.publisher.publishStatus(name, { "tool-call": name });
  }

  onToolInput(_content: string): void {} // no-op: tool input JSON is not a workflow step

  onResult(result: string): void {
    if (result) this.publisher.publishStatus(result, { "final-output": result });
  }
}
