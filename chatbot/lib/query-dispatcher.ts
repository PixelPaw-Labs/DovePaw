/**
 * QueryResponseDispatcher — interface + two concrete implementations.
 *
 * consumeQueryEvents() calls the dispatcher for every parsed query() event.
 * The two implementations differ only in *transport* — the same logical events
 * travel different paths depending on where the query() call originates:
 *
 *   SseQueryDispatcher   — query initiated by the browser (chat/route.ts MCP tool).
 *                          Events go directly to the browser via the HTTP SSE stream.
 *
 *   A2AQueryDispatcher   — query initiated inside an A2A task (QueryAgentExecutor).
 *                          No direct browser connection exists; events are published
 *                          to the A2A event bus and reach the browser via the A2A SSE
 *                          stream, where await_* / start_* tools reconstruct them.
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
 * Artifact names that are streaming intermediaries — they carry content to the chat
 * bubble but must NOT be accumulated into workflow ProgressEntry nodes in
 * collectStreamResult. Only TOOL_CALL and FINAL_OUTPUT are structural enough to
 * warrant a workflow step; the rest are transient stream fragments.
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
 * Forwards query() events to the A2A execution event bus via ExecutorPublisher.
 * Used when query() runs inside an A2A task (QueryAgentExecutor) — there is no
 * direct SSE connection to the browser, so events must travel via A2A protocol.
 *
 * Two publish paths are used deliberately:
 *   send             — emits a bare artifact-update event. Transient content
 *                      (stream deltas, thinking, tool input) flows to the chat
 *                      bubble without creating a workflow ProgressEntry node.
 *   publishStatusToUI    — emits a status-update (+ artifact). Structural milestones
 *                      like tool calls are surfaced as workflow step nodes.
 *
 * Session events are no-ops — session IDs are meaningful only to SSE clients.
 * onArtifact is a no-op — replayed artifacts from the A2A stream are already
 * handled upstream; this dispatcher only produces, it never re-dispatches.
 */
export class A2AQueryDispatcher implements QueryResponseDispatcher {
  constructor(private readonly publisher: ExecutorPublisher) {}

  onSession(_sessionId: string): void {}

  onTextDelta(text: string): void {
    this.publisher.send(text, ARTIFACT.STREAM);
  }

  onThinking(text: string): void {
    this.publisher.send(text, ARTIFACT.THINKING);
  }

  onToolCall(name: string): void {
    // publishStatusToUI (not publishArtifact) so a workflow ProgressEntry node is created.
    this.publisher.publishStatusToUI(name, { [ARTIFACT.TOOL_CALL]: name });
  }

  onToolInput(content: string): void {
    this.publisher.send(content, ARTIFACT.TOOL_INPUT);
  }

  onResult(result: string): void {
    if (result) this.publisher.send(result, ARTIFACT.FINAL_OUTPUT);
  }

  onArtifact(_name: string, _text: string): void {}
}
