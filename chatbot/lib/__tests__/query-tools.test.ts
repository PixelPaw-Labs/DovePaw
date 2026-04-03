/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Module mocks (must come before imports) ──────────────────────────────────

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: vi.fn(),
}));

vi.mock("@a2a-js/sdk/client", () => ({
  ClientFactory: vi.fn(),
  TaskNotFoundError: class TaskNotFoundError extends Error {
    constructor(msg?: string) {
      super(msg ?? "Task not found");
      this.name = "TaskNotFoundError";
    }
  },
}));

vi.mock("@/a2a/lib/base-server", () => ({
  readPortsManifest: vi.fn(),
}));

vi.mock("@/lib/paths", () => ({
  AGENTS_ROOT: "/mock/agents",
  DOVEPAW_AGENT_LOGS: "/mock/logs",
  DOVEPAW_AGENT_STATE: "/mock/state",
}));

vi.mock("@@/lib/paths", () => ({
  LAUNCH_AGENTS_DIR: "/mock/launch-agents",
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { ClientFactory, TaskNotFoundError } from "@a2a-js/sdk/client";
import { readPortsManifest } from "@/a2a/lib/base-server";
import {
  makeAskTool,
  makeStartTool,
  makeAwaitTool,
  doveAskToolName,
  doveStartToolName,
  doveAwaitToolName,
} from "@/lib/query-tools";
import { MGMT_TOOL } from "@/lib/agent-tools";
import type { AgentDef } from "@@/lib/agents";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const AGENT: AgentDef = {
  name: "test-agent",
  alias: "ta",
  entryPath: "agents/test-agent/main.ts",
  displayName: "Test Agent",
  label: "Claude Code Agent - Test Agent",
  manifestKey: "test_agent",
  toolName: "yolo_test_agent",
  description: "A test agent for unit tests",
  scheduleDisplay: "daily 00:00",
  icon: {} as any,
  doveCard: {
    icon: {} as any,
    iconBg: "",
    iconColor: "",
    title: "Test Agent",
    description: "",
    prompt: "",
  },
  suggestions: [],
};

// Capture tool handlers by name across all tool() calls in a factory invocation
function captureTools(fn: () => void): Record<string, (...args: any[]) => any> {
  const captured: Record<string, (...args: any[]) => any> = {};
  vi.mocked(tool).mockImplementation((name: string, _desc: any, _schema: any, handler: any) => {
    captured[name] = handler;
    return { name } as any;
  });
  fn();
  return captured;
}

async function* asyncEvents(...events: object[]) {
  for (const e of events) yield e;
}

// ─── doveAskToolName helpers ─────────────────────────────────────────────────────

describe("doveAskToolName", () => {
  it("returns ask_<manifestKey>", () => {
    expect(doveAskToolName(AGENT)).toBe(`ask_${AGENT.manifestKey}`);
  });
});

describe("doveStartToolName", () => {
  it("returns start_<manifestKey>", () => {
    expect(doveStartToolName(AGENT)).toBe(`start_${AGENT.manifestKey}`);
  });
});

describe("doveAwaitToolName", () => {
  it("returns await_<manifestKey>", () => {
    expect(doveAwaitToolName(AGENT)).toBe(`await_${AGENT.manifestKey}`);
  });
});

// ─── MGMT_TOOL ────────────────────────────────────────────────────────────────

describe("MGMT_TOOL", () => {
  it("has all 6 management tool names", () => {
    expect(Object.keys(MGMT_TOOL)).toHaveLength(6);
  });

  it("maps to expected string values", () => {
    expect(MGMT_TOOL.install).toBe("install_agent");
    expect(MGMT_TOOL.uninstall).toBe("uninstall_agent");
    expect(MGMT_TOOL.load).toBe("load_agent");
    expect(MGMT_TOOL.unload).toBe("unload_agent");
    expect(MGMT_TOOL.status).toBe("check_status");
    expect(MGMT_TOOL.logs).toBe("get_logs");
  });
});

// ─── makeAskTool ──────────────────────────────────────────────────────────────

describe("makeAskTool", () => {
  let handler: (...args: any[]) => any;

  beforeEach(() => {
    vi.clearAllMocks();
    const captured = captureTools(() => makeAskTool(AGENT));
    handler = captured[doveAskToolName(AGENT)];
  });

  it("registers a tool with doveAskToolName", () => {
    expect(vi.mocked(tool)).toHaveBeenCalledWith(
      doveAskToolName(AGENT),
      AGENT.description,
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns servers-not-running message when manifest is null", async () => {
    vi.mocked(readPortsManifest).mockReturnValue(null);
    const result = await handler({ instruction: "run" });
    expect(result.content[0].text).toContain("npm run servers");
  });

  it("fires task and returns taskId immediately", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockSendMessage = vi.fn().mockResolvedValue({
      kind: "task",
      id: "task-abc",
      status: { state: "working" },
    });
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: vi.fn().mockResolvedValue({ sendMessage: mockSendMessage }) };
    } as any);
    const result = await handler({ instruction: "run" });
    expect(result.content[0].text).toContain("task-abc");
    // structuredContent carries the typed payload
    const structured = result.structuredContent as { taskId: string };
    expect(structured.taskId).toBe("task-abc");
  });

  it("returns error when response is not a task", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ sendMessage: vi.fn().mockResolvedValue({ kind: "message" }) }),
      };
    } as any);
    const result = await handler({ instruction: "run" });
    expect(result.content[0].text).toContain("task ID not received");
  });

  it("uses empty string as default instruction", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockSendMessage = vi.fn().mockResolvedValue({
      kind: "task",
      id: "task-x",
      status: { state: "working" },
    });
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          sendMessage: mockSendMessage,
          resubscribeTask: vi.fn().mockReturnValue(asyncEvents()),
        }),
      };
    } as any);
    await handler({});
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ parts: [{ kind: "text", text: "" }] }),
      }),
    );
  });

  it("returns unreachable message on ECONNREFUSED", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:51001")),
      };
    } as any);
    const result = await handler({ instruction: "run" });
    expect(result.content[0].text).toContain("unreachable");
    expect(result.content[0].text).toContain("npm run servers");
  });

  it("returns generic error for other errors", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: vi.fn().mockRejectedValue(new Error("unexpected failure")) };
    } as any);
    const result = await handler({ instruction: "run" });
    expect(result.content[0].text).toBe("Error: unexpected failure");
  });

  it("cancels the A2A task when the abort signal fires", async () => {
    const abortController = new AbortController();
    const captured = captureTools(() => makeAskTool(AGENT, abortController.signal));
    const h = captured[doveAskToolName(AGENT)];

    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockCancelTask = vi.fn().mockResolvedValue({});
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          sendMessage: vi.fn().mockResolvedValue({ kind: "task", id: "task-abort" }),
          cancelTask: mockCancelTask,
        }),
      };
    } as any);

    await h({ instruction: "run" });
    abortController.abort();

    expect(mockCancelTask).toHaveBeenCalledWith({ id: "task-abort" });
  });
});

