import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCollapsedSet } from "../use-collapsed-set";

describe("useCollapsedSet", () => {
  it("starts with all keys expanded by default", () => {
    const { result } = renderHook(() => useCollapsedSet());
    expect(result.current.isCollapsed("alice")).toBe(false);
    expect(result.current.isCollapsed("bob")).toBe(false);
  });

  it("toggle flips a key from expanded to collapsed", () => {
    const { result } = renderHook(() => useCollapsedSet());
    act(() => result.current.toggle("alice"));
    expect(result.current.isCollapsed("alice")).toBe(true);
    expect(result.current.isCollapsed("bob")).toBe(false);
    act(() => result.current.toggle("alice"));
    expect(result.current.isCollapsed("alice")).toBe(false);
  });

  it("respects an initial collapsed list", () => {
    const { result } = renderHook(() => useCollapsedSet(["bob"]));
    expect(result.current.isCollapsed("bob")).toBe(true);
    expect(result.current.isCollapsed("alice")).toBe(false);
  });
});
