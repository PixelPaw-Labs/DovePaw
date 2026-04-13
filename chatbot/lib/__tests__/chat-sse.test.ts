import { describe, it, expect, vi } from "vitest";
import { makeProgressSender } from "@/lib/chat-sse";
import { noAgentOutput, type StreamedResult } from "@/lib/a2a-client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(
  entries: { message: string; artifacts?: Record<string, string> }[],
): StreamedResult {
  const progress = entries.map((e) => ({ message: e.message, artifacts: e.artifacts ?? {} }));
  const output =
    progress
      .flatMap((e) => Object.values(e.artifacts))
      .join("\n")
      .trim() || noAgentOutput();
  return { output, progress };
}

// ─── makeProgressSender ───────────────────────────────────────────────────────

describe("makeProgressSender", () => {
  it("sends the first entry on initial snapshot", () => {
    const send = vi.fn();
    const onSnapshot = makeProgressSender(send);

    const result = makeResult([{ message: "step 1" }]);
    onSnapshot(result);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "progress",
      result: { output: result.output, progress: [result.progress[0]] },
    });
  });

  it("does not send when snapshot is identical to the last sent", () => {
    const send = vi.fn();
    const onSnapshot = makeProgressSender(send);

    const result = makeResult([{ message: "step 1" }]);
    onSnapshot(result);
    send.mockClear();
    onSnapshot(result);

    expect(send).not.toHaveBeenCalled();
  });

  it("sends only new entries when progress grows", () => {
    const send = vi.fn();
    const onSnapshot = makeProgressSender(send);

    onSnapshot(makeResult([{ message: "step 1" }]));
    send.mockClear();

    const result2 = makeResult([{ message: "step 1" }, { message: "step 2" }]);
    onSnapshot(result2);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "progress",
      result: { output: result2.output, progress: [result2.progress[1]] },
    });
  });

  it("re-sends last entry when its artifact count increases without new messages", () => {
    const send = vi.fn();
    const onSnapshot = makeProgressSender(send);

    onSnapshot(makeResult([{ message: "step 1" }]));
    send.mockClear();

    const result2 = makeResult([{ message: "step 1", artifacts: { "tool-call": "bash" } }]);
    onSnapshot(result2);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "progress",
      result: { output: result2.output, progress: [result2.progress[0]] },
    });
  });

  it("does not send when artifact count is unchanged", () => {
    const send = vi.fn();
    const onSnapshot = makeProgressSender(send);

    const result = makeResult([{ message: "step 1", artifacts: { "tool-call": "bash" } }]);
    onSnapshot(result);
    send.mockClear();
    onSnapshot(result);

    expect(send).not.toHaveBeenCalled();
  });

  it("each sender instance tracks its own state independently", () => {
    const send1 = vi.fn();
    const send2 = vi.fn();
    const onSnapshot1 = makeProgressSender(send1);
    const onSnapshot2 = makeProgressSender(send2);

    const r1 = makeResult([{ message: "a" }]);
    const r2 = makeResult([{ message: "a" }, { message: "b" }]);

    onSnapshot1(r1);
    onSnapshot1(r2); // sends "b" delta
    onSnapshot2(r2); // sends both "a" and "b" as new entries

    expect(send1).toHaveBeenCalledTimes(2);
    expect(send2).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledWith({
      type: "progress",
      result: { output: r2.output, progress: r2.progress },
    });
  });
});
