import type { ChatSseEvent } from "@/lib/chat-sse";

export type SseHandler = (
  send: (event: ChatSseEvent) => void,
  connectionController: AbortController, // fires on browser disconnect — NOT the subprocess controller
) => Promise<void>;

/**
 * Creates a streaming SSE Response from an async handler.
 *
 * Separates connection lifecycle (connectionController, wired to request.signal) from
 * subprocess lifecycle (subprocessController, owned by the caller). The handler receives
 * only the connectionController so it can react to browser disconnects without accidentally
 * killing long-running background subprocesses.
 *
 * The handler is responsible for its own error handling and sending terminal events
 * (done/cancelled/error).
 */
export function createSseResponse(
  request: Request,
  subprocessController: AbortController, // caller-owned, NOT wired to request.signal
  handler: SseHandler,
): Response {
  const encoder = new TextEncoder();
  const connectionController = new AbortController();
  request.signal.addEventListener("abort", () => connectionController.abort());

  const readable = new ReadableStream<Uint8Array>({
    cancel() {
      connectionController.abort();
    },
    start(controller) {
      const send = (payload: ChatSseEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      return handler(send, connectionController).finally(() => {
        connectionController.abort();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
