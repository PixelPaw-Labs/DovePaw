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

/** Error from the query() loop or network */
export type ChatSseError = { type: "error"; content: string };

/** Terminal event — stream is done. content is set when no text deltas were streamed (fallback). */
export type ChatSseDone = { type: "done"; content?: string };

/** User pressed Stop — task was cancelled */
export type ChatSseCancelled = { type: "cancelled" };

/** Live progress from a downstream A2A task — emitted during await_* polling. */
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

/** A single question option inside a ChatSseQuestion event. */
export type QuestionOption = {
  label: string;
  description: string;
};

/** A single question inside a ChatSseQuestion event. */
export type Question = {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
};

/**
 * AskUserQuestion request — Claude is asking the user clarifying questions.
 * The browser should render a question form and POST the answers to
 * /api/chat/question with { requestId, answers }.
 */
export type ChatSseQuestion = {
  type: "question";
  requestId: string;
  questions: Question[];
};

/** A member agent's output in a group task — keyed by agentId for demuxing. */
export type ChatSseGroupMember = {
  type: "group_member";
  agentId: string;
  text: string;
  done: boolean;
  sessionId?: string;
  /** True when this event carries an instruction FROM agentId TO the group, not a response. */
  isSender?: boolean;
};

export type ChatSseEvent =
  | ChatSseSession
  | ChatSseText
  | ChatSseThinking
  | ChatSseToolCall
  | ChatSseToolInput
  | ChatSseError
  | ChatSseProgress
  | ChatSseCancelled
  | ChatSseDone
  | ChatSsePermission
  | ChatSseQuestion
  | ChatSseGroupMember;

/**
 * "none" effort: suppresses all streaming text/tool/thinking events.
 * Emits done.content as a single batch once the result is confirmed clean.
 * Structural events (session, error, cancelled, permission, question, group_member) pass through.
 */
function buildNoneEffortSender(send: (event: ChatSseEvent) => void): (event: ChatSseEvent) => void {
  return (event: ChatSseEvent) => {
    if (
      event.type === "text" ||
      event.type === "thinking" ||
      event.type === "tool_call" ||
      event.type === "tool_input" ||
      event.type === "progress"
    ) {
      return;
    }
    if (event.type === "done") {
      if (event.content) {
        send({ type: "done", content: event.content });
        return;
      }
      send({ type: "done" });
      return;
    }
    send(event); // session, error, cancelled, permission, question, group_member
  };
}

/** "low" effort: streams text deltas and emits done. Suppresses thinking/tool/progress events.
 * Structural events (session, error, cancelled, permission, question, group_member) pass through.
 */
function buildLowEffortSender(send: (event: ChatSseEvent) => void): (event: ChatSseEvent) => void {
  return (event: ChatSseEvent) => {
    if (
      event.type === "thinking" ||
      event.type === "tool_call" ||
      event.type === "tool_input" ||
      event.type === "progress"
    ) {
      return;
    }
    if (event.type === "done") {
      if (event.content) {
        send({ type: "done", content: event.content });
        return;
      }
      send({ type: "done" });
      return;
    }
    send(event); // text, session, error, cancelled, permission, question, group_member
  };
}

/** Creates the SSE sender for the given effort level, wired to the stream controller. */
export function buildStreamSender(
  effort: "none" | "low" | "high",
  controller: ReadableStreamDefaultController<Uint8Array>,
): (event: ChatSseEvent) => void {
  const encoder = new TextEncoder();
  const raw = (payload: ChatSseEvent) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  if (effort === "none") return buildNoneEffortSender(raw);
  if (effort === "low") return buildLowEffortSender(raw);
  return raw;
}

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
