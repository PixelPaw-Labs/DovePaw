import { EventEmitter } from "node:events";
import type { ChatSseEvent } from "@/lib/chat-sse";

const BUFFER_MAX = 500;
const BUFFER_TTL_MS = 60_000;
const MAX_LISTENERS = 5;

interface SessionBucket {
  emitter: EventEmitter;
  buffer: ChatSseEvent[];
  seq: number;
  clearTimer: ReturnType<typeof setTimeout> | null;
}

const buckets = new Map<string, SessionBucket>();
/** Sessions that have been explicitly cleared — late events are dropped, not re-bucketed. */
const terminatedIds = new Set<string>();

function getOrCreate(sessionId: string): SessionBucket {
  let b = buckets.get(sessionId);
  if (!b) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(MAX_LISTENERS);
    b = { emitter, buffer: [], seq: 0, clearTimer: null };
    buckets.set(sessionId, b);
  }
  return b;
}

export function publishSessionEvent(sessionId: string, event: ChatSseEvent): void {
  if (terminatedIds.has(sessionId)) return; // session done/cleared — late event, drop
  const b = getOrCreate(sessionId); // auto-create bucket on first publish

  // Stamp seq number on event (mutable but non-enumerable to avoid polluting JSON)
  (event as Record<string, unknown>)._seq = ++b.seq;

  // Ring buffer
  if (b.buffer.length >= BUFFER_MAX) b.buffer.shift();
  b.buffer.push(event);

  b.emitter.emit("event", event);

  // Start TTL on terminal events
  if (event.type === "done" || event.type === "cancelled") {
    if (b.clearTimer) clearTimeout(b.clearTimer);
    b.clearTimer = setTimeout(() => clearSessionBuffer(sessionId), BUFFER_TTL_MS);
  }
}

/**
 * Subscribe to session events. Registers the listener FIRST, then returns the
 * current buffer snapshot — no race window between subscribe and replay.
 *
 * Caller must replay the returned snapshot, then process live events from the listener.
 * Events that fired between snapshot-time and listener-registration: impossible
 * (Node.js single-threaded event loop, both ops are synchronous).
 *
 * The listener is auto-removed when `signal` fires.
 */
export function subscribeSession(
  sessionId: string,
  onEvent: (event: ChatSseEvent) => void,
  signal: AbortSignal,
): ChatSseEvent[] {
  const b = getOrCreate(sessionId);

  b.emitter.on("event", onEvent);
  signal.addEventListener("abort", () => b.emitter.off("event", onEvent), { once: true });

  // Return snapshot AFTER subscribing (subscribe-then-snapshot)
  return [...b.buffer];
}

export function clearSessionBuffer(sessionId: string): void {
  const b = buckets.get(sessionId);
  if (!b) return;
  if (b.clearTimer) {
    clearTimeout(b.clearTimer);
    b.clearTimer = null;
  }
  b.emitter.removeAllListeners();
  buckets.delete(sessionId);
  terminatedIds.add(sessionId);
  // Prevent indefinite growth — remove from terminated set after TTL
  setTimeout(() => terminatedIds.delete(sessionId), BUFFER_TTL_MS);
}

export function getSessionBuffer(sessionId: string): ChatSseEvent[] | null {
  const b = buckets.get(sessionId);
  return b ? [...b.buffer] : null;
}

/** Returns the latest _seq stamped for a session, or 0 if the bucket doesn't exist. */
export function getSessionCurrentSeq(sessionId: string): number {
  return buckets.get(sessionId)?.seq ?? 0;
}
