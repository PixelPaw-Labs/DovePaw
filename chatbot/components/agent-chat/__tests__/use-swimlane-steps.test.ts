import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSwimlaneSteps } from "../group-swimlane/use-swimlane-steps";
import type { ChatMessage } from "@/components/hooks/use-messages";

const text = (content: string): ChatMessage["segments"] => [{ type: "text", content }];

describe("useSwimlaneSteps", () => {
  it("returns empty lanes for empty messages", () => {
    const { result } = renderHook(() => useSwimlaneSteps([], ["alpha", "beta"]));
    expect(result.current.lanes).toHaveLength(2);
    expect(result.current.lanes.every((l) => l.steps.length === 0)).toBe(true);
    expect(result.current.handoffs).toHaveLength(0);
    expect(result.current.narratorPills).toHaveLength(0);
  });

  it("groups messages into per-agent lanes", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", segments: text("a1"), agentId: "alpha" },
      { id: "2", role: "assistant", segments: text("b1"), agentId: "beta" },
      { id: "3", role: "assistant", segments: text("a2"), agentId: "alpha" },
    ];
    const { result } = renderHook(() => useSwimlaneSteps(messages, ["alpha", "beta"]));
    const alpha = result.current.lanes.find((l) => l.agentId === "alpha")!;
    const beta = result.current.lanes.find((l) => l.agentId === "beta")!;
    expect(alpha.steps.map((s) => s.id)).toEqual(["1", "3"]);
    expect(beta.steps.map((s) => s.id)).toEqual(["2"]);
  });

  it("filters Dove out of lanes", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", segments: text("dove reasoning"), agentId: "dove" },
      { id: "2", role: "assistant", segments: text("alpha response"), agentId: "alpha" },
    ];
    const { result } = renderHook(() => useSwimlaneSteps(messages, ["dove", "alpha"]));
    expect(result.current.lanes.map((l) => l.agentId)).toEqual(["alpha"]);
  });

  it("captures dove sender bubbles as narrator pills", () => {
    const messages: ChatMessage[] = [
      {
        id: "h1",
        role: "user",
        segments: text("Go investigate the build"),
        agentId: "dove",
        senderAgentId: "dove",
      },
      { id: "a1", role: "assistant", segments: text("on it"), agentId: "alpha" },
    ];
    const { result } = renderHook(() => useSwimlaneSteps(messages, ["dove", "alpha"]));
    expect(result.current.narratorPills).toHaveLength(1);
    expect(result.current.narratorPills[0]).toMatchObject({
      id: "h1",
      targetAgent: "alpha",
    });
  });

  it("emits a handoff between consecutive cross-agent messages", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", segments: text("alpha"), agentId: "alpha" },
      { id: "2", role: "assistant", segments: text("beta"), agentId: "beta" },
    ];
    const { result } = renderHook(() => useSwimlaneSteps(messages, ["alpha", "beta"]));
    expect(result.current.handoffs).toHaveLength(1);
    expect(result.current.handoffs[0]).toMatchObject({
      fromAgent: "alpha",
      toAgent: "beta",
      fromStepId: "1",
      toStepId: "2",
    });
  });

  it("treats isLoading messages as running status and tracks active agents", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", segments: text("…"), agentId: "alpha", isLoading: true },
    ];
    const { result } = renderHook(() => useSwimlaneSteps(messages, ["alpha"]));
    expect(result.current.lanes[0].steps[0].status).toBe("running");
    expect(result.current.lanes[0].isActive).toBe(true);
    expect(result.current.activeAgentIds.has("alpha")).toBe(true);
  });

  it("treats ⚠️-prefixed messages as error status", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", segments: text("⚠️ failed"), agentId: "alpha" },
    ];
    const { result } = renderHook(() => useSwimlaneSteps(messages, ["alpha"]));
    expect(result.current.lanes[0].steps[0].status).toBe("error");
  });

  it("preserves member order from memberAgentIds", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", segments: text("b"), agentId: "beta" },
      { id: "2", role: "assistant", segments: text("a"), agentId: "alpha" },
    ];
    const { result } = renderHook(() => useSwimlaneSteps(messages, ["alpha", "beta"]));
    expect(result.current.lanes.map((l) => l.agentId)).toEqual(["alpha", "beta"]);
  });
});
