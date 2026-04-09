import { describe, expect, it, vi } from "vitest";

// Mock readPortsManifest before importing the route
vi.mock("@/a2a/lib/ports-manifest", () => ({
  readPortsManifest: vi.fn(),
}));

import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import { GET } from "../ports/route";

const SAMPLE_MANIFEST = {
  memory_dream: 51001,
  get_shit_done: 51002,
  release_log_sentinel: 51003,
  memory_distiller: 51004,
  oncall_analyzer: 51005,
  zendesk_triager: 51006,
  dependabot_merger: 51007,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("GET /api/ports", () => {
  it("returns 200 with manifest JSON when servers are running", async () => {
    vi.mocked(readPortsManifest).mockReturnValue(SAMPLE_MANIFEST);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual(SAMPLE_MANIFEST);
  });

  it("returns 503 when .ports.json does not exist", async () => {
    vi.mocked(readPortsManifest).mockReturnValue(null);

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.error).toContain("npm run servers");
  });

  it("manifest contains all agent port keys", async () => {
    vi.mocked(readPortsManifest).mockReturnValue(SAMPLE_MANIFEST);

    const response = await GET();
    const body = await response.json();

    for (const key of [
      "memory_dream",
      "get_shit_done",
      "release_log_sentinel",
      "memory_distiller",
      "oncall_analyzer",
      "zendesk_triager",
      "dependabot_merger",
    ]) {
      expect(body[key]).toBeGreaterThan(1024);
    }
  });
});
