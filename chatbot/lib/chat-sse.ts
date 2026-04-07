/**
 * Discriminated union for the SSE events streamed from POST /api/chat.
 *
 * These are our own protocol types that wrap the Agent SDK events —
 * not the SDK's internal types, which are for query() consumption only.
 */

import type { StreamedResult } from "./query-tools";

/** session_id emitted on the first turn so the hook can resume later */
export type ChatSseSession = { type: "session"; sessionId: string };

/** Incremental text delta from a content_block_delta / text_delta stream event */
export type ChatSseText = { type: "text"; content: string };

/** Thinking delta from a content_block_delta / thinking_delta stream event */
export type ChatSseThinking = { type: "thinking"; content: string };

/** Tool call started — name of the tool being invoked */
export type ChatSseToolCall = { type: "tool_call"; name: string };

/** Tool call input — full JSON args, emitted when input block completes */
export type ChatSseToolInput = { type: "tool_input"; content: string };

/** Full result from ResultMessage — fallback when no text_delta was emitted */
export type ChatSseResult = { type: "result"; content: string };

/** Error from the query() loop or network */
export type ChatSseError = { type: "error"; content: string };

/** Terminal event — stream is done */
export type ChatSseDone = { type: "done" };

/** User pressed Stop — task was cancelled */
export type ChatSseCancelled = { type: "cancelled" };

/** Live progress from a downstream A2A task — emitted during await_* polling */
export type ChatSseProgress = { type: "progress"; result: StreamedResult };

/**
 * Permission request — Claude needs user approval to use a tool.
 * The browser should display a confirmation dialog and POST the decision
 * to /api/chat/permission with { requestId, allowed }.
 */
export type ChatSsePermission = {
  type: "permission";
  requestId: string;
  toolName: string;
  toolInput: unknown;
  /** Full prompt sentence from the bridge, e.g. "Claude wants to write to settings.json" */
  title?: string;
};

export type ChatSseEvent =
  | ChatSseSession
  | ChatSseText
  | ChatSseThinking
  | ChatSseToolCall
  | ChatSseToolInput
  | ChatSseResult
  | ChatSseError
  | ChatSseProgress
  | ChatSseCancelled
  | ChatSseDone
  | ChatSsePermission;

/**
 * Returns an onSnapshot callback that delta-tracks a StreamedResult and
 * forwards only new/updated progress entries via send({ type: "progress" }).
 */
export function makeProgressSender(
  send: (event: ChatSseEvent) => void,
): (result: StreamedResult) => void {
  let lastSentCount = 0;
  let lastSentArtifactCount = 0;
  return (result: StreamedResult) => {
    const newEntries = result.progress.slice(lastSentCount);
    const lastEntry = result.progress.at(-1);
    const artifactCount = lastEntry ? Object.keys(lastEntry.artifacts).length : 0;
    if (newEntries.length > 0) {
      lastSentCount = result.progress.length;
      lastSentArtifactCount = artifactCount;
      send({ type: "progress", result: { output: result.output, progress: newEntries } });
    } else if (lastEntry && artifactCount > lastSentArtifactCount) {
      lastSentArtifactCount = artifactCount;
      send({ type: "progress", result: { output: result.output, progress: [lastEntry] } });
    }
  };
}
