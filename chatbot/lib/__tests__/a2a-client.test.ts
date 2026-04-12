import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must come before imports) ──────────────────────────────────

vi.mock("@a2a-js/sdk/client", () => ({
  ClientFactory: vi.fn(),
}));

vi.mock("@/a2a/lib/ports-manifest", () => ({
  readPortsManifest: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { ClientFactory } from "@a2a-js/sdk/client";
import {
  startAgentStream,
  collectStreamResult,
  extractArtifactResult,
  collectAgentStreamContext,
  formatAgentStreamContext,
  type A2AStreamEvent,
} from "@/lib/a2a-client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function* asyncEvents(...events: object[]) {
  for (const e of events) yield e;
}

function makeClientFactory(clientOverrides: Record<string, unknown>) {
  const client = {
    cancelTask: vi.fn().mockResolvedValue(undefined),
    ...clientOverrides,
  };
  vi.mocked(ClientFactory).mockImplementation(function () {
    return { createFromUrl: vi.fn().mockResolvedValue(client) };
  } as never);
  return client;
}

// ─── startAgentStream ─────────────────────────────────────────────────────────

describe("startAgentStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns handle with taskId when first event is a task", async () => {
    makeClientFactory({
      sendMessageStream: () => asyncEvents({ kind: "task", id: "task-123" }),
    });

    const handle = await startAgentStream(3000, "hello");

    expect(handle).not.toBeNull();
    expect(handle!.taskId).toBe("task-123");
  });

  it("creates client at the correct localhost URL", async () => {
    const mockCreateFromUrl = vi.fn().mockResolvedValue({
      cancelTask: vi.fn().mockResolvedValue(undefined),
      sendMessageStream: () => asyncEvents({ kind: "task", id: "t1" }),
    });
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: mockCreateFromUrl };
    } as never);

    await startAgentStream(7777, "hello");

    expect(mockCreateFromUrl).toHaveBeenCalledWith("http://localhost:7777");
  });

  it("sends the message text in sendMessageStream parts", async () => {
    const mockStream = vi.fn().mockReturnValue(asyncEvents({ kind: "task", id: "t1" }));
    makeClientFactory({ sendMessageStream: mockStream });

    await startAgentStream(3000, "do the thing");

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          parts: [{ kind: "text", text: "do the thing" }],
        }),
      }),
      expect.any(Object),
    );
  });

  it("returns null when first event is not a task", async () => {
    makeClientFactory({
      sendMessageStream: () => asyncEvents({ kind: "message", content: "hello" }),
    });

    const handle = await startAgentStream(3000, "hello");

    expect(handle).toBeNull();
  });

  it("returns null when stream is immediately done", async () => {
    makeClientFactory({
      sendMessageStream: () => asyncEvents(),
    });

    const handle = await startAgentStream(3000, "hello");

    expect(handle).toBeNull();
  });

  it("calls cancelTask when abort signal fires after taskId is known", async () => {
    const client = makeClientFactory({
      sendMessageStream: () => asyncEvents({ kind: "task", id: "task-abort" }),
    });
    const ac = new AbortController();

    await startAgentStream(3000, "hello", ac.signal);
    ac.abort();
    await Promise.resolve(); // flush microtasks

    expect(client.cancelTask).toHaveBeenCalledWith({ id: "task-abort" });
  });

  it("does not call cancelTask when signal is not aborted", async () => {
    const client = makeClientFactory({
      sendMessageStream: () => asyncEvents({ kind: "task", id: "task-ok" }),
    });
    const ac = new AbortController();

    await startAgentStream(3000, "hello", ac.signal);

    expect(client.cancelTask).not.toHaveBeenCalled();
  });
});

// ─── collectStreamResult ──────────────────────────────────────────────────────

async function* a2aEvents(...events: object[]): AsyncGenerator<A2AStreamEvent, void, undefined> {
  for (const e of events) yield e as A2AStreamEvent;
}

