import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock agent-links lib before importing routes ─────────────────────────────

vi.mock("@@/lib/agent-links", () => ({
  readAgentLinksFile: vi.fn(),
  writeAgentLinksFile: vi.fn(),
  AGENT_LINK_STRATEGIES: ["chat", "review", "escalation"],
}));

vi.mock("@@/lib/agents-config", () => ({
  readAgentFile: vi.fn(),
}));

import { readAgentLinksFile, writeAgentLinksFile } from "@@/lib/agent-links";
import { readAgentFile } from "@@/lib/agents-config";
import { GET, POST, PATCH, DELETE } from "../settings/agent-links/route";
import {
  POST as GroupPOST,
  PATCH as GroupPATCH,
  DELETE as GroupDELETE,
} from "../settings/agent-links/groups/route";
import type { AgentLinksFile } from "@@/lib/agent-links-schemas";

const SAMPLE_FILE: AgentLinksFile = {
  version: 1,
  groups: [
    { name: "Review Chain", members: [], description: "" },
    { name: "Data Pipeline", members: [], description: "" },
  ],
  links: [
    {
      source: "agent-a",
      target: "agent-b",
      direction: "single",
      strategy: "chat",
      group: "Review Chain",
    },
    {
      source: "agent-c",
      target: "agent-d",
      direction: "dual",
      strategy: "review",
      group: "Data Pipeline",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readAgentLinksFile).mockResolvedValue(structuredClone(SAMPLE_FILE));
  vi.mocked(writeAgentLinksFile).mockResolvedValue();
  vi.mocked(readAgentFile).mockResolvedValue({ name: "agent-x" } as never);
});

// ─── GET /api/settings/agent-links ───────────────────────────────────────────

describe("GET /api/settings/agent-links", () => {
  it("returns links and groups", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.links).toEqual(SAMPLE_FILE.links);
    expect(body.groups).toEqual(SAMPLE_FILE.groups);
  });
});

// ─── POST /api/settings/agent-links ──────────────────────────────────────────

describe("POST /api/settings/agent-links", () => {
  it("creates a link with a group", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "agent-a",
        target: "agent-e",
        direction: "single",
        strategy: "chat",
        group: "Review Chain",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const written = vi.mocked(writeAgentLinksFile).mock.calls[0]?.[0];
    expect(written?.links.at(-1)?.group).toBe("Review Chain");
  });

  it("creates a link without a group (ungrouped)", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "agent-a", target: "agent-e", direction: "single" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const written = vi.mocked(writeAgentLinksFile).mock.calls[0]?.[0];
    expect(written?.links.at(-1)?.group).toBeUndefined();
  });

  it("allows same source+target pair with a different strategy", async () => {
    // SAMPLE_FILE has agent-a→agent-b with strategy "chat"; "review" should be allowed
    const req = new Request("http://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "agent-a",
        target: "agent-b",
        direction: "single",
        strategy: "review",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("rejects a link with the same source, target, and strategy", async () => {
    // SAMPLE_FILE has agent-a→agent-b with strategy "chat"
    const req = new Request("http://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "agent-a",
        target: "agent-b",
        direction: "single",
        strategy: "chat",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });
});

// ─── PATCH /api/settings/agent-links ─────────────────────────────────────────

describe("PATCH /api/settings/agent-links", () => {
  it("moves a link to a different group", async () => {
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "agent-a",
        target: "agent-b",
        currentStrategy: "chat",
        newSource: "agent-a",
        newTarget: "agent-b",
        direction: "single",
        strategy: "chat",
        group: "Data Pipeline",
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);

    const written = vi.mocked(writeAgentLinksFile).mock.calls[0]?.[0];
    const updated = written?.links.find((l) => l.source === "agent-a" && l.target === "agent-b");
    expect(updated?.group).toBe("Data Pipeline");
  });
});

// ─── DELETE /api/settings/agent-links ────────────────────────────────────────

describe("DELETE /api/settings/agent-links", () => {
  it("removes the link and preserves groups", async () => {
    const req = new Request("http://x", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "agent-a", target: "agent-b", strategy: "chat" }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);

    const written = vi.mocked(writeAgentLinksFile).mock.calls[0]?.[0];
    expect(
      written?.links.some(
        (l) => l.source === "agent-a" && l.target === "agent-b" && l.strategy === "chat",
      ),
    ).toBe(false);
    expect(written?.groups).toEqual(SAMPLE_FILE.groups);
  });

  it("only removes the matching strategy, leaving other strategies intact", async () => {
    // Add a second link between agent-a and agent-b with strategy "review"
    vi.mocked(readAgentLinksFile).mockResolvedValue({
      ...SAMPLE_FILE,
      links: [
        ...SAMPLE_FILE.links,
        { source: "agent-a", target: "agent-b", direction: "single", strategy: "review" },
      ],
    });

    const req = new Request("http://x", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "agent-a", target: "agent-b", strategy: "chat" }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);

    const written = vi.mocked(writeAgentLinksFile).mock.calls[0]?.[0];
    expect(
      written?.links.some(
        (l) => l.source === "agent-a" && l.target === "agent-b" && l.strategy === "chat",
      ),
    ).toBe(false);
    expect(
      written?.links.some(
        (l) => l.source === "agent-a" && l.target === "agent-b" && l.strategy === "review",
      ),
    ).toBe(true);
  });
});

