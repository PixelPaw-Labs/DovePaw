import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  publishSessionEvent,
  subscribeSession,
  clearSessionBuffer,
  getSessionBuffer,
  getSessionCurrentSeq,
} from "../session-events";
import type { ChatSseEvent } from "@/lib/chat-sse";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function textEvent(content: string): ChatSseEvent {
  return { type: "text", content };
}

function doneEvent(): ChatSseEvent {
  return { type: "done" };
}

/** Fresh session ID per test to avoid cross-test bucket pollution. */
let sessionId: string;
let sessionCounter = 0;

beforeEach(() => {
  sessionId = `test-session-${++sessionCounter}`;
});

afterEach(() => {
  // Clean up any buckets created during the test
  clearSessionBuffer(sessionId);
  vi.useRealTimers();
});

// ─── publishSessionEvent + subscribeSession ───────────────────────────────────

describe("publishSessionEvent + subscribeSession", () => {
  it("subscriber receives events published after subscribing", () => {
    const received: ChatSseEvent[] = [];
    const ac = new AbortController();

    // Subscribe first, then publish
    subscribeSession(sessionId, (e) => received.push(e), ac.signal);
    publishSessionEvent(sessionId, textEvent("hello"));
    publishSessionEvent(sessionId, textEvent("world"));

    ac.abort();
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ type: "text", content: "hello" });
    expect(received[1]).toMatchObject({ type: "text", content: "world" });
  });

  it("snapshot returned from subscribeSession contains previously published events", () => {
    // Pre-populate the bucket by subscribing (creates bucket) then publishing
    const ac1 = new AbortController();
    subscribeSession(sessionId, () => {}, ac1.signal);
    publishSessionEvent(sessionId, textEvent("pre-1"));
    publishSessionEvent(sessionId, textEvent("pre-2"));
    ac1.abort();

    // Late subscriber gets snapshot of buffered events
    const ac2 = new AbortController();
    const snapshot = subscribeSession(sessionId, () => {}, ac2.signal);
    ac2.abort();

    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).toMatchObject({ type: "text", content: "pre-1" });
    expect(snapshot[1]).toMatchObject({ type: "text", content: "pre-2" });
  });

  it("aborted signal removes listener — no more events delivered", () => {
    const received: ChatSseEvent[] = [];
    const ac = new AbortController();

    subscribeSession(sessionId, (e) => received.push(e), ac.signal);
    publishSessionEvent(sessionId, textEvent("before abort"));
    ac.abort();
    publishSessionEvent(sessionId, textEvent("after abort"));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "text", content: "before abort" });
  });
});

// ─── Ring buffer overflow ─────────────────────────────────────────────────────

describe("ring buffer", () => {
  it("buffer stays ≤ 500 after 501 events — oldest is dropped", () => {
    const ac = new AbortController();
    subscribeSession(sessionId, () => {}, ac.signal);

    for (let i = 1; i <= 501; i++) {
      publishSessionEvent(sessionId, textEvent(`event-${i}`));
    }
    ac.abort();

    const buf = getSessionBuffer(sessionId);
    expect(buf).not.toBeNull();
    expect(buf!.length).toBe(500);
    // First event (event-1) was dropped; oldest retained is event-2
    expect(buf![0]).toMatchObject({ type: "text", content: "event-2" });
    expect(buf![499]).toMatchObject({ type: "text", content: "event-501" });
  });
});

// ─── TTL timer fires clearSessionBuffer after done ────────────────────────────

describe("TTL timer", () => {
  it("clears buffer 60 seconds after a done event", () => {
    vi.useFakeTimers();

    const ac = new AbortController();
    subscribeSession(sessionId, () => {}, ac.signal);
    publishSessionEvent(sessionId, textEvent("some work"));
    publishSessionEvent(sessionId, doneEvent());
    ac.abort();

    // Buffer should still exist immediately after done
    expect(getSessionBuffer(sessionId)).not.toBeNull();

    // Advance time to just before TTL — still present
    vi.advanceTimersByTime(59_999);
    expect(getSessionBuffer(sessionId)).not.toBeNull();

    // Advance past TTL — buffer cleared
    vi.advanceTimersByTime(1);
    expect(getSessionBuffer(sessionId)).toBeNull();
  });

  it("clears buffer after a cancelled event", () => {
    vi.useFakeTimers();

    const ac = new AbortController();
    subscribeSession(sessionId, () => {}, ac.signal);
    publishSessionEvent(sessionId, { type: "cancelled" });
    ac.abort();

    vi.advanceTimersByTime(60_000);
    expect(getSessionBuffer(sessionId)).toBeNull();
  });
});

// ─── Silent no-op after clearSessionBuffer ────────────────────────────────────

describe("publishSessionEvent after clearSessionBuffer", () => {
  it("is a silent no-op — does not throw", () => {
    const ac = new AbortController();
    subscribeSession(sessionId, () => {}, ac.signal);
    ac.abort();

    clearSessionBuffer(sessionId);

    // Publish after clear — bucket is gone, should not throw
    expect(() => publishSessionEvent(sessionId, textEvent("ghost"))).not.toThrow();
    expect(getSessionBuffer(sessionId)).toBeNull();
  });
});

