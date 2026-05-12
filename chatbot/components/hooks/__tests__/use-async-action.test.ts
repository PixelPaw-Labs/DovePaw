import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAsyncAction } from "../use-async-action";

describe("useAsyncAction", () => {
  it("toggles pending true while the action is in-flight and false after it resolves", async () => {
    let resolveFn!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFn = resolve;
        }),
    );
    const { result } = renderHook(() => useAsyncAction(action));

    expect(result.current.pending).toBe(false);
    let triggerPromise!: Promise<void>;
    act(() => {
      triggerPromise = result.current.trigger();
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolveFn();
      await triggerPromise;
    });
    expect(result.current.pending).toBe(false);
  });

  it("ignores concurrent triggers while pending", async () => {
    let resolveFn!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFn = resolve;
        }),
    );
    const { result } = renderHook(() => useAsyncAction(action));

    act(() => {
      void result.current.trigger();
      void result.current.trigger();
      void result.current.trigger();
    });
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFn();
    });
  });

  it("resets pending to false even when the action rejects", async () => {
    const action = vi.fn(() => Promise.reject(new Error("boom")));
    const { result } = renderHook(() => useAsyncAction(action));

    await act(async () => {
      await result.current.trigger().catch(() => {});
    });
    expect(result.current.pending).toBe(false);
  });
});
