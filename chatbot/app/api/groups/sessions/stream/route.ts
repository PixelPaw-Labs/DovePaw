import { subscribeSessionStarted, type SessionStartedEvent } from "@/lib/group-session-events";

export const maxDuration = 86400;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

function encodeEvent(event: SessionStartedEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const agentIds = new Set(
    (url.searchParams.get("agentIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const onEvent = (event: SessionStartedEvent) => {
        if (!agentIds.has(event.agentId)) return;
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      subscribeSessionStarted(onEvent, request.signal);

      request.signal.addEventListener(
        "abort",
        () => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
        { once: true },
      );
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
