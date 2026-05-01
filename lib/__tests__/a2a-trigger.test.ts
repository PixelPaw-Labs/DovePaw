import { describe, it, expect, vi, beforeEach } from "vitest";

// sendMessageStream must return an AsyncGenerator
function makeStream(events: object[]): AsyncGenerator<object, void, undefined> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

const { mockSendMessageStream, mockReadFileSync, mockCleanupOnetimeJob } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockCleanupOnetimeJob: vi.fn().mockResolvedValue(undefined),
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
  portsFile: () => "/fake/ports.json",
}));

import { triggerAgent, resolvePort, readJobConfig, cleanupOnetimeJob } from "../a2a-trigger.js";

function taskEvent(contextId = "ctx-1") {
  return { kind: "task", id: "task-1", contextId, status: { state: "submitted" } };
}

function statusEvent(state: string, final = false) {
  return { kind: "status-update", final, status: { state } };
}

describe("triggerAgent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 'completed' when final status-update is completed", async () => {
    mockSendMessageStream.mockReturnValue(
      makeStream([taskEvent(), statusEvent("working"), statusEvent("completed", true)]),
    );
    expect(await triggerAgent(12345, "run")).toBe("completed");
  });

  it("returns 'failed' when final status-update is failed", async () => {
    mockSendMessageStream.mockReturnValue(makeStream([taskEvent(), statusEvent("failed", true)]));
    expect(await triggerAgent(12345, "run")).toBe("failed");
  });

  it("returns 'unknown' when stream has no task event as first event", async () => {
    mockSendMessageStream.mockReturnValue(makeStream([{ kind: "message" }]));
    expect(await triggerAgent(12345, "run")).toBe("unknown");
  });

  it("passes contextId in the message when provided", async () => {
    mockSendMessageStream.mockReturnValue(
      makeStream([taskEvent("existing-ctx"), statusEvent("completed", true)]),
    );
    await triggerAgent(12345, "resume task", "existing-ctx");
    const [params] = mockSendMessageStream.mock.calls[0];
    expect(params.message.contextId).toBe("existing-ctx");
  });

  it("omits contextId from the message when not provided", async () => {
    mockSendMessageStream.mockReturnValue(
      makeStream([taskEvent(), statusEvent("completed", true)]),
    );
    await triggerAgent(12345, "fresh task");
    const [params] = mockSendMessageStream.mock.calls[0];
    expect(params.message.contextId).toBeUndefined();
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
