import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const TMP_DIR = join(tmpdir(), `dovepaw-db-test-${process.pid}`);

vi.mock("@@/lib/paths", () => ({ DOVEPAW_DIR: TMP_DIR }));

const {
  upsertSession,
  setActiveSession,
  getActiveSession,
  listSessions,
  getSessionDetail,
  deleteSession,
  setSessionStatus,
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

  it("deleteSession removes row and clears active_sessions", () => {
    upsertSession(base);
    setActiveSession("test-agent", "ctx-1");
    deleteSession("ctx-1");
    expect(getSessionDetail("ctx-1")).toBeNull();
    expect(getActiveSession("test-agent")).toBeNull();
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
});
