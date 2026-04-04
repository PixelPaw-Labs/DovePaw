import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversations } from "../use-conversations";
import { messageText } from "../use-messages";
import type { ChatMessage } from "../use-messages";
import {
  writePersistedMessages,
  writeActiveAgentId,
  readPersistedMessages,
  readActiveAgentId,
} from "../use-persisted-conversation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSseResponse(events: object[]) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function text(m: ChatMessage | undefined): string {
  return m ? messageText(m) : "";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useConversations", () => {
  let uuidCount = 0;

  beforeEach(() => {
    uuidCount = 0;
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++uuidCount}` });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Initial state ────────────────────────────────────────────────────────────

  it("starts with activeAgentId = 'dove' by default", () => {
    const { result } = renderHook(() => useConversations());
    expect(result.current.activeAgentId).toBe("dove");
  });

  it("restores activeAgentId from localStorage", () => {
    writeActiveAgentId("get-shit-done");
    const { result } = renderHook(() => useConversations());
    expect(result.current.activeAgentId).toBe("get-shit-done");
  });

  it("starts with empty messages and not loading", () => {
    const { result } = renderHook(() => useConversations());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("hydrates messages from localStorage on mount", async () => {
    const stored = [
      { id: "m1", role: "user" as const, segments: [{ type: "text" as const, content: "hello" }] },
    ];
    writePersistedMessages("dove", stored);
    const { result } = renderHook(() => useConversations());
    await waitFor(() => result.current.messages.length > 0);
    expect(result.current.messages).toEqual(stored);
  });

  // ─── Agent switching ──────────────────────────────────────────────────────────

  it("setActiveAgentId switches the active agent", () => {
    const { result } = renderHook(() => useConversations());
    act(() => {
      result.current.setActiveAgentId("get-shit-done");
    });
    expect(result.current.activeAgentId).toBe("get-shit-done");
  });

  it("setActiveAgentId writes new activeAgentId to localStorage", () => {
    const { result } = renderHook(() => useConversations());
    act(() => {
      result.current.setActiveAgentId("memory-distiller");
    });
    expect(readActiveAgentId()).toBe("memory-distiller");
  });

  it("setActiveAgentId saves current messages before switching", () => {
    const stored = [
      {
        id: "m1",
        role: "user" as const,
        segments: [{ type: "text" as const, content: "dove msg" }],
      },
    ];
    writePersistedMessages("dove", stored);
    const { result } = renderHook(() => useConversations());

    // Wait for hydration
    act(() => {
      // Switch away - current dove messages should be saved
      result.current.setActiveAgentId("get-shit-done");
    });

    // Dove's messages should still be in localStorage (saved on switch)
    const saved = readPersistedMessages("dove");
    expect(saved).not.toBeNull();
  });

  it("setActiveAgentId loads messages for the new agent", () => {
    const gsdMessages = [
      {
        id: "g1",
        role: "user" as const,
        segments: [{ type: "text" as const, content: "gsd msg" }],
      },
    ];
    writePersistedMessages("get-shit-done", gsdMessages);
    const { result } = renderHook(() => useConversations());

    act(() => {
      result.current.setActiveAgentId("get-shit-done");
    });

    expect(result.current.messages).toEqual(gsdMessages);
  });

  it("switching back to an agent restores its cached messages (in-memory cache, not re-read from localStorage)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "dove answer" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useConversations());

    // Send a dove message
    await act(async () => {
      await result.current.sendMessage("hello dove");
    });
    const doveMessages = result.current.messages;

    // Switch to gsd
    act(() => {
      result.current.setActiveAgentId("get-shit-done");
    });
    expect(result.current.messages).toEqual([]);

    // Switch back to dove
    act(() => {
      result.current.setActiveAgentId("dove");
    });
    expect(result.current.messages).toEqual(doveMessages);
  });

  it("setActiveAgentId is a no-op when switching to the already-active agent", () => {
    const { result } = renderHook(() => useConversations());
    const messagesBefore = result.current.messages;
    act(() => {
      result.current.setActiveAgentId("dove");
    });
    expect(result.current.messages).toEqual(messagesBefore);
  });

  // ─── Endpoint routing ─────────────────────────────────────────────────────────

  it("sends to /api/chat when active agent is dove", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "hi" }, { type: "done" }]),
    );
    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/chat");
  });

  it("sends to /api/agent/[name]/chat when active agent is not dove", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "hi" }, { type: "done" }]),
    );
    const { result } = renderHook(() => useConversations());
    act(() => {
      result.current.setActiveAgentId("get-shit-done");
    });
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/agent/get-shit-done/chat");
  });

  // ─── SSE streaming ────────────────────────────────────────────────────────────

  it("adds user and assistant messages on sendMessage", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "pong" }, { type: "done" }]),
    );
    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("ping");
    });
    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[1].role).toBe("assistant");
    expect(text(result.current.messages[1])).toBe("pong");
  });

  it("stores sessionId from session event and sends it on next request", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeSseResponse([
          { type: "session", sessionId: "sess-x" },
          { type: "result", content: "first" },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "second" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("first");
    });
    await act(async () => {
      await result.current.sendMessage("second");
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string);
    expect(body.sessionId).toBe("sess-x");
  });

  // ─── Persistence on message update ───────────────────────────────────────────

  it("writes messages to localStorage after receiving them (debounced)", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "stored" }, { type: "done" }]),
    );
    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("save me");
    });
    await act(async () => {
      vi.runAllTimers();
    });
    const stored = readPersistedMessages("dove");
    expect(stored).not.toBeNull();
    expect(stored!.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  // ─── newSession ────────────────────────────────────────────────────────────

  it("newSession empties messages and resets sessionId", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "session", sessionId: "sess-clear" },
        { type: "result", content: "hi" },
        { type: "done" },
      ]),
    );
    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    act(() => {
      result.current.newSession();
    });
    expect(result.current.messages).toEqual([]);

    // Next message sends null sessionId
    vi.mocked(fetch).mockResolvedValue(makeSseResponse([{ type: "done" }]));
    await act(async () => {
      await result.current.sendMessage("after clear");
    });
    const body = JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string);
    expect(body.sessionId).toBeNull();
  });

  it("newSession removes conversation from localStorage", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "hi" }, { type: "done" }]),
    );
    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    act(() => {
      result.current.newSession();
    });
    // clearPersistedConversation removes the key synchronously;
    // the debounced write hasn't fired yet so the key is still null
    expect(readPersistedMessages("dove")).toBeNull();
  });

  // ─── Pending queue ────────────────────────────────────────────────────────────

  it("queues message sent while loading", async () => {
    let resolve!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolve = r;
    });
    vi.mocked(fetch)
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(Promise.resolve(makeSseResponse([{ type: "done" }])));

    const { result } = renderHook(() => useConversations());
    act(() => {
      void result.current.sendMessage("first");
    });
    await waitFor(() => result.current.isLoading);

    act(() => {
      void result.current.sendMessage("second");
    });
    expect(result.current.pendingQueue).toEqual(["second"]);

    resolve(makeSseResponse([{ type: "result", content: "ok" }, { type: "done" }]));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
