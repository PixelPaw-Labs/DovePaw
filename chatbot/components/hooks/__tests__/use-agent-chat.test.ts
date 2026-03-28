import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentChat } from "../use-agent-chat";
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

function toolCalls(m: ChatMessage | undefined) {
  return (m?.segments ?? []).filter((s) => s.type === "tool_call").map((s) => s.tool);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useAgentChat", () => {
  let uuidCount = 0;

  beforeEach(() => {
    uuidCount = 0;
    vi.stubGlobal("fetch", vi.fn());
    // Each call returns a unique id — prevents SSE update from matching user message id
    vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++uuidCount}` });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Initial state ───────────────────────────────────────────────────────────

  it("starts with empty messages and not loading", () => {
    const { result } = renderHook(() => useAgentChat());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  // ─── User message ────────────────────────────────────────────────────────────

  it("adds user message immediately on sendMessage", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "hello" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("hi there");
    });

    expect(result.current.messages[0].role).toBe("user");
    expect(text(result.current.messages[0])).toBe("hi there");
  });

  it("adds assistant placeholder while loading", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "response" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useAgentChat());
    act(() => {
      void result.current.sendMessage("ping");
    });

    await waitFor(() => expect(result.current.messages.length).toBe(2));
    expect(result.current.messages[1].role).toBe("assistant");
  });

  // ─── session event ───────────────────────────────────────────────────────────

  it("stores sessionId from session event and sends it in subsequent requests", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeSseResponse([
          { type: "session", sessionId: "sess-abc" },
          { type: "result", content: "first" },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "second" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useAgentChat());

    await act(async () => {
      await result.current.sendMessage("first message");
    });
    await act(async () => {
      await result.current.sendMessage("second message");
    });

    const secondCallBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string,
    );
    expect(secondCallBody.sessionId).toBe("sess-abc");
  });

  // ─── thinking event → processContent ─────────────────────────────────────────

  it("appends thinking delta to processContent and sets isProcessStreaming=true", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "thinking", content: "Let me think..." },
        { type: "result", content: "answer" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.processContent).toBe("Let me think...");
    expect(assistant?.isProcessStreaming).toBe(false); // done event resets it
  });

  it("accumulates multiple thinking deltas into processContent", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "thinking", content: "Step 1. " },
        { type: "thinking", content: "Step 2." },
        { type: "result", content: "done" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.processContent).toBe("Step 1. Step 2.");
  });

  // ─── tool_call event → segments ───────────────────────────────────────────────

  it("adds tool_call segment with name and input", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "tool_call", name: "search" },
        { type: "tool_input", content: JSON.stringify({ query: "test" }) },
        { type: "result", content: "results" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("search for something");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    const calls = toolCalls(assistant);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("search");
    expect(calls[0].input).toEqual({ query: "test" });
  });

  it("tool_call does not appear in processContent", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "tool_call", name: "calc" },
        { type: "tool_input", content: JSON.stringify({ expr: "1+1" }) },
        { type: "result", content: "42" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("compute");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.processContent).toBeUndefined();
    expect(assistant?.isProcessStreaming).toBe(false);
  });

  it("thinking goes to processContent, tool_call goes to segments", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "thinking", content: "I need to search." },
        { type: "tool_call", name: "web_search" },
        { type: "tool_input", content: JSON.stringify({ q: "foo" }) },
        { type: "result", content: "found it" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("research");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.processContent).toContain("I need to search.");
    expect(toolCalls(assistant)[0].name).toBe("web_search");
  });

  it("interleaves tool_call segments between text segments in stream order", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "text", content: "Before." },
        { type: "tool_call", name: "Read" },
        { type: "tool_input", content: JSON.stringify({ file_path: "/foo.ts" }) },
        { type: "text", content: "After." },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    const segs = assistant?.segments ?? [];
    expect(segs[0]).toMatchObject({ type: "text", content: "Before." });
    expect(segs[1]).toMatchObject({ type: "tool_call" });
    expect(segs[2]).toMatchObject({ type: "text", content: "After." });
  });

  // ─── text event → animation + isProcessStreaming ──────────────────────────────

  it("streams text chunks progressively via text events", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "text", content: "Hello" },
        { type: "text", content: " world" },
        { type: "text", content: "!" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(text(assistant)).toBe("Hello world!");
    expect(assistant?.isLoading).toBe(false);
  });

  it("text event sets isProcessStreaming=false immediately", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "thinking", content: "thinking..." },
        { type: "text", content: "answer" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.isProcessStreaming).toBe(false);
  });

  // ─── result event (tool-only fallback) ───────────────────────────────────────

  it("populates assistant message with result content (tool-only fallback)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "Here is the answer." }, { type: "done" }]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    await waitFor(() => !result.current.isLoading);
    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(text(assistant)).toBe("Here is the answer.");
    expect(assistant?.isLoading).toBe(false);
  });

  it("result event is ignored when assistant content is already non-empty (text already streamed)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "text", content: "Streamed answer" },
        { type: "result", content: "Should not overwrite" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(text(assistant)).toBe("Streamed answer");
    expect(text(assistant)).not.toContain("Should not overwrite");
  });

  it("result event sets isProcessStreaming=false", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "thinking", content: "hmm" },
        { type: "result", content: "response" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.isProcessStreaming).toBe(false);
  });

  // ─── error event ─────────────────────────────────────────────────────────────

  it("handles error event from SSE", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "error", content: "Something went wrong" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("test");
    });

    await waitFor(() => !result.current.isLoading);
    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(text(assistant)).toContain("Something went wrong");
  });

  it("error event sets isLoading=false and isProcessStreaming=false", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([
        { type: "thinking", content: "thinking..." },
        { type: "error", content: "Oops" },
        { type: "done" },
      ]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.isLoading).toBe(false);
    expect(assistant?.isProcessStreaming).toBe(false);
  });

  it("error event content is prefixed with warning emoji", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "error", content: "rate limit exceeded" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("test");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(text(assistant)).toMatch(/^⚠️/);
  });

  // ─── done event ───────────────────────────────────────────────────────────────

  it("done event clears isLoading and isProcessStreaming", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "text", content: "hi" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(result.current.isLoading).toBe(false);
    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.isProcessStreaming).toBe(false);
  });

  it("done event sets content to (no response) when assistant content is still empty", async () => {
    vi.mocked(fetch).mockResolvedValue(makeSseResponse([{ type: "done" }]));

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("question");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(text(assistant)).toBe("(no response)");
    expect(assistant?.isLoading).toBe(false);
  });

  // ─── fetch / network errors ───────────────────────────────────────────────────

  it("handles fetch network error gracefully", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network failure"));

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("test");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(text(assistant)).toContain("Connection error");
    expect(text(assistant)).toContain("Network failure");
    expect(assistant?.isLoading).toBe(false);
  });

  it("connection error sets isProcessStreaming=false", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("timeout"));

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("test");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.isProcessStreaming).toBe(false);
  });

  it("non-ok HTTP response is treated as a connection error", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("test");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(text(assistant)).toContain("HTTP 500");
  });

  // ─── clearMessages ────────────────────────────────────────────────────────────

  it("clears all messages and stops loading", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeSseResponse([{ type: "result", content: "hi" }, { type: "done" }]),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("clearMessages resets sessionId so next request sends null", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeSseResponse([
          { type: "session", sessionId: "sess-xyz" },
          { type: "result", content: "first" },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "second" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useAgentChat());

    await act(async () => {
      await result.current.sendMessage("first");
    });

    act(() => {
      result.current.clearMessages();
    });

    await act(async () => {
      await result.current.sendMessage("second");
    });

    const secondCallBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string,
    );
    expect(secondCallBody.sessionId).toBeNull();
  });

  // ─── guard: no duplicate send while loading ───────────────────────────────────

  it("queues message sent while loading and sends it after first completes", async () => {
    let resolveFirst!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    vi.mocked(fetch)
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(Promise.resolve(makeSseResponse([{ type: "done" }])));

    const { result } = renderHook(() => useAgentChat());

    act(() => {
      void result.current.sendMessage("first");
    });
    await waitFor(() => result.current.isLoading);

    act(() => {
      void result.current.sendMessage("second");
    });
    expect(result.current.pendingQueue).toEqual(["second"]);

    resolveFirst(makeSseResponse([{ type: "result", content: "ok" }, { type: "done" }]));
    // Wait for the second fetch to actually be initiated (not just for isLoading to momentarily clear)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("ignores empty or whitespace-only messages", async () => {
    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("   ");
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  // ─── abort on concurrent sendMessage ─────────────────────────────────────────

  it("aborts in-flight request when clearMessages is called mid-stream", async () => {
    let resolveFirst!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    vi.mocked(fetch).mockReturnValueOnce(pending);

    const { result } = renderHook(() => useAgentChat());

    act(() => {
      void result.current.sendMessage("first");
    });
    await waitFor(() => result.current.isLoading);

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages).toEqual([]);

    resolveFirst(makeSseResponse([{ type: "result", content: "late" }, { type: "done" }]));
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.messages).toEqual([]);
  });

  // ─── patchMsg helper behaviour ────────────────────────────────────────────────

  it("patchMsg only updates the targeted message id, leaving others untouched", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "first answer" }, { type: "done" }]),
      )
      .mockResolvedValueOnce(
        makeSseResponse([{ type: "result", content: "second answer" }, { type: "done" }]),
      );

    const { result } = renderHook(() => useAgentChat());

    await act(async () => {
      await result.current.sendMessage("first");
    });
    await act(async () => {
      await result.current.sendMessage("second");
    });

    const messages = result.current.messages;
    expect(messages).toHaveLength(4);
    expect(text(messages[1])).toBe("first answer");
    expect(text(messages[3])).toBe("second answer");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].isLoading).toBe(false);
  });

  // ─── malformed SSE lines ──────────────────────────────────────────────────────

  it("ignores malformed SSE lines without throwing", async () => {
    const body =
      'data: not-valid-json\n\ndata: {"type":"result","content":"ok"}\n\ndata: {"type":"done"}\n\n';
    vi.mocked(fetch).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result } = renderHook(() => useAgentChat());
    await act(async () => {
      await result.current.sendMessage("test");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(text(assistant)).toBe("ok");
  });
});
