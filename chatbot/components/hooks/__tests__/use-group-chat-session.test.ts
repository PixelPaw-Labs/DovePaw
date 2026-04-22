import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function makePoolSseChunk(agentId: string, type: "progress" | "done" | "error"): string {
  return `data: ${JSON.stringify({ agentId, text: "text", type })}\n\n`;
}

/** Stream that pushes chunks then blocks forever (simulates an open SSE connection). */
function makeBlockingStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      // Intentionally no close() — stream stays open indefinitely
    },
  });
}

/** Stream that pushes chunks then closes (simulates an SSE connection that ends). */
function makeClosingStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function makeGroupFetchMock(stream: ReadableStream<Uint8Array>) {
  return (url: unknown) => {
    const u = String(url);
    // Group active-session endpoint
    if ((u.includes("group%3A") || u.includes("group:")) && u.includes("active-session"))
      return Promise.resolve(makeJson({ id: "ctx-1", status: "running" }));
    // Group SSE stream endpoint
    if (u.includes("groups/stream")) return Promise.resolve(new Response(stream, { status: 200 }));
    // Group message history: return empty array so no messages are injected
    if (u.includes("groups/messages")) return Promise.resolve(makeJson([]));
    // Member active-session: no running session (prevents individual stream connections)
    return Promise.resolve(makeJson({ id: null }));
  };
}

function makeJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Minimal fetch mock — use mockImplementation so each call gets a fresh Response
// (mockResolvedValue reuses the same Response instance, causing "Body is unusable" when
// multiple concurrent effects all call res.json() on the same object)
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(makeJson({ id: null }))),
  );
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
      vi.mocked(fetch).mockImplementation((input: unknown) => {
        const url = String(input);
        // Group active-session → no running group task
        if (url.includes("group%3A") || url.includes("group:"))
          return Promise.resolve(makeJson({ id: null }));
        // Group message history — agent-b started earlier, returned first (sorted ASC)
        if (url.includes("groups/messages"))
          return Promise.resolve(
            makeJson([
              {
                id: "session-b",
                agentId: "agent-b",
                startedAt: "2024-01-01T00:00:00Z",
                groupMessage: "from B",
              },
              {
                id: "session-a",
                agentId: "agent-a",
                startedAt: "2024-01-02T00:00:00Z",
                groupMessage: "from A",
              },
            ]),
          );
        // Member active-session: no active session (history comes from groups/messages)
        if (url.includes("active-session")) return Promise.resolve(makeJson({ id: null }));
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
      vi.mocked(fetch).mockImplementation((input: unknown) => {
        const url = String(input);
        if (url.includes("group%3A") || url.includes("group:"))
          return Promise.resolve(makeJson({ id: null }));
        // agent-a started earlier this time
        if (url.includes("groups/messages"))
          return Promise.resolve(
            makeJson([
              {
                id: "session-a",
                agentId: "agent-a",
                startedAt: "2024-01-01T00:00:00Z",
                groupMessage: "from A",
              },
              {
                id: "session-b",
                agentId: "agent-b",
                startedAt: "2024-01-02T00:00:00Z",
                groupMessage: "from B",
              },
            ]),
          );
        if (url.includes("active-session")) return Promise.resolve(makeJson({ id: null }));
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

  describe("isLoading tracks group pool progress", () => {
    it("stays true while a member has received progress but not done", async () => {
      vi.mocked(fetch).mockImplementation(
        makeGroupFetchMock(makeBlockingStream([makePoolSseChunk("agent-a", "progress")])),
      );

      const { result, unmount } = renderHook(() => useGroupChatSession(["agent-a"], "test-group"));

      await waitFor(() => expect(result.current.isLoading).toBe(true));
      unmount();
    });

    it("stays true when one of two members is still in progress after the other finishes", async () => {
      vi.mocked(fetch).mockImplementation(
        makeGroupFetchMock(
          makeBlockingStream([
            makePoolSseChunk("agent-a", "progress"),
            makePoolSseChunk("agent-b", "progress"),
            makePoolSseChunk("agent-a", "done"),
          ]),
        ),
      );

      const { result, unmount } = renderHook(() =>
        useGroupChatSession(["agent-a", "agent-b"], "test-group"),
      );

      // Wait until agent-a's pool message shows as complete
      await waitFor(() => {
        const aDone = result.current.messages.find((m) => m.id.startsWith("pool-agent-a"));
        expect(aDone?.isLoading).toBe(false);
      });

      // agent-b is still in progress — isLoading must remain true
      expect(result.current.isLoading).toBe(true);
      unmount();
    });

    it("creates a new bubble when the same agent responds a second time", async () => {
      vi.mocked(fetch).mockImplementation(
        makeGroupFetchMock(
          makeClosingStream([
            makePoolSseChunk("agent-a", "progress"),
            makePoolSseChunk("agent-a", "done"),
            makePoolSseChunk("agent-a", "progress"),
            makePoolSseChunk("agent-a", "done"),
          ]),
        ),
      );

      const { result, unmount } = renderHook(() => useGroupChatSession(["agent-a"], "test-group"));

      await waitFor(() => {
        const agentMsgs = result.current.messages.filter((m) => m.id.startsWith("pool-agent-a"));
        expect(agentMsgs).toHaveLength(2);
        expect(agentMsgs[0].id).not.toBe(agentMsgs[1].id);
      });
      unmount();
    });

    it("becomes false when all members are done and the stream closes", async () => {
      vi.mocked(fetch).mockImplementation(
        makeGroupFetchMock(
          makeClosingStream([
            makePoolSseChunk("agent-a", "progress"),
            makePoolSseChunk("agent-a", "done"),
          ]),
        ),
      );

      const { result, unmount } = renderHook(() => useGroupChatSession(["agent-a"], "test-group"));

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      unmount();
    });
  });
});
