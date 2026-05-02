import { describe, it, expect, vi, beforeEach } from "vitest";
import { access, copyFile, chmod } from "node:fs/promises";
import { exec, type ExecException } from "node:child_process";

// Mock node modules before importing the module under test
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined), // used by deployTriggerScript internally
  access: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  writeFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
  symlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execSync: vi.fn().mockReturnValue(Buffer.from("1000")),
}));

vi.mock("node:util", () => ({
  promisify: vi.fn((fn) => {
    // Return a promisified version that calls the mock
    return (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        fn(...args, (err: Error | null, result: unknown) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
  }),
}));

describe("deployAgentSdk", () => {
  let deployAgentSdk: () => Promise<void>;
  let symlinkMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../installer.js");
    deployAgentSdk = mod.deployAgentSdk;
    const fs = await import("node:fs/promises");
    symlinkMock = vi.mocked(fs.symlink);
  });

  it("symlinks @openai/codex-sdk and @anthropic-ai/claude-agent-sdk but not @ladybugdb/core", async () => {
    await deployAgentSdk();

    const targets = symlinkMock.mock.calls.map((args) => String(args[1]));
    expect(targets.some((t) => t.includes("codex-sdk"))).toBe(true);
    expect(targets.some((t) => t.includes("claude-agent-sdk"))).toBe(true);
    expect(targets.some((t) => t.includes("ladybugdb"))).toBe(false);
  });
});

describe("linkAgentSdkToAgentLocal", () => {
  let linkAgentSdkToAgentLocal: () => Promise<void>;
  let symlinkMock: ReturnType<typeof vi.fn>;
  let rmMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../installer.js");
    linkAgentSdkToAgentLocal = mod.linkAgentSdkToAgentLocal;
    const fs = await import("node:fs/promises");
    symlinkMock = vi.mocked(fs.symlink);
    rmMock = vi.mocked(fs.rm);
  });

  it("symlinks agent-sdk into agent-local/node_modules/@dovepaw/agent-sdk", async () => {
    await linkAgentSdkToAgentLocal();
    const dests = symlinkMock.mock.calls.map((args) => String(args[1]));
    expect(dests.some((d) => d.includes("agent-local") && d.endsWith("agent-sdk"))).toBe(true);
  });

  it("removes existing link before symlinking", async () => {
    await linkAgentSdkToAgentLocal();
    const rmPaths = rmMock.mock.calls.map((args) => String(args[0]));
    expect(rmPaths.some((p) => p.includes("agent-local") && p.endsWith("agent-sdk"))).toBe(true);
  });
});

describe("linkPluginSkills", () => {
  let linkPluginSkills: (pluginDir: string, skillNames: string[]) => Promise<void>;
  let symlinkMock: ReturnType<typeof vi.fn>;
  let rmMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../installer.js");
    linkPluginSkills = mod.linkPluginSkills;
    const fs = await import("node:fs/promises");
    symlinkMock = vi.mocked(fs.symlink);
    rmMock = vi.mocked(fs.rm);
  });

  it("does nothing when skillNames is empty", async () => {
    await linkPluginSkills("/plugin", []);
    expect(symlinkMock).not.toHaveBeenCalled();
  });

  it("symlinks each skill into ~/.claude/skills", async () => {
    await linkPluginSkills("/plugin", ["create-pr"]);
    const dests = symlinkMock.mock.calls.map((args) => String(args[1]));
    expect(dests.some((d) => d.includes(".claude/skills") && d.endsWith("create-pr"))).toBe(true);
  });

  it("symlinks each skill into ~/.codex/skills", async () => {
    await linkPluginSkills("/plugin", ["create-pr"]);
    const dests = symlinkMock.mock.calls.map((args) => String(args[1]));
    expect(dests.some((d) => d.includes(".codex/skills") && d.endsWith("create-pr"))).toBe(true);
  });

  it("removes existing link before symlinking in both roots", async () => {
    await linkPluginSkills("/plugin", ["create-pr"]);
    const rmPaths = rmMock.mock.calls.map((args) => String(args[0]));
    expect(rmPaths.some((p) => p.includes(".claude/skills") && p.endsWith("create-pr"))).toBe(true);
    expect(rmPaths.some((p) => p.includes(".codex/skills") && p.endsWith("create-pr"))).toBe(true);
  });
});

describe("unlinkPluginSkills", () => {
  let unlinkPluginSkills: (skillNames: string[]) => Promise<void>;
  let rmMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../installer.js");
    unlinkPluginSkills = mod.unlinkPluginSkills;
    const fs = await import("node:fs/promises");
    rmMock = vi.mocked(fs.rm);
  });

  it("removes skill from ~/.claude/skills", async () => {
    await unlinkPluginSkills(["create-pr"]);
    const rmPaths = rmMock.mock.calls.map((args) => String(args[0]));
    expect(rmPaths.some((p) => p.includes(".claude/skills") && p.endsWith("create-pr"))).toBe(true);
  });

  it("removes skill from ~/.codex/skills", async () => {
    await unlinkPluginSkills(["create-pr"]);
    const rmPaths = rmMock.mock.calls.map((args) => String(args[0]));
    expect(rmPaths.some((p) => p.includes(".codex/skills") && p.endsWith("create-pr"))).toBe(true);
  });
});

