import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  SseQueryDispatcher,
  A2AQueryDispatcher,
  MessageAccumulator,
  ARTIFACT,
} from "../query-dispatcher";
import type { ExecutorPublisher } from "@/a2a/lib/executor-publisher";

vi.mock("@/lib/relay-to-chatbot", () => ({ relaySessionEvent: vi.fn() }));

import { relaySessionEvent } from "@/lib/relay-to-chatbot";

// ─── MessageAccumulator ───────────────────────────────────────────────────────

describe("MessageAccumulator.buildMessage", () => {
  it("collects text deltas into a single text segment", () => {
    const acc = new MessageAccumulator();
    acc.onTextDelta("hello ");
    acc.onTextDelta("world");
    const msg = acc.buildMessage();
    expect(msg.segments).toEqual([{ type: "text", content: "hello world" }]);
    expect(msg.processContent).toBeUndefined();
  });

  it("excludes tool_call segments from both segments and processContent", () => {
    const acc = new MessageAccumulator();
    acc.onTextDelta("before ");
    acc.onToolCall("Bash");
    acc.onToolInput('{"cmd":"ls"}');
    acc.onTextDelta("after");
    const msg = acc.buildMessage();
    expect(msg.segments).toEqual([
      { type: "text", content: "before " },
      { type: "text", content: "after" },
    ]);
    expect(msg.processContent).toBeUndefined();
  });

  it("puts thinking into processContent", () => {
    const acc = new MessageAccumulator();
    acc.onThinking("reasoning...");
    acc.onTextDelta("answer");
    const msg = acc.buildMessage();
    expect(msg.segments).toEqual([{ type: "text", content: "answer" }]);
    expect(msg.processContent).toContain("reasoning...");
  });

  it("saves only thinking in processContent, not tool calls", () => {
    const acc = new MessageAccumulator();
    acc.onThinking("thought");
    acc.onToolCall("Read");
    acc.onToolInput('{"path":"/x"}');
    acc.onTextDelta("result");
    const msg = acc.buildMessage();
    expect(msg.segments).toEqual([{ type: "text", content: "result" }]);
    expect(msg.processContent).toBe("thought");
  });

  it("returns no processContent when no thinking or tool calls", () => {
    const acc = new MessageAccumulator();
    acc.onTextDelta("plain text");
    const msg = acc.buildMessage();
    expect(msg.processContent).toBeUndefined();
  });

  it("buildProgress returns accumulated tool call entries", () => {
    const acc = new MessageAccumulator();
    acc.onToolCall("Bash");
    acc.onToolInput('{"cmd":"ls"}');
    acc.onToolCall("Read");
    acc.onToolInput('{"path":"/x"}');
    expect(acc.buildProgress()).toEqual([
      { message: "Bash", artifacts: { "tool-call": "Bash", label: "Bash: ls" } },
      { message: "Read", artifacts: { "tool-call": "Read", label: "Read: /x" } },
    ]);
  });

  it("buildProgress returns empty array when no tool calls", () => {
    const acc = new MessageAccumulator();
    acc.onTextDelta("hello");
    expect(acc.buildProgress()).toEqual([]);
  });

  it("onTaskProgress appends a new entry per event with unique key", () => {
    const acc = new MessageAccumulator();
    acc.onToolCall("Agent", "tu-1");
    acc.onToolInput('{"prompt":"go"}');
    acc.onTaskProgress("tu-1", "List recent files", "Bash");
    acc.onTaskProgress("tu-1", "Read config", "Read");
    expect(acc.buildProgress()).toEqual([
      { message: "tu-1", artifacts: { "tool-call": "Agent", label: "Agent: go" } },
      { message: "tu-1_1", artifacts: { "tool-call": "Bash", label: "Bash: List recent files" } },
      { message: "tu-1_2", artifacts: { "tool-call": "Read", label: "Read: Read config" } },
    ]);
  });

  it("onTaskProgress skips entry when lastTool is empty", () => {
    const acc = new MessageAccumulator();
    acc.onTaskProgress("tu-1", "Starting…", "");
    expect(acc.buildProgress()).toEqual([]);
  });

  it("onTaskProgress without prior onToolCall appends with unique key when lastTool is set", () => {
    const acc = new MessageAccumulator();
    acc.onTaskProgress("tu-orphan", "Running task", "Read");
    expect(acc.buildProgress()).toEqual([
      { message: "tu-orphan_1", artifacts: { "tool-call": "Read", label: "Read: Running task" } },
    ]);
  });

  it("onTaskProgress counters are per toolUseId", () => {
    const acc = new MessageAccumulator();
    acc.onToolCall("Agent", "tu-1");
    acc.onToolInput('{"prompt":"go"}');
    acc.onToolCall("Agent", "tu-2");
    acc.onToolInput('{"prompt":"go"}');
    acc.onTaskProgress("tu-2", "Reading config", "Read");
    const progress = acc.buildProgress();
    expect(progress[0]).toEqual({
      message: "tu-1",
      artifacts: { "tool-call": "Agent", label: "Agent: go" },
    });
    expect(progress[1]).toEqual({
      message: "tu-2",
      artifacts: { "tool-call": "Agent", label: "Agent: go" },
    });
    expect(progress[2]).toEqual({
      message: "tu-2_1",
      artifacts: { "tool-call": "Read", label: "Read: Reading config" },
    });
  });
});

