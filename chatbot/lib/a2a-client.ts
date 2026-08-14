/**
 * A2A client helpers shared across query-tools MCP tool factories.
 *
 *   resolveAgentPort      — port lookup from the ports manifest
 *   createAgentClient     — create A2A Client for a port
 *   streamCollect         — async generator: yields chunk + snapshot events from an A2A stream
 *   subscribeTaskStream   — async generator: resubscribe + yield events, cancels on abort
 *   collectStreamResult   — thin drain wrapper: consumes streamCollect, returns final CollectedStream
 *   extractArtifactResult — build StreamedResult from terminal task artifacts
 */

import { CancelTaskRequest, GetTaskRequest, SubscribeToTaskRequest, TaskState } from "@a2a-js/sdk";
import type { Artifact, Part } from "@a2a-js/sdk";
import type { Client } from "@a2a-js/sdk/client";
import type { A2AStreamEvent } from "@@/lib/a2a-client";
import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import type { PortsManifest } from "@/a2a/lib/ports-manifest";
import { TRANSIENT_ARTIFACT_NAMES, ARTIFACT } from "@/lib/query-dispatcher";
import { agentPersistentLogDir, DOVEPAW_AGENT_LOGS } from "@/lib/paths";
import type { ProgressEntry } from "@/lib/progress";
export type { ProgressEntry } from "@/lib/progress";
export { createAgentClient, startAgentStream } from "@@/lib/a2a-client";
export type { A2AStreamEvent, AgentStreamHandle } from "@@/lib/a2a-client";

/**
 * Fallback message when an agent produces no output.
 * Includes the agent-specific log path when agentName is provided.
 */
export const noAgentOutput = (agentName?: string): string => {
  const logPath = agentName ? agentPersistentLogDir(agentName) : DOVEPAW_AGENT_LOGS;
  return `Something wrong with agent. Check agent logs at ${logPath}.`;
};

/** The collected output of a completed A2A task stream. */
export type CollectedStream = {
  /** A2A task ID, present when the stream included a task event. */
  taskId?: string;
  /** Full result built from the stream's artifact and status events. */
  result: StreamedResult;
};

/**
 * Terminal task states in DovePaw's own vocabulary. Distinct from the SDK's
 * TaskState because this is what reaches the MCP structuredContent, the
 * PostToolUse hook contract (AwaitToolStatus, which also carries the
 * DovePaw-only "still_running") and the UI.
 */
export type TaskFinalState = "completed" | "failed" | "canceled" | "rejected";

/** Terminal SDK states only — non-terminal states have no DovePaw equivalent. */
const FINAL_STATES = new Map<TaskState, TaskFinalState>([
  [TaskState.TASK_STATE_COMPLETED, "completed"],
  [TaskState.TASK_STATE_FAILED, "failed"],
  [TaskState.TASK_STATE_CANCELED, "canceled"],
  [TaskState.TASK_STATE_REJECTED, "rejected"],
]);

/** Read the text out of an SDK Part, or undefined when it is not a text part. */
function partText(part: Part): string | undefined {
  return part.content?.$case === "text" ? part.content.value : undefined;
}

export type StreamedResult = {
  /** Primary text output (from artifact-update events), joined for readability. */
  output: string;
  /** Progress messages, each carrying its linked artifacts inline. */
  progress: ProgressEntry[];
  /** Agent's extended thinking, concatenated from all thinking artifact chunks. */
  thinking?: string;
  /** Tool calls made by the agent, formatted as "toolName: args". */
  toolCalls?: string[];
  /** Terminal task state from the final status-update event. */
  finalState?: TaskFinalState;
};

/**
 * Event emitted by streamCollect.
 *
 *   chunk    — a raw artifact text part (fires for every artifact, including thinking/tool-call)
 *   snapshot — current StreamedResult after each status or artifact update; also fired once at the
 *              end so drain callers always receive a final result even for empty streams
 */
export type StreamEvent =
  | { kind: "chunk"; name: string; text: string }
  | { kind: "snapshot"; taskId?: string; result: StreamedResult };

function getManifestPort(manifest: PortsManifest, key: string): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(manifest, key)) return undefined;
  const val = (manifest as Record<string, unknown>)[key];
  return typeof val === "number" ? val : undefined;
}

/** Resolve agent port from the ports manifest, or null if servers are unavailable. */
export function resolveAgentPort(manifestKey: string): number | null {
  const manifest = readPortsManifest();
  if (!manifest) return null;
  return getManifestPort(manifest, manifestKey) ?? null;
}

function accumulate(target: Record<string, string>, name: string, text: string): void {
  target[name] = target[name] ? `${target[name]}\n${text}` : text;
}

