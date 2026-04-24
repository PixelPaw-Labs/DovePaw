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
import type {
  AgentInput,
  BashInput,
  FileReadInput,
  FileEditInput,
  FileWriteInput,
  GlobInput,
  GrepInput,
  WebSearchInput,
  WebFetchInput,
  NotebookEditInput,
} from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import type { ProgressEntry } from "@/lib/a2a-client";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface QueryResponseDispatcher {
  onSession(sessionId: string): void;
  onTextDelta(text: string): void;
  onThinking(text: string): void;
  /** toolUseId is the SDK tool_use block id — passed so the node key matches onTaskProgress. */
  onToolCall(name: string, toolUseId?: string): void;
  onToolInput(content: string): void;
  onFinalOutput(result: string): void;
  onArtifact(name: string, text: string): void;
  /** Called for SDK task_progress events — live progress from Agent subagent tasks. */
  onTaskProgress(toolUseId: string, description: string, lastTool: string): void;
}

export { ARTIFACT, TRANSIENT_ARTIFACT_NAMES } from "@/lib/artifact-names";
import { ARTIFACT } from "@/lib/artifact-names";
import { isHandoffToolName } from "@/lib/agent-tools";
import { upsertSession } from "@/lib/db";
import { getSessionCurrentSeq, publishSessionEvent } from "@/lib/session-events";
import { relaySessionEvent } from "@/lib/relay-to-chatbot";

// ─── MessageAccumulator ───────────────────────────────────────────────────────

/**
 * Segment types that are rendered in the UI chat bubble.
 * Any segment type NOT listed here is treated as process content (stored in processContent).
 * When adding a new MessageSegment type, opt it in here only if it belongs in the message body.
 */
const MESSAGE_SEGMENT_TYPES = new Set<MessageSegment["type"]>(["text"]);

// ─── Tool label helpers ───────────────────────────────────────────────────────

const toStr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Ordered field names to try per tool — field names are verified at compile time
 * against the SDK input types using `satisfies`, so TypeScript catches renames.
 * Bash has two fields: description (human-readable, optional) preferred over command.
 */
const TOOL_LABEL_FIELDS: Partial<Record<string, readonly string[]>> = {
  Agent: ["description" satisfies keyof AgentInput],
  Bash: ["description" satisfies keyof BashInput, "command" satisfies keyof BashInput],
  Read: ["file_path" satisfies keyof FileReadInput],
  Edit: ["file_path" satisfies keyof FileEditInput],
  Write: ["file_path" satisfies keyof FileWriteInput],
  Glob: ["pattern" satisfies keyof GlobInput],
  Grep: ["pattern" satisfies keyof GrepInput],
  WebSearch: ["query" satisfies keyof WebSearchInput],
  WebFetch: ["url" satisfies keyof WebFetchInput],
  NotebookEdit: ["notebook_path" satisfies keyof NotebookEditInput],
} as const;

function describeToolCall(toolName: string, input: Record<string, unknown>): string {
  const fields = TOOL_LABEL_FIELDS[toolName];
  const val = fields?.map((f) => toStr(input[f])).find((v) => v !== null) ?? null;
  if (val) return `${toolName}: ${val}`;
  // Generic fallback for MCP / unknown tools — first string value in the input
  const firstStr =
    Object.values(input)
      .map(toStr)
      .find((v) => v !== null) ?? null;
  return firstStr ? `${toolName}: ${firstStr}` : toolName;
}

export class MessageAccumulator {
  private _segments: MessageSegment[] = [];
  private _textBuffer = "";
  private _thinkingBuffer = "";
  private _pendingToolName: string | null = null;
  private _pendingEntry: ProgressEntry | null = null;
  private _progress: ProgressEntry[] = [];
  private _taskProgressCounters = new Map<string, number>();
  private _saveConfig: IncrementalSaveConfig | null = null;
  private _textSavedLength = 0;
  private static readonly TEXT_SAVE_INTERVAL = 500;
  /** Stable ID reused across all saves so mergeMessages in db.ts deduplicates correctly. */
  private readonly _msgId: string = crypto.randomUUID();

  enableIncrementalSave(config: IncrementalSaveConfig): void {
    this._saveConfig = config;
  }

