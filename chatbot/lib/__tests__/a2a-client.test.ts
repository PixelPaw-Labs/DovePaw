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
import { TaskState } from "@a2a-js/sdk";
import { CancelTaskRequest, Part } from "@a2a-js/sdk";
import {
  a2aEvents,
  artifact,
  artifactEvent,
  messageEvent,
  statusEvent,
  taskEvent,
  taskResult,
} from "./__fixtures__/a2a-events";
import {
  startAgentStream,
  streamCollect,
  collectStreamResult,
  extractArtifactResult,
  formatAgentStreamContext,
  noAgentOutput,
  subscribeTaskStream,
} from "@/lib/a2a-client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      sendMessageStream: () => a2aEvents(taskEvent("task-123")),
    });

    const handle = await startAgentStream(3000, "hello");

    expect(handle).not.toBeNull();
    expect(handle!.taskId).toBe("task-123");
  });

  it("creates client at the correct localhost URL", async () => {
    const mockCreateFromUrl = vi.fn().mockResolvedValue({
      cancelTask: vi.fn().mockResolvedValue(undefined),
      sendMessageStream: () => a2aEvents(taskEvent("t1")),
    });
    vi.mocked(ClientFactory).mockImplementation(function () {
      return { createFromUrl: mockCreateFromUrl };
    } as never);

    await startAgentStream(7777, "hello");

    expect(mockCreateFromUrl).toHaveBeenCalledWith("http://localhost:7777");
  });

  it("sends the message text in sendMessageStream parts", async () => {
    const mockStream = vi.fn().mockReturnValue(a2aEvents(taskEvent("t1")));
    makeClientFactory({ sendMessageStream: mockStream });

    await startAgentStream(3000, "do the thing");

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          parts: [Part.fromJSON({ text: "do the thing" })],
        }),
      }),
      expect.any(Object),
    );
  });

  it("returns null when first event is not a task", async () => {
    makeClientFactory({
      sendMessageStream: () => a2aEvents(messageEvent()),
    });

    const handle = await startAgentStream(3000, "hello");

    expect(handle).toBeNull();
  });

  it("returns null when stream is immediately done", async () => {
    makeClientFactory({
      sendMessageStream: () => a2aEvents(),
    });

    const handle = await startAgentStream(3000, "hello");

    expect(handle).toBeNull();
  });

  it("calls cancelTask when abort signal fires after taskId is known", async () => {
    const client = makeClientFactory({
      sendMessageStream: () => a2aEvents(taskEvent("task-abort")),
    });
    const ac = new AbortController();

    await startAgentStream(3000, "hello", ac.signal);
    ac.abort();
    await Promise.resolve(); // flush microtasks

    expect(client.cancelTask).toHaveBeenCalledWith(
      CancelTaskRequest.fromJSON({ id: "task-abort" }),
    );
  });

  it("does not call cancelTask when signal is not aborted", async () => {
    const client = makeClientFactory({
      sendMessageStream: () => a2aEvents(taskEvent("task-ok")),
    });
    const ac = new AbortController();

    await startAgentStream(3000, "hello", ac.signal);

    expect(client.cancelTask).not.toHaveBeenCalled();
  });
});

// ─── collectStreamResult ──────────────────────────────────────────────────────

