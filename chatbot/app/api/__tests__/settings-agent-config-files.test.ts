import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Hoist fs mock functions so they're available before vi.mock hoisting ─────

const {
  mockExistsSync,
  mockMkdirSync,
  mockReaddirSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockUnlinkSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
  },
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
}));

// ─── Mock agents registry ─────────────────────────────────────────────────────

vi.mock("@@/lib/agents", () => ({
  AGENTS: [{ name: "zendesk-triager" }, { name: "dependabot-merger" }],
}));

vi.mock("@@/lib/agents-config", () => ({
  readAgentsConfig: vi.fn(() => [{ name: "zendesk-triager" }, { name: "dependabot-merger" }]),
}));

// ─── Mock paths ───────────────────────────────────────────────────────────────

vi.mock("@@/lib/paths", () => ({
  agentConfigDir: (agentName: string) => `/home/.dovepaw/settings.agents/${agentName}`,
  agentConfigFile: (agentName: string, filename: string) =>
    `/home/.dovepaw/settings.agents/${agentName}/${filename}`,
}));

import { GET, PUT, DELETE } from "../settings/agent-config-files/route";

const AGENT = "zendesk-triager";
const DIR = `/home/.dovepaw/settings.agents/${AGENT}`;

function makeGet(agentName?: string) {
  const url = agentName
    ? `http://localhost/api/settings/agent-config-files?agentName=${encodeURIComponent(agentName)}`
    : "http://localhost/api/settings/agent-config-files";
  return new Request(url);
}

function makePut(body: object) {
  return new Request("http://localhost/api/settings/agent-config-files", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDelete(body: object) {
  return new Request("http://localhost/api/settings/agent-config-files", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockReaddirSync.mockReturnValue([]);
});

// ─── GET ──────────────────────────────────────────────────────────────────────

describe("GET /api/settings/agent-config-files", () => {
  it("returns 400 when agentName is missing", async () => {
    expect((await GET(makeGet())).status).toBe(400);
  });

  it("returns 404 for unknown agent", async () => {
    expect((await GET(makeGet("unknown-agent"))).status).toBe(404);
  });

  it("returns 200 with empty list when dir does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await GET(makeGet(AGENT));
    expect(res.status).toBe(200);
    expect((await res.json()).files).toEqual([]);
  });

  it("returns 200 with files, filtering non-.json entries", async () => {
    mockReaddirSync.mockReturnValue(["config.json", "README.md", "data.json"]);
    mockReadFileSync.mockImplementation((p: unknown) =>
      String(p).includes("config") ? '{"a":1}' : '{"b":2}',
    );
    const body = await (await GET(makeGet(AGENT))).json();
    expect(body.files).toHaveLength(2);
    expect(body.files[0].name).toBe("config.json");
    expect(body.files[1].name).toBe("data.json");
  });
});

// ─── PUT ──────────────────────────────────────────────────────────────────────

describe("PUT /api/settings/agent-config-files", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/settings/agent-config-files", {
      method: "PUT",
      body: "not json",
    });
    expect((await PUT(req)).status).toBe(400);
  });

  it("returns 400 for invalid filename (missing .json extension)", async () => {
    const res = await PUT(makePut({ agentName: AGENT, filename: "config.txt", content: "{}" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for filename starting with a dash", async () => {
    const res = await PUT(makePut({ agentName: AGENT, filename: "-bad.json", content: "{}" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown agent", async () => {
    const res = await PUT(
      makePut({ agentName: "unknown-agent", filename: "cfg.json", content: "{}" }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when content is not valid JSON", async () => {
    const res = await PUT(makePut({ agentName: AGENT, filename: "cfg.json", content: "not json" }));
    expect(res.status).toBe(400);
  });

  it("creates the dir and writes the file on success", async () => {
    mockReaddirSync.mockReturnValue(["cfg.json"]);
    mockReadFileSync.mockReturnValue('{"x":1}');

    const res = await PUT(makePut({ agentName: AGENT, filename: "cfg.json", content: '{"x":1}' }));
    expect(res.status).toBe(200);
    expect(mockMkdirSync).toHaveBeenCalledWith(DIR, { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(`${DIR}/cfg.json`, '{"x":1}', "utf-8");
    const body = await res.json();
    expect(body.files).toHaveLength(1);
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /api/settings/agent-config-files", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/settings/agent-config-files", {
      method: "DELETE",
      body: "not json",
    });
    expect((await DELETE(req)).status).toBe(400);
  });

  it("returns 404 for unknown agent", async () => {
    const res = await DELETE(makeDelete({ agentName: "unknown-agent", filename: "cfg.json" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when file does not exist", async () => {
    mockExistsSync.mockImplementation((p: unknown) => !String(p).includes("cfg.json"));
    const res = await DELETE(makeDelete({ agentName: AGENT, filename: "cfg.json" }));
    expect(res.status).toBe(404);
  });

  it("deletes the file and returns updated list", async () => {
    const res = await DELETE(makeDelete({ agentName: AGENT, filename: "cfg.json" }));
    expect(res.status).toBe(200);
    expect(mockUnlinkSync).toHaveBeenCalledWith(`${DIR}/cfg.json`);
    expect((await res.json()).files).toEqual([]);
  });
});
