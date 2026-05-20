/**
 * Tests for GET /api/chat/stream/[sessionId]
 *
 * Covers the three reconnect modes:
 *   Mode 1 — live buffer exists: replay buffered events after ?after=seq
 *   Mode 2 — buffer gone, status "running": replay DB messages as prefix
 *   Mode 3 — buffer gone, session complete: synthesize from DB and close
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatSseEvent } from "@/lib/chat-sse";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/session-events", () => ({
  getSessionBuffer: vi.fn(),
  subscribeSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getSessionStatus: vi.fn(),
  getSessionDetail: vi.fn(),
  setSessionStatus: vi.fn(),
  readSessionEventsAfter: vi.fn(() => []),
}));

vi.mock("@/lib/pending-permissions", () => ({
  hasPendingPermission: vi.fn(() => false),
}));

vi.mock("@/lib/session-runner", () => ({
  sessionRunner: { isRunning: vi.fn(() => true) },
}));

import { getSessionBuffer, subscribeSession } from "@/lib/session-events";
import {
  getSessionStatus,
  getSessionDetail,
  setSessionStatus,
  readSessionEventsAfter,
} from "@/lib/db";
import { sessionRunner } from "@/lib/session-runner";
import { GET } from "../chat/stream/[sessionId]/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

/**
 * Collect all SSE events from a live (non-closing) Response stream.
 *
 * `start(controller)` in makeLiveResponse runs synchronously when the Response
 * is constructed (inside GET), so by the time GET resolves all buffered events
 * are already enqueued AND the abort listener is attached. Scheduling the abort
 * on the next macrotask (setTimeout 0) ensures:
 *   1. We read all synchronously-buffered events first.
 *   2. controller.close() fires, signalling EOF to the reader.
 */
async function collectLiveSseEvents(
  response: Response,
  ac: AbortController,
): Promise<ChatSseEvent[]> {
  if (!response.body) return [];
  setTimeout(() => ac.abort(), 0);
  return drainSse(response);
}

/** Collect SSE events from a response that closes by itself (Mode 3). */
async function collectSseEvents(response: Response): Promise<ChatSseEvent[]> {
  if (!response.body) return [];
  return drainSse(response);
}

async function drainSse(response: Response): Promise<ChatSseEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as ChatSseEvent);
}

/**
 * Mock subscribeSession to return a fixed snapshot and attach a no-op abort
 * listener so the signal listener is registered before our abort fires.
 */
function stubSubscribe(snapshot: ChatSseEvent[] = []): void {
  vi.mocked(subscribeSession).mockImplementation((_id, _cb, signal) => {
    signal.addEventListener("abort", () => {}, { once: true });
    return snapshot;
  });
}

function seqEvent<T extends ChatSseEvent>(event: T, seq: number): T {
  return Object.assign({}, event, { seq });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Mode 1: live buffer ───────────────────────────────────────────────────────

describe("Mode 1 — live buffer exists", () => {
  it("replays buffered events with seq > after=0", async () => {
    const buffered: ChatSseEvent[] = [
      seqEvent({ type: "session", sessionId: "sess-1" }, 1),
      seqEvent({ type: "text", content: "hello" }, 2),
      seqEvent({ type: "done" }, 3),
    ];
    vi.mocked(getSessionBuffer).mockReturnValue(buffered);
    stubSubscribe(buffered);

    const ac = new AbortController();
    const req = new Request("http://localhost/api/chat/stream/sess-1?after=0", {
      signal: ac.signal,
    });
    const res = await GET(req, makeParams("sess-1"));
    const events = await collectLiveSseEvents(res, ac);

    expect(events).toContainEqual(
      expect.objectContaining({ type: "session", sessionId: "sess-1" }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "text", content: "hello" }));
    // getSessionStatus should NOT be called (short-circuit in Mode 1)
    expect(getSessionStatus).not.toHaveBeenCalled();
  });

  it("filters out buffered events with seq <= after", async () => {
    const buffered: ChatSseEvent[] = [
      seqEvent({ type: "text", content: "old" }, 1),
      seqEvent({ type: "text", content: "new" }, 2),
    ];
    vi.mocked(getSessionBuffer).mockReturnValue(buffered);
    stubSubscribe(buffered);

    const ac = new AbortController();
    const req = new Request("http://localhost/api/chat/stream/sess-1?after=1", {
      signal: ac.signal,
    });
    const res = await GET(req, makeParams("sess-1"));
    const events = await collectLiveSseEvents(res, ac);

    expect(events).not.toContainEqual(expect.objectContaining({ type: "text", content: "old" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "text", content: "new" }));
  });
});

// ── Mode 2: buffer gone, status "running" ────────────────────────────────────

