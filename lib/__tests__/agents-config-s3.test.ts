import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPushConfig } = vi.hoisted(() => ({ mockPushConfig: vi.fn() }));
const { mockWriteFile, mockCopyFile, mockMkdir, mockAccess, mockLstat, mockReadlink } = vi.hoisted(
  () => ({
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockCopyFile: vi.fn().mockResolvedValue(undefined),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockAccess: vi.fn().mockResolvedValue(undefined),
    mockLstat: vi.fn().mockResolvedValue({ isSymbolicLink: () => false }),
    mockReadlink: vi.fn().mockResolvedValue(""),
  }),
);

vi.mock("../s3-config-sync.js", () => ({ pushConfig: mockPushConfig }));

vi.mock("node:fs/promises", () => ({
  writeFile: mockWriteFile,
  copyFile: mockCopyFile,
  mkdir: mockMkdir,
  access: mockAccess,
  lstat: mockLstat,
  readlink: mockReadlink,
  constants: { F_OK: 0 },
}));

vi.mock("../paths.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../paths.js")>();
  const path = require("node:path") as typeof import("node:path");
  const os = require("node:os") as typeof import("node:os");
  const base = path.join(os.tmpdir(), `agents-config-s3-test-${process.pid}`);
  const fakeTmp = path.join(base, "tmp");
  const fakeSettings = path.join(base, "settings.agents");
  return {
    ...real,
    DOVEPAW_TMP_DIR: fakeTmp,
    AGENT_SETTINGS_DIR: fakeSettings,
    agentDefinitionFile: (name: string) => path.join(fakeSettings, name, "agent.json"),
    tmpAgentDefinitionFile: (name: string) => path.join(fakeTmp, name, "agent.json"),
  };
});

const AGENT_FILE = {
  version: 1 as const,
  name: "test-agent",
  alias: "ta",
  displayName: "Test Agent",
  description: "desc",
  doveCard: { title: "Test", description: "desc", prompt: "prompt" },
  suggestions: [],
  repos: [],
  envVars: [],
  locked: false as const,
};

// ─── writeAgentFile ───────────────────────────────────────────────────────────

describe("writeAgentFile S3 push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPushConfig.mockResolvedValue(undefined);
  });

  it("pushes to S3 for permanent agents (access throws → resolves to settings path)", async () => {
    // access throws → fileExists returns false → resolveAgentFilePath returns settings path
    mockAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const { writeAgentFile } = await import("../agents-config.js");
    await writeAgentFile("test-agent", AGENT_FILE);
    expect(mockPushConfig).toHaveBeenCalledOnce();
    expect(mockPushConfig.mock.calls[0]?.[0]).toBe("settings.agents/test-agent/agent.json");
  });

  it("skips S3 push for tmp agents (access resolves → resolves to tmp path)", async () => {
    // access resolves → fileExists returns true → resolveAgentFilePath returns tmp path
    mockAccess.mockResolvedValue(undefined);
    const { writeAgentFile } = await import("../agents-config.js");
    await writeAgentFile("test-agent", AGENT_FILE);
    expect(mockPushConfig).not.toHaveBeenCalled();
  });
});

// ─── writeAgentLinksFile ──────────────────────────────────────────────────────

describe("writeAgentLinksFile S3 push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPushConfig.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it("pushes agent-links.json to S3 on write", async () => {
    const { writeAgentLinksFile } = await import("../agent-links.js");
    await writeAgentLinksFile({ version: 1, links: [], groups: [] });
    expect(mockPushConfig).toHaveBeenCalledOnce();
    expect(mockPushConfig.mock.calls[0]?.[0]).toBe("agent-links.json");
  });

  it("passes serialized JSON as the S3 body", async () => {
    const { writeAgentLinksFile } = await import("../agent-links.js");
    const file = { version: 1 as const, links: [], groups: [] };
    await writeAgentLinksFile(file);
    const body = mockPushConfig.mock.calls[0]?.[1] as string;
    expect(JSON.parse(body)).toEqual(file);
  });
});
