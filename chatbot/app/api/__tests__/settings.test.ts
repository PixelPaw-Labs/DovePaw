import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock settings lib before importing route ─────────────────────────────────

vi.mock("@@/lib/settings", () => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
  makeRepository: vi.fn((githubRepo: string) => ({
    id: "test-id",
    githubRepo,
    name: githubRepo.split("/").at(-1) ?? githubRepo,
  })),
}));

import { readSettings, writeSettings } from "@@/lib/settings";
import { GET, PUT } from "../settings/route";

const SAMPLE_SETTINGS = {
  version: 1 as const,
  repositories: [
    { id: "r1", githubRepo: "org/repo-a", name: "repo-a" },
    { id: "r2", githubRepo: "org/repo-b", name: "repo-b" },
  ],
  envVars: [],
};

beforeEach(() => {
  vi.mocked(readSettings).mockResolvedValue(SAMPLE_SETTINGS);
  vi.mocked(writeSettings).mockResolvedValue();
});

describe("GET /api/settings", () => {
  it("returns 200 with current settings", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual(SAMPLE_SETTINGS);
  });

  it("response contains version and repositories", async () => {
    const body = await (await GET()).json();
    expect(body.version).toBe(1);
    expect(Array.isArray(body.repositories)).toBe(true);
  });
});

describe("PUT /api/settings", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: "not json",
    });
    const response = await PUT(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when repositories is missing", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wrong: "field" }),
    });
    const response = await PUT(req);
    expect(response.status).toBe(400);
  });

  it("replaces repositories and writes settings", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repositories: [{ githubRepo: "org/new-repo" }] }),
    });

    const response = await PUT(req);
    expect(response.status).toBe(200);
    expect(vi.mocked(writeSettings)).toHaveBeenCalledOnce();
  });

  it("returns updated settings in response", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repositories: [{ githubRepo: "org/new-repo" }] }),
    });

    const body = await (await PUT(req)).json();
    expect(body.version).toBe(1);
    expect(Array.isArray(body.repositories)).toBe(true);
  });
});
