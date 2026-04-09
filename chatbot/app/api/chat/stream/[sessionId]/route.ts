import { getSessionBuffer, subscribeSession } from "@/lib/session-events";
import { getSessionDetail, getSessionStatus } from "@/lib/db";
import { hasPendingPermission } from "@/lib/pending-permissions";
import type { ChatSseEvent } from "@/lib/chat-sse";

export const maxDuration = 86400;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

function encodeEvent(event: ChatSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Open a live SSE stream for a session.  Three modes:
 *
 * 1. **Buffer exists** — replay buffered events after `?after=seq`, then
 *    subscribe for live events.  Normal path for active or recently-completed
 *    sessions.
 *
 * 2. **Buffer gone, DB status "running"** — the buffer was evicted (e.g. HMR
 *    or TTL) but the subprocess may still be alive.  Subscribe to a fresh
 *    bucket so any future `publishSessionEvent` calls reach the client.
 *    Replay saved messages from the DB so the UI isn't blank.
 *
 * 3. **Buffer gone, session complete** — synthesize events from the DB and
 *    close immediately.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const url = new URL(request.url);
  const after = parseInt(url.searchParams.get("after") ?? "0", 10);

  const buffer = getSessionBuffer(sessionId);

  // ── Mode 1: live buffer ──────────────────────────────────────────────────────
  if (buffer !== null) {
    return makeLiveResponse(sessionId, after, request.signal);
  }

  // ── Mode 2: buffer gone but session still "running" in DB ────────────────────
  const status = getSessionStatus(sessionId);
  if (status === "running") {
    // Subscribe to a fresh bucket — if the subprocess is still alive it will
    // publish events that land here.  Replay DB messages so the UI has context.
    return makeLiveResponse(sessionId, after, request.signal);
  }

  // ── Mode 3: completed session — synthesize from DB ───────────────────────────
  const detail = getSessionDetail(sessionId);
  if (!detail) {
    return new Response(null, { status: 404 });
  }

  const events: ChatSseEvent[] = [
    { type: "session", sessionId: detail.id },
    ...detail.messages.flatMap((msg) => {
      if (msg.role !== "assistant") return [];
      return msg.segments.flatMap((s): ChatSseEvent[] => {
        if (s.type === "text" && s.content) {
          return [{ type: "result", content: s.content }];
        }
        return [];
      });
    }),
    { type: "done" },
  ];

  const enc = new TextEncoder();
  const body = events.map(encodeEvent).join("");
  return new Response(enc.encode(body), {
    headers: { ...SSE_HEADERS, "Content-Length": String(enc.encode(body).byteLength) },
  });
}

/** Shared helper for modes 1 & 2: subscribe to the session event bus. */
function makeLiveResponse(sessionId: string, after: number, signal: AbortSignal): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        const write = (event: ChatSseEvent) => {
          try {
            controller.enqueue(enc.encode(encodeEvent(event)));
          } catch {
            // stream already closed
          }
        };

        // Subscribe FIRST (before snapshot) to avoid race window
        const snapshot = subscribeSession(sessionId, write, signal);
        // Replay only events after the client's last-seen seq.
        // Skip permission events whose requestId is no longer in the pending map
        // (stale prompts from a restarted/aborted subprocess would 404 on Allow).
        for (const e of snapshot) {
          const seq = (e as Record<string, unknown>)._seq;
          if (typeof seq === "number" && seq > after) {
            if (e.type === "permission" && !hasPendingPermission(e.requestId)) continue;
            write(e);
          }
        }

        signal.addEventListener(
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
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    },
  );
}