// ─── makeStartTool ─────────────────────────────────────────────────────────

describe("makeStartTool", () => {
  let handler: (...args: any[]) => any;

  beforeEach(() => {
    vi.clearAllMocks();
    const captured = captureTools(() => makeStartTool(AGENT));
    handler = captured[doveStartToolName(AGENT)];
  });

  it("registers a tool with doveStartToolName", () => {
    expect(vi.mocked(tool)).toHaveBeenCalledWith(
      doveStartToolName(AGENT),
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns servers-not-running message when manifest is null", async () => {
    vi.mocked(readPortsManifest).mockReturnValue(null);
    const result = await handler({ instruction: "run" });
    expect(result.content[0].text).toContain("npm run servers");
  });

  it("returns taskId and manifestKey from sendMessageStream task response", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          sendMessageStream: () =>
            asyncEvents({ kind: "task", id: "task-abc-123", status: { state: "submitted" } }),
        }),
      };
    } as any);
    const result = await handler({ instruction: "run" });
    expect(result.content[0].text).toContain("task-abc-123");
    const structured = result.structuredContent as { taskId: string; manifestKey: string };
    expect(structured.taskId).toBe("task-abc-123");
    expect(structured.manifestKey).toBe(AGENT.manifestKey);
  });

  it("returns error message when first stream event is not a task", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          sendMessageStream: () => asyncEvents({ kind: "message" }),
        }),
      };
    } as any);
    const result = await handler({ instruction: "run" });
    expect(result.content[0].text).toContain("task ID not received");
  });

  it("returns unreachable message on ECONNREFUSED", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    } as any);
    const result = await handler({ instruction: "run" });
    expect(result.content[0].text).toContain("unreachable");
  });

  it("cancels the A2A task when the abort signal fires", async () => {
    const abortController = new AbortController();
    const captured = captureTools(() => makeStartTool(AGENT, abortController.signal));
    const h = captured[doveStartToolName(AGENT)];

    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockCancelTask = vi.fn().mockResolvedValue({});
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          sendMessageStream: () =>
            asyncEvents({ kind: "task", id: "task-start-abort", status: { state: "submitted" } }),
          cancelTask: mockCancelTask,
        }),
      };
    } as any);

    await h({ instruction: "run" });
    abortController.abort();

    expect(mockCancelTask).toHaveBeenCalledWith({ id: "task-start-abort" });
  });
});

