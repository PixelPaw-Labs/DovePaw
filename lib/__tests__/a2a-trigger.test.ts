import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSendMessage } = vi.hoisted(() => ({ mockSendMessage: vi.fn() }));

vi.mock("@a2a-js/sdk/client", () => ({
  ClientFactory: class {
    async createFromUrl(_url: string) {
      return { sendMessage: mockSendMessage };
    }
  },
}));

import { triggerAgent } from "../a2a-trigger.js";

describe("triggerAgent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves 'completed' when task state is completed", async () => {
    mockSendMessage.mockResolvedValue({ kind: "task", status: { state: "completed" } });
    expect(await triggerAgent(12345, "run")).toBe("completed");
  });

  it("resolves 'failed' when task state is failed", async () => {
    mockSendMessage.mockResolvedValue({ kind: "task", status: { state: "failed" } });
    expect(await triggerAgent(12345, "run")).toBe("failed");
  });

  it("resolves 'unknown' when result kind is not task", async () => {
    mockSendMessage.mockResolvedValue({ kind: "message" });
    expect(await triggerAgent(12345, "run")).toBe("unknown");
  });
});