describe("linkLocalAgentSkills", () => {
  let linkLocalAgentSkills: () => Promise<void>;
  let symlinkMock: ReturnType<typeof vi.fn>;
  let rmMock: ReturnType<typeof vi.fn>;
  let readdirMock: ReturnType<typeof vi.fn>;
  let accessMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../installer.js");
    linkLocalAgentSkills = mod.linkLocalAgentSkills;
    const fs = await import("node:fs/promises");
    symlinkMock = vi.mocked(fs.symlink);
    rmMock = vi.mocked(fs.rm);
    readdirMock = vi.mocked(fs.readdir);
    accessMock = vi.mocked(fs.access);
  });

  it("no-ops silently when agent-local/ does not exist", async () => {
    readdirMock.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await linkLocalAgentSkills();
    expect(symlinkMock).not.toHaveBeenCalled();
  });

  it("skips agent dirs that have no skill/ subdir", async () => {
    readdirMock.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    accessMock.mockRejectedValue(new Error("ENOENT"));
    await linkLocalAgentSkills();
    expect(symlinkMock).not.toHaveBeenCalled();
  });

  it("symlinks skill/ into ~/.claude/skills/<name>", async () => {
    readdirMock.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    accessMock.mockResolvedValue(undefined);
    await linkLocalAgentSkills();
    const dests = symlinkMock.mock.calls.map((args) => String(args[1]));
    expect(dests.some((d) => d.includes(".claude/skills") && d.endsWith("my-agent"))).toBe(true);
  });

  it("symlinks skill/ into ~/.codex/skills/<name>", async () => {
    readdirMock.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    accessMock.mockResolvedValue(undefined);
    await linkLocalAgentSkills();
    const dests = symlinkMock.mock.calls.map((args) => String(args[1]));
    expect(dests.some((d) => d.includes(".codex/skills") && d.endsWith("my-agent"))).toBe(true);
  });

  it("removes existing link before symlinking", async () => {
    readdirMock.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    accessMock.mockResolvedValue(undefined);
    await linkLocalAgentSkills();
    const rmPaths = rmMock.mock.calls.map((args) => String(args[0]));
    expect(rmPaths.some((p) => p.includes(".claude/skills") && p.endsWith("my-agent"))).toBe(true);
    expect(rmPaths.some((p) => p.includes(".codex/skills") && p.endsWith("my-agent"))).toBe(true);
  });
});

describe("syncAgentLocalToSettings", () => {
  let syncAgentLocalToSettings: () => Promise<void>;
  let readdirMock: ReturnType<typeof vi.fn>;
  let accessMock: ReturnType<typeof vi.fn>;
  let mkdirMock: ReturnType<typeof vi.fn>;
  let copyFileMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../installer.js");
    syncAgentLocalToSettings = mod.syncAgentLocalToSettings;
    const fs = await import("node:fs/promises");
    readdirMock = vi.mocked(fs.readdir);
    accessMock = vi.mocked(fs.access);
    mkdirMock = vi.mocked(fs.mkdir);
    copyFileMock = vi.mocked(fs.copyFile);
  });

  it("no-ops silently when agent-local/ does not exist", async () => {
    readdirMock.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await syncAgentLocalToSettings();
    expect(copyFileMock).not.toHaveBeenCalled();
  });

  it("skips agent dirs that have no agent.json", async () => {
    readdirMock.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    accessMock.mockRejectedValue(new Error("ENOENT"));
    await syncAgentLocalToSettings();
    expect(copyFileMock).not.toHaveBeenCalled();
  });

  it("copies agent.json into settings.agents/<name>/agent.json", async () => {
    readdirMock.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    accessMock.mockResolvedValue(undefined);
    await syncAgentLocalToSettings();
    const [src, dest] = copyFileMock.mock.calls[0] as [string, string];
    expect(src).toMatch(/agent-local[/\\]my-agent[/\\]agent\.json$/);
    expect(dest).toMatch(/settings\.agents[/\\]my-agent[/\\]agent\.json$/);
  });

  it("creates the destination directory before copying", async () => {
    readdirMock.mockResolvedValue([{ name: "my-agent", isDirectory: () => true }]);
    accessMock.mockResolvedValue(undefined);
    await syncAgentLocalToSettings();
    const mkdirPaths = mkdirMock.mock.calls.map((args) => String(args[0]));
    expect(mkdirPaths.some((p) => p.includes("settings.agents") && p.endsWith("my-agent"))).toBe(
      true,
    );
  });

  it("skips non-directory entries", async () => {
    readdirMock.mockResolvedValue([{ name: "README.md", isDirectory: () => false }]);
    await syncAgentLocalToSettings();
    expect(copyFileMock).not.toHaveBeenCalled();
  });
});

describe("deployTriggerScript", () => {
  let deployTriggerScript: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset module cache so the _deployTriggerScriptOnce singleton is cleared
    vi.resetModules();
    const mod = await import("../installer.js");
    deployTriggerScript = mod.deployTriggerScript;
  });

  it("copies the trigger script directly when dist file exists", async () => {
    vi.mocked(access).mockResolvedValue(undefined);

    await deployTriggerScript();

    expect(exec).not.toHaveBeenCalled();
    expect(copyFile).toHaveBeenCalledOnce();
    expect(chmod).toHaveBeenCalledOnce();
  });

  it("runs npm run build before copying when dist file is missing", async () => {
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
      (cb as unknown as (err: ExecException | null, stdout: string, stderr: string) => void)(
        null,
        "",
        "",
      );
      return {} as ReturnType<typeof exec>;
    });

    await deployTriggerScript();

    expect(exec).toHaveBeenCalledWith(
      "npm run build",
      expect.objectContaining({ cwd: expect.stringContaining("DovePaw") }),
      expect.any(Function),
    );
    expect(copyFile).toHaveBeenCalledOnce();
    expect(chmod).toHaveBeenCalledOnce();
  });

  it("concurrent calls run the underlying deploy only once", async () => {
    vi.mocked(access).mockResolvedValue(undefined);

    await Promise.all([deployTriggerScript(), deployTriggerScript(), deployTriggerScript()]);

    expect(copyFile).toHaveBeenCalledOnce();
    expect(chmod).toHaveBeenCalledOnce();
  });
});
