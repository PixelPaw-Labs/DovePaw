/**
 * Tests for GET /api/agent/[name]/sessions
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@@/lib/agents-config", () => ({
  readAgentsConfig: vi.fn(() => [
    { name: "test-agent", manifestKey: "test_agent", displayName: "Test Agent" },
  ]),
}));

vi.mock("@/a2a/lib/base-server", () => ({
  readPortsManifest: vi.fn(),
}));

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

import { readPortsManifest } from "@/a2a/lib/base-server";
import { GET } from "../agent/[name]/sessions/route";

function makeRequest(name: string) {
  return {
    request: new Request(`http://localhost/api/agent/${name}/sessions`),
    params: Promise.resolve({ name }),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(readPortsManifest).mockReset();
});

describe("GET /api/agent/[name]/sessions", () => {
  it("returns 404 for unknown agent", async () => {
    const { request, params } = makeRequest("nonexistent");
    const response = await GET(request, { params });
    expect(response.status).toBe(404);
  });

  it("returns { sessions: [] } (not 503) when manifest is null", async () => {
    vi.mocked(readPortsManifest).mockReturnValue(null);
    const { request, params } = makeRequest("test-agent");
    const response = await GET(request, { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessions: [] });
  });

  it("returns { sessions: [] } when agent port not in manifest", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({
      other_agent: 9999,
      updatedAt: new Date().toISOString(),
    });
    const { request, params } = makeRequest("test-agent");
    const response = await GET(request, { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessions: [] });
  });

  it("proxies the A2A server response correctly", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({
      test_agent: 7474,
      updatedAt: new Date().toISOString(),
    });
    const sessions = [
      { contextId: "ctx-1", startedAt: "2025-01-01T00:00:00Z", label: "Run tickets" },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => sessions,
    } as Response);

    const { request, params } = makeRequest("test-agent");
    const response = await GET(request, { params });

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:7474/sessions", { cache: "no-store" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessions });
  });

  it("returns { sessions: [] } when A2A server returns non-ok", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({
      test_agent: 7474,
      updatedAt: new Date().toISOString(),
    });
    mockFetch.mockResolvedValue({ ok: false } as Response);

    const { request, params } = makeRequest("test-agent");
    const response = await GET(request, { params });
    expect(await response.json()).toEqual({ sessions: [] });
  });

  it("returns { sessions: [] } when A2A server fetch throws", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({
      test_agent: 7474,
      updatedAt: new Date().toISOString(),
    });
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const { request, params } = makeRequest("test-agent");
    const response = await GET(request, { params });
    expect(await response.json()).toEqual({ sessions: [] });
  });
});