/**
 * Consume an A2A event stream, yielding StreamEvents.
 *
 * Yields `{ kind: "chunk" }` for every artifact text part (including thinking, tool-call, etc.).
 * Yields `{ kind: "snapshot" }` after each status-update or non-transient artifact-update so
 * callers can forward live progress to the UI. Always yields a final snapshot before returning,
 * so drain callers always receive at least one snapshot even for empty streams.
 */
export async function* streamCollect(
  stream: AsyncGenerator<A2AStreamEvent, void, undefined>,
  agentName?: string,
): AsyncGenerator<StreamEvent, void, undefined> {
  let taskId: string | undefined;
  let finalState: TaskFinalState | undefined;
  const progress: ProgressEntry[] = [];
  let pendingEntry: ProgressEntry | undefined;
  const thinkingChunks: string[] = [];
  const toolCalls: string[] = [];
  let pendingToolCall = "";

  const snapshot = (): StreamedResult => {
    const finalEntry = progress.toReversed().find((e) => ARTIFACT.FINAL_OUTPUT in e.artifacts);
    const output = (finalEntry?.artifacts[ARTIFACT.FINAL_OUTPUT] ?? "").trim();
    return {
      output: output || noAgentOutput(agentName),
      progress: progress.map((e) => ({ ...e, artifacts: { ...e.artifacts } })),
      thinking: thinkingChunks.join("").trim(),
      finalState,
      toolCalls: [...toolCalls],
    };
  };

  for await (const event of stream) {
    const { payload } = event;
    if (payload?.$case === "task") {
      const task = payload.value;
      taskId = task.id;
      // A terminal Task snapshot arrives on its own, with no artifactUpdate or
      // statusUpdate events following (the EventQueue was destructively consumed by
      // the initial stream in start_*) — either as the first event of a live stream,
      // or synthesised by resubscribeOrSnapshot for an already-finished task. Extract
      // the output from the task's stored artifacts, which ResultManager populated
      // during execution.
      const state = task.status && FINAL_STATES.get(task.status.state);
      if (state) {
        finalState = state;
        const stored = extractArtifactResult(task.artifacts, agentName);
        if (stored.thinking) thinkingChunks.push(stored.thinking);
        if (stored.output !== noAgentOutput(agentName)) {
          const entry: ProgressEntry = {
            message: "",
            artifacts: { [ARTIFACT.FINAL_OUTPUT]: stored.output },
          };
          progress.push(entry);
          pendingEntry = entry;
        }
      }
    } else if (payload?.$case === "artifactUpdate") {
      const { artifact } = payload.value;
      if (!artifact) continue;
      const name = artifact.name;
      for (const p of artifact.parts) {
        const text = partText(p);
        if (text !== undefined) {
          yield { kind: "chunk", name, text };
          if (name === ARTIFACT.THINKING) {
            thinkingChunks.push(text);
          } else if (name === ARTIFACT.TOOL_CALL) {
            pendingToolCall = text;
          } else if (name === ARTIFACT.TOOL_INPUT && pendingToolCall) {
            toolCalls.push(`${pendingToolCall}: ${text}`);
            pendingToolCall = "";
          }
          // final-output must always be captured. A resumed session may respond
          // without any tool calls, so pendingEntry may never be set — create an
          // implicit entry to hold it rather than dropping the artifact.
          if (name === ARTIFACT.FINAL_OUTPUT && !pendingEntry) {
            pendingEntry = { message: "", artifacts: {} };
            progress.push(pendingEntry);
          }
          if (pendingEntry && !(TRANSIENT_ARTIFACT_NAMES as Set<string>).has(name)) {
            accumulate(pendingEntry.artifacts, name, text);
            yield { kind: "snapshot", taskId, result: snapshot() };
          }
        }
      }
    } else if (payload?.$case === "statusUpdate") {
      // v1.0 dropped the `final` flag — terminality is derived from the state itself.
      const { status } = payload.value;
      const state = status && FINAL_STATES.get(status.state);
      if (state) {
        finalState = state;
        for (const p of status?.message?.parts ?? []) {
          const text = partText(p);
          if (text) {
            const entry: ProgressEntry = {
              message: text,
              artifacts: { [ARTIFACT.FINAL_OUTPUT]: text },
            };
            progress.push(entry);
            pendingEntry = entry;
          }
        }
      } else if (status?.message) {
        for (const p of status.message.parts) {
          const text = partText(p);
          if (text !== undefined) {
            const entry: ProgressEntry = { message: text, artifacts: {} };
            progress.push(entry);
            pendingEntry = entry;
            yield { kind: "snapshot", taskId, result: snapshot() };
          }
        }
      }
    }
  }

  yield { kind: "snapshot", taskId, result: snapshot() };
}

