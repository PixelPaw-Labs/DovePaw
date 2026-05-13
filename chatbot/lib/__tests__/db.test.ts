import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const TMP_DIR = join(tmpdir(), `dovepaw-db-test-${process.pid}`);

vi.mock("@@/lib/paths", () => ({ DOVEPAW_DIR: TMP_DIR }));
vi.mock("@/lib/memory", () => ({
  getMemoryProvider: vi.fn().mockResolvedValue({
    initGroup: vi.fn(),
    deleteGroup: vi.fn().mockResolvedValue(undefined),
    buildReminder: () => "",
  }),
}));

const {
  upsertSession,
  setActiveSession,
  getActiveSession,
  listSessions,
  getSessionDetail,
  deleteSession,
  deleteAllSessions,
  setSessionStatus,
  insertSessionEvent,
  readSessionEventsAfter,
  closeDb,
} = await import("../db");

beforeEach(() => mkdirSync(TMP_DIR, { recursive: true }));
afterEach(() => {
  closeDb();
  rmSync(TMP_DIR, { recursive: true, force: true });
});

const base = {
  id: "ctx-1",
  agentId: "test-agent",
  startedAt: "2025-01-01T00:00:00.000Z",
  label: "Test",
  messages: [
    { id: "m1", role: "user" as const, segments: [{ type: "text" as const, content: "hi" }] },
  ],
  progress: [{ message: "Step 1", artifacts: {} }],
};

