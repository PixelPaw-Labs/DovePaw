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
  onTextDelta(text: string): void;
  onThinking(text: string): void;
  onToolCall(name: string): void;
  onToolInput(content: string): void;
  onResult(result: string): void;
  onArtifact(name: string, text: string): void;
}

/** Artifact name constants — single source of truth for all A2A artifact names. */
export const ARTIFACT = {
  STREAM: "stream",
  THINKING: "thinking",
  TOOL_CALL: "tool-call",
  TOOL_INPUT: "tool-input",
  FINAL_OUTPUT: "final-output",
} as const;

/**
 * Artifact names that are transient chat-only signals — published via publishArtifact
 * without an accompanying status-update. These must NOT be accumulated into workflow
 * ProgressEntry nodes in collectStreamResult.
 */
export const TRANSIENT_ARTIFACT_NAMES = new Set([
  ARTIFACT.STREAM,
  ARTIFACT.THINKING,
  ARTIFACT.TOOL_INPUT,
]);

// ─── SSE implementation ───────────────────────────────────────────────────────

/**
 * Forwards query() events as SSE events to the chat client.
 */
export class SseQueryDispatcher implements QueryResponseDispatcher {
  constructor(private readonly send: (event: ChatSseEvent) => void) {}

  onSession(sessionId: string): void {
    this.send({ type: "session", sessionId });
  }

  onTextDelta(text: string): void {
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

  onResult(result: string): void {
    if (result) this.send({ type: "result", content: result });
  }

  /** Maps an A2A artifact name to the appropriate SSE method. */
  onArtifact(name: string, text: string): void {
    if (name === ARTIFACT.STREAM) this.onTextDelta(text);
    else if (name === ARTIFACT.THINKING) this.onThinking(text);
    else if (name === ARTIFACT.TOOL_CALL) this.onToolCall(text);
    else if (name === ARTIFACT.TOOL_INPUT) this.onToolInput(text);
    else if (name === ARTIFACT.FINAL_OUTPUT) this.onResult(text);
  }
}

// ─── A2A implementation ───────────────────────────────────────────────────────

/**
 * Forwards query() events as A2A artifact-update events via the execution event bus.
 * Session events are no-ops (A2A manages its own task lifecycle).
 */
export class A2AQueryDispatcher implements QueryResponseDispatcher {
  constructor(private readonly publisher: ExecutorPublisher) {}

  onSession(_sessionId: string): void {} // no-op: session IDs are for SSE clients

  onTextDelta(text: string): void {
    // Publish as artifact-only — no status-update, so no workflow node is created.
    this.publisher.publishArtifact(text, ARTIFACT.STREAM);
  }

  onThinking(text: string): void {
    this.publisher.publishArtifact(text, ARTIFACT.THINKING);
  }

  onToolCall(name: string): void {
    this.publisher.publishStatus(name, { [ARTIFACT.TOOL_CALL]: name });
  }

  onToolInput(content: string): void {
    this.publisher.publishArtifact(content, ARTIFACT.TOOL_INPUT);
  }

  onResult(result: string): void {
    // Publish as artifact-only so the result flows to the chatbot without
    // creating a workflow progress node for it.
    if (result) this.publisher.publishArtifact(result, ARTIFACT.FINAL_OUTPUT);
  }

  onArtifact(_name: string, _text: string): void {} // no-op: A2A publishes directly via publisher
}
