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
import { z } from "zod";
import type { MessageSegment, SessionMessage } from "@/lib/message-types";
import type { ProgressEntry } from "@/lib/a2a-client";

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

// ─── MessageAccumulator ───────────────────────────────────────────────────────

/**
 * Segment types that are rendered in the UI chat bubble.
 * Any segment type NOT listed here is treated as process content (stored in processContent).
 * When adding a new MessageSegment type, opt it in here only if it belongs in the message body.
 */
const MESSAGE_SEGMENT_TYPES = new Set<MessageSegment["type"]>(["text"]);

/**
 * Owns the segment accumulation logic for building an assistant SessionMessage.
 * Extracted from SseQueryDispatcher so it can be composed and tested independently.
 */
export class MessageAccumulator {
  private _segments: MessageSegment[] = [];
  private _textBuffer = "";
  private _thinkingBuffer = "";
  private _pendingToolName: string | null = null;
  private _progress: ProgressEntry[] = [];

  onTextDelta(text: string): void {
    this._textBuffer += text;
  }

  onThinking(text: string): void {
    this._thinkingBuffer += text;
  }

  onToolCall(name: string): ProgressEntry {
    if (this._textBuffer) {
      this._segments.push({ type: "text", content: this._textBuffer });
      this._textBuffer = "";
    }
    this._pendingToolName = name;
    const entry: ProgressEntry = { message: name, artifacts: { [ARTIFACT.TOOL_CALL]: name } };
    this._progress.push(entry);
    return entry;
  }

  buildProgress(): ProgressEntry[] {
    return this._progress;
  }

  onToolInput(content: string): void {
    if (this._pendingToolName) {
      try {
        const input = z.record(z.string(), z.unknown()).parse(JSON.parse(content));
        this._segments.push({ type: "tool_call", tool: { name: this._pendingToolName, input } });
      } catch {
        this._segments.push({
          type: "tool_call",
          tool: { name: this._pendingToolName, input: { raw: content } },
        });
      }
      this._pendingToolName = null;
    }
  }

  buildMessage(id: string): SessionMessage {
    const allSegments: MessageSegment[] = [...this._segments];
    if (this._textBuffer) allSegments.push({ type: "text", content: this._textBuffer });

    const messageSegments = allSegments.filter((s) => MESSAGE_SEGMENT_TYPES.has(s.type));

    return {
      id,
      role: "assistant",
      segments: messageSegments,
      processContent: this._thinkingBuffer || undefined,
    };
  }
}

// ─── SSE implementation ───────────────────────────────────────────────────────

/**
 * Forwards query() events as SSE events to the chat client.
 */
export class SseQueryDispatcher implements QueryResponseDispatcher {
  private readonly accumulator = new MessageAccumulator();

  constructor(private readonly send: (event: ChatSseEvent) => void) {}

  buildAssistantMessage(id: string): SessionMessage {
    return this.accumulator.buildMessage(id);
  }

  buildProgress(): ProgressEntry[] {
    return this.accumulator.buildProgress();
  }

  onSession(sessionId: string): void {
    this.send({ type: "session", sessionId });
  }

  onTextDelta(text: string): void {
    this.accumulator.onTextDelta(text);
    this.send({ type: "text", content: text });
  }

  onThinking(text: string): void {
    this.accumulator.onThinking(text);
    this.send({ type: "thinking", content: text });
  }

  onToolCall(name: string): void {
    const entry = this.accumulator.onToolCall(name);
    this.send({ type: "tool_call", name });
    this.send({ type: "progress", result: { output: "", progress: [entry] } });
  }

  onToolInput(content: string): void {
    this.accumulator.onToolInput(content);
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
