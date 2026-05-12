import { describe, it, expect } from "vitest";
import { bucketOf, isDove, USER_BUCKET, DOVE_AGENT_ID } from "../group-swimlane/swimlane-buckets";
import type { ChatMessage } from "@/components/hooks/use-messages";

const text = (content: string): ChatMessage["segments"] => [{ type: "text", content }];

describe("bucketOf", () => {
  it("buckets assistant messages by agentId", () => {
    expect(bucketOf({ id: "1", role: "assistant", segments: text("hi"), agentId: "alpha" })).toBe(
      "alpha",
    );
  });

  it("buckets human-typed user messages into the user slot", () => {
    expect(bucketOf({ id: "1", role: "user", segments: text("hi"), agentId: "alpha" })).toBe(
      USER_BUCKET,
    );
  });

  it("buckets orchestrator user messages by senderAgentId", () => {
    expect(
      bucketOf({
        id: "1",
        role: "user",
        segments: text("instruction"),
        agentId: "alpha",
        senderAgentId: "alpha",
      }),
    ).toBe("alpha");
  });

  it("falls back to USER_BUCKET when assistant has no agentId", () => {
    expect(bucketOf({ id: "1", role: "assistant", segments: text("hi") })).toBe(USER_BUCKET);
  });
});

describe("isDove", () => {
  it("matches the canonical id", () => {
    expect(isDove(DOVE_AGENT_ID)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isDove("Dove")).toBe(true);
    expect(isDove("DOVE")).toBe(true);
  });

  it("does not match other agents", () => {
    expect(isDove("alpha")).toBe(false);
  });
});