/**
 * Resubscribe to a task's live event stream, falling back to its stored snapshot.
 *
 * Since SDK v1.0 the server REJECTS a subscribe to a task that already reached a
 * terminal state ("Task <id> is in a terminal state (3) and cannot be subscribed
 * to"), where v0.3 replied with the Task snapshot. That rejection is the normal
 * case for await_* whenever its start_* task finished first, so recover the
 * result via getTask — its artifacts are what ResultManager stored during
 * execution, and the task branch of streamCollect already knows how to read them.
 *
 * Only a pre-stream failure is recoverable: once events have been delivered the
 * stream was genuinely interrupted. getTask surfaces its own errors (task gone,
 * server down) so the caller's existing handling still applies.
 */
async function* resubscribeOrSnapshot(
  client: Client,
  taskId: string,
  signal: AbortSignal,
): AsyncGenerator<A2AStreamEvent, void, undefined> {
  let delivered = false;
  try {
    for await (const event of client.resubscribeTask(
      SubscribeToTaskRequest.fromJSON({ id: taskId }),
      { signal },
    )) {
      delivered = true;
      yield event;
    }
    return;
  } catch (err) {
    if (delivered || signal.aborted) throw err;
  }
  const task = await client.getTask(GetTaskRequest.fromJSON({ id: taskId }));
  yield { payload: { $case: "task", value: task } };
}

/**
 * Subscribe to a task's live event stream, yielding StreamEvents.
 * Aborts the stream and cancels the task when signal fires.
 */
export async function* subscribeTaskStream(
  client: Client,
  taskId: string,
  signal?: AbortSignal,
  agentName?: string,
): AsyncGenerator<StreamEvent, void, undefined> {
  const ac = new AbortController();
  signal?.addEventListener(
    "abort",
    () => {
      ac.abort();
      void client.cancelTask(CancelTaskRequest.fromJSON({ id: taskId })).catch(() => {});
    },
    { once: true },
  );
  yield* streamCollect(resubscribeOrSnapshot(client, taskId, ac.signal), agentName);
}

/**
 * Consume an A2A event stream and return the final CollectedStream.
 * Thin drain wrapper around streamCollect for callers that only need the terminal result.
 */
export async function collectStreamResult(
  stream: AsyncGenerator<A2AStreamEvent, void, undefined>,
  agentName?: string,
): Promise<CollectedStream> {
  let out: CollectedStream = { result: { output: noAgentOutput(agentName), progress: [] } };
  for await (const event of streamCollect(stream, agentName)) {
    if (event.kind === "snapshot") out = { taskId: event.taskId, result: event.result };
  }
  return out;
}

// ─── Stream context formatter ─────────────────────────────────────────────────

/**
 * Format a StreamedResult into a structured text block for LLM consumption.
 * Used by makeChatToTool, makeAwaitTool, makeReviewTool, makeEscalateTool so
 * every level of the call chain returns consistent context to its caller.
 */
export function formatAgentStreamContext(
  result: StreamedResult,
  contextId: string,
  displayName: string,
): string {
  const lines: string[] = [
    `Agent ${displayName} finished — state: ${result.finalState ?? "unknown"}.`,
    `Session contextId: ${contextId} (pass as contextId to continue this conversation).`,
  ];
  if (result.thinking) lines.push(`\n<thinking>\n${result.thinking}\n</thinking>`);
  if (result.toolCalls && result.toolCalls.length > 0)
    lines.push(`\n<actions>\n${result.toolCalls.map((t) => `- ${t}`).join("\n")}\n</actions>`);
  if (result.output) lines.push(`\n<response>\n${result.output}\n</response>`);
  return lines.join("\n");
}

/** Build a StreamedResult from terminal task artifacts (no live stream needed). */
export function extractArtifactResult(
  rawArtifacts: Artifact[] | undefined,
  agentName?: string,
): StreamedResult {
  const artifacts: Record<string, string> = {};
  for (const a of rawArtifacts ?? []) {
    for (const p of a.parts) {
      const text = partText(p);
      if (text !== undefined)
        artifacts[a.name] = artifacts[a.name] ? `${artifacts[a.name]}\n${text}` : text;
    }
  }
  // Prefer final-output (complete response), fall back to stream (accumulated text deltas).
  // Never include tool-call, tool-input, or thinking in the text output.
  const output =
    (artifacts[ARTIFACT.FINAL_OUTPUT] || artifacts[ARTIFACT.STREAM] || "").trim() ||
    noAgentOutput(agentName);
  return { output, progress: [], thinking: artifacts[ARTIFACT.THINKING] ?? "", toolCalls: [] };
}
