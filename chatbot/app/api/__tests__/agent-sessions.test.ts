/**
 * Tests for GET /api/agent/[name]/sessions
 * Now backed by SQLite DB (listSessions) instead of A2A server proxy.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@@/lib/agents-config", () => ({
  readAgentsConfig: vi.fn(() => [
    { name: "test-agent", manifestKey: "test_agent", displayName: "Test Agent" },
  ]),
}));

vi.mock("@/lib/db", () => ({
  listSessions: vi.fn(),
}));

import { listSessions } from "@/lib/db";
import { GET } from "../agent/[name]/sessions/route";

function makeRequest(name: string) {
  return {
    request: new Request(`http://localhost/api/agent/${name}/sessions`),
    params: Promise.resolve({ name }),
  };
}

describe("GET /api/agent/[name]/sessions", () => {
  it("returns 404 for unknown agent", async () => {
    const { request, params } = makeRequest("nonexistent");
    const response = await GET(request, { params });
    expect(response.status).toBe(404);
  });

  it("returns sessions from DB for a known agent", async () => {
    const sessions = [
      {
        id: "ctx-1",
        agentId: "test-agent",
        startedAt: "2025-01-01T00:00:00Z",
        label: "Run tickets",
      },
    ];
    vi.mocked(listSessions).mockReturnValue(sessions);

    const { request, params } = makeRequest("test-agent");
    const response = await GET(request, { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessions });
    expect(listSessions).toHaveBeenCalledWith("test-agent");
  });

  it("returns empty sessions array when no sessions in DB", async () => {
    vi.mocked(listSessions).mockReturnValue([]);

    const { request, params } = makeRequest("test-agent");
    const response = await GET(request, { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessions: [] });
  });
});
