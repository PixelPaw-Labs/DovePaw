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

vi.mock("@@/lib/paths", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const groupTasksDir = path.join(os.tmpdir(), `query-tools-test-group-tasks-${Date.now()}`);
  return {
    LAUNCH_AGENTS_DIR: "/mock/launch-agents",
    DOVEPAW_DIR: "/mock/dovepaw",
    GROUP_WORKSPACE_ROOT: os.tmpdir(),
    GROUP_TASKS_DIR: groupTasksDir,
    groupTasksFile: (id: string) => path.join(groupTasksDir, `${id}.json`),
    agentPersistentMetaDir: (name: string) => `/mock/state/.${name}/meta`,
  };
});

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
import { makeStartGroupTool, doveStartGroupToolName } from "@/lib/group-tools";
import { noAgentOutput } from "@/lib/a2a-client";
import { MGMT_TOOL } from "@/lib/agent-tools";
import { upsertSession, setActiveSession } from "@/lib/db";
import { publishSessionEvent } from "@/lib/session-events";
import type { AgentDef } from "@@/lib/agents";
import type { AgentLink } from "@@/lib/agent-links-schemas";

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

// ─── makeAwaitTool — group-done detection ────────────────────────────────────

describe("makeAwaitTool — group-done detection", () => {
  function mockCompletedAwait(output: string) {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          resubscribeTask: vi.fn().mockReturnValue(
            asyncEvents(
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
                artifact: { name: "final-output", parts: [{ kind: "text", text: output }] },
              },
              { kind: "status-update", status: { state: "completed", timestamp: "" }, final: true },
            ),
          ),
        }),
      };
    } as any);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const { groupMemberCounters } = await import("@/lib/group-member-counter");
    groupMemberCounters.clear();
  });

  it("does nothing when groupContextId is omitted (non-group await)", async () => {
    mockCompletedAwait("ok");
    const captured = captureTools(() => makeAwaitTool(AGENT));
    const h = captured[doveAwaitToolName(AGENT)];
    await h({ taskId: "task-1", timeoutMs: 10000 });
    expect(publishSessionEvent).not.toHaveBeenCalled();
  });

  it("does not fire done event when completed < started", async () => {
    mockCompletedAwait("ok");
    const { groupMemberCounters } = await import("@/lib/group-member-counter");
    groupMemberCounters.set("grp-1", { started: 2, completed: 0 });
    const captured = captureTools(() => makeAwaitTool(AGENT));
    const h = captured[doveAwaitToolName(AGENT)];
    await h({ taskId: "task-1", timeoutMs: 10000, groupContextId: "grp-1" });
    expect(groupMemberCounters.get("grp-1")).toEqual({ started: 2, completed: 1 });
    expect(publishSessionEvent).not.toHaveBeenCalledWith("grp-1", { type: "done" });
  });

  it("fires done event and deletes counter when the last member completes", async () => {
    mockCompletedAwait("ok");
    const { groupMemberCounters } = await import("@/lib/group-member-counter");
    groupMemberCounters.set("grp-1", { started: 1, completed: 0 });
    const captured = captureTools(() => makeAwaitTool(AGENT));
    const h = captured[doveAwaitToolName(AGENT)];
    await h({ taskId: "task-1", timeoutMs: 10000, groupContextId: "grp-1" });
    expect(publishSessionEvent).toHaveBeenCalledWith("grp-1", { type: "done" });
    expect(groupMemberCounters.has("grp-1")).toBe(false);
  });
});

// ─── doveStartGroupToolName ───────────────────────────────────────────────────

