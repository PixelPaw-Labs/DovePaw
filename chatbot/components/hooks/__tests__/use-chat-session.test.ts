import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "../use-chat-session";
import { messageText } from "../use-messages";
import type { ChatMessage } from "../use-messages";

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

describe("useChatSession", () => {
  let uuidCount = 0;

  beforeEach(() => {
    uuidCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++uuidCount}` });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Initial state ─────────────────────────────────────────────────────────

  it("starts with empty messages and isLoading false", async () => {
    // mount: GET /api/chat/active-session → {id: null}
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: null }), { status: 200 }),
    );
    const { result } = renderHook(() => useChatSession("dove"));
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.currentSessionId).toBeNull();
  });

  // ─── sendMessage ───────────────────────────────────────────────────────────

  it("sendMessage adds user and assistant messages on success", async () => {
    vi.mocked(fetch)
      // mount active-session
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      // sendMessage POST
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "pong" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useChatSession("dove"));

    await act(async () => {
      await result.current.sendMessage("ping");
    });

    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[1].role).toBe("assistant");
    expect(text(result.current.messages[1])).toBe("pong");
  });

  it("sendMessage sets isLoading while running", async () => {
    let resolveStream!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveStream = r;
    });
    vi.mocked(fetch)
      // mount active-session
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      // sendMessage POST → pending stream
      .mockReturnValueOnce(pending);

    const { result } = renderHook(() => useChatSession("dove"));

    act(() => {
      void result.current.sendMessage("hello");
    });

    await waitFor(() => result.current.isLoading);
    expect(result.current.isLoading).toBe(true);

    resolveStream(makeSseResponse([{ type: "done" }]));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("sendMessage stores sessionId from session event", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockResolvedValueOnce(
        makeSseResponse([
          { type: "session", sessionId: "srv-sess-1" },
          { type: "result", content: "hi" },
          { type: "done" },
        ]),
      );

    const { result } = renderHook(() => useChatSession("dove"));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(result.current.currentSessionId).toBe("srv-sess-1");
  });

  it("sendMessage queues messages when already loading", async () => {
    let resolveFirst!: (v: Response) => void;
    const firstPending = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockReturnValueOnce(firstPending);

    const { result } = renderHook(() => useChatSession("dove"));

    act(() => {
      void result.current.sendMessage("first");
    });
    await waitFor(() => result.current.isLoading);

    // Send a second message while loading — it should go to the queue
    act(() => {
      void result.current.sendMessage("second");
    });

    expect(result.current.pendingQueue).toHaveLength(1);
    expect(result.current.pendingQueue[0]).toBe("second");

    resolveFirst(makeSseResponse([{ type: "done" }]));
    await waitFor(() => !result.current.isLoading);
  });

  // ─── cancelMessage ──────────────────────────────────────────────────────────

  it("cancelMessage aborts stream and sets sessionCancelled", async () => {
    let resolveStream!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveStream = r;
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // DELETE

    const { result } = renderHook(() => useChatSession("dove"));

    act(() => {
      void result.current.sendMessage("work forever");
    });
    await waitFor(() => result.current.isLoading);

    act(() => {
      result.current.cancelMessage();
    });

    await waitFor(() => !result.current.isLoading);
    expect(result.current.isLoading).toBe(false);

    resolveStream(makeSseResponse([]));
  });

  it("cancelMessage sends DELETE to agent endpoint when sessionId is set", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "session", sessionId: "cancel-sess" }, { type: "done" }]),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // DELETE

    const { result } = renderHook(() => useChatSession("dove"));

    await act(async () => {
      await result.current.sendMessage("work");
    });

    await act(async () => {
      result.current.cancelMessage();
    });

    const deleteCalls = vi.mocked(fetch).mock.calls.filter((c) => c[1]?.method === "DELETE");
    expect(deleteCalls.length).toBeGreaterThan(0);
    const body = JSON.parse((deleteCalls[0][1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.sessionId).toBe("cancel-sess");
  });

  // ─── newSession ─────────────────────────────────────────────────────────────

  it("newSession resets all state", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockResolvedValueOnce(makeSseResponse([{ type: "result", content: "hi" }, { type: "done" }]))
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // PUT active-session

    const { result } = renderHook(() => useChatSession("dove"));

    await act(async () => {
      await result.current.sendMessage("hello");
    });
    expect(result.current.messages).toHaveLength(2);

    act(() => {
      result.current.newSession();
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.currentSessionId).toBeNull();
    expect(result.current.pendingQueue).toHaveLength(0);
  });

  // ─── setSessionId ───────────────────────────────────────────────────────────

  it("setSessionId loads session from DB", async () => {
    const dbMessages = [
      { id: "u1", role: "user", segments: [{ type: "text", content: "hello" }] },
      { id: "a1", role: "assistant", segments: [{ type: "text", content: "world" }] },
    ];
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ messages: dbMessages, progress: [], resumeSeq: 0, status: "done" }),
          { status: 200 },
        ),
      );

    const { result } = renderHook(() => useChatSession("dove"));

    await act(async () => {
      await result.current.setSessionId("my-session");
      await new Promise((r) => setTimeout(r, 10));
    });

    await waitFor(() => result.current.currentSessionId === "my-session");
    expect(result.current.messages).toHaveLength(2);
  });

  it("setSessionId reconnects via SSE when resumeHint is available", async () => {
    const dbMessages = [
      {
        id: "a1",
        role: "assistant",
        segments: [{ type: "text", content: "partial response" }],
      },
    ];
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: dbMessages,
            progress: [],
            resumeSeq: 3,
            status: "running",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "running result" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useChatSession("dove"));

    await act(async () => {
      void result.current.setSessionId("running-sess");
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => !result.current.isLoading);

    const streamCalls = vi
      .mocked(fetch)
      .mock.calls.filter((c) => typeof c[0] === "string" && c[0].includes("/api/chat/stream/"));
    expect(streamCalls).toHaveLength(1);
  });

  it("setSessionId reconnects via polling when no resumeHint (A2A session)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ messages: [], progress: [], resumeSeq: 0, status: "running" }),
          { status: 200 },
        ),
      );

    const { result } = renderHook(() => useChatSession("my-agent"));

    await act(async () => {
      void result.current.setSessionId("running-sess");
      await new Promise((r) => setTimeout(r, 20));
    });

    // isLoading must be true — STOP button / 5-dots must be visible
    expect(result.current.isLoading).toBe(true);

    // No SSE stream fetch — startPolling is used instead
    const streamCalls = vi
      .mocked(fetch)
      .mock.calls.filter((c) => typeof c[0] === "string" && c[0].includes("/api/chat/stream/"));
    expect(streamCalls).toHaveLength(0);
  });

  // ─── Pending queue drain ────────────────────────────────────────────────────

  it("pending queue drains when isLoading becomes false", async () => {
    let resolveFirst!: (v: Response) => void;
    const firstPending = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockReturnValueOnce(firstPending)
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "queued reply" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useChatSession("dove"));

    act(() => {
      void result.current.sendMessage("first");
    });
    await waitFor(() => result.current.isLoading);

    act(() => {
      void result.current.sendMessage("queued");
    });
    expect(result.current.pendingQueue).toHaveLength(1);

    resolveFirst(makeSseResponse([{ type: "result", content: "first reply" }, { type: "done" }]));
    await waitFor(() => result.current.pendingQueue.length === 0);
    await waitFor(() => !result.current.isLoading);

    // Both turns should be in messages now
    expect(result.current.messages.some((m) => m.role === "user")).toBe(true);
  });

  // ─── resolvePermission ──────────────────────────────────────────────────────

  it("resolvePermission calls permission API and clears the permission", async () => {
    const permissionEvent = {
      type: "permission",
      requestId: "req-1",
      toolName: "Write",
      toolInput: {},
      title: "Write to file?",
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      .mockResolvedValueOnce(makeSseResponse([permissionEvent, { type: "done" }]))
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // permission POST

    const { result } = renderHook(() => useChatSession("dove"));

    await act(async () => {
      await result.current.sendMessage("do something risky");
    });

    await waitFor(() => result.current.pendingPermissions.length > 0);
    expect(result.current.pendingPermissions[0].requestId).toBe("req-1");

    await act(async () => {
      await result.current.resolvePermission("req-1", true);
    });

    expect(result.current.pendingPermissions).toHaveLength(0);

    const permissionPost = vi
      .mocked(fetch)
      .mock.calls.find((c) => typeof c[0] === "string" && c[0] === "/api/chat/permission");
    expect(permissionPost).toBeTruthy();
    const body = JSON.parse((permissionPost![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.requestId).toBe("req-1");
    expect(body.allowed).toBe(true);
  });
});