describe("collectStreamResult", () => {
  it("excludes label artifact values from output", async () => {
    const { result } = await collectStreamResult(
      a2aEvents(
        statusEvent(TaskState.TASK_STATE_WORKING, "toolu_abc123"),
        artifactEvent("tool-call", "ToolSearch"),
        artifactEvent("label", "ToolSearch: select:mcp__agents__start_pixelpaw_qa"),
        artifactEvent("final-output", "Here is Taylor's QA analysis"),
      ),
    );
    expect(result.output).not.toContain("ToolSearch");
    expect(result.output).not.toContain("mcp__agents__start_pixelpaw_qa");
    expect(result.output).toBe("Here is Taylor's QA analysis");
  });

  it("excludes tool-call artifact values from output", async () => {
    const { result } = await collectStreamResult(
      a2aEvents(
        statusEvent(TaskState.TASK_STATE_WORKING, "ToolSearch"),
        artifactEvent("tool-call", "ToolSearch"),
        artifactEvent("final-output", "Here are the results"),
      ),
    );
    expect(result.output).not.toContain("ToolSearch");
    expect(result.output).toBe("Here are the results");
  });

  it("includes final-output artifact value in output", async () => {
    const { result } = await collectStreamResult(
      a2aEvents(
        statusEvent(TaskState.TASK_STATE_WORKING, "step"),
        artifactEvent("final-output", "done"),
      ),
    );
    expect(result.output).toBe("done");
  });

  it("thinking artifact value is excluded from output", async () => {
    const { result } = await collectStreamResult(
      a2aEvents(
        statusEvent(TaskState.TASK_STATE_WORKING, "step"),
        artifactEvent("thinking", "inner thoughts"),
        artifactEvent("final-output", "response"),
      ),
    );
    expect(result.output).toBe("response");
    expect(result.output).not.toContain("inner thoughts");
  });
});

// ─── streamCollect ────────────────────────────────────────────────────────────

describe("streamCollect", () => {
  it("yields chunk events for every artifact text part", async () => {
    const chunks: { name: string; text: string }[] = [];
    for await (const event of streamCollect(
      a2aEvents(
        statusEvent(TaskState.TASK_STATE_WORKING, "step"),
        artifactEvent("thinking", "inner thoughts"),
        artifactEvent("final-output", "response"),
      ),
    )) {
      if (event.kind === "chunk") chunks.push({ name: event.name, text: event.text });
    }
    expect(chunks).toContainEqual({ name: "thinking", text: "inner thoughts" });
    expect(chunks).toContainEqual({ name: "final-output", text: "response" });
  });

  it("yields snapshot events after each status-update and artifact accumulation", async () => {
    const snapshots: string[] = [];
    for await (const event of streamCollect(
      a2aEvents(
        statusEvent(TaskState.TASK_STATE_WORKING, "working"),
        artifactEvent("final-output", "done"),
      ),
    )) {
      if (event.kind === "snapshot") snapshots.push(event.result.output);
    }
    // At least one snapshot should contain the final output
    expect(snapshots.some((o) => o === "done")).toBe(true);
  });

  it("always yields a final snapshot even for an empty stream", async () => {
    const snapshots: unknown[] = [];
    for await (const event of streamCollect(a2aEvents())) {
      if (event.kind === "snapshot") snapshots.push(event);
    }
    expect(snapshots).toHaveLength(1);
  });

  it("snapshot carries the taskId from the task event", async () => {
    makeClientFactory({
      resubscribeTask: vi.fn().mockReturnValue(a2aEvents(taskEvent("task-snap-id"))),
    });
    const client = await (await import("@@/lib/a2a-client")).createAgentClient(9999);
    let lastTaskId: string | undefined;
    for await (const event of streamCollect(
      client.resubscribeTask({ id: "task-snap-id", tenant: "" }, {}),
    )) {
      if (event.kind === "snapshot") lastTaskId = event.taskId;
    }
    expect(lastTaskId).toBe("task-snap-id");
  });
});

// ─── extractArtifactResult ────────────────────────────────────────────────────

describe("extractArtifactResult", () => {
  it("uses final-output artifact as output", () => {
    const result = extractArtifactResult([
      artifact("tool-call", "ToolSearch"),
      artifact("final-output", "the answer"),
    ]);
    expect(result.output).toBe("the answer");
  });

  it("falls back to stream artifact when no final-output", () => {
    const result = extractArtifactResult([artifact("stream", "streamed text")]);
    expect(result.output).toBe("streamed text");
  });

  it("does not include tool-call, tool-input, or thinking in output", () => {
    const result = extractArtifactResult([
      artifact("tool-call", "Bash"),
      artifact("tool-input", '{"cmd":"ls"}'),
      artifact("thinking", "reasoning"),
    ]);
    expect(result.output).toBe(noAgentOutput());
  });

  it("returns 'Something wrong with agent.' for empty artifacts", () => {
    expect(extractArtifactResult([]).output).toBe(noAgentOutput());
    expect(extractArtifactResult(undefined).output).toBe(noAgentOutput());
  });
});