describe("doveStartGroupToolName", () => {
  it("slugifies the group name", () => {
    expect(doveStartGroupToolName("PixelPaw Labs")).toBe("start_group_pixelpaw_labs");
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

  it("generates groupContextId and groupMomentsPath internally", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    const result = await handler({
      members: [{ name: "test-agent", relevanceScore: 100, instruction: "do something" }],
    });
    const sc = result.structuredContent as { groupContextId: string };
    expect(typeof sc.groupContextId).toBe("string");
  });

  it("calls upsertSession and setActiveSession with group agentId", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    const result = await handler({
      members: [{ name: "test-agent", relevanceScore: 100, instruction: "do something" }],
    });
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
      buildReadReminder: () => "",
      buildSaveReminder: () => "",
    });
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      members: [{ name: "test-agent", relevanceScore: 100, instruction: "do something" }],
    });
    expect(initGroup).toHaveBeenCalledWith(expect.any(String), expect.any(String));
  });

  it("falls back to mkdir(moments) when the provider's initGroup rejects", async () => {
    const { getMemoryProvider } = await import("@/lib/memory");
    vi.mocked(getMemoryProvider).mockResolvedValue({
      initGroup: vi.fn().mockRejectedValue(new Error("provider down")),
      deleteGroup: vi.fn().mockResolvedValue(undefined),
      buildReadReminder: () => "",
      buildSaveReminder: () => "",
    });
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      members: [{ name: "test-agent", relevanceScore: 100, instruction: "do something" }],
    });
    // upsertSession is still called (session row created before dispatch)
    expect(vi.mocked(upsertSession)).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: `group:${GROUP.name}` }),
    );
  });

  it("writes members/roster.md listing each member's displayName and description", async () => {
    const memberDef = {
      ...AGENT,
      name: "test-agent",
      displayName: "Test Agent",
      description: "A test agent for unit tests",
    };
    const captured = captureTools(() => makeStartGroupTool(GROUP, [memberDef as any]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      members: [{ name: "test-agent", relevanceScore: 100, instruction: "do something" }],
    });
    // upsertSession receives workspacePath = groupMomentsPath
    const sessionCall = vi.mocked(upsertSession).mock.calls[0][0];
    const groupMomentsPath = sessionCall.workspacePath as string;

    const { readFile } = await import("node:fs/promises");
    const roster = await readFile(`${groupMomentsPath}/members/roster.md`, "utf8");
    expect(roster).toContain("Test Agent");
    expect(roster).toContain("A test agent for unit tests");
    expect(roster).toContain("Do not involve any agent outside this list.");
  });

  it("forwards isGroupChat metadata and groupMomentsPath to each member", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      members: [{ name: "test-agent", relevanceScore: 100, instruction: "do something" }],
    });
    const client =
      await vi.mocked(ClientFactory).mock.results[0].value.createFromUrl.mock.results[0].value;
    const sentMetadata = client.sendMessageStream.mock.calls[0][0].message.metadata as Record<
      string,
      unknown
    >;
    expect(sentMetadata.isGroupChat).toBe(true);
    expect(typeof sentMetadata.groupMomentsPath).toBe("string");
  });

  it("returns memberTaskIds in structuredContent", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    const result = await handler({
      members: [{ name: "test-agent", relevanceScore: 100, instruction: "do something" }],
    });
    const sc = result.structuredContent as {
      memberTaskIds: Record<string, string>;
      groupContextId: string;
    };
    expect(sc.memberTaskIds).toEqual({ test_agent: "task-grp-1" });
    expect(typeof sc.groupContextId).toBe("string");
  });

  it("publishes a sender event per member, prefixed with the member's displayName", async () => {
    const a: AgentDef = {
      ...AGENT,
      name: "agent-a",
      manifestKey: "agent_a",
      displayName: "Alice",
    };
    const b: AgentDef = {
      ...AGENT,
      name: "agent-b",
      manifestKey: "agent_b",
      displayName: "Bob",
    };
    vi.mocked(readPortsManifest).mockReturnValue({ agent_a: 9001, agent_b: 9002 } as any);
    const captured = captureTools(() =>
      makeStartGroupTool({ ...GROUP, members: ["agent-a", "agent-b"] }, [a, b]),
    );
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      members: [
        { name: "agent-a", relevanceScore: 95, instruction: "do A" },
        { name: "agent-b", relevanceScore: 95, instruction: "do B" },
      ],
    });
    expect(vi.mocked(publishSessionEvent)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        type: "group_member",
        agentId: "dove",
        isSender: true,
        done: true,
        text: "@Alice\n\ndo A",
      }),
    );
    expect(vi.mocked(publishSessionEvent)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        type: "group_member",
        agentId: "dove",
        isSender: true,
        done: true,
        text: "@Bob\n\ndo B",
      }),
    );
  });

  it("dispatches each member with its own tailored instruction", async () => {
    const a: AgentDef = { ...AGENT, name: "agent-a", manifestKey: "agent_a" };
    const b: AgentDef = { ...AGENT, name: "agent-b", manifestKey: "agent_b" };
    vi.mocked(readPortsManifest).mockReturnValue({ agent_a: 9001, agent_b: 9002 } as any);
    const captured = captureTools(() =>
      makeStartGroupTool({ ...GROUP, members: ["agent-a", "agent-b"] }, [a, b]),
    );
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      members: [
        { name: "agent-a", relevanceScore: 95, instruction: "investigate logs" },
        { name: "agent-b", relevanceScore: 95, instruction: "check the dashboard" },
      ],
    });
    // Collect all sendMessageStream calls across both client instances and assert
    // each tailored instruction made it into exactly one dispatched message.
    const factoryCalls = vi.mocked(ClientFactory).mock.results;
    const messageTexts: string[] = [];
    for (const factoryCall of factoryCalls) {
      const client = await factoryCall.value.createFromUrl.mock.results[0].value;
      for (const call of client.sendMessageStream.mock.calls) {
        const parts = call[0].message.parts as { kind: string; text?: string }[];
        const text = parts.map((p) => p.text ?? "").join("");
        messageTexts.push(text);
      }
    }
    expect(messageTexts.some((t) => t.includes("investigate logs"))).toBe(true);
    expect(messageTexts.some((t) => t.includes("check the dashboard"))).toBe(true);
  });

  it("does not publish a group_member done event from the drain — the A2A relay handles it", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      members: [{ name: "test-agent", relevanceScore: 100, instruction: "do something" }],
    });
    // Flush microtasks so any drain .then() callbacks fire
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(publishSessionEvent)).not.toHaveBeenCalledWith(
      expect.any(String),
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
    const captured = captureTools(() =>
      makeStartGroupTool({ ...GROUP, members: ["agent-a", "agent-b", "agent-c"] }, [a, b, c]),
    );
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    const result = await handler({
      members: [
        { name: "agent-a", relevanceScore: 95, instruction: "task A" },
        { name: "agent-b", relevanceScore: 85, instruction: "task B" },
        { name: "agent-c", relevanceScore: 92, instruction: "task C" },
      ],
    });
    const sc = result.structuredContent as { memberTaskIds: Record<string, string> };
    expect(Object.keys(sc.memberTaskIds).toSorted()).toEqual(["agent_a", "agent_c"]);
  });

  it("stops immediately when no member clears the threshold", async () => {
    const a: AgentDef = { ...AGENT, name: "agent-a", manifestKey: "agent_a" };
    const b: AgentDef = { ...AGENT, name: "agent-b", manifestKey: "agent_b" };
    vi.mocked(readPortsManifest).mockReturnValue({ agent_a: 9001, agent_b: 9002 } as any);
    const captured = captureTools(() =>
      makeStartGroupTool({ ...GROUP, members: ["agent-a", "agent-b"] }, [a, b]),
    );
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    const result = await handler({
      members: [
        { name: "agent-a", relevanceScore: 50, instruction: "task A" },
        { name: "agent-b", relevanceScore: 70, instruction: "task B" },
      ],
    });
    const sc = result.structuredContent as { memberTaskIds: Record<string, string> };
    expect(Object.keys(sc.memberTaskIds)).toEqual([]);
  });

  // ─── members description: graph-aware candidate filter ────────────────────
  // The `members` Zod description shapes which agents Dove proposes. The rule
  // (per project owner): only candidates with out-degree > 0 AND in-degree == 0
  // within the group's link subgraph are preferred; agents isolated in the
  // graph (out == 0 AND in == 0) are fallbacks; agents with any in-degree are
  // excluded — they'll be reached transitively via the upstream's handoff.

  function getMembersDescription(captured: typeof tool): string {
    const call = vi
      .mocked(captured)
      .mock.calls.find((c) => c[0] === doveStartGroupToolName("PixelPaw Labs"));
    const schema = call?.[2] as unknown as {
      members: { description?: string };
    };
    return schema.members.description ?? "";
  }

  const GROUP_3 = {
    ...GROUP,
    members: ["alpha", "beta", "gamma"],
  };

  it("lists only out-only agents as bullet points when links exist", () => {
    const a: AgentDef = { ...AGENT, name: "alpha", manifestKey: "alpha", description: "A-desc" };
    const b: AgentDef = { ...AGENT, name: "beta", manifestKey: "beta", description: "B-desc" };
    const c: AgentDef = { ...AGENT, name: "gamma", manifestKey: "gamma", description: "C-desc" };
    const links: AgentLink[] = [
      {
        source: "alpha",
        target: "beta",
        direction: "single",
        strategy: "chat",
        group: "PixelPaw Labs",
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
      {
        source: "alpha",
        target: "gamma",
        direction: "single",
        strategy: "chat",
        group: "PixelPaw Labs",
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
    ];
    captureTools(() =>
      makeStartGroupTool(GROUP_3, [a, b, c], undefined, undefined, undefined, links),
    );
    const desc = getMembersDescription(tool);
    expect(desc).toContain("- alpha: A-desc");
    expect(desc).not.toContain("- beta:");
    expect(desc).not.toContain("- gamma:");
  });

  it("hides fallback agents when preferred is non-empty; isolated agents not shown", () => {
    const a: AgentDef = { ...AGENT, name: "alpha", manifestKey: "alpha", description: "A-desc" };
    const b: AgentDef = { ...AGENT, name: "beta", manifestKey: "beta", description: "B-desc" };
    const c: AgentDef = { ...AGENT, name: "gamma", manifestKey: "gamma", description: "C-desc" };
    const links: AgentLink[] = [
      {
        source: "alpha",
        target: "beta",
        direction: "single",
        strategy: "chat",
        group: "PixelPaw Labs",
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
    ];
    captureTools(() =>
      makeStartGroupTool(GROUP_3, [a, b, c], undefined, undefined, undefined, links),
    );
    const desc = getMembersDescription(tool);
    expect(desc).toContain("- alpha: A-desc");
    expect(desc).not.toContain("- gamma:");
    expect(desc).not.toContain("- beta:");
  });

  it("excludes agents touched by a dual edge (dual counts as in-degree)", () => {
    const a: AgentDef = { ...AGENT, name: "alpha", manifestKey: "alpha", description: "A-desc" };
    const b: AgentDef = { ...AGENT, name: "beta", manifestKey: "beta", description: "B-desc" };
    const links: AgentLink[] = [
      {
        source: "alpha",
        target: "beta",
        direction: "dual",
        strategy: "chat",
        group: "PixelPaw Labs",
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
    ];
    captureTools(() =>
      makeStartGroupTool(
        { ...GROUP, members: ["alpha", "beta"] },
        [a, b],
        undefined,
        undefined,
        undefined,
        links,
      ),
    );
    const desc = getMembersDescription(tool);
    // Both have in-degree ≥ 1 via the dual edge → neither preferred, neither isolated
    expect(desc).not.toContain("- alpha:");
    expect(desc).not.toContain("- beta:");
  });

  it("ignores escalation/review group links for start topology — all members shown as fallback", () => {
    const a: AgentDef = { ...AGENT, name: "alpha", manifestKey: "alpha", description: "A-desc" };
    const b: AgentDef = { ...AGENT, name: "beta", manifestKey: "beta", description: "B-desc" };
    const c: AgentDef = { ...AGENT, name: "gamma", manifestKey: "gamma", description: "C-desc" };
    const links: AgentLink[] = [
      {
        source: "alpha",
        target: "beta",
        direction: "single",
        strategy: "escalation",
        group: "PixelPaw Labs",
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
      {
        source: "alpha",
        target: "gamma",
        direction: "single",
        strategy: "review",
        group: "PixelPaw Labs",
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
    ];
    captureTools(() =>
      makeStartGroupTool(GROUP_3, [a, b, c], undefined, undefined, undefined, links),
    );
    const desc = getMembersDescription(tool);
    // escalation/review don't affect start topology → all 3 are isolated → shown as fallback
    expect(desc).toContain("- alpha: A-desc");
    expect(desc).toContain("- beta: B-desc");
    expect(desc).toContain("- gamma: C-desc");
  });

  it("ignores links belonging to a different group", () => {
    const a: AgentDef = { ...AGENT, name: "alpha", manifestKey: "alpha", description: "A-desc" };
    const b: AgentDef = { ...AGENT, name: "beta", manifestKey: "beta", description: "B-desc" };
    const links: AgentLink[] = [
      {
        source: "alpha",
        target: "beta",
        direction: "single",
        strategy: "chat",
        group: "Other Group",
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
    ];
    captureTools(() =>
      makeStartGroupTool(
        { ...GROUP, members: ["alpha", "beta"] },
        [a, b],
        undefined,
        undefined,
        undefined,
        links,
      ),
    );
    const desc = getMembersDescription(tool);
    // No in-group edges → both isolated → shown as fallback bullet points
    expect(desc).toContain("- alpha: A-desc");
    expect(desc).toContain("- beta: B-desc");
  });

  it("shows all members as bullet points when no links exist", () => {
    const a: AgentDef = { ...AGENT, name: "alpha", manifestKey: "alpha", description: "A-desc" };
    const b: AgentDef = { ...AGENT, name: "beta", manifestKey: "beta", description: "B-desc" };
    captureTools(() =>
      makeStartGroupTool(
        { ...GROUP, members: ["alpha", "beta"] },
        [a, b],
        undefined,
        undefined,
        undefined,
        [],
      ),
    );
    const desc = getMembersDescription(tool);
    expect(desc).toContain("- alpha: A-desc");
    expect(desc).toContain("- beta: B-desc");
  });

  it("publishes agent_status:start then agent_status:running per dispatched member", async () => {
    const captured = captureTools(() => makeStartGroupTool(GROUP, [AGENT]));
    const handler = captured[doveStartGroupToolName(GROUP.name)];
    await handler({
      members: [{ name: "test-agent", relevanceScore: 100, instruction: "do something" }],
    });
    const calls = vi.mocked(publishSessionEvent).mock.calls;
    const statusCalls = calls.filter(([, ev]) => (ev as any).type === "agent_status");
    const statuses = statusCalls.map(([, ev]) => (ev as any).status);
    expect(statuses).toContain("start");
    expect(statuses).toContain("running");
    // start must precede running
    expect(statuses.indexOf("start")).toBeLessThan(statuses.indexOf("running"));
  });
});

// ─── makeAwaitTool — group agent_status relay ─────────────────────────────────

describe("makeAwaitTool — group agent_status relay", () => {
  function mockCompletedAwait(state: "completed" | "failed" = "completed") {
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          resubscribeTask: vi.fn().mockReturnValue(
            asyncEvents(
              {
                kind: "artifact-update",
                artifact: { name: "final-output", parts: [{ kind: "text", text: "done" }] },
              },
              { kind: "status-update", status: { state, timestamp: "" }, final: true },
            ),
          ),
        }),
      };
    } as any);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const { groupMemberCounters } = await import("@/lib/group-member-counter");
    groupMemberCounters.clear();
  });

  it("publishes agent_status:completed to groupContextId on success", async () => {
    mockCompletedAwait("completed");
    const { groupMemberCounters } = await import("@/lib/group-member-counter");
    groupMemberCounters.set("grp-1", { started: 1, completed: 0 });
    const captured = captureTools(() => makeAwaitTool(AGENT));
    const h = captured[doveAwaitToolName(AGENT)];
    await h({ taskId: "task-1", timeoutMs: 10000, groupContextId: "grp-1" });
    expect(vi.mocked(publishSessionEvent)).toHaveBeenCalledWith(
      "grp-1",
      expect.objectContaining({ type: "agent_status", status: "completed" }),
    );
  });

  it("publishes agent_status:failed to groupContextId on task failure", async () => {
    mockCompletedAwait("failed");
    const { groupMemberCounters } = await import("@/lib/group-member-counter");
    groupMemberCounters.set("grp-1", { started: 1, completed: 0 });
    const captured = captureTools(() => makeAwaitTool(AGENT));
    const h = captured[doveAwaitToolName(AGENT)];
    await h({ taskId: "task-1", timeoutMs: 10000, groupContextId: "grp-1" });
    expect(vi.mocked(publishSessionEvent)).toHaveBeenCalledWith(
      "grp-1",
      expect.objectContaining({ type: "agent_status", status: "failed" }),
    );
  });

  it("does not publish agent_status when groupContextId is omitted", async () => {
    mockCompletedAwait("completed");
    const captured = captureTools(() => makeAwaitTool(AGENT));
    const h = captured[doveAwaitToolName(AGENT)];
    await h({ taskId: "task-1", timeoutMs: 10000 });
    const agentStatusCalls = vi
      .mocked(publishSessionEvent)
      .mock.calls.filter(([, ev]) => (ev as any).type === "agent_status");
    expect(agentStatusCalls).toHaveLength(0);
  });
});