// ─── POST /api/settings/agent-links/groups ───────────────────────────────────

describe("POST /api/settings/agent-links/groups", () => {
  it("creates a new group", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Escalation" }),
    });
    const res = await GroupPOST(req);
    expect(res.status).toBe(201);

    const written = vi.mocked(writeAgentLinksFile).mock.calls[0]?.[0];
    expect(written?.groups.some((g) => g.name === "Escalation")).toBe(true);
  });

  it("rejects a duplicate group name", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Review Chain" }),
    });
    const res = await GroupPOST(req);
    expect(res.status).toBe(409);
  });
});

// ─── PATCH /api/settings/agent-links/groups ──────────────────────────────────

describe("PATCH /api/settings/agent-links/groups", () => {
  it("renames a group and cascades to links", async () => {
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Review Chain", newName: "Approval Flow" }),
    });
    const res = await GroupPATCH(req);
    expect(res.status).toBe(200);

    const written = vi.mocked(writeAgentLinksFile).mock.calls[0]?.[0];
    expect(written?.groups.some((g) => g.name === "Approval Flow")).toBe(true);
    expect(written?.groups.some((g) => g.name === "Review Chain")).toBe(false);
    // Link that was in "Review Chain" should now be in "Approval Flow"
    const movedLink = written?.links.find((l) => l.source === "agent-a");
    expect(movedLink?.group).toBe("Approval Flow");
  });

  it("returns 404 for unknown group", async () => {
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ghost Group", newName: "Something" }),
    });
    const res = await GroupPATCH(req);
    expect(res.status).toBe(404);
  });

  it("returns 409 when new name already exists", async () => {
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Review Chain", newName: "Data Pipeline" }),
    });
    const res = await GroupPATCH(req);
    expect(res.status).toBe(409);
  });
});

// ─── DELETE /api/settings/agent-links/groups ─────────────────────────────────

describe("DELETE /api/settings/agent-links/groups", () => {
  it("removes the group and ungroups its links", async () => {
    const req = new Request("http://x", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Review Chain" }),
    });
    const res = await GroupDELETE(req);
    expect(res.status).toBe(200);

    const written = vi.mocked(writeAgentLinksFile).mock.calls[0]?.[0];
    expect(written?.groups.some((g) => g.name === "Review Chain")).toBe(false);
    // Link that was in "Review Chain" should now be ungrouped
    const ungroupedLink = written?.links.find((l) => l.source === "agent-a");
    expect(ungroupedLink?.group).toBeUndefined();
    // Link in a different group is unaffected
    const otherLink = written?.links.find((l) => l.source === "agent-c");
    expect(otherLink?.group).toBe("Data Pipeline");
  });
});
