import { afterEach, describe, expect, it } from "vitest";
import {
  cancelProcessing,
  getProcessingTrigger,
  isProcessing,
  markIdle,
  markProcessing,
} from "../processing-registry";

afterEach(() => {
  markIdle("agent-a", "task-a");
  markIdle("agent-a", "task-a2");
  markIdle("agent-b", "task-b");
});

describe("markProcessing / isProcessing", () => {
  it("marks an agent as processing", () => {
    markProcessing("agent-a", "task-a", new AbortController(), "dove");
    expect(isProcessing("agent-a")).toBe(true);
  });

  it("does not affect other agents", () => {
    markProcessing("agent-a", "task-a", new AbortController(), "scheduled");
    expect(isProcessing("agent-b")).toBe(false);
  });

  it("returns false for an agent that was never marked", () => {
    expect(isProcessing("agent-a")).toBe(false);
  });
});

describe("getProcessingTrigger", () => {
  it("returns the trigger passed to markProcessing (dove)", () => {
    markProcessing("agent-a", "task-a", new AbortController(), "dove");
    expect(getProcessingTrigger("agent-a")).toBe("dove");
  });

  it("returns the trigger passed to markProcessing (scheduled)", () => {
    markProcessing("agent-a", "task-a", new AbortController(), "scheduled");
    expect(getProcessingTrigger("agent-a")).toBe("scheduled");
  });

  it("returns null for an agent that is not processing", () => {
    expect(getProcessingTrigger("agent-a")).toBeNull();
  });
});

describe("markIdle", () => {
  it("removes the agent from the active set", () => {
    markProcessing("agent-a", "task-a", new AbortController(), "dove");
    markIdle("agent-a", "task-a");
    expect(isProcessing("agent-a")).toBe(false);
  });

  it("clears the trigger", () => {
    markProcessing("agent-a", "task-a", new AbortController(), "dove");
    markIdle("agent-a", "task-a");
    expect(getProcessingTrigger("agent-a")).toBeNull();
  });

  it("does not throw when called for an agent that is not processing", () => {
    expect(() => markIdle("agent-a", "task-a")).not.toThrow();
  });

  it("keeps agent processing when one of two concurrent tasks finishes", () => {
    markProcessing("agent-a", "task-a", new AbortController(), "dove");
    markProcessing("agent-a", "task-a2", new AbortController(), "dove");
    markIdle("agent-a", "task-a");
    expect(isProcessing("agent-a")).toBe(true);
    markIdle("agent-a", "task-a2");
    expect(isProcessing("agent-a")).toBe(false);
  });
});

describe("cancelProcessing", () => {
  it("aborts the controller registered for the agent", () => {
    const controller = new AbortController();
    markProcessing("agent-a", "task-a", controller, "dove");
    cancelProcessing("agent-a");
    expect(controller.signal.aborted).toBe(true);
  });

  it("does not abort other agents' controllers", () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    markProcessing("agent-a", "task-a", controllerA, "dove");
    markProcessing("agent-b", "task-b", controllerB, "scheduled");
    cancelProcessing("agent-a");
    expect(controllerB.signal.aborted).toBe(false);
  });

  it("aborts all concurrent tasks for the same agent", () => {
    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();
    markProcessing("agent-a", "task-a", ctrl1, "dove");
    markProcessing("agent-a", "task-a2", ctrl2, "dove");
    cancelProcessing("agent-a");
    expect(ctrl1.signal.aborted).toBe(true);
    expect(ctrl2.signal.aborted).toBe(true);
  });

  it("is a no-op when the agent is not processing", () => {
    expect(() => cancelProcessing("agent-a")).not.toThrow();
  });
});
