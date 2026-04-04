import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversations } from "../use-conversations";
import { messageText } from "../use-messages";
import type { ChatMessage } from "../use-messages";
import { readActiveAgentId } from "../use-persisted-conversation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSseResponse(events: object[]) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** A response for API calls that return null active session (no restoration). */
function makeNoSessionResponse(): Response {
  return new Response(JSON.stringify({ contextId: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A response for API calls that return an active session with messages. */
function makeSessionResponse(contextId: string, _messages: ChatMessage[] = []): Response {
  return new Response(JSON.stringify({ contextId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A response for session detail API calls. */
function makeDetailResponse(messages: ChatMessage[] = [], progress: object[] = []): Response {
  return new Response(JSON.stringify({ messages, progress }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
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
    // Default mock: mount fetches active-session → null (no restoration)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ contextId: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
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

  it("starts with empty messages and not loading", () => {
    const { result } = renderHook(() => useConversations());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("hydrates messages from API on mount when active session exists", async () => {
    const stored: ChatMessage[] = [
      { id: "m1", role: "user", segments: [{ type: "text", content: "hello" }] },
    ];
    vi.mocked(fetch).mockImplementation((url) => {
      if (url === "/api/chat/active-session") {
        return Promise.resolve(
          new Response(JSON.stringify({ contextId: "sess-abc" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (typeof url === "string" && url.startsWith("/api/chat/session/")) {
        return Promise.resolve(makeDetailResponse(stored));
      }
      return Promise.resolve(new Response(JSON.stringify({ contextId: null }), { status: 200 }));
    });

    const { result } = renderHook(() => useConversations());
    await act(async () => {
      // flush microtasks so the fetch chain resolves and state updates are committed
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.messages).toEqual(stored), { timeout: 3000 });
  });

  // ─── Agent switching ──────────────────────────────────────────────────────────

  it("setActiveAgentId switches the active agent", () => {
    const { result } = renderHook(() => useConversations());
    act(() => {
      result.current.setActiveAgentId("get-shit-done");
    });
    expect(result.current.activeAgentId).toBe("get-shit-done");
  });

  it("setActiveAgentId writes new activeAgentId via writeActiveAgentId (no-op stub)", () => {
    const { result } = renderHook(() => useConversations());
    act(() => {
      result.current.setActiveAgentId("memory-distiller");
    });
    // writeActiveAgentId is a no-op stub — readActiveAgentId always returns 'dove'
    expect(readActiveAgentId()).toBe("dove");
  });

  it("setActiveAgentId saves current messages to cache before switching", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount: active-session
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "dove answer" }, { type: "done" }]),
      )
      .mockResolvedValueOnce(makeNoSessionResponse()); // switch to gsd: active-session

    const { result } = renderHook(() => useConversations());

    await act(async () => {
      await result.current.sendMessage("hello dove");
    });
    const doveMessageCount = result.current.messages.length;
    expect(doveMessageCount).toBeGreaterThan(0);

    // Switch away — messages are saved to cache
    act(() => {
      result.current.setActiveAgentId("get-shit-done");
    });

    // Switch back — messages are restored from cache
    act(() => {
      result.current.setActiveAgentId("dove");
    });
    expect(result.current.messages.length).toBe(doveMessageCount);
  });

  it("setActiveAgentId loads messages for the new agent from API", async () => {
    const gsdMessages: ChatMessage[] = [
      { id: "g1", role: "user", segments: [{ type: "text", content: "gsd msg" }] },
    ];
    vi.mocked(fetch).mockImplementation((url) => {
      if (url === "/api/chat/active-session") {
        return Promise.resolve(makeNoSessionResponse());
      }
      if (url === "/api/agent/get-shit-done/active-session") {
        return Promise.resolve(makeSessionResponse("gsd-sess"));
      }
      if (typeof url === "string" && url.startsWith("/api/agent/get-shit-done/session/")) {
        return Promise.resolve(makeDetailResponse(gsdMessages));
      }
      return Promise.resolve(makeNoSessionResponse());
    });

    const { result } = renderHook(() => useConversations());

    act(() => {
      result.current.setActiveAgentId("get-shit-done");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.messages).toEqual(gsdMessages), { timeout: 3000 });
  });

  it("switching back to an agent restores its cached messages (in-memory cache)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount: active-session
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "dove answer" }, { type: "done" }]),
      )
      .mockResolvedValueOnce(makeNoSessionResponse()); // switch to gsd: active-session

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

    // Switch back to dove — from cache
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
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount: active-session
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "hi" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    // call[0] is the mount active-session fetch; call[1] is the chat POST
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("/api/chat");
  });

  it("sends to /api/agent/[name]/chat when active agent is not dove", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount: active-session
      .mockResolvedValueOnce(makeNoSessionResponse()) // setActiveAgentId: active-session
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "hi" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useConversations());
    act(() => {
      result.current.setActiveAgentId("get-shit-done");
    });
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    // call[0] = mount, call[1] = setActiveAgentId active-session, call[2] = chat POST
    expect(vi.mocked(fetch).mock.calls[2][0]).toBe("/api/agent/get-shit-done/chat");
  });

  // ─── SSE streaming ────────────────────────────────────────────────────────────

  it("adds user and assistant messages on sendMessage", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount
      .mockResolvedValueOnce(
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
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount
      .mockResolvedValueOnce(
        makeSseResponse([
          { type: "session", sessionId: "sess-x" },
          { type: "result", content: "first" },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }), // setSessionId PUT
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

    // Find the second chat POST call (not the active-session or PUT calls)
    const chatPosts = vi
      .mocked(fetch)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0] === "/api/chat" && c[1]?.method === "POST",
      );
    expect(chatPosts.length).toBe(2);
    const body = JSON.parse((chatPosts[1][1] as RequestInit).body as string);
    expect(body.sessionId).toBe("sess-x");
  });

  // ─── Persistence (no-op localStorage, API-based) ──────────────────────────────

  it("does not write to localStorage for messages (no-op stubs)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "stored" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("save me");
    });
    // localStorage should be empty since stubs are no-ops
    expect(localStorage.getItem("dovepaw:conv:dove:messages")).toBeNull();
  });

  // ─── newSession ────────────────────────────────────────────────────────────

  it("newSession empties messages and resets sessionId", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount
      .mockResolvedValueOnce(
        makeSseResponse([
          { type: "session", sessionId: "sess-clear" },
          { type: "result", content: "hi" },
          { type: "done" },
        ]),
      )
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })); // PUT + next POST

    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    act(() => {
      result.current.newSession();
    });
    expect(result.current.messages).toEqual([]);

    // Next message sends null sessionId
    vi.mocked(fetch).mockResolvedValueOnce(makeSseResponse([{ type: "done" }]));
    await act(async () => {
      await result.current.sendMessage("after clear");
    });
    const chatPosts = vi
      .mocked(fetch)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0] === "/api/chat" && c[1]?.method === "POST",
      );
    const body = JSON.parse((chatPosts[1][1] as RequestInit).body as string);
    expect(body.sessionId).toBeNull();
  });

  it("newSession PUTs null to active-session API", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount
      .mockResolvedValueOnce(makeSseResponse([{ type: "result", content: "hi" }, { type: "done" }]))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { result } = renderHook(() => useConversations());
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    act(() => {
      result.current.newSession();
    });

    // Find the PUT to active-session
    const puts = vi
      .mocked(fetch)
      .mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          c[0] === "/api/chat/active-session" &&
          (c[1] as RequestInit)?.method === "PUT",
      );
    expect(puts.length).toBeGreaterThan(0);
    const body = JSON.parse((puts[0][1] as RequestInit).body as string);
    expect(body.contextId).toBeNull();
  });

  // ─── Pending queue ────────────────────────────────────────────────────────────

  it("queues message sent while loading", async () => {
    let resolveFirst!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeNoSessionResponse()) // mount
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

    resolveFirst(makeSseResponse([{ type: "result", content: "ok" }, { type: "done" }]));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3)); // mount + first + second
  });
});
