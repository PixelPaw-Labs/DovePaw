/**
 * GET /api/groups/stream/:groupContextId
 *
 * SSE endpoint that streams all member agent events for a group task.
 * Uses the same buffered session-events system as individual agent sessions,
 * so late-connecting clients get a replay of missed events.
 * Each SSE data payload is { agentId, text, type } (GroupStreamEvent shape).
 */

import { subscribeSession } from "@/lib/session-events";
import type { ChatSseGroupMember } from "@/lib/chat-sse";

export const maxDuration = 86400;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

function encodeGroupMember(event: ChatSseGroupMember): string {
  return `data: ${JSON.stringify({
    agentId: event.agentId,
    text: event.text,
    type: event.done ? "done" : "progress",
  })}\n\n`;
}

export function GET(request: Request, { params }: { params: Promise<{ groupContextId: string }> }) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { groupContextId } = await params;
      const encoder = new TextEncoder();

      const onEvent = (event: ReturnType<typeof subscribeSession>[number]) => {
        if (event.type !== "group_member") return;
        try {
          controller.enqueue(encoder.encode(encodeGroupMember(event)));
        } catch {
          // controller already closed
        }
      };

      const buffer = subscribeSession(groupContextId, onEvent, request.signal);
      for (const event of buffer) {
        if (event.type === "group_member") {
          controller.enqueue(encoder.encode(encodeGroupMember(event)));
        }
      }

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