describe("collectStreamResult", () => {
  it("excludes tool-call artifact values from output", async () => {
    const { result } = await collectStreamResult(
      a2aEvents(
        {
          kind: "status-update",
          status: {
            state: "working",
            timestamp: "",
            message: {
              kind: "message",
              messageId: "1",
              role: "agent",
              parts: [{ kind: "text", text: "ToolSearch" }],
            },
          },
          final: false,
        },
        {
          kind: "artifact-update",
          artifact: { name: "tool-call", parts: [{ kind: "text", text: "ToolSearch" }] },
        },
        {
          kind: "artifact-update",
          artifact: {
            name: "final-output",
            parts: [{ kind: "text", text: "Here are the results" }],
          },
        },
      ),
    );
    expect(result.output).not.toContain("ToolSearch");
    expect(result.output).toBe("Here are the results");
  });

  it("includes final-output artifact value in output", async () => {
    const { result } = await collectStreamResult(
      a2aEvents(
        {
          kind: "status-update",
          status: {
            state: "working",
            timestamp: "",
            message: {
              kind: "message",
              messageId: "1",
              role: "agent",
              parts: [{ kind: "text", text: "step" }],
            },
          },
          final: false,
        },
        {
          kind: "artifact-update",
          artifact: { name: "final-output", parts: [{ kind: "text", text: "done" }] },
        },
      ),
    );
    expect(result.output).toBe("done");
  });

  it("passes thinking artifacts to onArtifact but excludes them from output", async () => {
    const onArtifact = vi.fn();
    const { result } = await collectStreamResult(
      a2aEvents(
        {
          kind: "status-update",
          status: {
            state: "working",
            timestamp: "",
            message: {
              kind: "message",
              messageId: "1",
              role: "agent",
              parts: [{ kind: "text", text: "step" }],
            },
          },
          final: false,
        },
        {
          kind: "artifact-update",
          artifact: { name: "thinking", parts: [{ kind: "text", text: "inner thoughts" }] },
        },
        {
          kind: "artifact-update",
          artifact: { name: "final-output", parts: [{ kind: "text", text: "response" }] },
        },
      ),
      undefined,
      onArtifact,
    );
    expect(onArtifact).toHaveBeenCalledWith("thinking", "inner thoughts");
    expect(result.output).toBe("response");
    expect(result.output).not.toContain("inner thoughts");
  });
});

// ─── extractArtifactResult ────────────────────────────────────────────────────

describe("extractArtifactResult", () => {
  it("uses final-output artifact as output", () => {
    const result = extractArtifactResult([
      { name: "tool-call", parts: [{ kind: "text", text: "ToolSearch" }] } as never,
      { name: "final-output", parts: [{ kind: "text", text: "the answer" }] } as never,
    ]);
    expect(result.output).toBe("the answer");
  });

  it("falls back to stream artifact when no final-output", () => {
    const result = extractArtifactResult([
      { name: "stream", parts: [{ kind: "text", text: "streamed text" }] } as never,
    ]);
    expect(result.output).toBe("streamed text");
  });

  it("does not include tool-call, tool-input, or thinking in output", () => {
    const result = extractArtifactResult([
      { name: "tool-call", parts: [{ kind: "text", text: "Bash" }] } as never,
      { name: "tool-input", parts: [{ kind: "text", text: '{"cmd":"ls"}' }] } as never,
      { name: "thinking", parts: [{ kind: "text", text: "reasoning" }] } as never,
    ]);
    expect(result.output).toBe("Something wrong with agent.");
  });

  it("returns 'Something wrong with agent.' for empty artifacts", () => {
    expect(extractArtifactResult([]).output).toBe("Something wrong with agent.");
    expect(extractArtifactResult(undefined).output).toBe("Something wrong with agent.");
  });
});

// ─── collectAgentStreamContext ────────────────────────────────────────────────

