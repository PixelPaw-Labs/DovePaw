import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentHeartbeat } from "../use-agent-heartbeat";

// ─── EventSource mock ─────────────────────────────────────────────────────────

class MockEventSource {
  static instances: MockEventSource[] = [];
  static get last(): MockEventSource | null {
    return MockEventSource.instances[MockEventSource.instances.length - 1] ?? null;
  }

  url: string;
  closed = false;
  private listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, cb: (e: unknown) => void) {
    (this.listeners[event] ??= []).push(cb);
  }

  /** Simulate browser close — does NOT fire error (matches real EventSource behaviour). */
  close() {
    this.closed = true;
  }

  emit(event: string, data: unknown) {
    for (const cb of this.listeners[event] ?? []) cb(data);
  }
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useAgentHeartbeat", () => {
  it("returns empty statuses initially", () => {
    const { result } = renderHook(() => useAgentHeartbeat());
    expect(result.current).toEqual({});
  });

  it("connects to /api/heartbeat via EventSource", async () => {
    renderHook(() => useAgentHeartbeat());
    await flushAsync();

    expect(MockEventSource.last).not.toBeNull();
    expect(MockEventSource.last!.url).toBe("/api/heartbeat");
  });

  it("updates statuses when a valid status message arrives", async () => {
    const { result } = renderHook(() => useAgentHeartbeat());
    await flushAsync();

    const payload = {
      type: "status",
      agents: {
        my_agent: {
          online: true,
          latency: 42,
          scheduler: null,
          processing: false,
          processingTrigger: null,
        },
      },
    };

    act(() => {
      MockEventSource.last!.emit(
        "message",
        new MessageEvent("message", { data: JSON.stringify(payload) }),
      );
    });

    expect(result.current.my_agent?.online).toBe(true);
    expect(result.current.my_agent?.latency).toBe(42);
  });

  it("ignores malformed SSE messages", async () => {
    const { result } = renderHook(() => useAgentHeartbeat());
    await flushAsync();

    act(() => {
      MockEventSource.last!.emit("message", new MessageEvent("message", { data: "not json{{{" }));
    });

    expect(result.current).toEqual({});
  });

  it("reconnects after EventSource error", async () => {
    vi.useFakeTimers();
    renderHook(() => useAgentHeartbeat());
    await act(async () => await Promise.resolve());

    const first = MockEventSource.last;
    expect(first).not.toBeNull();

    act(() => first!.emit("error", new Event("error")));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });

    expect(MockEventSource.last).not.toBe(first);
    expect(MockEventSource.last!.url).toBe("/api/heartbeat");

    vi.useRealTimers();
  });

  it("closes EventSource on unmount", async () => {
    const { unmount } = renderHook(() => useAgentHeartbeat());
    await flushAsync();

    const es = MockEventSource.last!;
    unmount();

    expect(es.closed).toBe(true);
  });
});
