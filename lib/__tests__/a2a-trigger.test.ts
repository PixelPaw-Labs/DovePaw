import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// sendMessageStream must return an AsyncGenerator
function makeStream(events: object[]): AsyncGenerator<object, void, undefined> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

const { mockSendMessageStream, mockReadFileSync, mockCleanupOnetimeJob, mockPortsFile } =
  vi.hoisted(() => ({
    mockSendMessageStream: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockCleanupOnetimeJob: vi.fn().mockResolvedValue(undefined),
    mockPortsFile: vi.fn().mockReturnValue("/fake/ports.json"),
  }));

vi.mock("@a2a-js/sdk/client", () => ({
  ClientFactory: class {
    async createFromUrl(_url: string) {
      return {
        sendMessageStream: mockSendMessageStream,
        cancelTask: vi.fn().mockResolvedValue(undefined),
      };
    }
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock("../scheduler", () => ({
  scheduler: { cleanupOnetimeJob: mockCleanupOnetimeJob },
}));

vi.mock("../paths", () => ({
  agentDefinitionFile: (name: string) => `/fake/${name}/agent.json`,
  portsFile: mockPortsFile,
}));

import { Message, Role, TaskState, roleToJSON } from "@a2a-js/sdk";
import { triggerAgent, resolvePort, readJobConfig, cleanupOnetimeJob } from "../a2a-trigger.js";

function taskEvent(contextId = "ctx-1") {
  return {
    payload: {
      $case: "task",
      value: {
        id: "task-1",
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: "" },
        artifacts: [],
        history: [],
        metadata: undefined,
      },
    },
  };
}

// v1.0 dropped the `final` flag — terminality is derived from the state itself.
function statusEvent(state: TaskState) {
  return {
    payload: {
      $case: "statusUpdate",
      value: {
        taskId: "task-1",
        contextId: "",
        status: { state, message: undefined, timestamp: "" },
        metadata: undefined,
      },
    },
  };
}

function messageEvent() {
  return {
    payload: {
      $case: "message",
      value: Message.fromJSON({ role: roleToJSON(Role.ROLE_AGENT), parts: [{ text: "hello" }] }),
    },
  };
}

describe("triggerAgent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns TASK_STATE_COMPLETED when the final status-update is completed", async () => {
    mockSendMessageStream.mockReturnValue(
      makeStream([
        taskEvent(),
        statusEvent(TaskState.TASK_STATE_WORKING),
        statusEvent(TaskState.TASK_STATE_COMPLETED),
      ]),
    );
    expect(await triggerAgent(12345, "run")).toBe(TaskState.TASK_STATE_COMPLETED);
  });

  it("returns TASK_STATE_FAILED when the final status-update is failed", async () => {
    mockSendMessageStream.mockReturnValue(
      makeStream([taskEvent(), statusEvent(TaskState.TASK_STATE_FAILED)]),
    );
    expect(await triggerAgent(12345, "run")).toBe(TaskState.TASK_STATE_FAILED);
  });

  it("returns TASK_STATE_UNSPECIFIED when the stream reports no status-update", async () => {
    mockSendMessageStream.mockReturnValue(makeStream([messageEvent()]));
    expect(await triggerAgent(12345, "run")).toBe(TaskState.TASK_STATE_UNSPECIFIED);
  });

  it("passes contextId in the message when provided", async () => {
    mockSendMessageStream.mockReturnValue(
      makeStream([taskEvent("existing-ctx"), statusEvent(TaskState.TASK_STATE_COMPLETED)]),
    );
    await triggerAgent(12345, "resume task", "existing-ctx");
    const [params] = mockSendMessageStream.mock.calls[0];
    expect(params.message.contextId).toBe("existing-ctx");
  });

  it("omits contextId from the message when not provided", async () => {
    mockSendMessageStream.mockReturnValue(
      makeStream([taskEvent(), statusEvent(TaskState.TASK_STATE_COMPLETED)]),
    );
    await triggerAgent(12345, "fresh task");
    const [params] = mockSendMessageStream.mock.calls[0];
    // v1.0's Message requires contextId, so an absent context is the empty string.
    expect(params.message.contextId).toBe("");
  });
});

// ─── resolvePort ──────────────────────────────────────────────────────────────

describe("resolvePort", () => {
  it("returns the port number when present", () => {
    expect(resolvePort({ my_agent: 3000 }, "my_agent")).toBe(3000);
  });

  it("returns null when the key is absent", () => {
    expect(resolvePort({}, "missing")).toBeNull();
  });

  it("returns null when the value is not a number", () => {
    expect(resolvePort({ agent: "3000" }, "agent")).toBeNull();
  });
});

// ─── readJobConfig ────────────────────────────────────────────────────────────

describe("readJobConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the matching job when found", () => {
    const jobs = [{ id: "job-1", label: "Daily", instruction: "do stuff" }];
    mockReadFileSync.mockReturnValue(JSON.stringify({ scheduledJobs: jobs }));
    const result = readJobConfig("my-agent", "job-1");
    expect(result?.instruction).toBe("do stuff");
    expect(result?.id).toBe("job-1");
  });

  it("returns null when the job id is not in the list", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ scheduledJobs: [{ id: "job-2", label: "", instruction: "" }] }),
    );
    expect(readJobConfig("my-agent", "job-1")).toBeNull();
  });

  it("returns null when the file does not exist", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(readJobConfig("my-agent", "job-1")).toBeNull();
  });

  it("returns null when the file contains invalid JSON", () => {
    mockReadFileSync.mockReturnValue("not json");
    expect(readJobConfig("my-agent", "job-1")).toBeNull();
  });
});

// ─── cleanupOnetimeJob ────────────────────────────────────────────────────────

describe("cleanupOnetimeJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to scheduler.cleanupOnetimeJob with correct args", async () => {
    await cleanupOnetimeJob("my-agent", "job-1", undefined);
    expect(mockCleanupOnetimeJob).toHaveBeenCalledWith("my-agent", "job-1", undefined);
  });

  it("forwards the label to scheduler.cleanupOnetimeJob", async () => {
    await cleanupOnetimeJob("my-agent", "job-1", "Nightly Run");
    expect(mockCleanupOnetimeJob).toHaveBeenCalledWith("my-agent", "job-1", "Nightly Run");
  });
});

// ─── PORTS_FILE port derivation ───────────────────────────────────────────────

describe("PORTS_FILE port derivation", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    delete process.env.DOVEPAW_PORT;
  });

  it("passes DOVEPAW_PORT env var to portsFile", async () => {
    mockPortsFile.mockClear();
    process.env.DOVEPAW_PORT = "9999";
    await import("../a2a-trigger.js");
    expect(mockPortsFile).toHaveBeenCalledWith(9999);
  });

  it("defaults to 7473 when DOVEPAW_PORT is unset", async () => {
    mockPortsFile.mockClear();
    await import("../a2a-trigger.js");
    expect(mockPortsFile).toHaveBeenCalledWith(7473);
  });
});