// ─── MaxListeners warning at 6th subscriber ───────────────────────────────────

describe("MaxListeners", () => {
  it("5 subscribers are fine — no warning emitted", () => {
    const warnSpy = vi.spyOn(process, "emit");

    const controllers: AbortController[] = [];
    for (let i = 0; i < 5; i++) {
      const ac = new AbortController();
      controllers.push(ac);
      subscribeSession(sessionId, () => {}, ac.signal);
    }

    const maxListenersWarnings = warnSpy.mock.calls.filter(
      (args) =>
        args[0] === "warning" &&
        (args[1] as NodeJS.ErrnoException)?.name === "MaxListenersExceededWarning",
    );
    expect(maxListenersWarnings).toHaveLength(0);

    controllers.forEach((ac) => ac.abort());
    warnSpy.mockRestore();
  });

  it("6th subscriber triggers MaxListenersExceededWarning", () => {
    const warnings: unknown[] = [];
    const warnHandler = (w: unknown) => {
      if (w instanceof Error && w.name === "MaxListenersExceededWarning") {
        warnings.push(w);
      }
    };
    process.on("warning", warnHandler);

    const controllers: AbortController[] = [];
    for (let i = 0; i < 6; i++) {
      const ac = new AbortController();
      controllers.push(ac);
      subscribeSession(sessionId, () => {}, ac.signal);
    }

    // Warning is emitted asynchronously by Node's EventEmitter internals
    // Use setImmediate to let the warning propagate
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        process.off("warning", warnHandler);
        controllers.forEach((ac) => ac.abort());
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        resolve();
      });
    });
  });
});

// ─── getSessionCurrentSeq ────────────────────────────────────────────────────

describe("getSessionCurrentSeq", () => {
  it("returns 0 when no bucket exists for the session", () => {
    expect(getSessionCurrentSeq("nonexistent-session")).toBe(0);
  });

  it("returns 0 after subscribing but before any events are published", () => {
    const ac = new AbortController();
    subscribeSession(sessionId, () => {}, ac.signal);
    expect(getSessionCurrentSeq(sessionId)).toBe(0);
    ac.abort();
  });

  it("returns the current seq after events are published", () => {
    const ac = new AbortController();
    subscribeSession(sessionId, () => {}, ac.signal);
    publishSessionEvent(sessionId, textEvent("a"));
    publishSessionEvent(sessionId, textEvent("b"));
    publishSessionEvent(sessionId, textEvent("c"));
    ac.abort();
    expect(getSessionCurrentSeq(sessionId)).toBe(3);
  });

  it("returns 0 after clearSessionBuffer removes the bucket", () => {
    const ac = new AbortController();
    subscribeSession(sessionId, () => {}, ac.signal);
    publishSessionEvent(sessionId, textEvent("x"));
    ac.abort();
    clearSessionBuffer(sessionId);
    expect(getSessionCurrentSeq(sessionId)).toBe(0);
  });
});

// ─── Subscribe-then-snapshot: no race window ─────────────────────────────────

describe("subscribe-then-snapshot ordering", () => {
  it("events published between two subscribe calls are captured by both snapshot and listener", () => {
    // Subscriber A subscribes and gets an empty snapshot
    const receivedA: ChatSseEvent[] = [];
    const ac1 = new AbortController();
    const snapshotA = subscribeSession(sessionId, (e) => receivedA.push(e), ac1.signal);
    expect(snapshotA).toHaveLength(0);

    // Publish event-1
    publishSessionEvent(sessionId, textEvent("event-1"));

    // Subscriber B subscribes — snapshot should include event-1
    const receivedB: ChatSseEvent[] = [];
    const ac2 = new AbortController();
    const snapshotB = subscribeSession(sessionId, (e) => receivedB.push(e), ac2.signal);
    expect(snapshotB).toHaveLength(1);
    expect(snapshotB[0]).toMatchObject({ type: "text", content: "event-1" });

    // Publish event-2 — both live listeners should receive it
    publishSessionEvent(sessionId, textEvent("event-2"));

    ac1.abort();
    ac2.abort();

    // A received event-1 and event-2 via live listener
    expect(receivedA).toHaveLength(2);
    expect(receivedA[0]).toMatchObject({ content: "event-1" });
    expect(receivedA[1]).toMatchObject({ content: "event-2" });

    // B received only event-2 via live listener (event-1 was in its snapshot)
    expect(receivedB).toHaveLength(1);
    expect(receivedB[0]).toMatchObject({ content: "event-2" });
  });
});

// ─── Monotonic seq stamping ───────────────────────────────────────────────────

describe("seq counter", () => {
  it("stamps incrementing _seq on each event", () => {
    const ac = new AbortController();
    subscribeSession(sessionId, () => {}, ac.signal);

    const e1 = textEvent("a");
    const e2 = textEvent("b");
    const e3 = textEvent("c");
    publishSessionEvent(sessionId, e1);
    publishSessionEvent(sessionId, e2);
    publishSessionEvent(sessionId, e3);
    ac.abort();

    expect((e1 as Record<string, unknown>)._seq).toBe(1);
    expect((e2 as Record<string, unknown>)._seq).toBe(2);
    expect((e3 as Record<string, unknown>)._seq).toBe(3);
  });
});
