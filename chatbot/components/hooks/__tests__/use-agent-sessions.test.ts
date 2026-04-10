import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAgentSessions } from "../use-agent-sessions";

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAgentSessions", () => {
  it("fetches /api/chat/sessions on mount for dove", async () => {
    const sessions = [
      {
        id: "ctx-d",
        startedAt: "2025-01-01T00:00:00Z",
        label: "Dove run",
        status: "done" as const,
      },
    ];
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ sessions }) } as Response);

    const { result } = renderHook(() => useAgentSessions("dove"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFetch).toHaveBeenCalledWith("/api/chat/sessions");
    expect(result.current.sessions).toEqual(sessions);
  });

  it("fetches /api/agent/[name]/sessions on mount for non-dove agent", async () => {
    const sessions = [
      { id: "ctx-1", startedAt: "2025-01-01T00:00:00Z", label: "Hello", status: "done" as const },
    ];
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ sessions }) } as Response);

    const { result } = renderHook(() => useAgentSessions("memory-distiller"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFetch).toHaveBeenCalledWith("/api/agent/memory-distiller/sessions");
    expect(result.current.sessions).toEqual(sessions);
  });

  it("keeps sessions empty on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false } as Response);

    const { result } = renderHook(() => useAgentSessions("memory-distiller"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions).toEqual([]);
  });

  it("keeps sessions empty on fetch error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAgentSessions("memory-distiller"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions).toEqual([]);
  });

  it("re-fetches when agentId changes", async () => {
    const sessionsA = [
      { id: "ctx-a", startedAt: "2025-01-01T00:00:00Z", label: "A", status: "done" as const },
    ];
    const sessionsB = [
      { id: "ctx-b", startedAt: "2025-01-02T00:00:00Z", label: "B", status: "done" as const },
    ];
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sessions: sessionsA }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sessions: sessionsB }) } as Response);

    const { result, rerender } = renderHook(({ id }) => useAgentSessions(id), {
      initialProps: { id: "agent-a" },
    });

    await waitFor(() => expect(result.current.sessions).toEqual(sessionsA));

    rerender({ id: "agent-b" });

    await waitFor(() => expect(result.current.sessions).toEqual(sessionsB));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("refresh() re-fetches and updates sessions", async () => {
    const initial = [
      { id: "ctx-1", startedAt: "2025-01-01T00:00:00Z", label: "First", status: "done" as const },
    ];
    const updated = [
      {
        id: "ctx-2",
        startedAt: "2025-01-02T00:00:00Z",
        label: "Second",
        status: "running" as const,
      },
      { id: "ctx-1", startedAt: "2025-01-01T00:00:00Z", label: "First", status: "done" as const },
    ];
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sessions: initial }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sessions: updated }) } as Response);

    const { result } = renderHook(() => useAgentSessions("memory-distiller"));
    await waitFor(() => expect(result.current.sessions).toEqual(initial));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.sessions).toEqual(updated);
  });
});
