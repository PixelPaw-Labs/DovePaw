/**
 * GET /api/groups/stream/:groupContextId
 *
 * SSE endpoint that streams all member agent events for a group task.
 * The client supplies the groupContextId (returned by ask_group_* via makeAskGroupTool).
 * Each event is { agentId, text, type } so the frontend can demux by agent.
 */

import { groupStreamPool, type GroupStreamEvent } from "@/lib/group-stream-pool";

export const maxDuration = 86400;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

export function GET(request: Request, { params }: { params: Promise<{ groupContextId: string }> }) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { groupContextId } = await params;
      const encoder = new TextEncoder();

      const onEvent = (event: GroupStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller already closed
        }
      };

      groupStreamPool.subscribe(groupContextId, onEvent, request.signal);

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
