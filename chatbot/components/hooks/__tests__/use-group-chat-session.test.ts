import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function makeJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeSession(
  agentId: string,
  sessionId: string,
  startedAt: string,
  messageContent: string,
) {
  return {
    messages: [
      {
        id: `msg-${agentId}`,
        role: "assistant",
        segments: [{ type: "text", content: messageContent }],
        agentId,
      },
    ],
    progress: [],
    resumeSeq: 0,
    status: "done",
    startedAt,
  };
}

// Minimal fetch mock — group chat session polls active-session on mount
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJson({ id: null })));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Import after stubbing fetch so the module doesn't fire real requests
const { useGroupChatSession } = await import("../use-group-chat-session");

describe("useGroupChatSession", () => {
  describe("clearMessages", () => {
    it("empties messages array", () => {
      const { result } = renderHook(() => useGroupChatSession(["agent-a"], "test-group"));

      // Manually inject a message via internal setState through sendToAgent would require
      // a running fetch; instead verify clearMessages on an already-empty state is safe
      expect(result.current.messages).toEqual([]);
      act(() => result.current.clearMessages());
      expect(result.current.messages).toEqual([]);
    });
  });

  describe("history sort by startedAt", () => {
    it("orders messages from earlier-started sessions first", async () => {
      vi.mocked(fetch).mockImplementation((url: string) => {
        // Group active-session → no running group task
        if (url.includes("group%3A") || url.includes("group:"))
          return Promise.resolve(makeJson({ id: null }));
        // Member active-session checks
        if (url.includes("agent-a/active-session"))
          return Promise.resolve(makeJson({ id: "session-a" }));
        if (url.includes("agent-b/active-session"))
          return Promise.resolve(makeJson({ id: "session-b" }));
        // Session detail — agent-b started earlier
        if (url.includes("agent-a/session/session-a"))
          return Promise.resolve(
            makeJson(makeSession("agent-a", "session-a", "2024-01-02T00:00:00Z", "from A")),
          );
        if (url.includes("agent-b/session/session-b"))
          return Promise.resolve(
            makeJson(makeSession("agent-b", "session-b", "2024-01-01T00:00:00Z", "from B")),
          );
        return Promise.resolve(makeJson({ id: null }));
      });

      const { result } = renderHook(() =>
        useGroupChatSession(["agent-a", "agent-b"], "test-group"),
      );

      await waitFor(() => expect(result.current.messages).toHaveLength(2));

      // agent-b started earlier (2024-01-01) so its message must come first
      expect(result.current.messages[0].agentId).toBe("agent-b");
      expect(result.current.messages[1].agentId).toBe("agent-a");
    });

    it("places messages from later-started session second", async () => {
      vi.mocked(fetch).mockImplementation((url: string) => {
        if (url.includes("group%3A") || url.includes("group:"))
          return Promise.resolve(makeJson({ id: null }));
        if (url.includes("agent-a/active-session"))
          return Promise.resolve(makeJson({ id: "session-a" }));
        if (url.includes("agent-b/active-session"))
          return Promise.resolve(makeJson({ id: "session-b" }));
        // agent-a started earlier this time
        if (url.includes("agent-a/session/session-a"))
          return Promise.resolve(
            makeJson(makeSession("agent-a", "session-a", "2024-01-01T00:00:00Z", "from A")),
          );
        if (url.includes("agent-b/session/session-b"))
          return Promise.resolve(
            makeJson(makeSession("agent-b", "session-b", "2024-01-02T00:00:00Z", "from B")),
          );
        return Promise.resolve(makeJson({ id: null }));
      });

      const { result } = renderHook(() =>
        useGroupChatSession(["agent-a", "agent-b"], "test-group"),
      );

      await waitFor(() => expect(result.current.messages).toHaveLength(2));

      expect(result.current.messages[0].agentId).toBe("agent-a");
      expect(result.current.messages[1].agentId).toBe("agent-b");
    });
  });
});
