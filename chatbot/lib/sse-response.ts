import type { ChatSseEvent } from "@/lib/chat-sse";

export type SseHandler = (
  send: (event: ChatSseEvent) => void,
  abortController: AbortController,
) => Promise<void>;

/**
 * Creates a streaming SSE Response from an async handler.
 *
 * Wires request abort to the AbortController, provides a typed `send` helper,
 * and closes the stream after the handler settles. The handler is responsible
 * for its own error handling and sending terminal events (done/cancelled/error).
 */
export function createSseResponse(request: Request, handler: SseHandler): Response {
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const readable = new ReadableStream<Uint8Array>({
    cancel() {
      abortController.abort();
    },
    start(controller) {
      const send = (payload: ChatSseEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      return handler(send, abortController).finally(() => {
        abortController.abort();
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