// ─── SseQueryDispatcher.buildProgress ────────────────────────────────────────

describe("SseQueryDispatcher.buildProgress", () => {
  it("delegates to accumulator — returns entries for each tool call", () => {
    const dispatcher = new SseQueryDispatcher(vi.fn());
    dispatcher.onToolCall("Bash");
    dispatcher.onToolCall("Read");
    expect(dispatcher.buildProgress()).toEqual([
      { message: "Bash", artifacts: { "tool-call": "Bash", label: "Bash" } },
      { message: "Read", artifacts: { "tool-call": "Read", label: "Read" } },
    ]);
  });

  it("onTaskProgress appends a separate entry per inner tool call", () => {
    const dispatcher = new SseQueryDispatcher(vi.fn());
    dispatcher.onToolCall("Agent", "tu-1");
    dispatcher.onToolInput('{"prompt":"go"}');
    dispatcher.onTaskProgress("tu-1", "List recent files", "Bash");
    expect(dispatcher.buildProgress()).toEqual([
      { message: "tu-1", artifacts: { "tool-call": "Agent", label: "Agent: go" } },
      { message: "tu-1_1", artifacts: { "tool-call": "Bash", label: "Bash: List recent files" } },
    ]);
  });
});

// ─── SseQueryDispatcher ───────────────────────────────────────────────────────

describe("SseQueryDispatcher", () => {
  function makeSend() {
    return vi.fn();
  }

  it("onSession sends session event", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onSession("sess-1");
    expect(send).toHaveBeenCalledWith({ type: "session", sessionId: "sess-1" });
  });

  it("onTextDelta sends text event", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onTextDelta("hello");
    expect(send).toHaveBeenCalledWith({ type: "text", content: "hello" });
  });

  it("onThinking sends thinking event", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onThinking("hmm");
    expect(send).toHaveBeenCalledWith({ type: "thinking", content: "hmm" });
  });

  it("onToolCall sends tool_call event and a progress event for the workflow panel", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onToolCall("Bash");
    expect(send).toHaveBeenCalledWith({ type: "tool_call", name: "Bash" });
    expect(send).toHaveBeenCalledWith({
      type: "progress",
      result: {
        output: "",
        progress: [{ message: "Bash", artifacts: { [ARTIFACT.TOOL_CALL]: "Bash", label: "Bash" } }],
      },
    });
  });

  it("onToolInput sends tool_input event", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onToolInput('{"cmd":"ls"}');
    expect(send).toHaveBeenCalledWith({ type: "tool_input", content: '{"cmd":"ls"}' });
  });

  it("onFinalOutput sends result event for non-empty string", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onFinalOutput("done");
    expect(send).toHaveBeenCalledWith({ type: "result", content: "done" });
  });

  it("onFinalOutput does not send for empty string", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onFinalOutput("");
    expect(send).not.toHaveBeenCalled();
  });

  describe("onArtifact", () => {
    it("maps stream artifact to text event", () => {
      const send = makeSend();
      new SseQueryDispatcher(send).onArtifact(ARTIFACT.STREAM, "hi");
      expect(send).toHaveBeenCalledWith({ type: "text", content: "hi" });
    });

    it("maps thinking artifact to thinking event", () => {
      const send = makeSend();
      new SseQueryDispatcher(send).onArtifact(ARTIFACT.THINKING, "hmm");
      expect(send).toHaveBeenCalledWith({ type: "thinking", content: "hmm" });
    });

    it("maps tool-call artifact to tool_call event and progress event", () => {
      const send = makeSend();
      new SseQueryDispatcher(send).onArtifact(ARTIFACT.TOOL_CALL, "Read");
      expect(send).toHaveBeenCalledWith({ type: "tool_call", name: "Read" });
      expect(send).toHaveBeenCalledWith({
        type: "progress",
        result: {
          output: "",
          progress: [
            { message: "Read", artifacts: { [ARTIFACT.TOOL_CALL]: "Read", label: "Read" } },
          ],
        },
      });
    });

    it("maps tool-input artifact to tool_input event", () => {
      const send = makeSend();
      new SseQueryDispatcher(send).onArtifact(ARTIFACT.TOOL_INPUT, '{"x":1}');
      expect(send).toHaveBeenCalledWith({ type: "tool_input", content: '{"x":1}' });
    });

    it("maps final-output artifact to result event", () => {
      const send = makeSend();
      new SseQueryDispatcher(send).onArtifact(ARTIFACT.FINAL_OUTPUT, "result text");
      expect(send).toHaveBeenCalledWith({ type: "result", content: "result text" });
    });

    it("ignores unknown artifact names", () => {
      const send = makeSend();
      new SseQueryDispatcher(send).onArtifact("unknown", "data");
      expect(send).not.toHaveBeenCalled();
    });
  });
});

