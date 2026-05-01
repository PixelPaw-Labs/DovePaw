import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentHeartbeat } from "../use-agent-heartbeat";

// ─── WebSocket class mock ─────────────────────────────────────────────────────
// Must be a real class so `new WebSocket(url)` works.

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  static get last(): MockWebSocket | null {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1] ?? null;
  }

  readyState: number = MockWebSocket.OPEN;
  url: string;
  private listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, cb: (e: unknown) => void) {
    (this.listeners[event] ??= []).push(cb);
  }

  close() {
    this.readyState = 3; // CLOSED
    for (const cb of this.listeners["close"] ?? []) cb(new Event("close"));
  }

  emit(event: string, data: unknown) {
    for (const cb of this.listeners[event] ?? []) cb(data);
  }
}

// ─── fetch mock ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockPortsResponse(wsPort: number) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ ws_port: wsPort, updatedAt: "2026-01-01T00:00:00.000Z" }),
  });
}

function mockPortsError() {
  mockFetch.mockResolvedValue({ ok: false });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: flush all pending promises and resulting React state updates.
async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useAgentHeartbeat", () => {
  it("returns empty statuses initially", async () => {
    mockPortsError();
    const { result } = renderHook(() => useAgentHeartbeat());
    expect(result.current).toEqual({});
  });

  it("connects to WebSocket once ws_port is fetched from /api/ports", async () => {
    mockPortsResponse(9876);
    renderHook(() => useAgentHeartbeat());

    await flushAsync();

    expect(MockWebSocket.last).not.toBeNull();
    expect(MockWebSocket.last!.url).toBe("ws://127.0.0.1:9876");
  });

  it("updates statuses when a valid status message arrives", async () => {
    mockPortsResponse(9876);
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
      MockWebSocket.last!.emit(
        "message",
        new MessageEvent("message", { data: JSON.stringify(payload) }),
      );
    });

    expect(result.current.my_agent?.online).toBe(true);
    expect(result.current.my_agent?.latency).toBe(42);
  });

  it("ignores malformed WebSocket messages", async () => {
    mockPortsResponse(9876);
    const { result } = renderHook(() => useAgentHeartbeat());
    await flushAsync();

    act(() => {
      MockWebSocket.last!.emit("message", new MessageEvent("message", { data: "not json{{{" }));
    });

    expect(result.current).toEqual({});
  });

  it("does not connect when /api/ports returns an error", async () => {
    mockPortsError();
    renderHook(() => useAgentHeartbeat());

    await flushAsync();

    expect(MockWebSocket.last).toBeNull();
  });

  it("reconnects after WebSocket close", async () => {
    vi.useFakeTimers();
    mockPortsResponse(9876);
    renderHook(() => useAgentHeartbeat());

    await act(async () => {
      await Promise.resolve();
    });

    const first = MockWebSocket.last;
    expect(first).not.toBeNull();

    act(() => first!.close());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });

    expect(MockWebSocket.last).not.toBe(first);
    expect(MockWebSocket.last!.url).toBe("ws://127.0.0.1:9876");

    vi.useRealTimers();
  });

  it("closes WebSocket on unmount", async () => {
    mockPortsResponse(9876);
    const { unmount } = renderHook(() => useAgentHeartbeat());
    await flushAsync();

    const ws = MockWebSocket.last!;
    unmount();

    expect(ws.readyState).toBe(3); // CLOSED
  });
});
