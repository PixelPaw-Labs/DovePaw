import { describe, expect, it, vi } from "vitest";
import { SseQueryDispatcher, A2AQueryDispatcher, ARTIFACT } from "../query-dispatcher";
import type { ExecutorPublisher } from "@/a2a/lib/executor-publisher";

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
        progress: [{ message: "Bash", artifacts: { [ARTIFACT.TOOL_CALL]: "Bash" } }],
      },
    });
  });

  it("onToolInput sends tool_input event", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onToolInput('{"cmd":"ls"}');
    expect(send).toHaveBeenCalledWith({ type: "tool_input", content: '{"cmd":"ls"}' });
  });

  it("onResult sends result event for non-empty string", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onResult("done");
    expect(send).toHaveBeenCalledWith({ type: "result", content: "done" });
  });

  it("onResult does not send for empty string", () => {
    const send = makeSend();
    new SseQueryDispatcher(send).onResult("");
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
          progress: [{ message: "Read", artifacts: { [ARTIFACT.TOOL_CALL]: "Read" } }],
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

  it("onToolCall publishes status with tool-call artifact", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onToolCall("Bash");
    expect(pub.publishStatusToUI).toHaveBeenCalledWith("Bash", { [ARTIFACT.TOOL_CALL]: "Bash" });
  });

  it("onToolInput publishes tool-input artifact (no workflow node)", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onToolInput('{"cmd":"ls"}');
    expect(pub.send).toHaveBeenCalledWith('{"cmd":"ls"}', ARTIFACT.TOOL_INPUT);
    expect(pub.publishStatusToUI).not.toHaveBeenCalled();
  });

  it("onResult publishes final-output artifact (no workflow node)", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onResult("task complete");
    expect(pub.send).toHaveBeenCalledWith("task complete", ARTIFACT.FINAL_OUTPUT);
    expect(pub.publishStatusToUI).not.toHaveBeenCalled();
  });

  it("onResult skips empty string", () => {
    const pub = makePublisher();
    new A2AQueryDispatcher(pub).onResult("");
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
});