// ─── A2AQueryDispatcher ───────────────────────────────────────────────────────

describe("A2AQueryDispatcher", () => {
  function makePublisher(): ExecutorPublisher {
    return {
      publishTask: vi.fn(),
      publishStatusToUI: vi.fn(),
      send: vi.fn(),
    } as unknown as ExecutorPublisher;
  }

  it("onTextDelta publishes stream artifact (no workflow node)", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onTextDelta("output");
    expect(pub.send).toHaveBeenCalledWith("output", ARTIFACT.STREAM);
    expect(pub.publishStatusToUI).not.toHaveBeenCalled();
  });

  it("onThinking publishes thinking artifact (no workflow node)", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onThinking("reasoning");
    expect(pub.send).toHaveBeenCalledWith("reasoning", ARTIFACT.THINKING);
    expect(pub.publishStatusToUI).not.toHaveBeenCalled();
  });

  it("onToolCall uses tool name as key when no toolUseId", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onToolCall("Bash");
    expect(pub.publishStatusToUI).toHaveBeenCalledWith("Bash", {
      [ARTIFACT.TOOL_CALL]: "Bash",
      label: "Bash",
    });
  });

  it("onToolCall uses toolUseId as key when provided", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onToolCall("Bash", "tu-abc");
    expect(pub.publishStatusToUI).toHaveBeenCalledWith("tu-abc", {
      [ARTIFACT.TOOL_CALL]: "Bash",
      label: "Bash",
    });
  });

  it("onToolInput publishes tool-input artifact (no workflow node)", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onToolInput('{"cmd":"ls"}');
    expect(pub.send).toHaveBeenCalledWith('{"cmd":"ls"}', ARTIFACT.TOOL_INPUT);
    expect(pub.publishStatusToUI).not.toHaveBeenCalled();
  });

  it("onFinalOutput publishes final-output artifact (no workflow node)", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onFinalOutput("task complete");
    expect(pub.send).toHaveBeenCalledWith("task complete", ARTIFACT.FINAL_OUTPUT);
    expect(pub.publishStatusToUI).not.toHaveBeenCalled();
  });

  it("onFinalOutput skips empty string", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onFinalOutput("");
    expect(pub.send).not.toHaveBeenCalled();
  });

  it("onSession is a no-op", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onSession("sess-1");
    expect(pub.publishStatusToUI).not.toHaveBeenCalled();
    expect(pub.send).not.toHaveBeenCalled();
  });

  it("onArtifact is a no-op", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onArtifact("stream", "text");
    expect(pub.publishStatusToUI).not.toHaveBeenCalled();
    expect(pub.send).not.toHaveBeenCalled();
  });

  it("onTaskProgress publishes with unique step key and description label", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onTaskProgress("tu-1", "List recent log files", "Bash");
    expect(pub.publishStatusToUI).toHaveBeenCalledWith("tu-1_1", {
      [ARTIFACT.TOOL_CALL]: "Bash",
      label: "Bash: List recent log files",
    });
  });

  it("buildAssistantMessage returns text-only segments and thinking in processContent", () => {
    const dispatcher = new A2AQueryDispatcher(makePublisher());
    dispatcher.onTextDelta("Hello ");
    dispatcher.onToolCall("ToolSearch");
    dispatcher.onToolInput('{"query":"foo"}');
    dispatcher.onThinking("inner reasoning");
    dispatcher.onTextDelta("World");

    const msg = dispatcher.buildAssistantMessage();

    expect(typeof msg.id).toBe("string");
    expect(msg.role).toBe("assistant");
    expect(msg.segments.every((s) => s.type === "text")).toBe(true);
    expect(msg.segments.map((s) => (s as { type: "text"; content: string }).content)).toEqual([
      "Hello ",
      "World",
    ]);
    expect(msg.processContent).toBe("inner reasoning");
  });

  it("buildProgress returns tool call entries for workflow display", () => {
    const dispatcher = new A2AQueryDispatcher(makePublisher());
    dispatcher.onToolCall("Read");
    dispatcher.onToolCall("Bash");

    const progress = dispatcher.buildProgress();

    expect(progress).toHaveLength(2);
    expect(progress[0].message).toBe("Read");
    expect(progress[1].message).toBe("Bash");
  });

  describe("relay via emit", () => {
    beforeEach(() => {
      vi.mocked(relaySessionEvent).mockClear();
    });

    it("onTextDelta relays text event to sessionId when provided", () => {
      const dispatcher = new A2AQueryDispatcher(makePublisher(), "ctx-1");
      dispatcher.onTextDelta("hello");
      expect(relaySessionEvent).toHaveBeenCalledWith("ctx-1", { type: "text", content: "hello" });
    });

    it("onTextDelta does not relay when sessionId is absent", () => {
      const dispatcher = new A2AQueryDispatcher(makePublisher());
      dispatcher.onTextDelta("hello");
      expect(relaySessionEvent).not.toHaveBeenCalled();
    });

    it("onTextDelta relays group_member event with accumulated text when groupRelay set", () => {
      const dispatcher = new A2AQueryDispatcher(makePublisher(), undefined, {
        groupContextId: "grp-1",
        agentName: "agent-a",
      });
      dispatcher.onTextDelta("foo");
      dispatcher.onTextDelta(" bar");
      expect(relaySessionEvent).toHaveBeenLastCalledWith("grp-1", {
        type: "group_member",
        agentId: "agent-a",
        text: "foo bar",
        done: false,
      });
    });

    it("group relay accumulates across multiple onTextDelta calls", () => {
      const dispatcher = new A2AQueryDispatcher(makePublisher(), undefined, {
        groupContextId: "grp-1",
        agentName: "agent-a",
      });
      dispatcher.onTextDelta("a");
      dispatcher.onTextDelta("b");
      dispatcher.onTextDelta("c");
      const calls = vi.mocked(relaySessionEvent).mock.calls.filter(([sid]) => sid === "grp-1");
      expect(calls[0][1]).toMatchObject({ text: "a" });
      expect(calls[1][1]).toMatchObject({ text: "ab" });
      expect(calls[2][1]).toMatchObject({ text: "abc" });
    });

    it("onToolInput does not emit isSender — sender bubble is emitted by the tool handler after hook passes", () => {
      const dispatcher = new A2AQueryDispatcher(makePublisher(), undefined, {
        groupContextId: "grp-1",
        agentName: "agent-a",
      });
      dispatcher.onToolCall("start_chat_to_agent_b");
      dispatcher.onToolInput(JSON.stringify({ instruction: "Morgan, I need you to review X." }));
      const groupCalls = vi.mocked(relaySessionEvent).mock.calls.filter(([sid]) => sid === "grp-1");
      const senderCall = groupCalls.find(
        ([, e]) => (e as { isSender?: boolean }).isSender === true,
      );
      expect(senderCall).toBeUndefined();
    });

    it("suppresses group relay after a handoff tool call", () => {
      const dispatcher = new A2AQueryDispatcher(makePublisher(), undefined, {
        groupContextId: "grp-1",
        agentName: "agent-a",
      });
      dispatcher.onTextDelta("deliverable");
      dispatcher.onToolCall("start_chat_to_alex");
      dispatcher.onTextDelta("justification reasoning — should not reach pool");
      const groupCalls = vi.mocked(relaySessionEvent).mock.calls.filter(([sid]) => sid === "grp-1");
      // Only the pre-handoff text should have been relayed
      expect(
        groupCalls.every(
          ([, e]) =>
            (e as { text?: string }).text !==
            "deliverable\njustification reasoning — should not reach pool",
        ),
      ).toBe(true);
      const lastGroupCall = groupCalls.at(-1);
      expect(lastGroupCall).toBeDefined();
      expect((lastGroupCall![1] as { text: string }).text).toBe("deliverable");
    });

    it("sessionId relay and groupRelay fire independently when both set", () => {
      const dispatcher = new A2AQueryDispatcher(makePublisher(), "ctx-1", {
        groupContextId: "grp-1",
        agentName: "agent-a",
      });
      dispatcher.onTextDelta("x");
      const calls = vi.mocked(relaySessionEvent).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls.some(([sid]) => sid === "ctx-1")).toBe(true);
      expect(calls.some(([sid]) => sid === "grp-1")).toBe(true);
    });
  });
});
