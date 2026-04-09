import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { useConversationContext, ConversationProvider } from "../use-conversation-context";

describe("useConversationContext", () => {
  it("returns fallback defaults when used outside ConversationProvider", () => {
    const { result } = renderHook(() => useConversationContext());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.activeAgentId).toBe("");
  });

  it("returns provider values when inside ConversationProvider", () => {
    const { result } = renderHook(() => useConversationContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        React.createElement(ConversationProvider, {
          isLoading: true,
          activeAgentId: "dove",
          doveIsRunning: false,
          children,
        }),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.activeAgentId).toBe("dove");
  });
});
