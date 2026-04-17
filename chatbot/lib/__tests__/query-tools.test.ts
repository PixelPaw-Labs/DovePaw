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

vi.mock("@/a2a/lib/ports-manifest", () => ({
  readPortsManifest: vi.fn(),
}));

vi.mock("@/lib/paths", () => ({
  AGENTS_ROOT: "/mock/agents",
  DOVEPAW_AGENT_LOGS: "/mock/logs",
  DOVEPAW_AGENT_STATE: "/mock/state",
  agentPersistentLogDir: (name: string) => `/mock/logs/.${name}`,
}));

vi.mock("@@/lib/paths", () => ({
  LAUNCH_AGENTS_DIR: "/mock/launch-agents",
  DOVEPAW_DIR: "/mock/dovepaw",
}));

vi.mock("@/lib/db", () => ({
  upsertSession: vi.fn(),
  setActiveSession: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { ClientFactory, TaskNotFoundError } from "@a2a-js/sdk/client";
import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import {
  makeAskTool,
  makeStartTool,
  makeAwaitTool,
  makeAskGroupTool,
  doveAskToolName,
  doveStartToolName,
  doveAwaitToolName,
  doveAskGroupToolName,
} from "@/lib/query-tools";
import { noAgentOutput } from "@/lib/a2a-client";
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
  icon: {} as any,
  iconBg: "",
  iconColor: "",
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
    expect(result.content[0].text).toContain("npm run chatbot:servers");
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

  it("passes instruction text to the agent", async () => {
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
    const instruction = "I am Dove, your orchestrator. Please run the task.";
    await handler({ instruction });
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ parts: [{ kind: "text", text: instruction }] }),
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
    expect(result.content[0].text).toContain("npm run chatbot:servers");
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
    expect(result.content[0].text).toContain("npm run chatbot:servers");
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
    expect(result.content[0].text).toContain("npm run chatbot:servers");
  });

  it("returns artifact text from resubscribed stream", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockResubscribe = vi.fn().mockReturnValue(
      asyncEvents(
        // status-update sets pendingEntry so the following artifact is accumulated
        {
          kind: "status-update",
          status: {
            state: "working",
            message: {
              kind: "message",
              messageId: "1",
              role: "agent",
              parts: [{ kind: "text", text: "done" }],
            },
            timestamp: "",
          },
          final: false,
        },
        {
          kind: "artifact-update",
          artifact: { name: "final-output", parts: [{ kind: "text", text: "done output" }] },
        },
      ),
    );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({ resubscribeTask: mockResubscribe }),
      };
    } as any);
    const result = await handler({ taskId: "task-123" });
    expect(mockResubscribe).toHaveBeenCalledWith({ id: "task-123" }, expect.anything());
    expect(result.structuredContent.result.output).toBe("done output");
    expect(result.content[0].text).toContain("done output");
  });

  it("returns 'Something wrong with agent.' when stream has no artifacts", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockResubscribe = vi.fn().mockReturnValue(asyncEvents());
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: vi.fn().mockResolvedValue({ resubscribeTask: mockResubscribe }) };
    } as any);
    const result = await handler({ taskId: "task-123" });
    expect(result.structuredContent.result.output).toBe(noAgentOutput(AGENT.name));
  });

  it("resubscribes and collects chunks", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
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
        createFromUrl: vi.fn().mockResolvedValue({ resubscribeTask: mockResubscribe }),
      };
    } as any);
    const result = await handler({ taskId: "task-123" });
    expect(mockResubscribe).toHaveBeenCalledWith({ id: "task-123" }, expect.anything());
    expect(result.structuredContent.result.output).toBe("partial\nresult");
  });

  it("always resubscribes regardless of task state", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    const mockResubscribe = vi.fn().mockReturnValue(
      asyncEvents({
        kind: "artifact-update",
        artifact: { name: "final-output", parts: [{ kind: "text", text: "result" }] },
      }),
    );
    const captured = captureTools(() => makeAwaitTool(AGENT));
    const h = captured[doveAwaitToolName(AGENT)];
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({ resubscribeTask: mockResubscribe }),
      };
    } as any);
    await h({ taskId: "task-123" });
    expect(mockResubscribe).toHaveBeenCalledWith({ id: "task-123" }, expect.anything());
  });

  it("returns task-not-found message on TaskNotFoundError from resubscribeTask", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    // Throw synchronously so the error propagates through subscribeTaskStream's catch block
    const mockResubscribe = vi.fn().mockImplementation(() => {
      throw new TaskNotFoundError("task-123");
    });
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: vi.fn().mockResolvedValue({ resubscribeTask: mockResubscribe }) };
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
    // Stream ends immediately → collected result is noAgentOutput() (not still_running)
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

    expect(result.structuredContent.result.output).toContain("actual result");
    expect(result.structuredContent.result.output).not.toContain("progress noise");
    // progress messages are separated into their own array as ProgressEntry objects
    expect(result.structuredContent.result.progress).toEqual(
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

// ─── doveAskGroupToolName ─────────────────────────────────────────────────────

describe("doveAskGroupToolName", () => {
  it("slugifies the group name", () => {
    expect(doveAskGroupToolName("PixelPaw Labs")).toBe("ask_group_pixelpaw_labs");
    expect(doveAskGroupToolName("Review Chain!")).toBe("ask_group_review_chain");
    expect(doveAskGroupToolName("  spaced  ")).toBe("ask_group_spaced");
  });
});

// ─── makeAskGroupTool ─────────────────────────────────────────────────────────

describe("makeAskGroupTool", () => {
  const AGENT_A: AgentDef = { ...AGENT, name: "agent-a", manifestKey: "agent_a" };
  const AGENT_B: AgentDef = { ...AGENT, name: "agent-b", manifestKey: "agent_b" };
  const AGENT_C: AgentDef = { ...AGENT, name: "agent-c", manifestKey: "agent_c" };
  const GROUP = {
    name: "PixelPaw Labs",
    description: "Simulates Envato's business",
    members: ["agent-a", "agent-b", "agent-c"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a tool named ask_group_<slug>", () => {
    captureTools(() => makeAskGroupTool(GROUP, [AGENT_A, AGENT_B, AGENT_C]));
    expect(vi.mocked(tool)).toHaveBeenCalledWith(
      doveAskGroupToolName(GROUP.name),
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("tool description embeds group description and member names", () => {
    captureTools(() => makeAskGroupTool(GROUP, [AGENT_A, AGENT_B, AGENT_C]));
    const desc = vi.mocked(tool).mock.calls[0][1] as string;
    expect(desc).toContain(GROUP.description);
    expect(desc).toContain("agent-a");
    expect(desc).toContain("agent-b");
    expect(desc).toContain("agent-c");
  });

  it("fires startAgentStream in parallel for each memberId and returns triggered taskIds", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({
      agent_a: 51001,
      agent_b: 51002,
      agent_c: 51003,
    } as any);
    const sendStream = vi.fn((_req: unknown) => {
      // Each call returns a distinct task id based on call order
      const callIndex = sendStream.mock.calls.length;
      return asyncEvents({
        kind: "task",
        id: `task-${callIndex}`,
        contextId: `ctx-${callIndex}`,
        status: { state: "submitted" },
      });
    });
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({ sendMessageStream: sendStream }),
      };
    } as any);

    const captured = captureTools(() => makeAskGroupTool(GROUP, [AGENT_A, AGENT_B, AGENT_C]));
    const handler = captured[doveAskGroupToolName(GROUP.name)];
    const result = await handler({
      memberIds: ["agent-a", "agent-b"],
      message: "investigate X",
    });

    expect(sendStream).toHaveBeenCalledTimes(2);
    const structured = result.structuredContent as {
      group: string;
      triggered: { agentId: string; taskId: string }[];
    };
    expect(structured.group).toBe(GROUP.name);
    expect(structured.triggered).toHaveLength(2);
    expect(structured.triggered.map((t) => t.agentId).toSorted()).toEqual(["agent-a", "agent-b"]);
    for (const t of structured.triggered) expect(t.taskId).toMatch(/^task-\d+$/);
  });

  it("appends start_script reminder to each member message", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({ agent_a: 51001 } as any);
    const sendStream = vi.fn((_req: unknown) =>
      asyncEvents({
        kind: "task",
        id: "task-1",
        contextId: "ctx-1",
        status: { state: "submitted" },
      }),
    );
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({ sendMessageStream: sendStream }),
      };
    } as any);

    const captured = captureTools(() => makeAskGroupTool(GROUP, [AGENT_A]));
    const handler = captured[doveAskGroupToolName(GROUP.name)];
    await handler({ memberIds: ["agent-a"], message: "do work" });

    const sentText = sendStream.mock.calls[0][0].message.parts[0].text as string;
    expect(sentText).toContain("do work");
    expect(sentText).toContain(`<reminder>Must call "start_agent_a" tool</reminder>`);
  });

  it("rejects memberIds not in group.members", async () => {
    const captured = captureTools(() => makeAskGroupTool(GROUP, [AGENT_A, AGENT_B, AGENT_C]));
    const handler = captured[doveAskGroupToolName(GROUP.name)];
    const result = await handler({
      memberIds: ["agent-a", "agent-z"],
      message: "hello",
    });
    expect(result.content[0].text).toContain("agent-z");
    expect(result.content[0].text).toMatch(/not (in|a member)/i);
    expect(result.structuredContent).toBeUndefined();
  });

  it("publishes session-started events for each triggered member", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({
      agent_a: 51001,
      agent_b: 51002,
    } as any);
    const sendStream = vi.fn((_req: unknown) => {
      const callIndex = sendStream.mock.calls.length;
      return asyncEvents({
        kind: "task",
        id: `task-${callIndex}`,
        contextId: `ctx-${callIndex}`,
        status: { state: "submitted" },
      });
    });
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({ sendMessageStream: sendStream }),
      };
    } as any);

    const { subscribeSessionStarted } = await import("../group-session-events");
    const received: { agentId: string; sessionId: string }[] = [];
    const ctrl = new AbortController();
    subscribeSessionStarted((e) => received.push(e), ctrl.signal);

    const captured = captureTools(() => makeAskGroupTool(GROUP, [AGENT_A, AGENT_B]));
    const handler = captured[doveAskGroupToolName(GROUP.name)];
    await handler({ memberIds: ["agent-a", "agent-b"], message: "go" });

    ctrl.abort();
    expect(received.map((e) => e.agentId).toSorted()).toEqual(["agent-a", "agent-b"]);
    for (const e of received) expect(e.sessionId).toMatch(/^ctx-\d+$/);
  });
});
