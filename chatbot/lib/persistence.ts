import { closeStaleSessions, setSessionStatus } from "@/lib/db";
import { sessionRunner } from "@/lib/session-runner";

/** Time we give async cleanup (cancelTask round-trips, workspace rm -rf) before forcing exit. */
export const SHUTDOWN_GRACE_MS = 2_000;

/**
 * Wire session-runner status callbacks to the DB and close any sessions left
 * running from a previous process. Call once at server startup.
 *
 * Known race: `onAbort` fires synchronously from `sessionRunner.abort()` —
 * the SDK has only just received `controller.abort()` and is still unwinding
 * asynchronously. For a few milliseconds the DB row says `cancelled` while
 * the live SSE stream is still emitting tool events. A user reloading mid-
 * abort can briefly see an inconsistent view. The window is bounded by SDK
 * unwind latency (single-digit ms in practice) and self-heals once the route
 * handler's finally block runs. Strict fix would defer this DB write until
 * after the SDK promise settles; deemed not worth the cross-route refactor.
 */
export function enablePersistence(): void {
  closeStaleSessions();
  sessionRunner.configure({
    onComplete: (id) => setSessionStatus(id, "done"),
    onAbort: (id) => setSessionStatus(id, "cancelled"),
  });
}

/**
 * Best-effort graceful shutdown for SIGTERM: aborts all running sessions, then
 * schedules a hard exit after SHUTDOWN_GRACE_MS so async cleanup (A2A
 * cancelTask round-trips, workspace removal) has a deterministic window before
 * Node tears down. The `exit` event handler can't await async work — that's a
 * fundamental Node limitation — so this is the only place we can give async
 * cleanup a chance during a graceful shutdown.
 *
 * Returns the scheduled timer so callers/tests can introspect (unused in prod).
 */
export function gracefulShutdown(
  exit: (code: number) => void = (code) => process.exit(code),
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
): unknown {
  sessionRunner.abortAll();
  return schedule(() => exit(0), SHUTDOWN_GRACE_MS);
}
