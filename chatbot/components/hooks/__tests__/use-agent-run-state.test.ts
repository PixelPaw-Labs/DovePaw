import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { useAgentRunState } from "../use-agent-run-state";
import { ConversationProvider } from "../use-conversation-context";
import type { AgentStatus } from "@/a2a/heartbeat-types";

function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    online: true,
    latency: null,
    processing: false,
    processingTrigger: null,
    scheduler: null,
    ...overrides,
  };
}

function wrapper(isLoading: boolean, activeAgentId: string) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(ConversationProvider, {
      isLoading,
      activeAgentId,
      doveIsRunning: false,
      children,
    });
}

describe("useAgentRunState — without ConversationProvider", () => {
  it("isRunning=false when no provider and no heartbeat", () => {
    const { result } = renderHook(() => useAgentRunState(false, makeStatus()));
    expect(result.current.isRunning).toBe(false);
    expect(result.current.processingTrigger).toBeNull();
  });

  it("isRunning=true for scheduled run even when no provider", () => {
    const { result } = renderHook(() =>
      useAgentRunState(false, makeStatus({ processing: true, processingTrigger: "scheduled" })),
    );
    expect(result.current.isRunning).toBe(true);
    expect(result.current.processingTrigger).toBe("scheduled");
  });
});

describe("useAgentRunState", () => {
  it("isRunning=false when idle and no heartbeat", () => {
    const { result } = renderHook(() => useAgentRunState(true, makeStatus()), {
      wrapper: wrapper(false, "memory-dream"),
    });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.processingTrigger).toBeNull();
  });

  it("isRunning=true when isLoading and isActive", () => {
    const { result } = renderHook(() => useAgentRunState(true, makeStatus()), {
      wrapper: wrapper(true, "memory-dream"),
    });
    expect(result.current.isRunning).toBe(true);
    expect(result.current.processingTrigger).toBe("dove");
  });

  it("isRunning=false when isLoading but not active agent", () => {
    const { result } = renderHook(() => useAgentRunState(false, makeStatus()), {
      wrapper: wrapper(true, "memory-dream"),
    });
    expect(result.current.isRunning).toBe(false);
  });

  it("isRunning=true for scheduled daemon run regardless of isLoading", () => {
    const { result } = renderHook(
      () =>
        useAgentRunState(false, makeStatus({ processing: true, processingTrigger: "scheduled" })),
      { wrapper: wrapper(false, "memory-dream") },
    );
    expect(result.current.isRunning).toBe(true);
    expect(result.current.processingTrigger).toBe("scheduled");
  });

  it("chat signal takes priority over heartbeat dove trigger to prevent lag", () => {
    // isLoading=false (chat done) but heartbeat still reports processing=true/dove
    const { result } = renderHook(
      () => useAgentRunState(true, makeStatus({ processing: true, processingTrigger: "dove" })),
      { wrapper: wrapper(false, "memory-dream") },
    );
    // isActive=true but isLoading=false → isDoveChatRunning=false
    // processing=true/dove but selected → heartbeat dove filtered to prevent post-session lag
    expect(result.current.isRunning).toBe(false);
  });

  it("isRunning=true for unselected agent while dove job is running (switched away)", () => {
    // User switched to another agent; the original agent's A2A job is still running.
    // isActive=false so isDoveChatRunning=false, but heartbeat reports processing=dove.
    // Unselected agents trust any heartbeat trigger.
    const { result } = renderHook(
      () => useAgentRunState(false, makeStatus({ processing: true, processingTrigger: "dove" })),
      { wrapper: wrapper(false, "memory-dream") },
    );
    expect(result.current.isRunning).toBe(true);
    expect(result.current.processingTrigger).toBe("dove");
  });
});
