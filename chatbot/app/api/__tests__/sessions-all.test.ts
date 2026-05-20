import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockAbortAll,
  mockGetRunningSessionIds,
  mockClearAll,
  mockDeleteAllSessions,
  mockGetAllSessionWorkspacePaths,
  mockGetRunningSessions,
  mockWorkspaceCleanup,
  mockDeletedSessionIds,
  mockReadAgentsConfig,
  mockResolveAgentPort,
  mockCancelTask,
  mockCreateAgentClient,
} = vi.hoisted(() => ({
  mockAbortAll: vi.fn(),
  mockGetRunningSessionIds: vi.fn(() => [] as string[]),
  mockClearAll: vi.fn(),
  mockDeleteAllSessions: vi.fn(),
  mockGetAllSessionWorkspacePaths: vi.fn(() => [] as string[]),
  mockGetRunningSessions: vi.fn(() => [] as Array<{ id: string; agentId: string }>),
  mockWorkspaceCleanup: vi.fn(),
  mockDeletedSessionIds: new Set<string>(),
  mockReadAgentsConfig: vi.fn(),
  mockResolveAgentPort: vi.fn(),
  mockCancelTask: vi.fn().mockResolvedValue({}),
  mockCreateAgentClient: vi.fn(),
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
  getAllSessionWorkspacePaths: mockGetAllSessionWorkspacePaths,
  getRunningSessions: mockGetRunningSessions,
}));

vi.mock("@@/lib/agents-config", () => ({
  readAgentsConfig: mockReadAgentsConfig,
}));

vi.mock("@/lib/a2a-client", () => ({
  resolveAgentPort: mockResolveAgentPort,
  createAgentClient: mockCreateAgentClient,
}));

vi.mock("@/lib/deleted-session-ids", () => ({
  deletedSessionIds: mockDeletedSessionIds,
}));

vi.mock("@/a2a/lib/workspace", () => ({
  restoreAgentWorkspace: () => ({ cleanup: mockWorkspaceCleanup }),
}));

import { DELETE } from "../sessions/all/route";

describe("DELETE /api/sessions/all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeletedSessionIds.clear();
    mockGetRunningSessionIds.mockReturnValue([]);
    mockGetAllSessionWorkspacePaths.mockReturnValue([]);
    mockGetRunningSessions.mockReturnValue([]);
    mockReadAgentsConfig.mockResolvedValue([]);
    mockCreateAgentClient.mockResolvedValue({ cancelTask: mockCancelTask });
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

  it("cleans up workspace directories for all sessions", async () => {
    mockGetAllSessionWorkspacePaths.mockReturnValueOnce(["/path/to/ws-1", "/path/to/ws-2"]);

    await DELETE();

    expect(mockWorkspaceCleanup).toHaveBeenCalledTimes(2);
  });

  it("reads workspace paths before deleting DB rows", async () => {
    const order: string[] = [];
    mockGetAllSessionWorkspacePaths.mockImplementationOnce(() => {
      order.push("read-paths");
      return [];
    });
    mockDeleteAllSessions.mockImplementationOnce(() => order.push("delete"));

    await DELETE();

    expect(order).toEqual(["read-paths", "delete"]);
  });

  it("calls A2A cancelTask for every running session — covers launchd-spawned tasks not in sessionRunner", async () => {
    mockGetRunningSessions.mockReturnValueOnce([
      { id: "sess-launchd-1", agentId: "scheduler-agent" },
      { id: "sess-chat-2", agentId: "test-agent" },
    ]);
    mockReadAgentsConfig.mockResolvedValueOnce([
      { name: "scheduler-agent", manifestKey: "scheduler_agent" },
      { name: "test-agent", manifestKey: "test_agent" },
    ]);
    mockResolveAgentPort.mockImplementation((key: string) =>
      key === "scheduler_agent" ? 5001 : key === "test_agent" ? 5002 : null,
    );

    await DELETE();

    expect(mockCancelTask).toHaveBeenCalledWith({ id: "sess-launchd-1" });
    expect(mockCancelTask).toHaveBeenCalledWith({ id: "sess-chat-2" });
  });
});
