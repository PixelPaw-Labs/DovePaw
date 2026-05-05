/**
 * Shared query() event stream consumer.
 *
 * Parses the raw AsyncIterable from query() and dispatches each event to a
 * QueryResponseDispatcher. All internal parsing state (tool input buffering,
 * block tracking) lives here — dispatchers stay stateless per-event.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKSystemMessage,
  SDKTaskProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";

/** Type guard — `task_id` is unique to SDKTaskProgressMessage among system subtypes. */
function isTaskProgress(event: SDKMessage): event is SDKTaskProgressMessage {
  return event.type === "system" && "task_id" in event;
}

/** Type guard — only SDKSystemMessage has `subtype: "init"` with a session_id. */
function isSystemInit(event: SDKMessage): event is SDKSystemMessage {
  return (
    event.type === "system" &&
    "session_id" in event &&
    !("task_id" in event) &&
    !("hook_id" in event) &&
    !("task_type" in event)
  );
}
import type { QueryResponseDispatcher } from "@/lib/query-dispatcher";

/**
 * Create an in-process MCP server, run a query with it, then close it.
 * Guarantees `instance.close()` is called regardless of success, abort, or error.
 */
export async function withMcpQuery(
  tools: Parameters<typeof createSdkMcpServer>[0]["tools"],
  run: (mcpServer: ReturnType<typeof createSdkMcpServer>) => Promise<void>,
  onError?: (err: unknown, isAbort: boolean) => void,
): Promise<void> {
  const mcpServer = createSdkMcpServer({ name: "agents", tools });
  try {
    await run(mcpServer);
  } catch (err: unknown) {
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || err.message === "Operation aborted");
    onError?.(err, isAbort);
  } finally {
    try {
      await mcpServer.instance.close();
    } catch {
      // Already closed or never connected
    }
  }
}

export async function consumeQueryEvents(
  events: AsyncIterable<SDKMessage>,
  dispatcher: QueryResponseDispatcher,
  /** Called once when the session ID is first known (system init event).
   *  Use to create the initial DB row so sessions appear in history immediately. */
  onSessionStart?: (sessionId: string) => void,
): Promise<string | null> {
  let sessionId: string | null = null;
  let toolInputBuf = "";
  let inToolBlock = false;

  for await (const event of events) {
    if (isSystemInit(event) && event.session_id !== sessionId) {
      sessionId = event.session_id;
      dispatcher.onSession(event.session_id);
      onSessionStart?.(event.session_id);
    } else if (isTaskProgress(event)) {
      const toolUseId = event.tool_use_id ?? "";
      const description = event.description;
      const lastTool = event.last_tool_name ?? "";
      if (toolUseId) dispatcher.onTaskProgress(toolUseId, description, lastTool);
    } else if (event.type === "stream_event") {
      const partial = event.event;

      if (partial.type === "content_block_start") {
        if (partial.content_block.type === "tool_use") {
          dispatcher.onToolCall(partial.content_block.name, partial.content_block.id);
          toolInputBuf = "";
          inToolBlock = true;
        } else {
          inToolBlock = false;
        }
      } else if (partial.type === "content_block_delta") {
        if (partial.delta.type === "text_delta") {
          dispatcher.onTextDelta(partial.delta.text);
        } else if (partial.delta.type === "thinking_delta") {
          dispatcher.onThinking(partial.delta.thinking);
        } else if (partial.delta.type === "input_json_delta") {
          toolInputBuf += partial.delta.partial_json;
        }
      } else if (partial.type === "content_block_stop") {
        if (inToolBlock && toolInputBuf) {
          try {
            dispatcher.onToolInput(JSON.stringify(JSON.parse(toolInputBuf), null, 2));
          } catch {
            dispatcher.onToolInput(toolInputBuf);
          }
          toolInputBuf = "";
          inToolBlock = false;
        }
      }
    } else if (event.type === "result" && event.subtype === "success") {
      dispatcher.onFinalOutput(event.result);
    }
  }
  return sessionId;
}