  onTextDelta(text: string): void {
    this._textBuffer += text;
    if (this._textBuffer.length - this._textSavedLength >= MessageAccumulator.TEXT_SAVE_INTERVAL) {
      this._textSavedLength = this._textBuffer.length;
      this.saveSnapshot();
    }
  }

  onThinking(text: string): void {
    this._thinkingBuffer += text;
  }

  onToolCall(name: string, toolUseId?: string): ProgressEntry {
    if (this._textBuffer) {
      this._segments.push({ type: "text", content: this._textBuffer });
      this._textBuffer = "";
    }
    this._pendingToolName = name;
    const key = toolUseId ?? name;
    const entry: ProgressEntry = {
      message: key,
      artifacts: { [ARTIFACT.TOOL_CALL]: name, label: name },
    };
    this._progress.push(entry);
    this._pendingEntry = entry;
    this.saveProgress();
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
        const description = describeToolCall(this._pendingToolName, input);
        if (this._pendingEntry) {
          this._pendingEntry.artifacts = { ...this._pendingEntry.artifacts, label: description };
        }
      } catch {
        this._segments.push({
          type: "tool_call",
          tool: { name: this._pendingToolName, input: { raw: content } },
        });
      }
      this._pendingToolName = null;
      this._pendingEntry = null;
    }
    this.saveProgress();
  }

  buildMessage(): SessionMessage {
    const allSegments: MessageSegment[] = [...this._segments];
    if (this._textBuffer) allSegments.push({ type: "text", content: this._textBuffer });

    const messageSegments = allSegments.filter((s) => MESSAGE_SEGMENT_TYPES.has(s.type));

    return {
      id: this._msgId,
      role: "assistant",
      segments: messageSegments,
      processContent: this._thinkingBuffer || undefined,
    };
  }

  onTaskProgress(toolUseId: string, description: string, lastTool: string): ProgressEntry | null {
    // Skip events where no inner tool has been called yet — lastTool is empty on the
    // first task_progress event fired before the Agent subagent calls anything.
    if (!lastTool) return null;
    // Each task_progress event is a distinct step — append a new entry with a unique
    // key so every inner tool call is captured in progress, not collapsed into one node.
    const count = (this._taskProgressCounters.get(toolUseId) ?? 0) + 1;
    this._taskProgressCounters.set(toolUseId, count);
    const entry: ProgressEntry = {
      message: `${toolUseId}_${count}`,
      artifacts: {
        [ARTIFACT.TOOL_CALL]: lastTool,
        label: describeToolCall(lastTool, { description }),
      },
    };
    this._progress.push(entry);
    this.saveProgress();
    return entry;
  }

  onFinalOutput(): void {
    this.saveSnapshot();
  }

  private saveSnapshot(): void {
    if (!this._saveConfig) return;
    const { sessionId, agentId, label, userMsgId, userText, senderAgentId } = this._saveConfig;
    const resumeSeq = getSessionCurrentSeq(sessionId);
    upsertSession({
      id: sessionId,
      agentId,
      startedAt: new Date().toISOString(),
      label,
      messages: [
        { id: userMsgId, role: "user", segments: [{ type: "text", content: userText }] },
        this.buildMessage(),
      ],
      progress: this._progress,
      resumeSeq,
      status: "running",
      senderAgentId,
    });
  }

  private saveProgress(): void {
    if (!this._saveConfig) return;
    const { sessionId, agentId, label, senderAgentId } = this._saveConfig;
    upsertSession({
      id: sessionId,
      agentId,
      startedAt: new Date().toISOString(),
      label,
      messages: [],
      progress: this._progress,
      status: "running",
      senderAgentId,
    });
  }
}

// ─── SSE implementation ───────────────────────────────────────────────────────

/**
 * Forwards query() events as SSE events to the chat client.
 */
export interface IncrementalSaveConfig {
  sessionId: string;
  agentId: string;
  label: string;
  userMsgId: string;
  userText: string;
  senderAgentId?: string;
}

export class SseQueryDispatcher implements QueryResponseDispatcher {
  private readonly accumulator = new MessageAccumulator();
  private sessionId: string | null;
  private readonly preSessionBuffer: ChatSseEvent[] = [];

  constructor(
    private readonly rawSend: (event: ChatSseEvent) => void,
    initialSessionId?: string,
  ) {
    this.sessionId = initialSessionId ?? null;
  }