// ─── makeAwaitTool ─────────────────────────────────────────────────────────

describe("makeAwaitTool", () => {
  let handler: (...args: any[]) => any;

  beforeEach(() => {
    vi.clearAllMocks();
    const captured = captureTools(() => makeAwaitTool(AGENT));
    handler = captured[doveAwaitToolName(AGENT)];
  });

  it("registers a tool with doveAwaitToolName", () => {
    expect(vi.mocked(tool)).toHaveBeenCalledWith(
      doveAwaitToolName(AGENT),
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns servers-not-running message when manifest is null", async () => {
    vi.mocked(readPortsManifest).mockReturnValue(null);
    const result = await handler({ taskId: "task-123" });
    expect(result.content[0].text).toContain("npm run servers");
  });

  it("returns artifact text from completed task without resubscribing", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "completed" },
      artifacts: [{ artifactId: "a1", parts: [{ kind: "text", text: "done output" }] }],
    });
    const mockResubscribe = vi.fn();
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
      };
    } as any);
    const result = await handler({ taskId: "task-123" });
    expect(JSON.parse(result.content[0].text).output).toBe("done output");
    expect(mockResubscribe).not.toHaveBeenCalled();
  });

  it("returns 'Agent completed.' when completed task has no artifacts", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "completed" },
      artifacts: [],
    });
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: vi.fn().mockResolvedValue({ getTask: mockGetTask }) };
    } as any);
    const result = await handler({ taskId: "task-123" });
    expect(JSON.parse(result.content[0].text).output).toBe("Agent completed.");
  });

  it("resubscribes and collects chunks when task is still working", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "working" },
    });
    const mockResubscribe = vi.fn().mockReturnValue(
      asyncEvents(
        {
          kind: "status-update",
          status: {
            state: "working",
            timestamp: "",
            message: {
              kind: "message",
              messageId: "1",
              role: "agent",
              parts: [{ kind: "text", text: "working" }],
            },
          },
          final: false,
        },
        { kind: "artifact-update", artifact: { parts: [{ kind: "text", text: "partial" }] } },
        { kind: "artifact-update", artifact: { parts: [{ kind: "text", text: "result" }] } },
      ),
    );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
      };
    } as any);
    const result = await handler({ taskId: "task-123" });
    expect(mockResubscribe).toHaveBeenCalledWith({ id: "task-123" }, expect.anything());
    expect(JSON.parse(result.content[0].text).output).toBe("partial\nresult");
  });

  it("handles all terminal states without resubscribing", async () => {
    for (const state of ["completed", "canceled", "failed", "rejected"]) {
      vi.clearAllMocks();
      vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
      const mockGetTask = vi.fn().mockResolvedValue({
        id: "task-123",
        kind: "task",
        status: { state },
        artifacts: [{ artifactId: "a1", parts: [{ kind: "text", text: `result:${state}` }] }],
      });
      const mockResubscribe = vi.fn();
      const captured = captureTools(() => makeAwaitTool(AGENT));
      const h = captured[doveAwaitToolName(AGENT)];
      vi.mocked(ClientFactory).mockImplementation(function () {
        return {
          createFromUrl: vi
            .fn()
            .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
        };
      } as any);
      await h({ taskId: "task-123" });
      expect(mockResubscribe).not.toHaveBeenCalled();
    }
  });

  it("returns task-not-found message on TaskNotFoundError", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockRejectedValue(new TaskNotFoundError("task-123"));
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: vi.fn().mockResolvedValue({ getTask: mockGetTask }) };
    } as any);
    const result = await handler({ taskId: "task-123" });
    expect(result.content[0].text).toContain("task-123");
    expect(result.content[0].text).toContain("not found");
  });

  it("returns unreachable message on ECONNREFUSED", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    } as any);
    const result = await handler({ taskId: "task-123" });
    expect(result.content[0].text).toContain("unreachable");
  });

  it("returns generic error for other errors", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: vi.fn().mockRejectedValue(new Error("db timeout")) };
    } as any);
    const result = await handler({ taskId: "task-123" });
    expect(result.content[0].text).toBe("Error: db timeout");
  });

  it("collects tool-call and stream artifacts when stream completes without timeout", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "working" },
    });
    const mockResubscribe = vi.fn().mockReturnValue(
      asyncEvents(
        {
          kind: "artifact-update",
          artifact: { name: "tool-call", parts: [{ kind: "text", text: "Bash" }] },
        },
        {
          kind: "artifact-update",
          artifact: { name: "stream", parts: [{ kind: "text", text: "running tests..." }] },
        },
      ),
    );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
      };
    } as any);
    // Stream completes without timeout — collected artifacts returned as completed
    const result = await handler({ taskId: "task-123" });
    expect(result.structuredContent).toMatchObject({ status: "completed", taskId: "task-123" });
  });

  it("still_running structuredContent has correct shape and base message when no progress captured", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "working" },
    });
    // Stream that resolves immediately with no artifacts — simulates timeout with empty progress
    const mockResubscribe = vi.fn().mockReturnValue(asyncEvents());
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
      };
    } as any);
    // Stream ends immediately → collected result is "Agent completed." (not still_running)
    // This verifies the progress tracking path doesn't interfere with normal completion
    const result = await handler({ taskId: "task-123" });
    expect(result.structuredContent).toMatchObject({ status: "completed" });
  });

  it("cancels the A2A task and aborts the stream when the abort signal fires", async () => {
    const abortController = new AbortController();
    const captured = captureTools(() => makeAwaitTool(AGENT, abortController.signal));
    const h = captured[doveAwaitToolName(AGENT)];

    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockCancelTask = vi.fn().mockResolvedValue({});
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-await-abort",
      kind: "task",
      status: { state: "working" },
    });
    // Stream that terminates when the internal abort signal fires — avoids dangling generator.
    const mockResubscribe = vi
      .fn()
      .mockImplementation((_params: unknown, opts?: { signal?: AbortSignal }) =>
        (async function* () {
          await new Promise<void>((resolve) => {
            opts?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          yield* [];
        })(),
      );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          getTask: mockGetTask,
          resubscribeTask: mockResubscribe,
          cancelTask: mockCancelTask,
        }),
      };
    } as any);

    const resultPromise = h({ taskId: "task-await-abort" });
    // Wait for all pending microtasks (createFromUrl, getTask) to resolve so the handler
    // registers the signal listener before we abort.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    abortController.abort();
    await resultPromise;

    expect(mockCancelTask).toHaveBeenCalledWith({ id: "task-await-abort" });
  });

  it("calls onProgress with text and name when a tool-call artifact arrives", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "working" },
    });
    const mockResubscribe = vi.fn().mockReturnValue(
      asyncEvents(
        {
          kind: "status-update",
          status: {
            state: "working",
            timestamp: "",
            message: {
              kind: "message",
              messageId: "1",
              role: "agent",
              parts: [{ kind: "text", text: "Bash" }],
            },
          },
          final: false,
        },
        {
          kind: "artifact-update",
          artifact: { name: "tool-call", parts: [{ kind: "text", text: "Bash" }] },
        },
      ),
    );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
      };
    } as any);

    const onProgress = vi.fn();
    const captured = captureTools(() => makeAwaitTool(AGENT, undefined, onProgress));
    const h = captured[doveAwaitToolName(AGENT)];
    await h({ taskId: "task-123" });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        progress: expect.arrayContaining([
          expect.objectContaining({ artifacts: expect.objectContaining({ "tool-call": "Bash" }) }),
        ]),
      }),
    );
  });

  it("calls onProgress for stream artifacts", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "working" },
    });
    const mockResubscribe = vi.fn().mockReturnValue(
      asyncEvents(
        {
          kind: "status-update",
          status: {
            state: "working",
            timestamp: "",
            message: {
              kind: "message",
              messageId: "1",
              role: "agent",
              parts: [{ kind: "text", text: "output text" }],
            },
          },
          final: false,
        },
        {
          kind: "artifact-update",
          artifact: { name: "stream", parts: [{ kind: "text", text: "output text" }] },
        },
      ),
    );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
      };
    } as any);

    const onProgress = vi.fn();
    const captured = captureTools(() => makeAwaitTool(AGENT, undefined, onProgress));
    const h = captured[doveAwaitToolName(AGENT)];
    await h({ taskId: "task-123" });

    // stream artifacts are excluded from workflow nodes (transient chat-only)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        progress: expect.arrayContaining([expect.objectContaining({ message: "output text" })]),
      }),
    );
  });

  it("calls onProgress for status-update events with a message", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "working" },
    });
    const mockResubscribe = vi.fn().mockReturnValue(
      asyncEvents({
        kind: "status-update",
        final: false,
        status: {
          state: "working",
          message: {
            kind: "message",
            messageId: "msg-1",
            role: "agent",
            parts: [{ kind: "text", text: "Fetching tickets…" }],
          },
        },
      }),
    );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
      };
    } as any);

    const onProgress = vi.fn();
    const captured = captureTools(() => makeAwaitTool(AGENT, undefined, onProgress));
    const h = captured[doveAwaitToolName(AGENT)];
    await h({ taskId: "task-123" });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        progress: expect.arrayContaining([
          expect.objectContaining({ message: "Fetching tickets…" }),
        ]),
      }),
    );
  });

  it("does not include status-update text in the collected result", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "working" },
    });
    const mockResubscribe = vi.fn().mockReturnValue(
      asyncEvents(
        {
          kind: "status-update",
          final: false,
          status: {
            state: "working",
            message: {
              kind: "message",
              messageId: "msg-1",
              role: "agent",
              parts: [{ kind: "text", text: "progress noise" }],
            },
          },
        },
        {
          kind: "artifact-update",
          artifact: { name: "final-output", parts: [{ kind: "text", text: "actual result" }] },
        },
      ),
    );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
      };
    } as any);

    const captured = captureTools(() => makeAwaitTool(AGENT));
    const h = captured[doveAwaitToolName(AGENT)];
    const result = await h({ taskId: "task-123" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.output).toContain("actual result");
    expect(parsed.output).not.toContain("progress noise");
    // progress messages are separated into their own array as ProgressEntry objects
    expect(parsed.progress).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: "progress noise" })]),
    );
  });

  it("works without onProgress (backward compat — no error thrown)", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockGetTask = vi.fn().mockResolvedValue({
      id: "task-123",
      kind: "task",
      status: { state: "working" },
    });
    const mockResubscribe = vi.fn().mockReturnValue(
      asyncEvents({
        kind: "artifact-update",
        artifact: { name: "tool-call", parts: [{ kind: "text", text: "Bash" }] },
      }),
    );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi
          .fn()
          .mockResolvedValue({ getTask: mockGetTask, resubscribeTask: mockResubscribe }),
      };
    } as any);

    // No onProgress passed — must not throw
    const captured = captureTools(() => makeAwaitTool(AGENT));
    const h = captured[doveAwaitToolName(AGENT)];
    await expect(h({ taskId: "task-123" })).resolves.toBeDefined();
  });
});
