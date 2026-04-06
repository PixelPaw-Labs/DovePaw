import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const TMP_DIR = join(tmpdir(), `dovepaw-session-manager-test-${process.pid}`);
vi.mock("@@/lib/paths", () => ({ DOVEPAW_DIR: TMP_DIR }));

const { SessionManager } = await import("../session-manager");
const { getSessionDetail, getActiveSession, closeDb } = await import("../db");

beforeEach(() => mkdirSync(TMP_DIR, { recursive: true }));

afterEach(() => {
  closeDb();
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ─── SessionManager.save ─────────────────────────────────────────────────────

describe("SessionManager.save", () => {
  it("persists messages and progress to db", () => {
    SessionManager.save(
      "test-agent",
      "ctx-1",
      { output: "done", progress: [{ message: "Bash", artifacts: { "tool-call": "Bash" } }] },
      { label: "My label", userText: "user text" },
    );
    const detail = getSessionDetail("ctx-1");
    expect(detail).not.toBeNull();
    expect(detail!.agentId).toBe("test-agent");
    expect(detail!.label).toBe("My label");
    expect(detail!.messages).toHaveLength(2);
    expect(detail!.messages[0]).toMatchObject({
      role: "user",
      segments: [{ type: "text", content: "user text" }],
    });
    expect(detail!.messages[1]).toMatchObject({
      role: "assistant",
      segments: [{ type: "text", content: "done" }],
    });
    expect(detail!.progress).toEqual([{ message: "Bash", artifacts: { "tool-call": "Bash" } }]);
  });

  it("sets the agent's active session", () => {
    SessionManager.save("test-agent", "ctx-2", { output: "", progress: [] });
    expect(getActiveSession("test-agent")).toBe("ctx-2");
  });

  it("uses provided assistantMsg instead of building from result.output", () => {
    const assistantMsg = {
      id: "msg-id",
      role: "assistant" as const,
      segments: [{ type: "text" as const, content: "custom text" }],
      processContent: "thinking content",
    };
    SessionManager.save(
      "test-agent",
      "ctx-3",
      { output: "ignored output", progress: [] },
      { label: "label", userText: "user", assistantMsg },
    );
    const detail = getSessionDetail("ctx-3");
    expect(detail!.messages[1].segments).toEqual([{ type: "text", content: "custom text" }]);
    expect(detail!.messages[1].processContent).toBe("thinking content");
  });
});

// ─── SessionManager.makePersistence ──────────────────────────────────────────

describe("SessionManager.makePersistence", () => {
  it("saves result.output as assistant message text", () => {
    const persistence = SessionManager.makePersistence("test-agent");
    persistence.save("ctx-4", { output: "agent output", progress: [] });
    const detail = getSessionDetail("ctx-4");
    expect(detail!.messages[1]).toMatchObject({
      role: "assistant",
      segments: [{ type: "text", content: "agent output" }],
    });
    expect(detail!.messages[1].processContent).toBeUndefined();
  });

  it("saves processContent when provided", () => {
    const persistence = SessionManager.makePersistence("test-agent");
    persistence.save("ctx-5", { output: "output", progress: [] }, "thinking text");
    const detail = getSessionDetail("ctx-5");
    expect(detail!.messages[1].processContent).toBe("thinking text");
    expect(detail!.messages[1].segments).toEqual([{ type: "text", content: "output" }]);
  });

  it("saves progress entries", () => {
    const persistence = SessionManager.makePersistence("test-agent");
    persistence.save("ctx-6", {
      output: "x",
      progress: [
        { message: "Read", artifacts: { "tool-call": "Read" } },
        { message: "Bash", artifacts: { "tool-call": "Bash" } },
      ],
    });
    const detail = getSessionDetail("ctx-6");
    expect(detail!.progress).toHaveLength(2);
    expect(detail!.progress[0].message).toBe("Read");
    expect(detail!.progress[1].message).toBe("Bash");
  });
});
