import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionRegistry } from "../use-session-registry";
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

describe("useSessionRegistry", () => {
  let uuidCount = 0;

  beforeEach(() => {
    uuidCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++uuidCount}` });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Initial state ────────────────────────────────────────────────────────────

  it("starts with no active session and empty sessions list", () => {
    const { result } = renderHook(() => useSessionRegistry());
    expect(result.current.sessions).toEqual([]);
    expect(result.current.activeSessionKey).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  // ─── createSession ────────────────────────────────────────────────────────────

  it("createSession returns a key and adds it to the sessions list", () => {
    const { result } = renderHook(() => useSessionRegistry());
    let key!: string;
    act(() => {
      key = result.current.createSession();
    });
    expect(key).toBeTruthy();
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].key).toBe(key);
  });

  it("createSession sets the new key as active", () => {
    const { result } = renderHook(() => useSessionRegistry());
    let key!: string;
    act(() => {
      key = result.current.createSession();
    });
    expect(result.current.activeSessionKey).toBe(key);
  });

  it("createSession clears rendering state", () => {
    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.sessionCancelled).toBe(false);
    expect(result.current.currentSessionId).toBeNull();
  });

  it("multiple createSession calls produce multiple sessions", () => {
    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
      result.current.createSession();
    });
    expect(result.current.sessions).toHaveLength(2);
  });

  // ─── newSession ───────────────────────────────────────────────────────────────

  it("newSession creates a blank session without removing existing sessions", () => {
    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    act(() => {
      result.current.newSession();
    });
    expect(result.current.sessions).toHaveLength(2);
  });

  // ─── sendMessage ──────────────────────────────────────────────────────────────

  it("sendMessage adds user and assistant messages on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeSseResponse([{ type: "result", content: "pong" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });

    await act(async () => {
      await result.current.sendMessage("ping");
    });

    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[1].role).toBe("assistant");
    expect(text(result.current.messages[1])).toBe("pong");
  });

  it("sendMessage stores the sessionId from session event", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeSseResponse([
        { type: "session", sessionId: "srv-sess-1" },
        { type: "result", content: "hi" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(result.current.currentSessionId).toBe("srv-sess-1");
  });

  it("sendMessage uses null sessionId on first turn", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeSseResponse([{ type: "done" }]));

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const chatPost = vi
      .mocked(fetch)
      .mock.calls.find(
        (c) => typeof c[0] === "string" && c[0] === "/api/chat" && c[1]?.method === "POST",
      );
    expect(chatPost).toBeTruthy();
    const body = JSON.parse((chatPost![1] as RequestInit).body as string);
    expect(body.sessionId).toBeNull();
  });

  it("sendMessage sends stored sessionId on subsequent turns", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeSseResponse([
          { type: "session", sessionId: "srv-sess-2" },
          { type: "result", content: "first" },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "second" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("first");
    });
    await act(async () => {
      await result.current.sendMessage("second");
    });

    const chatPosts = vi
      .mocked(fetch)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0] === "/api/chat" && c[1]?.method === "POST",
      );
    expect(chatPosts.length).toBe(2);
    const body = JSON.parse((chatPosts[1][1] as RequestInit).body as string);
    expect(body.sessionId).toBe("srv-sess-2");
  });

  it("sendMessage sets isLoading while running", async () => {
    let resolveStream!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveStream = r;
    });
    vi.mocked(fetch).mockReturnValueOnce(pending);

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });

    act(() => {
      void result.current.sendMessage("hello");
    });

    await waitFor(() => result.current.isLoading);
    expect(result.current.isLoading).toBe(true);

    resolveStream(makeSseResponse([{ type: "done" }]));
    await waitFor(() => !result.current.isLoading);
  });

  it("sendMessage auto-creates a session when none is active", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('data: {"type":"done"}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const { result } = renderHook(() => useSessionRegistry());
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(result.current.sessions.length).toBe(1);
  });

  it("sendMessage is a no-op when already loading", async () => {
    let resolveFirst!: (v: Response) => void;
    const firstPending = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    vi.mocked(fetch).mockReturnValueOnce(firstPending);

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    act(() => {
      void result.current.sendMessage("first");
    });
    await waitFor(() => result.current.isLoading);

    // Attempt second send while loading
    await act(async () => {
      await result.current.sendMessage("second while loading");
    });

    // Only one fetch call (the first one)
    const chatPosts = vi
      .mocked(fetch)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0] === "/api/chat" && c[1]?.method === "POST",
      );
    expect(chatPosts).toHaveLength(1);

    resolveFirst(makeSseResponse([{ type: "done" }]));
    await waitFor(() => !result.current.isLoading);
  });

  it("sendMessage handles cancelled event", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeSseResponse([{ type: "cancelled" }]));

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("do something");
    });

    expect(result.current.sessionCancelled).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  // ─── switchToSession ──────────────────────────────────────────────────────────

  it("switchToSession changes the active key and syncs rendering state", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSseResponse([{ type: "done" }]));

    const { result } = renderHook(() => useSessionRegistry());
    let key1!: string;
    let key2!: string;
    act(() => {
      key1 = result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("hello from session 1");
    });
    act(() => {
      key2 = result.current.createSession();
    });

    expect(result.current.activeSessionKey).toBe(key2);
    expect(result.current.messages).toHaveLength(0);

    await act(async () => {
      await result.current.switchToSession(key1);
    });
    expect(result.current.activeSessionKey).toBe(key1);
    // After switching back to key1 which had messages
    expect(result.current.messages.length).toBeGreaterThan(0);
  });

  it("switchToSession is a no-op when switching to the already-active session", async () => {
    const { result } = renderHook(() => useSessionRegistry());
    let key!: string;
    act(() => {
      key = result.current.createSession();
    });
    await act(async () => {
      await result.current.switchToSession(key);
    });
    // No additional fetch calls (no stream reconnect for non-running session)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("switchToSession loads from DB when session completed while away", async () => {
    const encoder = new TextEncoder();

    // Stream A emits a session event then hangs (simulates the user switching away mid-response)
    const hangingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "session", sessionId: "srv-sess-hanging" })}\n\n`,
          ),
        );
        // Never closes — subprocess is still running on the server
      },
    });

    const dbMessages = [
      { id: "u1", role: "user", segments: [{ type: "text", content: "hello" }] },
      { id: "a1", role: "assistant", segments: [{ type: "text", content: "completed reply" }] },
    ];

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        // POST /api/chat for session A — stream hangs after emitting session ID
        new Response(hangingBody, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      )
      .mockResolvedValueOnce(
        // GET /api/chat/session/srv-sess-hanging — DB status re-check inside switchToSession
        new Response(
          JSON.stringify({ messages: dbMessages, progress: [], resumeSeq: 0, status: "done" }),
          { status: 200 },
        ),
      );

    const { result } = renderHook(() => useSessionRegistry());
    let key1!: string;
    act(() => {
      key1 = result.current.createSession();
    });

    // Start session A — stream connects, session event arrives (isLoading=true, sessionId set), then hangs
    act(() => {
      void result.current.sendMessage("hello");
    });

    // Wait for the session ID from the SSE stream to be stored
    await waitFor(() => result.current.currentSessionId === "srv-sess-hanging");

    // Switch to a new session (saves session A's state — isLoading=true, sessionId set)
    act(() => {
      result.current.newSession();
    });

    // Switch back to session A — should detect it completed via DB re-check, load from DB
    await act(async () => {
      await result.current.switchToSession(key1);
    });

    expect(result.current.messages).toHaveLength(2);
    expect(text(result.current.messages[1])).toBe("completed reply");
    expect(result.current.isLoading).toBe(false);
  });

  // ─── stopSession ──────────────────────────────────────────────────────────────

  it("stopSession marks the session as cancelled and clears isLoading", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "session", sessionId: "stop-sess" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useSessionRegistry());
    let key!: string;
    act(() => {
      key = result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("work forever");
    });

    await act(async () => {
      await result.current.stopSession(key);
    });

    const session = result.current.sessions.find((s) => s.key === key);
    expect(session?.status).toBe("cancelled");
    expect(session?.isCancelled).toBe(true);
  });

  it("stopSession sends PATCH to server when sessionId is set", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "session", sessionId: "stop-sess-2" }, { type: "done" }]),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // PATCH (abort subprocess) response

    const { result } = renderHook(() => useSessionRegistry());
    let key!: string;
    act(() => {
      key = result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("something");
    });
    await act(async () => {
      await result.current.stopSession(key);
    });

    const patchCalls = vi.mocked(fetch).mock.calls.filter((c) => c[1]?.method === "PATCH");
    expect(patchCalls.length).toBeGreaterThan(0);
    const body = JSON.parse((patchCalls[0][1] as RequestInit).body as string);
    expect(body.sessionId).toBe("stop-sess-2");
  });

  // ─── cancelMessage ────────────────────────────────────────────────────────────

  it("cancelMessage calls stopSession on the active session", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "session", sessionId: "cancel-sess" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("work");
    });

    await act(async () => {
      result.current.cancelMessage();
    });

    expect(result.current.sessionCancelled).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  // ─── Progress events ──────────────────────────────────────────────────────────

  it("stores sessionProgress from progress events", async () => {
    const progressEntry = { message: "step 1", artifacts: {} };
    vi.mocked(fetch).mockResolvedValueOnce(
      makeSseResponse([
        { type: "progress", result: { output: "", progress: [progressEntry] } },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("run agent");
    });

    await waitFor(() => result.current.sessionProgress.length > 0);
    expect(result.current.sessionProgress[0].message).toBe("step 1");
  });

  // ─── Permission events ────────────────────────────────────────────────────────

  it("sets hasPendingPermission on the session and exposes pendingPermissions for active session", async () => {
    const permissionEvent = {
      type: "permission",
      requestId: "req-1",
      toolName: "Write",
      toolInput: {},
      title: "Write to file?",
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeSseResponse([permissionEvent, { type: "done" }]));

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("do something risky");
    });

    await waitFor(() => result.current.pendingPermissions.length > 0);
    expect(result.current.pendingPermissions[0].requestId).toBe("req-1");

    const activeSession = result.current.sessions.find(
      (s) => s.key === result.current.activeSessionKey,
    );
    expect(activeSession?.hasPendingPermission).toBe(true);
  });

  it("resolvePermission removes from pendingPermissions on success", async () => {
    const permissionEvent = {
      type: "permission",
      requestId: "req-resolve",
      toolName: "Write",
      toolInput: {},
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeSseResponse([permissionEvent, { type: "done" }]))
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // permission POST

    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
    });
    await act(async () => {
      await result.current.sendMessage("risky");
    });
    await waitFor(() => result.current.pendingPermissions.length > 0);

    await act(async () => {
      await result.current.resolvePermission("req-resolve", true);
    });

    expect(result.current.pendingPermissions).toHaveLength(0);
  });

  // ─── setActiveAgentId — Dove restore while loading ────────────────────────────

  it("switching back to Dove while loading restores isLoading:true from registry", async () => {
    const enc = new TextEncoder();

    // Dove stream: sends session event, then hangs open (never done)
    const hangingStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(
          enc.encode(`data: ${JSON.stringify({ type: "session", sessionId: "live-sess" })}\n\n`),
        );
      },
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        // Dove chat POST → hanging SSE stream
        new Response(hangingStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      )
      // active-session lookup when switching to memory-dream (no prior session)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      // agent sessions fallback (empty list)
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      // reconnect stream — session still running, no "done" yet
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ start() {} }), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );

    const { result } = renderHook(() => useSessionRegistry());

    act(() => {
      result.current.createSession();
    });

    // Fire sendMessage — do not await so the hanging stream keeps it in-flight
    act(() => {
      void result.current.sendMessage("long running task");
    });

    // Let microtasks run so the session event is processed
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.currentSessionId).toBe("live-sess");

    // Switch to another agent — this aborts the Dove SSE connection
    await act(async () => {
      result.current.setActiveAgentId("memory-dream");
      // flush the AbortError microtask so sessionsRef.isLoading stays true
      await new Promise((r) => setTimeout(r, 0));
    });

    // Rendering state was cleared
    expect(result.current.isLoading).toBe(false);
    expect(result.current.activeAgentId).toBe("memory-dream");

    // Switch back to Dove
    await act(async () => {
      result.current.setActiveAgentId("dove");
      await new Promise((r) => setTimeout(r, 0));
    });

    // isLoading must be restored from registry (the core fix)
    expect(result.current.isLoading).toBe(true);
    expect(result.current.currentSessionId).toBe("live-sess");
  });

  // ─── setActiveAgentId — non-Dove stream reconnect ────────────────────────────

  it("setActiveAgentId: cold-connects to stream when switching to non-Dove agent with running session", async () => {
    vi.mocked(fetch)
      // active-session lookup for gsd
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ctx-gsd" }), { status: 200 }))
      // session detail — running
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [], progress: [], status: "running" }), {
          status: 200,
        }),
      )
      // stream connection (cold, after=0)
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "live" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useSessionRegistry());

    await act(async () => {
      result.current.setActiveAgentId("gsd");
      // Allow the async IIFE (active-session + session detail + stream) to complete
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => !result.current.isLoading);

    // Core assertion: stream URL called with after=0 (cold reconnect — no prior seq)
    const streamCall = vi
      .mocked(fetch)
      .mock.calls.find(
        (c) => typeof c[0] === "string" && String(c[0]).startsWith("/api/chat/stream/ctx-gsd"),
      );
    expect(streamCall).toBeTruthy();
    expect(streamCall![0]).toContain("after=0");
  });

  it("setActiveAgentId: skips stream reconnect when non-Dove agent has no active session", async () => {
    vi.mocked(fetch)
      // active-session → null
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      // agent sessions fallback → empty
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [] }), { status: 200 }));

    const { result } = renderHook(() => useSessionRegistry());

    await act(async () => {
      result.current.setActiveAgentId("gsd");
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.isLoading).toBe(false);
    const streamCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && String(c[0]).includes("/api/chat/stream/"),
      );
    expect(streamCalls).toHaveLength(0);
  });

  // ─── setSessionId — non-Dove stream reconnect ─────────────────────────────────

  it("setSessionId: cold-connects to stream for running non-Dove session from history", async () => {
    vi.mocked(fetch)
      // setActiveAgentId's active-session → null (no running session on switch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      // setActiveAgentId's sessions fallback → empty
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [] }), { status: 200 }))
      // setSessionId session detail — running
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [], progress: [], status: "running" }), {
          status: 200,
        }),
      )
      // stream connection (cold, after=0)
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "hi" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useSessionRegistry());

    // Switch to non-Dove agent first (sets the non-Dove path in the hook)
    await act(async () => {
      result.current.setActiveAgentId("gsd");
      await new Promise((r) => setTimeout(r, 10));
    });

    // Load a historical session from the DB
    await act(async () => {
      void result.current.setSessionId("ctx-hist");
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => !result.current.isLoading);

    // Core assertion: stream URL called with after=0 (cold reconnect — no prior seq)
    const streamCall = vi
      .mocked(fetch)
      .mock.calls.find(
        (c) => typeof c[0] === "string" && String(c[0]).startsWith("/api/chat/stream/ctx-hist"),
      );
    expect(streamCall).toBeTruthy();
    expect(streamCall![0]).toContain("after=0");
  });

  it("setSessionId: does not stream-reconnect for a completed non-Dove session", async () => {
    vi.mocked(fetch)
      // setActiveAgentId's active-session → null
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null }), { status: 200 }))
      // setActiveAgentId's sessions fallback → empty
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [] }), { status: 200 }))
      // setSessionId session detail — done
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [
              { id: "m1", role: "assistant", segments: [{ type: "text", content: "result" }] },
            ],
            progress: [],
            status: "done",
          }),
          { status: 200 },
        ),
      );

    const { result } = renderHook(() => useSessionRegistry());

    await act(async () => {
      result.current.setActiveAgentId("gsd");
      await new Promise((r) => setTimeout(r, 10));
    });

    await act(async () => {
      void result.current.setSessionId("ctx-done");
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.isLoading).toBe(false);
    const streamCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        (c) => typeof c[0] === "string" && String(c[0]).includes("/api/chat/stream/"),
      );
    expect(streamCalls).toHaveLength(0);
    expect(result.current.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  // ─── Tab bar sessions snapshot ────────────────────────────────────────────────

  it("sessions snapshot contains all created sessions", () => {
    const { result } = renderHook(() => useSessionRegistry());
    act(() => {
      result.current.createSession();
      result.current.createSession();
      result.current.createSession();
    });
    expect(result.current.sessions).toHaveLength(3);
  });

  it("label is set from first message content (max 40 chars)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeSseResponse([{ type: "done" }]));

    const { result } = renderHook(() => useSessionRegistry());
    let key!: string;
    act(() => {
      key = result.current.createSession();
    });
    const longMessage = "This is a very long message that should be truncated to forty";
    await act(async () => {
      await result.current.sendMessage(longMessage);
    });

    const session = result.current.sessions.find((s) => s.key === key);
    expect(session?.label).toBe(longMessage.slice(0, 40));
  });
});
