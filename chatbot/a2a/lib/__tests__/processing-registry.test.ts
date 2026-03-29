import { afterEach, describe, expect, it } from "vitest";
import {
  cancelProcessing,
  getProcessingTrigger,
  isProcessing,
  markIdle,
  markProcessing,
} from "../processing-registry";

afterEach(() => {
  markIdle("agent-a");
  markIdle("agent-b");
});

describe("markProcessing / isProcessing", () => {
  it("marks an agent as processing", () => {
    markProcessing("agent-a", new AbortController(), "dove");
    expect(isProcessing("agent-a")).toBe(true);
  });

  it("does not affect other agents", () => {
    markProcessing("agent-a", new AbortController(), "scheduled");
    expect(isProcessing("agent-b")).toBe(false);
  });

  it("returns false for an agent that was never marked", () => {
    expect(isProcessing("agent-a")).toBe(false);
  });
});

describe("getProcessingTrigger", () => {
  it("returns the trigger passed to markProcessing (dove)", () => {
    markProcessing("agent-a", new AbortController(), "dove");
    expect(getProcessingTrigger("agent-a")).toBe("dove");
  });

  it("returns the trigger passed to markProcessing (scheduled)", () => {
    markProcessing("agent-a", new AbortController(), "scheduled");
    expect(getProcessingTrigger("agent-a")).toBe("scheduled");
  });

  it("returns null for an agent that is not processing", () => {
    expect(getProcessingTrigger("agent-a")).toBeNull();
  });
});

describe("markIdle", () => {
  it("removes the agent from the active set", () => {
    markProcessing("agent-a", new AbortController(), "dove");
    markIdle("agent-a");
    expect(isProcessing("agent-a")).toBe(false);
  });

  it("clears the trigger", () => {
    markProcessing("agent-a", new AbortController(), "dove");
    markIdle("agent-a");
    expect(getProcessingTrigger("agent-a")).toBeNull();
  });

  it("does not throw when called for an agent that is not processing", () => {
    expect(() => markIdle("agent-a")).not.toThrow();
  });
});

describe("cancelProcessing", () => {
  it("aborts the controller registered for the agent", () => {
    const controller = new AbortController();
    markProcessing("agent-a", controller, "dove");
    cancelProcessing("agent-a");
    expect(controller.signal.aborted).toBe(true);
  });

  it("does not abort other agents' controllers", () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    markProcessing("agent-a", controllerA, "dove");
    markProcessing("agent-b", controllerB, "scheduled");
    cancelProcessing("agent-a");
    expect(controllerB.signal.aborted).toBe(false);
  });

  it("is a no-op when the agent is not processing", () => {
    expect(() => cancelProcessing("agent-a")).not.toThrow();
  });
});
