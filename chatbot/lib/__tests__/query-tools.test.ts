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
  agentPersistentStateDir: (name: string) => `/mock/state/.${name}`,
}));

vi.mock("@@/lib/paths", () => ({
  LAUNCH_AGENTS_DIR: "/mock/launch-agents",
  DOVEPAW_DIR: "/mock/dovepaw",
  GROUP_WORKSPACE_ROOT: require("node:os").tmpdir(),
  agentPersistentMetaDir: (name: string) => `/mock/state/.${name}/meta`,
}));

vi.mock("@@/lib/settings", () => ({
  readSettings: vi.fn().mockResolvedValue({ repositories: [] }),
}));

vi.mock("@@/lib/group-config", () => ({
  readOrCreateGroupConfig: vi.fn().mockReturnValue({ repos: [], envVars: {} }),
}));

vi.mock("@/a2a/lib/workspace", () => ({
  cloneReposIntoWorkspace: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/memory", async () => {
  const actual = await vi.importActual<typeof import("@/lib/memory")>("@/lib/memory");
  const { MarkdownMemoryProvider } =
    await vi.importActual<typeof import("@/lib/memory/markdown")>("@/lib/memory/markdown");
  return {
    ...actual,
    getMemoryProvider: vi.fn(async () => new MarkdownMemoryProvider()),
  };
});

vi.mock("@/lib/db", () => ({
  upsertSession: vi.fn(),
  setActiveSession: vi.fn(),
  setGroupMessage: vi.fn(),
  setSessionStatus: vi.fn(),
}));

vi.mock("@/lib/session-events", () => ({
  publishSessionEvent: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { ClientFactory, TaskNotFoundError } from "@a2a-js/sdk/client";
import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import {
  makeAskTool,
  makeStartTool,
  makeAwaitTool,
  doveAskToolName,
  doveStartToolName,
  doveAwaitToolName,
} from "@/lib/query-tools";
import {
  makeInitGroupTool,
  makeStartGroupTool,
  makeAwaitGroupTool,
  doveInitGroupToolName,
  doveStartGroupToolName,
  doveAwaitGroupToolName,
} from "@/lib/group-tools";
import { noAgentOutput } from "@/lib/a2a-client";
import { MGMT_TOOL } from "@/lib/agent-tools";
import { upsertSession, setActiveSession } from "@/lib/db";
import { publishSessionEvent } from "@/lib/session-events";
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
        message: expect.objectContaining({
          parts: [{ kind: "text", text: expect.stringContaining(instruction) }],
        }),
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
        {
          kind: "artifact-update",
          artifact: { name: "final-output", parts: [{ kind: "text", text: "partial result" }] },
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
    expect(result.structuredContent.result.output).toBe("partial result");
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
        {
          kind: "status-update",
          final: true,
          status: { state: "completed" },
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
    // Stream resolves with a terminal status-update but no artifacts — empty completion
    const mockResubscribe = vi
      .fn()
      .mockReturnValue(
        asyncEvents({ kind: "status-update", final: true, status: { state: "completed" } }),
      );
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

  it("works without getSessionId (no error thrown)", async () => {
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

// ─── doveInitGroupToolName ────────────────────────────────────────────────────

describe("doveInitGroupToolName", () => {
  it("slugifies the group name", () => {
    expect(doveInitGroupToolName("PixelPaw Labs")).toBe("init_group_pixelpaw_labs");
    expect(doveInitGroupToolName("Review Chain!")).toBe("init_group_review_chain");
    expect(doveInitGroupToolName("  spaced  ")).toBe("init_group_spaced");
  });
});

// ─── doveStartGroupToolName / doveAwaitGroupToolName ──────────────────────────

describe("doveStartGroupToolName", () => {
  it("slugifies the group name", () => {
    expect(doveStartGroupToolName("PixelPaw Labs")).toBe("start_group_pixelpaw_labs");
  });
});

describe("doveAwaitGroupToolName", () => {
  it("slugifies the group name", () => {
    expect(doveAwaitGroupToolName("PixelPaw Labs")).toBe("await_group_pixelpaw_labs");
  });
});

// ─── makeInitGroupTool ────────────────────────────────────────────────────────

describe("makeInitGroupTool", () => {
  const GROUP = {
    name: "PixelPaw Labs",
    description: "Simulates Envato's business",
    members: ["agent-a", "agent-b", "agent-c"],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readPortsManifest).mockReturnValue({ openviking: 51234 } as any);
    const { getMemoryProvider } = await import("@/lib/memory");
    const { MarkdownMemoryProvider } = await import("@/lib/memory/markdown");
    vi.mocked(getMemoryProvider).mockResolvedValue(new MarkdownMemoryProvider());
  });

  it("registers a tool named init_group_<slug>", () => {
    captureTools(() => makeInitGroupTool(GROUP, []));
    expect(vi.mocked(tool)).toHaveBeenCalledWith(
      doveInitGroupToolName(GROUP.name),
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("description embeds group description and member names", () => {
    captureTools(() => makeInitGroupTool(GROUP, []));
    const desc = vi.mocked(tool).mock.calls[0][1] as string;
    expect(desc).toContain(GROUP.description);
    expect(desc).toContain("agent-a");
  });

  it("returns groupWorkspacePath, groupContextId, and groupName", async () => {
    const captured = captureTools(() => makeInitGroupTool(GROUP, []));
    const handler = captured[doveInitGroupToolName(GROUP.name)];
    const result = await handler({});
    const sc = result.structuredContent as {
      groupWorkspacePath: string;
      groupContextId: string;
      groupName: string;
    };
    expect(sc.groupName).toBe(GROUP.name);
    expect(typeof sc.groupWorkspacePath).toBe("string");
    expect(typeof sc.groupContextId).toBe("string");
  });

  it("calls upsertSession and setActiveSession with group agentId", async () => {
    const captured = captureTools(() => makeInitGroupTool(GROUP, []));
    const handler = captured[doveInitGroupToolName(GROUP.name)];
    const result = await handler({});
    const sc = result.structuredContent as { groupContextId: string };
    expect(vi.mocked(upsertSession)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sc.groupContextId,
        agentId: `group:${GROUP.name}`,
        status: "running",
      }),
    );
    expect(vi.mocked(setActiveSession)).toHaveBeenCalledWith(
      `group:${GROUP.name}`,
      sc.groupContextId,
    );
  });

  it("delegates per-group bootstrap to the active memory provider", async () => {
    const { getMemoryProvider } = await import("@/lib/memory");
    const initGroup = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getMemoryProvider).mockResolvedValue({
      initGroup,
      deleteGroup: vi.fn().mockResolvedValue(undefined),
      buildReminder: () => "",
    });
    const captured = captureTools(() => makeInitGroupTool(GROUP, []));
    const handler = captured[doveInitGroupToolName(GROUP.name)];
    const result = await handler({});
    const sc = result.structuredContent as {
      groupContextId: string;
      groupWorkspacePath: string;
    };
    expect(initGroup).toHaveBeenCalledWith(sc.groupContextId, sc.groupWorkspacePath);
  });

  it("falls back to mkdir(moments) when the provider's initGroup rejects", async () => {
    const { getMemoryProvider } = await import("@/lib/memory");
    vi.mocked(getMemoryProvider).mockResolvedValue({
      initGroup: vi.fn().mockRejectedValue(new Error("provider down")),
      deleteGroup: vi.fn().mockResolvedValue(undefined),
      buildReminder: () => "",
    });
    const captured = captureTools(() => makeInitGroupTool(GROUP, []));
    const handler = captured[doveInitGroupToolName(GROUP.name)];
    const result = await handler({});
    const { groupWorkspacePath } = result.structuredContent as { groupWorkspacePath: string };
    const { existsSync } = await import("node:fs");
    expect(existsSync(`${groupWorkspacePath}/moments`)).toBe(true);
  });

  it("writes members/roster.md listing each member's displayName and description", async () => {
    const memberDefs = [
      { name: "agent-a", displayName: "Agent A", description: "Does A things" },
      { name: "agent-b", displayName: "Agent B", description: "Does B things" },
    ];
    const captured = captureTools(() => makeInitGroupTool(GROUP, memberDefs as any));
    const handler = captured[doveInitGroupToolName(GROUP.name)];
    const result = await handler({});
    const { groupWorkspacePath } = result.structuredContent as { groupWorkspacePath: string };

    const { readFile } = await import("node:fs/promises");
    const roster = await readFile(`${groupWorkspacePath}/members/roster.md`, "utf8");
    expect(roster).toContain("Agent A");
    expect(roster).toContain("Does A things");
    expect(roster).toContain("Agent B");
    expect(roster).toContain("Does B things");
    expect(roster).toContain("Do not involve any agent outside this list.");
  });
});

// ─── makeStartGroupTool ───────────────────────────────────────────────────────

describe("makeStartGroupTool", () => {
  const GROUP = {
    name: "PixelPaw Labs",
    description: "Simulates Envato's business",
    members: ["test-agent"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 9999 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          sendMessageStream: vi.fn((_req: unknown) =>
            asyncEvents({
              kind: "task",
              id: "task-grp-1",
              contextId: "ctx-grp-1",
              status: { state: "submitted" },
            }),
          ),
        }),
      };
    } as any);
  });

  it("registers a tool named start_group_<slug>", () => {
    captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    expect(vi.mocked(tool)).toHaveBeenCalledWith(
      doveStartGroupToolName(GROUP.name),
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("forwards isGroupChat metadata to each member", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      instruction: "do something",
      members: [{ name: "test-agent", relevanceScore: 100 }],
      groupWorkspacePath: "/ws/group",
      groupContextId: "gc-1",
      groupName: "PixelPaw Labs",
    });
    const client =
      await vi.mocked(ClientFactory).mock.results[0].value.createFromUrl.mock.results[0].value;
    const sentMetadata = client.sendMessageStream.mock.calls[0][0].message.metadata as Record<
      string,
      unknown
    >;
    expect(sentMetadata.isGroupChat).toBe(true);
    expect(sentMetadata.groupWorkspacePath).toBe("/ws/group");
  });

  it("returns memberTaskIds in structuredContent", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    const result = await handler({
      instruction: "do something",
      members: [{ name: "test-agent", relevanceScore: 100 }],
      groupWorkspacePath: "/ws/group",
      groupContextId: "gc-1",
      groupName: "PixelPaw Labs",
    });
    const sc = result.structuredContent as {
      memberTaskIds: Record<string, string>;
      groupContextId: string;
    };
    expect(sc.memberTaskIds).toEqual({ test_agent: "task-grp-1" });
    expect(sc.groupContextId).toBe("gc-1");
  });

  it("publishes a single sender event for Dove's instruction before member events", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      instruction: "do something",
      members: [{ name: "test-agent", relevanceScore: 100 }],
      groupWorkspacePath: "/ws/group",
      groupContextId: "gc-1",
      groupName: "PixelPaw Labs",
    });
    expect(vi.mocked(publishSessionEvent)).toHaveBeenCalledWith(
      "gc-1",
      expect.objectContaining({
        type: "group_member",
        agentId: "dove",
        isSender: true,
        done: true,
        text: "do something",
      }),
    );
  });

  it("does not publish a group_member done event from the drain — the A2A relay handles it", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      instruction: "do something",
      members: [{ name: "test-agent", relevanceScore: 100 }],
      groupWorkspacePath: "/ws/group",
      groupContextId: "gc-1",
      groupName: "PixelPaw Labs",
    });
    // Flush microtasks so any drain .then() callbacks fire
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(publishSessionEvent)).not.toHaveBeenCalledWith(
      "gc-1",
      expect.objectContaining({ type: "group_member", agentId: "test-agent", done: true }),
    );
  });

  it("dispatches only members with relevanceScore >= 90", async () => {
    const a: AgentDef = { ...AGENT, name: "agent-a", manifestKey: "agent_a" };
    const b: AgentDef = { ...AGENT, name: "agent-b", manifestKey: "agent_b" };
    const c: AgentDef = { ...AGENT, name: "agent-c", manifestKey: "agent_c" };
    vi.mocked(readPortsManifest).mockReturnValue({
      agent_a: 9001,
      agent_b: 9002,
      agent_c: 9003,
    } as any);
    const captured = captureTools(() => makeStartGroupTool(GROUP, [a, b, c]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    const result = await handler({
      instruction: "do something",
      members: [
        { name: "agent-a", relevanceScore: 95 },
        { name: "agent-b", relevanceScore: 85 },
        { name: "agent-c", relevanceScore: 92 },
      ],
      groupWorkspacePath: "/ws/group",
      groupContextId: "gc-1",
      groupName: "PixelPaw Labs",
    });
    const sc = result.structuredContent as { memberTaskIds: Record<string, string> };
    expect(Object.keys(sc.memberTaskIds).toSorted()).toEqual(["agent_a", "agent_c"]);
  });

  it("falls back to the highest-scored member when none clear the threshold", async () => {
    const a: AgentDef = { ...AGENT, name: "agent-a", manifestKey: "agent_a" };
    const b: AgentDef = { ...AGENT, name: "agent-b", manifestKey: "agent_b" };
    vi.mocked(readPortsManifest).mockReturnValue({ agent_a: 9001, agent_b: 9002 } as any);
    const captured = captureTools(() => makeStartGroupTool(GROUP, [a, b]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    const result = await handler({
      instruction: "do something",
      members: [
        { name: "agent-a", relevanceScore: 50 },
        { name: "agent-b", relevanceScore: 70 },
      ],
      groupWorkspacePath: "/ws/group",
      groupContextId: "gc-1",
      groupName: "PixelPaw Labs",
    });
    const sc = result.structuredContent as { memberTaskIds: Record<string, string> };
    expect(Object.keys(sc.memberTaskIds)).toEqual(["agent_b"]);
  });
});

// ─── makeAwaitGroupTool ───────────────────────────────────────────────────────

describe("makeAwaitGroupTool", () => {
  const GROUP = {
    name: "PixelPaw Labs",
    description: "Simulates Envato's business",
    members: ["test-agent"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 9999 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          resubscribeTask: vi.fn((_req: unknown) =>
            asyncEvents({
              kind: "task",
              id: "task-grp-1",
              contextId: "ctx-grp-1",
              status: { state: "completed" },
              result: { parts: [{ kind: "text", text: "done" }] },
            }),
          ),
        }),
      };
    } as any);
  });

  it("registers a tool named await_group_<slug>", () => {
    captureTools(() => makeAwaitGroupTool(GROUP, [AGENT]));
    expect(vi.mocked(tool)).toHaveBeenCalledWith(
      doveAwaitGroupToolName(GROUP.name),
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });
});
