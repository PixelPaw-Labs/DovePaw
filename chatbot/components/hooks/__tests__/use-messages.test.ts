import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useMessages, messageText } from "../use-messages";
import type { ChatMessage } from "../use-messages";

const msg = (overrides: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  role: "user",
  segments: [{ type: "text", content: "" }],
  ...overrides,
});

const textMsg = (id: string, content: string): ChatMessage =>
  msg({ id, segments: [{ type: "text", content }] });

describe("useMessages", () => {
  it("starts with empty messages", () => {
    const { result } = renderHook(() => useMessages());
    expect(result.current.messages).toEqual([]);
  });

  describe("append", () => {
    it("adds messages in order", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a" }), msg({ id: "b" })));
      expect(result.current.messages.map((m) => m.id)).toEqual(["a", "b"]);
    });

    it("accumulates across calls", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a" })));
      act(() => result.current.append(msg({ id: "b" })));
      expect(result.current.messages).toHaveLength(2);
    });
  });

  describe("patch", () => {
    it("updates only the targeted message", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(textMsg("a", "old"), textMsg("b", "untouched")));
      act(() => result.current.patch("a", { isLoading: true }));
      expect(result.current.messages.find((m) => m.id === "a")?.isLoading).toBe(true);
      expect(result.current.messages.find((m) => m.id === "b")?.isLoading).toBeUndefined();
    });

    it("merges partial updates without removing other fields", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a", isLoading: true })));
      act(() => result.current.patch("a", { isLoading: false }));
      const m = result.current.messages[0];
      expect(m.isLoading).toBe(false);
      expect(m.segments).toBeDefined();
    });

    it("is a no-op for unknown id", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(textMsg("a", "x")));
      act(() => result.current.patch("unknown", { isLoading: true }));
      expect(result.current.messages[0].isLoading).toBeUndefined();
    });
  });

  describe("setLastTextContent", () => {
    it("updates the last text segment's content", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(textMsg("a", "")));
      act(() => result.current.setLastTextContent("a", "hello"));
      expect(messageText(result.current.messages[0])).toBe("hello");
    });

    it("updates only the last text segment when multiple exist", () => {
      const { result } = renderHook(() => useMessages());
      act(() =>
        result.current.append(
          msg({
            id: "a",
            segments: [
              { type: "text", content: "first" },
              { type: "tool_call", tool: { name: "Read", input: {} } },
              { type: "text", content: "" },
            ],
          }),
        ),
      );
      act(() => result.current.setLastTextContent("a", "second"));
      const segs = result.current.messages[0].segments;
      expect(segs[0]).toMatchObject({ type: "text", content: "first" });
      expect(segs[2]).toMatchObject({ type: "text", content: "second" });
    });

    it("adds a text segment if none exists", () => {
      const { result } = renderHook(() => useMessages());
      act(() =>
        result.current.append(
          msg({ id: "a", segments: [{ type: "tool_call", tool: { name: "X", input: {} } }] }),
        ),
      );
      act(() => result.current.setLastTextContent("a", "new"));
      expect(messageText(result.current.messages[0])).toBe("new");
    });
  });

  describe("appendToolCallSegment", () => {
    it("adds a tool_call segment and a new empty text segment", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(textMsg("a", "before")));
      act(() =>
        result.current.appendToolCallSegment("a", { name: "Edit", input: { file_path: "/f.ts" } }),
      );
      const segs = result.current.messages[0].segments;
      expect(segs).toHaveLength(3);
      expect(segs[1]).toMatchObject({ type: "tool_call", tool: { name: "Edit" } });
      expect(segs[2]).toMatchObject({ type: "text", content: "" });
    });
  });

  describe("setLiveProgress", () => {
    it("sets liveProgress on the targeted message", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(textMsg("a", "hi"), textMsg("b", "other")));
      act(() => result.current.setLiveProgress("a", "Bash"));
      expect(result.current.messages.find((m) => m.id === "a")?.liveProgress).toBe("Bash");
      expect(result.current.messages.find((m) => m.id === "b")?.liveProgress).toBeUndefined();
    });

    it("clears liveProgress when set to null", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(textMsg("a", "hi")));
      act(() => result.current.setLiveProgress("a", "Bash"));
      act(() => result.current.setLiveProgress("a", null));
      expect(result.current.messages[0].liveProgress).toBeNull();
    });
  });

  describe("patchWhere", () => {
    it("applies update when predicate is true", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a", isLoading: true })));
      act(() =>
        result.current.patchWhere(
          "a",
          (m) => !!m.isLoading,
          () => ({ isLoading: false }),
        ),
      );
      expect(result.current.messages[0].isLoading).toBe(false);
    });

    it("skips update when predicate is false", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a", isLoading: false })));
      act(() =>
        result.current.patchWhere(
          "a",
          (m) => !!m.isLoading,
          () => ({ isProcessStreaming: true }),
        ),
      );
      expect(result.current.messages[0].isProcessStreaming).toBeUndefined();
    });

    it("receives the current message in the update factory", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a", isLoading: true })));
      act(() =>
        result.current.patchWhere(
          "a",
          () => true,
          (m) => ({ isLoading: !m.isLoading }),
        ),
      );
      expect(result.current.messages[0].isLoading).toBe(false);
    });
  });

  describe("find", () => {
    it("returns the matching message", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(textMsg("a", "hello")));
      expect(messageText(result.current.find("a")!)).toBe("hello");
    });

    it("returns undefined for unknown id", () => {
      const { result } = renderHook(() => useMessages());
      expect(result.current.find("missing")).toBeUndefined();
    });
  });

  describe("appendToProcess", () => {
    it("creates processContent on first call", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a" })));
      act(() => result.current.appendToProcess("a", "hello"));
      expect(result.current.messages[0].processContent).toBe("hello");
      expect(result.current.messages[0].isProcessStreaming).toBe(true);
    });

    it("accumulates multiple deltas atomically", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a" })));
      act(() => result.current.appendToProcess("a", "foo"));
      act(() => result.current.appendToProcess("a", "bar"));
      expect(result.current.messages[0].processContent).toBe("foobar");
    });

    it("does not affect other messages", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a" }), msg({ id: "b" })));
      act(() => result.current.appendToProcess("a", "x"));
      expect(result.current.messages[1].processContent).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("removes all messages", () => {
      const { result } = renderHook(() => useMessages());
      act(() => result.current.append(msg({ id: "a" }), msg({ id: "b" })));
      act(() => result.current.clear());
      expect(result.current.messages).toEqual([]);
    });
  });

  describe("messageText", () => {
    it("joins all text segments", () => {
      const m = msg({
        id: "x",
        segments: [
          { type: "text", content: "hello" },
          { type: "tool_call", tool: { name: "X", input: {} } },
          { type: "text", content: " world" },
        ],
      });
      expect(messageText(m)).toBe("hello world");
    });
  });
});