describe("Mode 2 — buffer gone, session running", () => {
  beforeEach(() => {
    vi.mocked(getSessionBuffer).mockReturnValue(null);
    vi.mocked(getSessionStatus).mockReturnValue("running");
    vi.mocked(sessionRunner.isRunning).mockReturnValue(true);
    vi.mocked(readSessionEventsAfter).mockReturnValue([]);
  });

  it("replays the durable event log past ?after as prefix events", async () => {
    vi.mocked(readSessionEventsAfter).mockReturnValue([
      { seq: 1, event: { type: "session", sessionId: "sess-2" } },
      { seq: 2, event: { type: "text", content: "saved" } },
    ]);
    stubSubscribe([]);

    const ac = new AbortController();
    const req = new Request("http://localhost/api/chat/stream/sess-2?after=0", {
      signal: ac.signal,
    });
    const res = await GET(req, makeParams("sess-2"));
    const events = await collectLiveSseEvents(res, ac);

    expect(readSessionEventsAfter).toHaveBeenCalledWith("sess-2", 0);
    expect(events).toContainEqual({ type: "session", sessionId: "sess-2" });
    expect(events).toContainEqual({ type: "text", content: "saved" });
    // No "done" — stream stays open for live subprocess events
    expect(events).not.toContainEqual(expect.objectContaining({ type: "done" }));
  });

  it("uses ?after as the durable-log cursor so already-replayed events are skipped", async () => {
    vi.mocked(readSessionEventsAfter).mockReturnValue([]);
    stubSubscribe([]);

    const ac = new AbortController();
    const req = new Request("http://localhost/api/chat/stream/sess-2?after=42", {
      signal: ac.signal,
    });
    await GET(req, makeParams("sess-2"));

    expect(readSessionEventsAfter).toHaveBeenCalledWith("sess-2", 42);
  });

  it("sends nothing when the durable log is empty and no live events arrive", async () => {
    vi.mocked(readSessionEventsAfter).mockReturnValue([]);
    stubSubscribe([]);

    const ac = new AbortController();
    const req = new Request("http://localhost/api/chat/stream/sess-2?after=0", {
      signal: ac.signal,
    });
    const res = await GET(req, makeParams("sess-2"));
    const events = await collectLiveSseEvents(res, ac);

    expect(events).toHaveLength(0);
  });

  it("delivers live buffer snapshot events after durable prefix events", async () => {
    vi.mocked(readSessionEventsAfter).mockReturnValue([
      { seq: 1, event: { type: "text", content: "saved" } },
    ]);
    stubSubscribe([seqEvent({ type: "text", content: "live" }, 2)]);

    const ac = new AbortController();
    const req = new Request("http://localhost/api/chat/stream/sess-2?after=0", {
      signal: ac.signal,
    });
    const res = await GET(req, makeParams("sess-2"));
    const events = await collectLiveSseEvents(res, ac);

    const contents = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { type: "text"; content: string }).content);
    expect(contents).toContain("saved");
    expect(contents).toContain("live");
  });

  it("falls through to Mode 3 without changing status when subprocess is not registered", async () => {
    vi.mocked(sessionRunner.isRunning).mockReturnValue(false);
    vi.mocked(getSessionDetail).mockReturnValue({
      id: "sess-2",
      agentId: "dove",
      startedAt: "2026-01-01T00:00:00Z",
      label: "Test",
      status: "running",
      messages: [{ id: "a1", role: "assistant", segments: [{ type: "text", content: "partial" }] }],
      progress: [],
    });

    const req = new Request("http://localhost/api/chat/stream/sess-2?after=0");
    const res = await GET(req, makeParams("sess-2"));
    const events = await collectSseEvents(res);

    // Should synthesize and close (Mode 3 path), not subscribe, not touch status
    expect(subscribeSession).not.toHaveBeenCalled();
    expect(setSessionStatus).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: "done" }));
  });
});

// ── Mode 3: buffer gone, session complete ─────────────────────────────────────

describe("Mode 3 — buffer gone, session complete", () => {
  beforeEach(() => {
    vi.mocked(getSessionBuffer).mockReturnValue(null);
    vi.mocked(getSessionStatus).mockReturnValue("done");
  });

  it("synthesizes session + done with content from DB and closes immediately", async () => {
    vi.mocked(getSessionDetail).mockReturnValue({
      id: "sess-3",
      agentId: "dove",
      startedAt: "2026-01-01T00:00:00Z",
      label: "Test",
      status: "done",
      messages: [
        { id: "a1", role: "assistant", segments: [{ type: "text", content: "final answer" }] },
      ],
      progress: [],
    });

    const req = new Request("http://localhost/api/chat/stream/sess-3?after=0");
    const res = await GET(req, makeParams("sess-3"));
    const events = await collectSseEvents(res);

    expect(events).toContainEqual({ type: "session", sessionId: "sess-3" });
    expect(events).toContainEqual({ type: "done", content: "final answer" });
    expect(subscribeSession).not.toHaveBeenCalled();
  });

  it("returns 404 when session not found in DB", async () => {
    vi.mocked(getSessionDetail).mockReturnValue(null);

    const req = new Request("http://localhost/api/chat/stream/missing?after=0");
    const res = await GET(req, makeParams("missing"));
    expect(res.status).toBe(404);
  });
});
