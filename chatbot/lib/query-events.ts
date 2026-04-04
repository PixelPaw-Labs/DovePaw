/**
 * Shared query() event stream consumer.
 *
 * Parses the raw AsyncIterable from query() and dispatches each event to a
 * QueryResponseDispatcher. All internal parsing state (tool input buffering,
 * block tracking) lives here — dispatchers stay stateless per-event.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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
): Promise<string | null> {
  let sessionId: string | null = null;
  let toolInputBuf = "";
  let inToolBlock = false;

  for await (const event of events) {
    if (event.type === "system") {
      sessionId = event.session_id;
      dispatcher.onSession(event.session_id);
    } else if (event.type === "stream_event") {
      const partial = event.event;

      if (partial.type === "content_block_start") {
        if (partial.content_block.type === "tool_use") {
          dispatcher.onToolCall(partial.content_block.name);
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
      dispatcher.onResult(event.result);
    }
  }
  return sessionId;
}