describe("collectAgentStreamContext", () => {
  it("collects stream chunks as response", async () => {
    const stream = asyncEvents(
      {
        kind: "artifact-update",
        artifact: { name: "stream", parts: [{ kind: "text", text: "hello " }] },
      },
      {
        kind: "artifact-update",
        artifact: { name: "stream", parts: [{ kind: "text", text: "world" }] },
      },
      { kind: "status-update", status: { state: "completed" }, final: true },
    ) as AsyncGenerator<A2AStreamEvent, void, undefined>;
    const ctx = await collectAgentStreamContext(stream, "ctx-1");
    expect(ctx.response).toBe("hello world");
    expect(ctx.state).toBe("completed");
    expect(ctx.contextId).toBe("ctx-1");
  });

  it("collects thinking chunks", async () => {
    const stream = asyncEvents(
      {
        kind: "artifact-update",
        artifact: { name: "thinking", parts: [{ kind: "text", text: "Let me think..." }] },
      },
      { kind: "status-update", status: { state: "completed" }, final: true },
    ) as AsyncGenerator<A2AStreamEvent, void, undefined>;
    const ctx = await collectAgentStreamContext(stream, "ctx-2");
    expect(ctx.thinking).toBe("Let me think...");
  });

  it("collects tool calls paired with tool input", async () => {
    const stream = asyncEvents(
      {
        kind: "artifact-update",
        artifact: { name: "tool-call", parts: [{ kind: "text", text: "bash" }] },
      },
      {
        kind: "artifact-update",
        artifact: { name: "tool-input", parts: [{ kind: "text", text: '{"command":"ls"}' }] },
      },
      { kind: "status-update", status: { state: "completed" }, final: true },
    ) as AsyncGenerator<A2AStreamEvent, void, undefined>;
    const ctx = await collectAgentStreamContext(stream, "ctx-3");
    expect(ctx.toolCalls).toEqual(['bash: {"command":"ls"}']);
  });

  it("returns unknown state when no final status-update", async () => {
    const stream = asyncEvents() as AsyncGenerator<A2AStreamEvent, void, undefined>;
    const ctx = await collectAgentStreamContext(stream, "ctx-4");
    expect(ctx.state).toBe("unknown");
  });
});

// ─── formatAgentStreamContext ─────────────────────────────────────────────────

describe("formatAgentStreamContext", () => {
  it("includes state and contextId", () => {
    const text = formatAgentStreamContext(
      { state: "completed", contextId: "abc", response: "", thinking: "", toolCalls: [] },
      "MyAgent",
    );
    expect(text).toContain("completed");
    expect(text).toContain("abc");
  });

  it("includes response section when present", () => {
    const text = formatAgentStreamContext(
      { state: "completed", contextId: "abc", response: "done", thinking: "", toolCalls: [] },
      "MyAgent",
    );
    expect(text).toContain("<response>");
    expect(text).toContain("done");
  });

  it("includes thinking section when present", () => {
    const text = formatAgentStreamContext(
      { state: "completed", contextId: "abc", response: "", thinking: "reasoning", toolCalls: [] },
      "MyAgent",
    );
    expect(text).toContain("<thinking>");
    expect(text).toContain("reasoning");
  });

  it("includes actions section when tool calls present", () => {
    const text = formatAgentStreamContext(
      { state: "completed", contextId: "abc", response: "", thinking: "", toolCalls: ["bash: ls"] },
      "MyAgent",
    );
    expect(text).toContain("<actions>");
    expect(text).toContain("- bash: ls");
  });

  it("omits empty sections", () => {
    const text = formatAgentStreamContext(
      { state: "completed", contextId: "abc", response: "", thinking: "", toolCalls: [] },
      "MyAgent",
    );
    expect(text).not.toContain("<thinking>");
    expect(text).not.toContain("<response>");
    expect(text).not.toContain("<actions>");
  });
});
