import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockAbortAll,
  mockGetRunningSessionIds,
  mockClearAll,
  mockDeleteAllSessions,
  mockDeletedSessionIds,
} = vi.hoisted(() => ({
  mockAbortAll: vi.fn(),
  mockGetRunningSessionIds: vi.fn(() => [] as string[]),
  mockClearAll: vi.fn(),
  mockDeleteAllSessions: vi.fn(),
  mockDeletedSessionIds: new Set<string>(),
}));

vi.mock("@/lib/session-runner", () => ({
  sessionRunner: {
    abortAll: mockAbortAll,
    getRunningSessionIds: mockGetRunningSessionIds,
  },
}));

vi.mock("@/lib/agent-context-registry", () => ({
  agentContextRegistry: { clearAll: mockClearAll },
}));

vi.mock("@/lib/db", () => ({
  deleteAllSessions: mockDeleteAllSessions,
}));

vi.mock("@/lib/deleted-session-ids", () => ({
  deletedSessionIds: mockDeletedSessionIds,
}));

import { DELETE } from "../sessions/all/route";

describe("DELETE /api/sessions/all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeletedSessionIds.clear();
    mockGetRunningSessionIds.mockReturnValue([]);
  });

  it("returns ok: true", async () => {
    const res = await DELETE();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("aborts all running sessions", async () => {
    await DELETE();
    expect(mockAbortAll).toHaveBeenCalledOnce();
  });

  it("marks each running session id in deletedSessionIds before aborting", async () => {
    mockGetRunningSessionIds.mockReturnValueOnce(["sess-1", "sess-2"]);

    // Capture deletedSessionIds at the moment abortAll is called
    let idsAtAbort: string[] = [];
    mockAbortAll.mockImplementationOnce(() => {
      idsAtAbort = [...mockDeletedSessionIds];
    });

    await DELETE();

    expect(idsAtAbort).toEqual(expect.arrayContaining(["sess-1", "sess-2"]));
  });

  it("clears the agent context registry", async () => {
    await DELETE();
    expect(mockClearAll).toHaveBeenCalledOnce();
  });

  it("deletes all sessions from DB", async () => {
    await DELETE();
    expect(mockDeleteAllSessions).toHaveBeenCalledOnce();
  });

  it("aborts before deleting from DB", async () => {
    const order: string[] = [];
    mockAbortAll.mockImplementationOnce(() => order.push("abort"));
    mockDeleteAllSessions.mockImplementationOnce(() => order.push("delete"));

    await DELETE();

    expect(order).toEqual(["abort", "delete"]);
  });
});
