import { describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({}));

import { consumeQueryEvents } from "../query-events";
import type { QueryResponseDispatcher } from "../query-dispatcher";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

async function* events(...items: object[]): AsyncGenerator<SDKMessage> {
  for (const item of items) yield item as SDKMessage;
}

function mockDispatcher(): QueryResponseDispatcher {
  return {
    onSession: vi.fn(),
    onTextDelta: vi.fn(),
    onThinking: vi.fn(),
    onToolCall: vi.fn(),
    onToolInput: vi.fn(),
    onArtifact: vi.fn(),
    onFinalOutput: vi.fn(),
    onTaskProgress: vi.fn(),
  };
}

// ─── onSession ────────────────────────────────────────────────────────────────

describe("onSession", () => {
  it("fires with session_id from system/init event", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events({ type: "system", subtype: "init", session_id: "sess-123" }),
      d,
    );
    expect(d.onSession).toHaveBeenCalledWith("sess-123");
  });

  it("does not fire for non-system events", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(events({ type: "stream_event", event: { type: "message_start" } }), d);
    expect(d.onSession).not.toHaveBeenCalled();
  });
});

// ─── onTextDelta ──────────────────────────────────────────────────────────────

describe("onTextDelta", () => {
  it("fires with text from text_delta", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
      }),
      d,
    );
    expect(d.onTextDelta).toHaveBeenCalledWith("hello");
  });

  it("fires in order for multiple deltas", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events(
        {
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "foo" } },
        },
        {
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "bar" } },
        },
      ),
      d,
    );
    expect(d.onTextDelta).toHaveBeenCalledTimes(2);
    expect(d.onTextDelta).toHaveBeenNthCalledWith(1, "foo");
    expect(d.onTextDelta).toHaveBeenNthCalledWith(2, "bar");
  });
});

// ─── onThinking ───────────────────────────────────────────────────────────────

describe("onThinking", () => {
  it("fires with thinking text from thinking_delta", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "hmm..." },
        },
      }),
      d,
    );
    expect(d.onThinking).toHaveBeenCalledWith("hmm...");
  });
});

// ─── onToolCall / onToolInput ─────────────────────────────────────────────────

describe("onToolCall / onToolInput", () => {
  it("fires onToolCall at content_block_start for tool_use", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events({
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "tool_use", name: "my_tool" },
        },
      }),
      d,
    );
    expect(d.onToolCall).toHaveBeenCalledWith("my_tool", undefined);
  });

  it("does not fire onToolCall for non-tool content blocks", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events({
        type: "stream_event",
        event: { type: "content_block_start", content_block: { type: "text" } },
      }),
      d,
    );
    expect(d.onToolCall).not.toHaveBeenCalled();
  });

  it("fires onToolInput with buffered + pretty-printed JSON at content_block_stop", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events(
        {
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "tool_use", name: "t" } },
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "input_json_delta", partial_json: '{"k"' },
          },
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "input_json_delta", partial_json: ':"v"}' },
          },
        },
        { type: "stream_event", event: { type: "content_block_stop" } },
      ),
      d,
    );
    expect(d.onToolInput).toHaveBeenCalledWith(JSON.stringify({ k: "v" }, null, 2));
  });

  it("fires onToolInput with raw string when JSON is invalid", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events(
        {
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "tool_use", name: "t" } },
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "input_json_delta", partial_json: "not json" },
          },
        },
        { type: "stream_event", event: { type: "content_block_stop" } },
      ),
      d,
    );
    expect(d.onToolInput).toHaveBeenCalledWith("not json");
  });

  it("does not fire onToolInput for non-tool content blocks", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events(
        {
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "text" } },
        },
        { type: "stream_event", event: { type: "content_block_stop" } },
      ),
      d,
    );
    expect(d.onToolInput).not.toHaveBeenCalled();
  });

  it("does not fire onToolInput when tool input buffer is empty", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(
      events(
        {
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "tool_use", name: "t" } },
        },
        { type: "stream_event", event: { type: "content_block_stop" } },
      ),
      d,
    );
    expect(d.onToolInput).not.toHaveBeenCalled();
  });
});

// ─── onFinalOutput ─────────────────────────────────────────────────────────────────

describe("onFinalOutput", () => {
  it("fires with result string from result/success event", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(events({ type: "result", subtype: "success", result: "done!" }), d);
    expect(d.onFinalOutput).toHaveBeenCalledWith("done!");
  });

  it("fires with empty string when result is empty", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(events({ type: "result", subtype: "success", result: "" }), d);
    expect(d.onFinalOutput).toHaveBeenCalledWith("");
  });

  it("does not fire for result/error events", async () => {
    const d = mockDispatcher();
    await consumeQueryEvents(events({ type: "result", subtype: "error" }), d);
    expect(d.onFinalOutput).not.toHaveBeenCalled();
  });
});
