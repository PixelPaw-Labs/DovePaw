/**
 * Unit tests for SessionManager:
 * getSessions(), LRU eviction, delete(), label/startedAt metadata.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_SESSIONS, SessionManager } from "@/lib/session-manager";

function mockWorkspace(path = "/tmp/ws") {
  return { path, cleanup: vi.fn() };
}

function makeState(contextId: string, label: string, startedAt: Date) {
  return {
    subagentSessionId: `cs-${contextId}`,
    workspace: mockWorkspace(`/tmp/ws-${contextId}`),
    startedAt,
    label,
  };
}

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  describe("getSessions()", () => {
    it("returns [] when empty", () => {
      expect(manager.getSessions()).toEqual([]);
    });

    it("returns sessions newest-first (reverse insertion order)", () => {
      manager.set("ctx-1", makeState("ctx-1", "First", new Date("2025-01-01")));
      manager.set("ctx-2", makeState("ctx-2", "Second", new Date("2025-01-02")));
      manager.set("ctx-3", makeState("ctx-3", "Third", new Date("2025-01-03")));

      expect(manager.getSessions().map((s) => s.id)).toEqual(["ctx-3", "ctx-2", "ctx-1"]);
    });

    it("includes contextId, startedAt and label", () => {
      const t = new Date("2025-06-01T12:00:00Z");
      manager.set("ctx-x", makeState("ctx-x", "My label", t));

      expect(manager.getSessions()[0]).toMatchObject({
        id: "ctx-x",
        label: "My label",
        startedAt: t,
      });
    });
  });

  describe("delete()", () => {
    it("calls workspace.cleanup() and removes the entry", () => {
      const state = makeState("ctx-a", "A", new Date());
      manager.set("ctx-a", state);

      manager.delete("ctx-a");

      expect(state.workspace.cleanup).toHaveBeenCalledOnce();
      expect(manager.getSessions()).toHaveLength(0);
    });

    it("is a no-op for unknown contextId", () => {
      expect(() => manager.delete("nonexistent")).not.toThrow();
    });
  });

  describe("LRU eviction", () => {
    it("evicts the oldest session when limit exceeded", () => {
      for (let i = 0; i < MAX_SESSIONS; i++) {
        manager.set(`ctx-${i}`, makeState(`ctx-${i}`, `Label ${i}`, new Date(i * 1000)));
      }
      const oldest = manager.get("ctx-0")!;

      manager.set(
        `ctx-${MAX_SESSIONS}`,
        makeState(`ctx-${MAX_SESSIONS}`, `Label ${MAX_SESSIONS}`, new Date(MAX_SESSIONS * 1000)),
      );

      expect(oldest.workspace.cleanup).toHaveBeenCalledOnce();
      expect(manager.getSessions().map((s) => s.id)).not.toContain("ctx-0");
      expect(manager.getSessions()).toHaveLength(MAX_SESSIONS);
    });

    it("does not evict when at exactly MAX_SESSIONS", () => {
      for (let i = 0; i < MAX_SESSIONS; i++) {
        manager.set(`ctx-${i}`, makeState(`ctx-${i}`, `Label ${i}`, new Date(i * 1000)));
      }
      const oldest = manager.get("ctx-0")!;

      // No additional set — no eviction
      expect(oldest.workspace.cleanup).not.toHaveBeenCalled();
      expect(manager.getSessions()).toHaveLength(MAX_SESSIONS);
    });
  });
});
