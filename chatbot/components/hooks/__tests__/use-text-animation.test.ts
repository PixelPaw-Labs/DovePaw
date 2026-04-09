import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTextAnimation } from "../use-text-animation";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useTextAnimation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts with no pending or displayed content", () => {
    const onUpdate = vi.fn();
    renderHook(() => useTextAnimation(onUpdate));
    vi.advanceTimersByTime(100);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("enqueue starts the interval timer and drains one char per tick for short queues", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.enqueue("msg-1", "abc");
    });

    // After one 16ms tick, 1 char is drained (queue=3, under 40 threshold → 1 char/tick)
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onUpdate).toHaveBeenCalledWith("msg-1", "a");

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onUpdate).toHaveBeenCalledWith("msg-1", "ab");

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onUpdate).toHaveBeenCalledWith("msg-1", "abc");
  });

  it("drains 4 chars per tick when queue length is between 40 and 150", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    // 50 chars puts queue above the 40 threshold
    const text = "x".repeat(50);
    act(() => {
      result.current.enqueue("msg-1", text);
    });

    act(() => {
      vi.advanceTimersByTime(16);
    });

    // First call should have drained 4 chars
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][1]).toBe("xxxx");
  });

  it("drains 8 chars per tick when queue length is between 150 and 400", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    // 200 chars puts queue above the 150 threshold
    const text = "y".repeat(200);
    act(() => {
      result.current.enqueue("msg-1", text);
    });

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][1]).toBe("y".repeat(8));
  });

  it("drains 20 chars per tick when queue length exceeds 400", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    // 500 chars puts queue above the 400 threshold
    const text = "z".repeat(500);
    act(() => {
      result.current.enqueue("msg-1", text);
    });

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][1]).toBe("z".repeat(20));
  });

  it("accumulates content across multiple enqueue calls", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.enqueue("msg-1", "Hello");
      result.current.enqueue("msg-1", " world");
    });

    // Drain all chars (11 chars total, 1 per tick = 11 ticks)
    act(() => {
      vi.advanceTimersByTime(16 * 11);
    });

    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
    expect(lastCall[1]).toBe("Hello world");
  });

  it("does not start a second timer when enqueue is called while one is already running", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.enqueue("msg-1", "a");
    });

    // Advance one tick so "a" is drained
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][1]).toBe("a");

    // Enqueue more while the interval is still running
    act(() => {
      result.current.enqueue("msg-1", "b");
    });

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    // Content accumulates correctly from displayed "a"
    expect(onUpdate.mock.calls[1][1]).toBe("ab");
  });

  it("tick does nothing when pending queue is empty", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.enqueue("msg-1", "x");
    });

    // Drain the single char
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // Further ticks with nothing queued should not call onUpdate again
    act(() => {
      vi.advanceTimersByTime(64);
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("flush drains all remaining pending content immediately and stops the timer", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.enqueue("msg-1", "Hello world");
    });

    // Only drain 1 char via one tick
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    onUpdate.mockClear();

    // Flush should emit the rest in a single call
    act(() => {
      result.current.flush("msg-1");
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][1]).toBe("Hello world");

    // No further ticks should fire
    onUpdate.mockClear();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("flush is a no-op when there is no pending content", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.flush("msg-1");
    });

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("flush appends remaining chars to already-displayed content", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.enqueue("msg-1", "abc");
    });

    // Drain 1 char ("a")
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onUpdate.mock.calls[0][1]).toBe("a");
    onUpdate.mockClear();

    // Flush the rest ("bc")
    act(() => {
      result.current.flush("msg-1");
    });

    expect(onUpdate).toHaveBeenCalledWith("msg-1", "abc");
  });

  it("reset clears all state and stops the timer", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.enqueue("msg-1", "Hello");
    });

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    onUpdate.mockClear();

    act(() => {
      result.current.reset();
    });

    // Timer is stopped — no further updates
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onUpdate).not.toHaveBeenCalled();

    // After reset, enqueueing for the same id starts fresh (no accumulated content)
    act(() => {
      result.current.enqueue("msg-1", "New");
    });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    // Displayed content starts from zero, not from the pre-reset state
    expect(onUpdate.mock.calls[0][1]).toBe("N");
  });

  it("stop cancels the interval without clearing pending or displayed buffers", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.enqueue("msg-1", "abc");
    });

    act(() => {
      vi.advanceTimersByTime(16);
    });
    onUpdate.mockClear();

    act(() => {
      result.current.stop();
    });

    // Timer stopped — no further ticks
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("stop is idempotent when called multiple times", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.stop();
      result.current.stop();
    });

    // No error thrown and timer state is consistent
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("passes the correct streaming id to onUpdate after enqueue", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    act(() => {
      result.current.enqueue("assistant-42", "Hi");
    });

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(onUpdate).toHaveBeenCalledWith("assistant-42", "H");
  });

  it("drains the full queue to empty given enough ticks", () => {
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useTextAnimation(onUpdate));

    const text = "Hello!";
    act(() => {
      result.current.enqueue("msg-1", text);
    });

    // Advance well beyond enough ticks for 6 chars at 1 char/tick
    act(() => {
      vi.advanceTimersByTime(16 * 10);
    });

    const lastContent = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1];
    expect(lastContent).toBe("Hello!");
    // onUpdate should have been called exactly 6 times (one per char)
    expect(onUpdate).toHaveBeenCalledTimes(6);
  });

  describe("seed", () => {
    it("stops any running timer — no onUpdate after seed", () => {
      const onUpdate = vi.fn();
      const { result } = renderHook(() => useTextAnimation(onUpdate));

      // Start a timer by enqueuing
      act(() => {
        result.current.enqueue("msg-1", "abc");
      });
      act(() => {
        vi.advanceTimersByTime(16); // drains 1 char
      });
      onUpdate.mockClear();

      // Seed stops the timer
      act(() => {
        result.current.seed("msg-1", "saved text");
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it("primes displayed text — enqueue appends to the seeded content", () => {
      const onUpdate = vi.fn();
      const { result } = renderHook(() => useTextAnimation(onUpdate));

      act(() => {
        result.current.seed("msg-1", "hello ");
      });

      act(() => {
        result.current.enqueue("msg-1", "world");
      });

      // Drain 1 char per tick — first tick emits "hello " + "w"
      act(() => {
        vi.advanceTimersByTime(16);
      });
      expect(onUpdate).toHaveBeenCalledWith("msg-1", "hello w");
    });

    it("flush after seed with no queued text is a no-op", () => {
      const onUpdate = vi.fn();
      const { result } = renderHook(() => useTextAnimation(onUpdate));

      act(() => {
        result.current.seed("msg-1", "snapshot text");
      });

      act(() => {
        result.current.flush("msg-1");
      });

      expect(onUpdate).not.toHaveBeenCalled();
    });
  });
});