// ─── collectStreamResult — finalState capture ─────────────────────────────────

describe("collectStreamResult — finalState", () => {
  it("captures finalState from terminal status-update", async () => {
    makeClientFactory({
      resubscribeTask: vi
        .fn()
        .mockReturnValue(a2aEvents(statusEvent(TaskState.TASK_STATE_COMPLETED))),
    });
    const client = await (await import("@@/lib/a2a-client")).createAgentClient(9999);
    const { result } = await collectStreamResult(
      client.resubscribeTask({ id: "t", tenant: "" }, {}),
    );
    expect(result.finalState).toBe("completed");
  });

  // Each SDK terminal state must map to the right DovePaw status string — these
  // reach the MCP structuredContent, the PostToolUse hook contract and the UI.
  it.each([
    [TaskState.TASK_STATE_COMPLETED, "completed"],
    [TaskState.TASK_STATE_FAILED, "failed"],
    [TaskState.TASK_STATE_CANCELED, "canceled"],
    [TaskState.TASK_STATE_REJECTED, "rejected"],
  ])("maps terminal state %s to %s", async (state, expected) => {
    const { result } = await collectStreamResult(a2aEvents(statusEvent(state)));
    expect(result.finalState).toBe(expected);
  });

  it.each([
    TaskState.TASK_STATE_SUBMITTED,
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_AUTH_REQUIRED,
  ])("leaves finalState undefined for the non-terminal state %s", async (state) => {
    const { result } = await collectStreamResult(a2aEvents(statusEvent(state)));
    expect(result.finalState).toBeUndefined();
  });

  it("leaves finalState undefined when no terminal status-update", async () => {
    makeClientFactory({ resubscribeTask: vi.fn().mockReturnValue(a2aEvents()) });
    const client = await (await import("@@/lib/a2a-client")).createAgentClient(9999);
    const { result } = await collectStreamResult(
      client.resubscribeTask({ id: "t", tenant: "" }, {}),
    );
    expect(result.finalState).toBeUndefined();
  });

  it("collects thinking from thinking artifact", async () => {
    makeClientFactory({
      resubscribeTask: vi
        .fn()
        .mockReturnValue(
          a2aEvents(
            artifactEvent("thinking", "Let me think..."),
            statusEvent(TaskState.TASK_STATE_COMPLETED),
          ),
        ),
    });
    const client = await (await import("@@/lib/a2a-client")).createAgentClient(9999);
    const { result } = await collectStreamResult(
      client.resubscribeTask({ id: "t", tenant: "" }, {}),
    );
    expect(result.thinking).toBe("Let me think...");
  });

  it("collects tool calls from tool-call + tool-input artifacts", async () => {
    makeClientFactory({
      resubscribeTask: vi
        .fn()
        .mockReturnValue(
          a2aEvents(
            statusEvent(TaskState.TASK_STATE_WORKING, "calling bash"),
            artifactEvent("tool-call", "bash"),
            artifactEvent("tool-input", '{"command":"ls"}'),
            statusEvent(TaskState.TASK_STATE_COMPLETED),
          ),
        ),
    });
    const client = await (await import("@@/lib/a2a-client")).createAgentClient(9999);
    const { result } = await collectStreamResult(
      client.resubscribeTask({ id: "t", tenant: "" }, {}),
    );
    expect(result.toolCalls).toEqual(['bash: {"command":"ls"}']);
  });
});

// ─── formatAgentStreamContext ─────────────────────────────────────────────────

const BASE_RESULT = {
  output: "",
  progress: [],
  thinking: "",
  toolCalls: [],
  finalState: "completed" as const,
};