  /**
   * Dual-publish: forward every event to the browser SSE stream AND to the
   * per-session event bus so background reconnect endpoints can replay them.
   * rawSend may throw if the SSE stream was cancelled (client disconnected) while
   * the subprocess is still running — swallow that error so publishSessionEvent
   * still runs and the event bus stays up to date.
   */
  readonly publish = (event: ChatSseEvent): void => {
    try {
      // Spread so publishSessionEvent's _seq stamp doesn't appear in the primary stream
      this.rawSend({ ...event });
    } catch {
      // SSE stream closed — subprocess continues as background session
    }
    if (this.sessionId) {
      publishSessionEvent(this.sessionId, event);
    } else {
      this.preSessionBuffer.push(event);
    }
  };

  /**
   * Enable incremental DB saves so a page refresh doesn't lose mid-session state.
   * Call once the session ID is known (e.g. after system:init).
   */
  enableIncrementalSave(config: IncrementalSaveConfig): void {
    this.accumulator.enableIncrementalSave(config);
  }

  buildAssistantMessage(): SessionMessage {
    return this.accumulator.buildMessage();
  }

  buildProgress(): ProgressEntry[] {
    return this.accumulator.buildProgress();
  }

  onSession(sessionId: string): void {
    this.sessionId = sessionId;
    for (const e of this.preSessionBuffer) publishSessionEvent(sessionId, e);
    this.preSessionBuffer.length = 0;
    this.publish({ type: "session", sessionId });
  }

  onTextDelta(text: string): void {
    this.accumulator.onTextDelta(text);
    this.publish({ type: "text", content: text });
  }

  onThinking(text: string): void {
    this.accumulator.onThinking(text);
    this.publish({ type: "thinking", content: text });
  }

  onToolCall(name: string, toolUseId?: string): void {
    const entry = this.accumulator.onToolCall(name, toolUseId);
    this.publish({ type: "tool_call", name });
    this.publish({ type: "progress", result: { output: "", progress: [entry] } });
  }

  onToolInput(content: string): void {
    this.accumulator.onToolInput(content);
    this.publish({ type: "tool_input", content });
  }

  onFinalOutput(result: string): void {
    if (result) this.publish({ type: "result", content: result });
    this.accumulator.onFinalOutput();
  }

  /** Maps an A2A artifact name to the appropriate SSE method. */
  onArtifact(name: string, text: string): void {
    if (name === ARTIFACT.STREAM) this.onTextDelta(text);
    else if (name === ARTIFACT.THINKING) this.onThinking(text);
    else if (name === ARTIFACT.TOOL_CALL) this.onToolCall(text);
    else if (name === ARTIFACT.TOOL_INPUT) this.onToolInput(text);
    else if (name === ARTIFACT.FINAL_OUTPUT) this.onFinalOutput(text);
  }

