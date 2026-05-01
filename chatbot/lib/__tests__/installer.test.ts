// @vitest-environment node
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDef } from "@@/lib/agents";

const mockRm = vi.fn().mockResolvedValue(undefined);
const mockCp = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockSymlink = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn().mockResolvedValue([]);
const mockAccess = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
  rm: mockRm,
  cp: mockCp,
  mkdir: mockMkdir,
  symlink: mockSymlink,
  access: mockAccess,
  chmod: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  readdir: mockReaddir,
  readFile: vi.fn().mockResolvedValue(""),
  stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execSync: vi.fn().mockReturnValue(Buffer.from("501")),
}));

describe("deployAgentSdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("symlinks @openai/codex-sdk from repo node_modules into deployed sdk node_modules", async () => {
    const { deployAgentSdk } = await import("@@/lib/installer");
    const { AGENT_SDK_DIR, agentNodeModule } = await import("@@/lib/paths");

    await deployAgentSdk();

    const sdkNmScope = join(AGENT_SDK_DIR, "node_modules", "@openai");
    const expectedLink = join(sdkNmScope, "codex-sdk");
    const expectedTarget = agentNodeModule("@openai/codex-sdk");

    expect(mockMkdir).toHaveBeenCalledWith(sdkNmScope, { recursive: true });
    expect(mockSymlink).toHaveBeenCalledWith(expectedTarget, expectedLink);
  });

  it("writes package.json with type:module to ~/.dovepaw/tmp/ so tsx loads tmp agents as ESM", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { deployAgentSdk } = await import("@@/lib/installer");
    const { DOVEPAW_TMP_DIR } = await import("@@/lib/paths");

    await deployAgentSdk();

    expect(mockMkdir).toHaveBeenCalledWith(DOVEPAW_TMP_DIR, { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      join(DOVEPAW_TMP_DIR, "package.json"),
      '{"type":"module"}\n',
      "utf-8",
    );
  });
});

describe("linkLocalAgentSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops silently when agent-local/ does not exist", async () => {
    const { linkLocalAgentSkills } = await import("@@/lib/installer");
    mockReaddir.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await linkLocalAgentSkills();
    expect(mockSymlink).not.toHaveBeenCalled();
  });

  it("skips agent dirs that have no skill/ subdir", async () => {
    const { linkLocalAgentSkills } = await import("@@/lib/installer");
    mockReaddir.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    await linkLocalAgentSkills();
    expect(mockSymlink).not.toHaveBeenCalled();
  });

  it("symlinks skill/ into ~/.claude/skills/<name> and ~/.codex/skills/<name>", async () => {
    const { linkLocalAgentSkills } = await import("@@/lib/installer");
    mockReaddir.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    mockAccess.mockResolvedValue(undefined);
    await linkLocalAgentSkills();
    const dests = mockSymlink.mock.calls.map((args) => String(args[1]));
    expect(dests.some((d) => d.includes(".claude/skills") && d.endsWith("my-agent"))).toBe(true);
    expect(dests.some((d) => d.includes(".codex/skills") && d.endsWith("my-agent"))).toBe(true);
  });

  it("removes existing link before symlinking in both roots", async () => {
    const { linkLocalAgentSkills } = await import("@@/lib/installer");
    mockReaddir.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    mockAccess.mockResolvedValue(undefined);
    await linkLocalAgentSkills();
    const rmPaths = mockRm.mock.calls.map((args) => String(args[0]));
    expect(rmPaths.some((p) => p.includes(".claude/skills") && p.endsWith("my-agent"))).toBe(true);
    expect(rmPaths.some((p) => p.includes(".codex/skills") && p.endsWith("my-agent"))).toBe(true);
  });
});

describe("installAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { skipped: true } and writes no config when schedulingEnabled is false", async () => {
    const { installAgent } = await import("@/lib/agent-scheduler");
    const { writeFile } = await import("node:fs/promises");

    const result = await installAgent({
      name: "my-agent",
      label: "lbl",
      schedulingEnabled: false,
    } as unknown as AgentDef);

    expect(result).toEqual({ loaded: false, skipped: true });
    expect(writeFile).not.toHaveBeenCalled();
  });
});
