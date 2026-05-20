import { getSessionBuffer, subscribeSession } from "@/lib/session-events";
import { getSessionDetail, getSessionStatus, readSessionEventsAfter } from "@/lib/db";
import { hasPendingPermission } from "@/lib/pending-permissions";
import { sessionRunner } from "@/lib/session-runner";
import { isChatSseEvent, type ChatSseEvent } from "@/lib/chat-sse";

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
    if (sessionRunner.isRunning(sessionId)) {
      // Replay the durable event log (session_events) so the UI recovers full
      // fidelity after a buffer eviction / HMR / process restart, then attach
      // a fresh bucket for any further publishes from the live subprocess.
      const prefixEvents: ChatSseEvent[] = readSessionEventsAfter(sessionId, after).flatMap((r) =>
        isChatSseEvent(r.event) ? [r.event] : [],
      );
      return makeLiveResponse(sessionId, after, request.signal, prefixEvents);
    }
    // Subprocess is not registered — it died without updating the DB.
    // Fall through to Mode 3 to synthesize from DB without touching status.
  }

  // ── Mode 3: completed session — replay from durable log or synthesize ────────
  const detail = getSessionDetail(sessionId);
  if (!detail) {
    return new Response(null, { status: 404 });
  }

  const durable = readSessionEventsAfter(sessionId, after).flatMap((r) =>
    isChatSseEvent(r.event) ? [r.event] : [],
  );
  let events: ChatSseEvent[];
  if (durable.length > 0) {
    events = durable;
  } else {
    // Legacy path for pre-durable-log sessions: synthesize a single done event
    // from the saved messages so old completed runs still render.
    const textContent = detail.messages
      .flatMap((msg) => (msg.role === "assistant" ? msg.segments : []))
      .filter(
        (s): s is { type: "text"; content: string } => s.type === "text" && Boolean(s.content),
      )
      .map((s) => s.content)
      .join("");
    events = [
      { type: "session", sessionId: detail.id },
      ...(textContent
        ? [{ type: "done" as const, content: textContent }]
        : [{ type: "done" as const }]),
    ];
  }

  const enc = new TextEncoder();
  const body = events.map(encodeEvent).join("");
  return new Response(enc.encode(body), {
    headers: { ...SSE_HEADERS, "Content-Length": String(enc.encode(body).byteLength) },
  });
}

/** Shared helper for modes 1 & 2: subscribe to the session event bus. */
function makeLiveResponse(
  sessionId: string,
  after: number,
  signal: AbortSignal,
  prefixEvents: ChatSseEvent[] = [],
): Response {
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

        // Replay DB-sourced events (Mode 2: buffer evicted, session still running).
        // These are the messages saved to DB before the buffer was lost (e.g. after HMR).
        for (const e of prefixEvents) {
          write(e);
        }

        // Replay only events after the client's last-seen seq.
        // Skip permission events whose requestId is no longer in the pending map
        // (stale prompts from a restarted/aborted subprocess would 404 on Allow).
        for (const e of snapshot) {
          const seq = (e as Record<string, unknown>).seq;
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
