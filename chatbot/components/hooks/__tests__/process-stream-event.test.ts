import { describe, expect, it, vi } from "vitest";
import { processActiveStreamEvent } from "../process-stream-event";
import type { StreamEventContext } from "../process-stream-event";
import type { ChatSsePermission, ChatSseQuestion } from "@/lib/chat-sse";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<StreamEventContext>): StreamEventContext {
  return {
    updateActiveMessages: vi.fn(),
    animation: {
      enqueue: vi.fn(),
      cut: vi.fn(),
      flush: vi.fn(),
      reset: vi.fn(),
    } as unknown as StreamEventContext["animation"],
    pendingToolNameRef: { current: null },
    setPendingPermissions: vi.fn(),
    setPendingQuestions: vi.fn(),
    ...overrides,
  };
}

const sampleQuestion: ChatSseQuestion = {
  type: "question",
  requestId: "req-q-1",
  questions: [
    {
      question: "Which approach?",
      header: "Approach",
      options: [{ label: "Fast", description: "Quick" }],
      multiSelect: false,
    },
  ],
};

const samplePermission: ChatSsePermission = {
  type: "permission",
  requestId: "req-p-1",
  toolName: "Bash",
  toolInput: { command: "ls" },
};

// ─── question event ───────────────────────────────────────────────────────────

describe("processActiveStreamEvent — question", () => {
  it("calls setPendingQuestions with the new question appended", () => {
    const ctx = makeCtx();
    processActiveStreamEvent(sampleQuestion, "a1", ctx);

    expect(ctx.setPendingQuestions).toHaveBeenCalledOnce();
    // The updater fn should append the event
    const updater = vi.mocked(ctx.setPendingQuestions).mock.calls[0]![0] as (
      prev: ChatSseQuestion[],
    ) => ChatSseQuestion[];
    expect(updater([])).toEqual([sampleQuestion]);
    expect(updater([sampleQuestion])).toEqual([sampleQuestion, sampleQuestion]);
  });

  it("does not touch messages or permissions", () => {
    const ctx = makeCtx();
    processActiveStreamEvent(sampleQuestion, "a1", ctx);
    expect(ctx.updateActiveMessages).not.toHaveBeenCalled();
    expect(ctx.setPendingPermissions).not.toHaveBeenCalled();
  });
});

// ─── permission event ─────────────────────────────────────────────────────────

describe("processActiveStreamEvent — permission", () => {
  it("calls setPendingPermissions with the new permission appended", () => {
    const ctx = makeCtx();
    processActiveStreamEvent(samplePermission, "a1", ctx);

    expect(ctx.setPendingPermissions).toHaveBeenCalledOnce();
    const updater = vi.mocked(ctx.setPendingPermissions).mock.calls[0]![0] as (
      prev: ChatSsePermission[],
    ) => ChatSsePermission[];
    expect(updater([])).toEqual([samplePermission]);
  });

  it("does not touch questions", () => {
    const ctx = makeCtx();
    processActiveStreamEvent(samplePermission, "a1", ctx);
    expect(ctx.setPendingQuestions).not.toHaveBeenCalled();
  });
});

// ─── cancelled event ──────────────────────────────────────────────────────────

describe("processActiveStreamEvent — cancelled", () => {
  it("clears both pendingPermissions and pendingQuestions", () => {
    const ctx = makeCtx();
    processActiveStreamEvent({ type: "cancelled" }, "a1", ctx);

    // Both setters should be called with [] (not an updater fn)
    expect(ctx.setPendingPermissions).toHaveBeenCalledWith([]);
    expect(ctx.setPendingQuestions).toHaveBeenCalledWith([]);
  });

  it("flushes animation and marks message as cancelled", () => {
    const ctx = makeCtx();
    processActiveStreamEvent({ type: "cancelled" }, "a1", ctx);
    expect(ctx.animation.flush).toHaveBeenCalledWith("a1");
    expect(ctx.updateActiveMessages).toHaveBeenCalled();
  });
});