// ─── makeStartTool — group context status ─────────────────────────────────────

describe("makeStartTool — group context status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readPortsManifest).mockReturnValue({ test_agent: 51001 } as any);
    vi.mocked(ClientFactory).mockImplementation(function () {
      return {
        createFromUrl: vi.fn().mockResolvedValue({
          sendMessageStream: () =>
            asyncEvents({ kind: "task", id: "task-start-grp", status: { state: "submitted" } }),
        }),
      };
    } as any);
  });

  it("publishes agent_status:start then agent_status:running to groupContextId", async () => {
    const captured = captureTools(() => makeStartTool(AGENT));
    const h = captured[doveStartToolName(AGENT)];
    await h({ instruction: "go", groupContextId: "grp-ctx" });
    const calls = vi.mocked(publishSessionEvent).mock.calls.filter(([id]) => id === "grp-ctx");
    const statuses = calls.map(([, ev]) => (ev as any).status);
    expect(statuses).toContain("start");
    expect(statuses).toContain("running");
    expect(statuses.indexOf("start")).toBeLessThan(statuses.indexOf("running"));
  });

  it("does not publish to group context when groupContextId is omitted", async () => {
    const captured = captureTools(() => makeStartTool(AGENT));
    const h = captured[doveStartToolName(AGENT)];
    await h({ instruction: "go" });
    expect(vi.mocked(publishSessionEvent)).not.toHaveBeenCalled();
  });
});
