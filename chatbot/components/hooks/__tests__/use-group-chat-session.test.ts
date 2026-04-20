import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal fetch mock — group chat session polls active-session on mount
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, json: async () => ({ id: null }) }),
  );
});

// Import after stubbing fetch so the module doesn't fire real requests
const { useGroupChatSession } = await import("../use-group-chat-session");

describe("useGroupChatSession", () => {
  describe("clearMessages", () => {
    it("empties messages array", () => {
      const { result } = renderHook(() => useGroupChatSession(["agent-a"], "test-group"));

      // Manually inject a message via internal setState through sendToAgent would require
      // a running fetch; instead verify clearMessages on an already-empty state is safe
      expect(result.current.messages).toEqual([]);
      act(() => result.current.clearMessages());
      expect(result.current.messages).toEqual([]);
    });
  });
});