describe("db", () => {
  it("upsertSession creates a row", () => {
    upsertSession(base);
    expect(getSessionDetail("ctx-1")).not.toBeNull();
  });

  it("upsertSession appends messages on second call", () => {
    upsertSession(base);
    upsertSession({
      ...base,
      messages: [{ id: "m2", role: "assistant" as const, segments: [] }],
      progress: [],
    });
    expect(getSessionDetail("ctx-1")!.messages).toHaveLength(2);
  });

  it("upsertSession deduplicates messages with same content but different id", () => {
    upsertSession(base); // contains message id "m1" with role "user"
    upsertSession({
      ...base,
      messages: [
        {
          id: "m1-duplicate",
          role: "user" as const,
          segments: [{ type: "text" as const, content: "hi" }],
        },
      ],
      progress: [],
    });
    expect(getSessionDetail("ctx-1")!.messages).toHaveLength(1);
  });

  it("upsertSession appends messages with different content", () => {
    upsertSession(base);
    upsertSession({
      ...base,
      messages: [
        {
          id: "m2",
          role: "assistant" as const,
          segments: [{ type: "text" as const, content: "reply" }],
        },
      ],
      progress: [],
    });
    expect(getSessionDetail("ctx-1")!.messages).toHaveLength(2);
  });

  it("upsertSession deduplicates identical progress entries", () => {
    upsertSession(base);
    upsertSession({ ...base, messages: [] }); // same progress entry
    expect(getSessionDetail("ctx-1")!.progress).toHaveLength(1);
  });

  it("upsertSession merges progress entry with same message key when incoming has more artifact keys", () => {
    upsertSession({
      ...base,
      progress: [{ message: "tu-1", artifacts: { "tool-call": "Agent" } }],
    });
    upsertSession({
      ...base,
      messages: [],
      progress: [
        { message: "tu-1", artifacts: { "tool-call": "Agent", label: "Await GSD agent response" } },
      ],
    });
    const progress = getSessionDetail("ctx-1")!.progress;
    expect(progress).toHaveLength(1);
    expect(progress[0].artifacts).toEqual({
      "tool-call": "Agent",
      label: "Await GSD agent response",
    });
  });

  it("upsertSession skips stale progress entry when incoming is a strict subset", () => {
    upsertSession({
      ...base,
      progress: [{ message: "tu-1", artifacts: { "tool-call": "Agent", label: "Done" } }],
    });
    upsertSession({
      ...base,
      messages: [],
      progress: [{ message: "tu-1", artifacts: { "tool-call": "Agent" } }],
    });
    const progress = getSessionDetail("ctx-1")!.progress;
    expect(progress).toHaveLength(1);
    expect(progress[0].artifacts).toEqual({ "tool-call": "Agent", label: "Done" });
  });

  it("setActiveSession / getActiveSession round-trips", () => {
    setActiveSession("agent-a", "ctx-1");
    expect(getActiveSession("agent-a")).toBe("ctx-1");
  });

  it("getActiveSession returns null when not set", () => {
    expect(getActiveSession("unknown")).toBeNull();
  });

  it("setActiveSession null clears entry", () => {
    setActiveSession("agent-a", "ctx-1");
    setActiveSession("agent-a", null);
    expect(getActiveSession("agent-a")).toBeNull();
  });

  it("listSessions returns newest first", () => {
    upsertSession({ ...base, id: "ctx-1", label: "First" });
    upsertSession({ ...base, id: "ctx-2", label: "Second" });
    const sessions = listSessions("test-agent");
    expect(sessions[0].id).toBe("ctx-2");
    expect(sessions).toHaveLength(2);
  });

  it("listSessions returns empty for unknown agent", () => {
    expect(listSessions("nobody")).toEqual([]);
  });

  it("deleteSession removes row and clears active_sessions", async () => {
    upsertSession(base);
    setActiveSession("test-agent", "ctx-1");
    await deleteSession("ctx-1");
    expect(getSessionDetail("ctx-1")).toBeNull();
    expect(getActiveSession("test-agent")).toBeNull();
  });

  it("deleteSession calls memory provider's deleteGroup for group sessions", async () => {
    const { getMemoryProvider } = await import("@/lib/memory");
    const deleteGroup = vi.fn().mockResolvedValue(undefined);
    const provider = { initGroup: vi.fn(), deleteGroup, buildReminder: () => "" };
    vi.mocked(getMemoryProvider).mockResolvedValueOnce(provider);
    upsertSession({ ...base, id: "grp-xyz", agentId: "group:Engineering" });
    await deleteSession("grp-xyz");
    expect(deleteGroup).toHaveBeenCalledWith("grp-xyz", "");
  });

  it("deleteSession does not call deleteGroup for non-group sessions", async () => {
    const { getMemoryProvider } = await import("@/lib/memory");
    const deleteGroup = vi.fn().mockResolvedValue(undefined);
    const provider = { initGroup: vi.fn(), deleteGroup, buildReminder: () => "" };
    vi.mocked(getMemoryProvider).mockResolvedValueOnce(provider);
    upsertSession({ ...base, id: "ctx-1", agentId: "test-agent" });
    await deleteSession("ctx-1");
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("deleteAllSessions removes all sessions across all agents and clears active_sessions", () => {
    upsertSession({ ...base, id: "ctx-1", agentId: "agent-a" });
    upsertSession({ ...base, id: "ctx-2", agentId: "agent-b" });
    upsertSession({ ...base, id: "ctx-3", agentId: "agent-a" });
    setActiveSession("agent-a", "ctx-3");
    setActiveSession("agent-b", "ctx-2");

    deleteAllSessions();

    expect(listSessions("agent-a")).toEqual([]);
    expect(listSessions("agent-b")).toEqual([]);
    expect(getSessionDetail("ctx-1")).toBeNull();
    expect(getSessionDetail("ctx-2")).toBeNull();
    expect(getSessionDetail("ctx-3")).toBeNull();
    expect(getActiveSession("agent-a")).toBeNull();
    expect(getActiveSession("agent-b")).toBeNull();
  });

  describe("setSessionStatus", () => {
    it("updates status from default done to cancelled", () => {
      upsertSession(base);
      setSessionStatus("ctx-1", "cancelled");
      expect(getSessionDetail("ctx-1")!.status).toBe("cancelled");
    });

    it("updates status to running then back to done", () => {
      upsertSession({ ...base, status: "running" });
      expect(getSessionDetail("ctx-1")!.status).toBe("running");
      setSessionStatus("ctx-1", "done");
      expect(getSessionDetail("ctx-1")!.status).toBe("done");
    });
  });

  describe("resumeSeq", () => {
    it("stores and retrieves a non-zero resumeSeq", () => {
      upsertSession({ ...base, resumeSeq: 42 });
      expect(getSessionDetail("ctx-1")!.resumeSeq).toBe(42);
    });

    it("defaults to 0 when resumeSeq is not provided", () => {
      upsertSession(base);
      expect(getSessionDetail("ctx-1")!.resumeSeq).toBe(0);
    });

    it("does not overwrite existing non-zero resumeSeq when upserted with 0", () => {
      upsertSession({ ...base, resumeSeq: 7 });
      upsertSession({ ...base, messages: [], resumeSeq: 0 });
      expect(getSessionDetail("ctx-1")!.resumeSeq).toBe(7);
    });

    it("overwrites resumeSeq with a larger non-zero value", () => {
      upsertSession({ ...base, resumeSeq: 7 });
      upsertSession({ ...base, messages: [], resumeSeq: 15 });
      expect(getSessionDetail("ctx-1")!.resumeSeq).toBe(15);
    });
  });

  describe("session_events", () => {
    it("insertSessionEvent persists a row and readSessionEventsAfter returns it", () => {
      insertSessionEvent("ctx-1", 1, { type: "text", content: "hello" });
      expect(readSessionEventsAfter("ctx-1", 0)).toEqual([
        { seq: 1, event: { type: "text", content: "hello" } },
      ]);
    });

    it("readSessionEventsAfter filters by seq cursor", () => {
      insertSessionEvent("ctx-1", 1, { type: "text", content: "a" });
      insertSessionEvent("ctx-1", 2, { type: "text", content: "b" });
      insertSessionEvent("ctx-1", 3, { type: "text", content: "c" });
      const after1 = readSessionEventsAfter("ctx-1", 1);
      expect(after1.map((r) => r.seq)).toEqual([2, 3]);
    });

    it("readSessionEventsAfter isolates by session", () => {
      insertSessionEvent("ctx-1", 1, { type: "text", content: "a" });
      insertSessionEvent("ctx-2", 1, { type: "text", content: "z" });
      expect(readSessionEventsAfter("ctx-1", 0)).toHaveLength(1);
      expect(readSessionEventsAfter("ctx-2", 0)).toHaveLength(1);
      expect(readSessionEventsAfter("ctx-1", 0)[0]?.event).toEqual({
        type: "text",
        content: "a",
      });
    });

    it("returns rows ordered by seq ascending", () => {
      insertSessionEvent("ctx-1", 3, { type: "text", content: "c" });
      insertSessionEvent("ctx-1", 1, { type: "text", content: "a" });
      insertSessionEvent("ctx-1", 2, { type: "text", content: "b" });
      expect(readSessionEventsAfter("ctx-1", 0).map((r) => r.seq)).toEqual([1, 2, 3]);
    });

    it("ignores duplicate (sessionId, seq) inserts without throwing", () => {
      insertSessionEvent("ctx-1", 1, { type: "text", content: "a" });
      expect(() =>
        insertSessionEvent("ctx-1", 1, { type: "text", content: "duplicate" }),
      ).not.toThrow();
      // First write wins — duplicates are ignored, not overwritten.
      expect(readSessionEventsAfter("ctx-1", 0)[0]?.event).toEqual({
        type: "text",
        content: "a",
      });
    });
  });
});
