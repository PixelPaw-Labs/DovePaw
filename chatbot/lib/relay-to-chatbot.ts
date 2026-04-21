/**
 * Fire-and-forget relay: posts a session event to the Next.js chatbot process so
 * publishSessionEvent runs in-process where SSE subscribers actually live.
 *
 * A2A servers share no memory with Next.js, so direct publishSessionEvent calls
 * inside an A2A process are no-ops for any Next.js subscriber.
 */
import { consola } from "consola";

export function relaySessionEvent(sessionId: string, event: Record<string, unknown>): void {
  const port = process.env.DOVEPAW_PORT ?? "7473";
  fetch(`http://127.0.0.1:${port}/api/internal/session-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, event }),
  }).catch((err: unknown) => {
    consola.warn("relay-to-chatbot: failed to relay session event", err);
  });
}
