/**
 * Ordered relay: posts session events to the Next.js chatbot process so
 * publishSessionEvent runs in-process where SSE subscribers actually live.
 *
 * A2A servers share no memory with Next.js, so direct publishSessionEvent calls
 * inside an A2A process are no-ops for any Next.js subscriber.
 *
 * Events for the same session are queued and delivered sequentially to preserve
 * ordering — concurrent fire-and-forget POSTs can arrive out of order on loopback,
 * causing late progress events to land after done and create spurious bubbles.
 */
import { consola } from "consola";

const queues = new Map<string, Promise<void>>();

export function relaySessionEvent(sessionId: string, event: Record<string, unknown>): void {
  const port = process.env.DOVEPAW_PORT ?? "7473";
  const prev = queues.get(sessionId) ?? Promise.resolve();
  const next: Promise<void> = prev.then(async () => {
    try {
      await fetch(`http://127.0.0.1:${port}/api/internal/session-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, event }),
      });
    } catch (err: unknown) {
      consola.warn("relay-to-chatbot: failed to relay session event", err);
    }
  });
  queues.set(sessionId, next);
  // Clean up once this batch is the last one (no newer events queued behind it).
  void next.then(() => {
    if (queues.get(sessionId) === next) queues.delete(sessionId);
  });
}