describe("formatAgentStreamContext", () => {
  it("includes state and contextId", () => {
    const text = formatAgentStreamContext(BASE_RESULT, "abc", "MyAgent");
    expect(text).toContain("completed");
    expect(text).toContain("abc");
  });

  it("includes response section when output present", () => {
    const text = formatAgentStreamContext({ ...BASE_RESULT, output: "done" }, "abc", "MyAgent");
    expect(text).toContain("<response>");
    expect(text).toContain("done");
  });

  it("includes thinking section when present", () => {
    const text = formatAgentStreamContext(
      { ...BASE_RESULT, thinking: "reasoning" },
      "abc",
      "MyAgent",
    );
    expect(text).toContain("<thinking>");
    expect(text).toContain("reasoning");
  });

  it("includes actions section when tool calls present", () => {
    const text = formatAgentStreamContext(
      { ...BASE_RESULT, toolCalls: ["bash: ls"] },
      "abc",
      "MyAgent",
    );
    expect(text).toContain("<actions>");
    expect(text).toContain("- bash: ls");
  });

  it("omits empty sections", () => {
    const text = formatAgentStreamContext(BASE_RESULT, "abc", "MyAgent");
    expect(text).not.toContain("<thinking>");
    expect(text).not.toContain("<response>");
    expect(text).not.toContain("<actions>");
  });
});

// ─── subscribeTaskStream — terminal-task fallback ─────────────────────────────

/**
 * Since SDK v1.0 the server REJECTS a resubscribe to a task that already reached
 * a terminal state ("...is in a terminal state (3) and cannot be subscribed to").
 * That is the normal case for await_* once its start_* task has finished, so the
 * stream helper must recover the result from the stored task snapshot instead.
 */
describe("subscribeTaskStream — already-terminal task", () => {
  const terminalRejection = () => {
    const err = new Error("Task t1 is in a terminal state (3) and cannot be subscribed to.");
    err.name = "JsonRpcTransportError";
    return err;
  };

  async function drain(client: unknown) {
    let last: { output: string; finalState?: string } | undefined;
    for await (const ev of subscribeTaskStream(client as never, "t1")) {
      if (ev.kind === "snapshot") last = ev.result;
    }
    return last;
  }

  it("falls back to the task snapshot when resubscribe rejects", async () => {
    const getTask = vi.fn().mockResolvedValue(
      taskResult("t1", {
        state: TaskState.TASK_STATE_COMPLETED,
        artifacts: [artifact("final-output", "the stored answer")],
      }),
    );
    const result = await drain({
      resubscribeTask: vi.fn(() => {
        throw terminalRejection();
      }),
      getTask,
      cancelTask: vi.fn(),
    });

    expect(result?.output).toBe("the stored answer");
    expect(result?.finalState).toBe("completed");
    expect(getTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("does not call getTask when the live stream works", async () => {
    const getTask = vi.fn();
    const result = await drain({
      resubscribeTask: vi.fn(() => a2aEvents(artifactEvent("final-output", "live"))),
      getTask,
      cancelTask: vi.fn(),
    });

    expect(result?.output).toBe("live");
    expect(getTask).not.toHaveBeenCalled();
  });

  it("propagates the original error when the task is genuinely gone", async () => {
    const gone = new Error("Task not found: t1");
    await expect(
      drain({
        resubscribeTask: vi.fn(() => {
          throw terminalRejection();
        }),
        getTask: vi.fn().mockRejectedValue(gone),
        cancelTask: vi.fn(),
      }),
    ).rejects.toThrow("Task not found: t1");
  });

  it("does not fall back after the stream has already delivered events", async () => {
    const getTask = vi.fn();
    await expect(
      drain({
        resubscribeTask: vi.fn(async function* () {
          yield artifactEvent("final-output", "partial");
          throw new Error("connection reset mid-stream");
        }),
        getTask,
        cancelTask: vi.fn(),
      }),
    ).rejects.toThrow("connection reset mid-stream");
    expect(getTask).not.toHaveBeenCalled();
  });
});