  onTaskProgress(toolUseId: string, description: string, lastTool: string): void {
    const entry = this.accumulator.onTaskProgress(toolUseId, description, lastTool);
    if (entry) this.publish({ type: "progress", result: { output: "", progress: [entry] } });
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
 * A MessageAccumulator runs alongside the publisher so QueryAgentExecutor can
 * build a clean SessionMessage (text-only segments, thinking → processContent)
 * for DB persistence without going through a second stream pass.
 *
 * Session events are no-ops — session IDs are meaningful only to SSE clients.
 * onArtifact is a no-op — replayed artifacts from the A2A stream are already
 * handled upstream; this dispatcher only produces, it never re-dispatches.
 */
export class A2AQueryDispatcher implements QueryResponseDispatcher {
  private readonly accumulator = new MessageAccumulator();

  private groupStreamText = "";
  // Set when a handoff tool (chat_to_*, review_with_*, escalate_to_*) is attempted.
  // Any text after that point is either handoff narration or declined-handoff reasoning —
  // neither belongs in the group pool stream.
  private handoffAttempted = false;

  /**
   * @param publisher   A2A event bus publisher (required)
   * @param sessionId   DB context ID for this session. When provided, events are relayed
   *                    to the Next.js chatbot so `/api/chat/stream/[sessionId]` can serve
   *                    the subagent's live stream.
   * @param groupRelay  When set, each text delta is also accumulated and relayed as a
   *                    `group_member` pool event to the group context stream.
   */
  constructor(
    private readonly publisher: ExecutorPublisher,
    private readonly sessionId?: string,
    private readonly groupRelay?: { groupContextId: string; agentName: string },
  ) {}

  /** Relay an event to the Next.js session event bus via HTTP (no-op when sessionId absent). */
  private emit(event: ChatSseEvent, toSessionId?: string): void {
    const id = toSessionId ?? this.sessionId;
    if (id) relaySessionEvent(id, event);
  }

  enableIncrementalSave(config: IncrementalSaveConfig): void {
    this.accumulator.enableIncrementalSave(config);
  }

  /** Build the assistant SessionMessage for DB persistence. */
  buildAssistantMessage(): SessionMessage {
    return this.accumulator.buildMessage();
  }

  /** Build workflow progress entries for DB persistence. */
  buildProgress(): ProgressEntry[] {
    return this.accumulator.buildProgress();
  }

  onSession(_sessionId: string): void {
    // Emit the A2A context ID (not the inner Claude session ID) so stream subscribers
    // know which session they are connected to.
    if (this.sessionId) this.emit({ type: "session", sessionId: this.sessionId });
  }

  onTextDelta(text: string): void {
    this.publisher.send(text, ARTIFACT.STREAM);
    this.accumulator.onTextDelta(text);
    this.emit({ type: "text", content: text });
    if (this.groupRelay && !this.handoffAttempted) {
      this.groupStreamText += text;
      this.emit(
        {
          type: "group_member",
          agentId: this.groupRelay.agentName,
          text: this.groupStreamText,
          done: false,
        },
        this.groupRelay.groupContextId,
      );
    }
  }

  onThinking(text: string): void {
    this.publisher.send(text, ARTIFACT.THINKING);
    this.accumulator.onThinking(text);
    // Skip relaying thinking to session stream in group mode — it is noise that
    // the group UI does not render, and saves unnecessary relay calls.
    if (!this.groupRelay) this.emit({ type: "thinking", content: text });
  }

  onToolCall(name: string, toolUseId?: string): void {
    const key = toolUseId ?? name;
    // publishStatusToUI (not send) so a ProgressEntry is created for DB persistence.
    // Use toolUseId as the key — onTaskProgress uses the same id so the accumulator
    // can merge the description label into this entry.
    // Include label: name so the entry title shows the tool name immediately — matching
    // SseQueryDispatcher behaviour. Without it the title falls back to the toolUseId UUID
    // because onTaskProgress is never called for background inner-agent tool calls.
    this.publisher.publishStatusToUI(key, { [ARTIFACT.TOOL_CALL]: name, label: name });
    const entry = this.accumulator.onToolCall(name, toolUseId);
    if (this.groupRelay) {
      // Discard text before this tool call — only post-tool text reaches the pool.
      this.groupStreamText = "";
      // Mark handoff attempts so any following text (narration or declined-handoff
      // reasoning) is suppressed from the group pool stream.
      this.handoffAttempted ||= isHandoffToolName(name);
    }
    this.emit({ type: "tool_call", name });
    this.emit({ type: "progress", result: { output: "", progress: [entry] } });
  }

  onToolInput(content: string): void {
    this.publisher.send(content, ARTIFACT.TOOL_INPUT);
    this.accumulator.onToolInput(content);
    this.emit({ type: "tool_input", content });
  }

  onFinalOutput(result: string): void {
    if (result) this.publisher.send(result, ARTIFACT.FINAL_OUTPUT);
    if (result) this.emit({ type: "result", content: result });
    this.accumulator.onFinalOutput();
    // Close the group bubble so subsequent responses create a new bubble.
    // For Dove-orchestrated members the drain also sends done:true — that's fine,
    // a second close is a no-op on the frontend.
    if (this.groupRelay) {
      this.emit(
        {
          type: "group_member",
          agentId: this.groupRelay.agentName,
          text: result,
          done: true,
        },
        this.groupRelay.groupContextId,
      );
    }
  }

  onArtifact(_name: string, _text: string): void {}

  onTaskProgress(toolUseId: string, description: string, lastTool: string): void {
    const entry = this.accumulator.onTaskProgress(toolUseId, description, lastTool);
    if (entry) {
      this.publisher.publishStatusToUI(entry.message, entry.artifacts);
      this.emit({ type: "progress", result: { output: "", progress: [entry] } });
    }
  }
}
