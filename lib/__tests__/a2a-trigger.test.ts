import { describe, it, expect, vi, beforeEach } from "vitest";

// sendMessageStream must return an AsyncGenerator
function makeStream(events: object[]): AsyncGenerator<object, void, undefined> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

const { mockSendMessageStream } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
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

import { triggerAgent } from "../a2a-trigger.js";

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
