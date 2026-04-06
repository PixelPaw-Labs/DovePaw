import {
  existsSync,
  lstatSync,
  readlinkSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = `/tmp/workspace-test-${process.pid}`;

vi.mock("@@/lib/paths", () => ({
  AGENTS_ROOT: TMP_ROOT,
  DOVEPAW_DIR: join(TMP_ROOT, ".dovepaw"),
  WORKSPACES_DIR: join(TMP_ROOT, ".dovepaw", "workspaces"),
  agentWorkspaceDir: (alias: string) => join(TMP_ROOT, ".dovepaw", "workspaces", `.${alias}`),
  agentConfigDir: (agentName: string) => join(TMP_ROOT, ".dovepaw", "settings.agents", agentName),
}));

const {
  createAgentWorkspace,
  ensureAgentSourceSymlink,
  agentSourceDirFromEntry,
  cloneReposIntoWorkspace,
  recloneReposIntoWorkspace,
} = await import("../workspace");

// ─── createAgentWorkspace ─────────────────────────────────────────────────────

describe("createAgentWorkspace", () => {
  beforeEach(() => mkdirSync(TMP_ROOT, { recursive: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it("parent dir uses full agent name", () => {
    const ws = createAgentWorkspace("my-agent", "ma");

    expect(existsSync(ws.path)).toBe(true);
    expect(ws.path.startsWith(join(TMP_ROOT, ".dovepaw", "workspaces", ".my-agent"))).toBe(true);
  });

  it("workspace folder name is {alias}-{shortId}", () => {
    const ws = createAgentWorkspace("my-agent", "ma");
    const folderName = basename(ws.path);

    expect(folderName).toMatch(/^ma-[0-9a-f]{8}$/);
  });

  it("uses first 8 chars of taskId (dashes stripped) as shortId when provided", () => {
    const taskId = "abc123de-f456-7890-abcd-ef1234567890";
    const ws = createAgentWorkspace("my-agent", "ma", undefined, taskId);
    const folderName = basename(ws.path);

    expect(folderName).toBe("ma-abc123de");
  });

  it("uses a custom workspaceRoot when provided", () => {
    const customRoot = join(TMP_ROOT, "custom-workspaces");

    const ws = createAgentWorkspace("my-agent", "ma", customRoot);

    expect(ws.path.startsWith(customRoot)).toBe(true);
    expect(existsSync(ws.path)).toBe(true);
  });

  it("calls onProgress for workspace creation", () => {
    const onProgress = vi.fn();
    const ws = createAgentWorkspace("my-agent", "ma", undefined, undefined, onProgress);

    expect(onProgress).toHaveBeenCalledWith("Creating workspace", { workspace: ws.path });
  });

  it("each call produces a unique workspace path", () => {
    const ws1 = createAgentWorkspace("my-agent", "ma");
    const ws2 = createAgentWorkspace("my-agent", "ma");

    expect(ws1.path).not.toBe(ws2.path);

    ws1.cleanup();
    ws2.cleanup();
  });

  describe("cleanup()", () => {
    it("removes the workspace directory", () => {
      const ws = createAgentWorkspace("my-agent", "ma");
      expect(existsSync(ws.path)).toBe(true);

      ws.cleanup();

      expect(existsSync(ws.path)).toBe(false);
    });

    it("does not throw if called twice", () => {
      const ws = createAgentWorkspace("my-agent", "ma");
      ws.cleanup();
      expect(() => ws.cleanup()).not.toThrow();
    });

    it("removes the empty parent dir when it is the last workspace", () => {
      const ws = createAgentWorkspace("my-agent", "ma");
      const parentDir = join(TMP_ROOT, ".dovepaw", "workspaces", ".my-agent");

      ws.cleanup();

      expect(existsSync(ws.path)).toBe(false);
      expect(existsSync(parentDir)).toBe(false);
    });

    it("leaves the parent dir when sibling workspaces still exist", () => {
      const ws1 = createAgentWorkspace("my-agent", "ma");
      const ws2 = createAgentWorkspace("my-agent", "ma");
      const parentDir = join(TMP_ROOT, ".dovepaw", "workspaces", ".my-agent");

      ws1.cleanup();

      expect(existsSync(ws2.path)).toBe(true);
      expect(existsSync(parentDir)).toBe(true);

      ws2.cleanup();
    });
  });
});

// ─── ensureAgentSourceSymlink ─────────────────────────────────────────────────

describe("ensureAgentSourceSymlink", () => {
  beforeEach(() => mkdirSync(TMP_ROOT, { recursive: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it("creates source_{alias} symlink inside agentConfigDir", () => {
    const sourceDir = join(TMP_ROOT, "src", "my-agent");
    mkdirSync(sourceDir, { recursive: true });

    ensureAgentSourceSymlink("my-agent", sourceDir);

    const symlinkPath = join(TMP_ROOT, ".dovepaw", "settings.agents", "my-agent", "source");
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(symlinkPath)).toBe(sourceDir);
  });

  it("creates agentConfigDir if it does not exist", () => {
    const sourceDir = join(TMP_ROOT, "src", "my-agent");
    mkdirSync(sourceDir, { recursive: true });

    ensureAgentSourceSymlink("my-agent", sourceDir);

    const configDir = join(TMP_ROOT, ".dovepaw", "settings.agents", "my-agent");
    expect(existsSync(configDir)).toBe(true);
  });

  it("recreates the symlink if it points to a stale target", () => {
    const oldSourceDir = join(TMP_ROOT, "src", "old-location");
    const newSourceDir = join(TMP_ROOT, "src", "new-location");
    mkdirSync(oldSourceDir, { recursive: true });
    mkdirSync(newSourceDir, { recursive: true });

    ensureAgentSourceSymlink("my-agent", oldSourceDir);
    ensureAgentSourceSymlink("my-agent", newSourceDir);

    const symlinkPath = join(TMP_ROOT, ".dovepaw", "settings.agents", "my-agent", "source");
    expect(readlinkSync(symlinkPath)).toBe(newSourceDir);
  });

  it("is idempotent when called with the same target", () => {
    const sourceDir = join(TMP_ROOT, "src", "my-agent");
    mkdirSync(sourceDir, { recursive: true });

    expect(() => {
      ensureAgentSourceSymlink("my-agent", sourceDir);
      ensureAgentSourceSymlink("my-agent", sourceDir);
    }).not.toThrow();
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** ghClone mock that creates a minimal real git repo at clonePath (as gh repo clone would). */
function makeGitCloneMock() {
  return vi.fn().mockImplementation(async (_slug: string, clonePath: string) => {
    if (existsSync(join(clonePath, ".git"))) return; // already a repo — simulate idempotent re-clone
    mkdirSync(clonePath, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: clonePath, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: clonePath,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: clonePath, stdio: "pipe" });
    writeFileSync(join(clonePath, "README.md"), "init");
    execFileSync("git", ["add", "README.md"], { cwd: clonePath, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: clonePath, stdio: "pipe" });
  });
}

// ─── cloneReposIntoWorkspace ──────────────────────────────────────────────────

describe("cloneReposIntoWorkspace", () => {
  beforeEach(() => mkdirSync(TMP_ROOT, { recursive: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it("returns empty array for empty slugs", async () => {
    const ghClone = makeGitCloneMock();
    const result = await cloneReposIntoWorkspace(TMP_ROOT, [], ghClone);
    expect(result).toEqual([]);
    expect(ghClone).not.toHaveBeenCalled();
  });

  it("calls ghClone for each slug with derived local path", async () => {
    const ghClone = makeGitCloneMock();

    const paths = await cloneReposIntoWorkspace(TMP_ROOT, ["org/repo-a", "org/repo-b"], ghClone);

    expect(ghClone).toHaveBeenCalledTimes(2);
    expect(ghClone).toHaveBeenCalledWith("org/repo-a", join(TMP_ROOT, "repo-a"));
    expect(ghClone).toHaveBeenCalledWith("org/repo-b", join(TMP_ROOT, "repo-b"));
    expect(paths).toEqual([join(TMP_ROOT, "repo-a"), join(TMP_ROOT, "repo-b")]);
  });

  it("derives repo name from the slug basename", async () => {
    const ghClone = makeGitCloneMock();

    await cloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    expect(ghClone).toHaveBeenCalledWith("org/my-app", join(TMP_ROOT, "my-app"));
  });

  it("rejects when ghClone rejects", async () => {
    const ghClone = vi.fn().mockRejectedValueOnce(new Error("gh: repository not found"));

    await expect(cloneReposIntoWorkspace(TMP_ROOT, ["org/missing"], ghClone)).rejects.toThrow(
      "gh: repository not found",
    );
  });

  it("writes .claude/settings.local.json granting Write permission to workspacePath", async () => {
    const ghClone = makeGitCloneMock();

    await cloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    const settingsPath = join(TMP_ROOT, "my-app", ".claude", "settings.local.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.permissions).toEqual({ allow: ["Write(/**)", "Edit(/**)", "Bash(*)"] });
    expect(settings.hooks?.PermissionRequest).toHaveLength(1);
    expect(settings.hooks.PermissionRequest[0].matcher).toBe("Edit|Write");
    expect(settings.hooks.PermissionRequest[0].hooks[0].type).toBe("command");
    expect(settings.hooks.PermissionRequest[0].hooks[0].command).toContain('"behavior":"allow"');
  });

  it("writes .worktreeinclude with .claude/agents and .claude/skills patterns", async () => {
    const ghClone = makeGitCloneMock();

    await cloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    const worktreeIncludePath = join(TMP_ROOT, "my-app", ".worktreeinclude");
    expect(existsSync(worktreeIncludePath)).toBe(true);
    const content = readFileSync(worktreeIncludePath, "utf8");
    expect(content).toContain(".claude/agents/");
    expect(content).toContain(".claude/skills/");
    expect(content).not.toContain(".gsd/");
  });

  it("appends .claude/agents and .claude/skills to .gitignore", async () => {
    const ghClone = makeGitCloneMock();

    await cloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    const gitignorePath = join(TMP_ROOT, "my-app", ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, "utf8");
    expect(content).toContain(".claude/agents/");
    expect(content).toContain(".claude/skills/");
    expect(content).not.toContain(".gsd/");
  });

  it("does not duplicate .gitignore entries on re-clone", async () => {
    const ghClone = makeGitCloneMock();

    await cloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);
    await cloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    const gitignorePath = join(TMP_ROOT, "my-app", ".gitignore");
    const content = readFileSync(gitignorePath, "utf8");
    const agentLines = content.split("\n").filter((l) => l.trim() === ".claude/agents/");
    expect(agentLines).toHaveLength(1);
  });

  it("writes settings.local.json for each cloned repo", async () => {
    const ghClone = makeGitCloneMock();

    await cloneReposIntoWorkspace(TMP_ROOT, ["org/repo-a", "org/repo-b"], ghClone);

    for (const name of ["repo-a", "repo-b"]) {
      const settingsPath = join(TMP_ROOT, name, ".claude", "settings.local.json");
      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.permissions.allow).toContain("Write(/**)");
      expect(settings.permissions.allow).toContain("Edit(/**)");
      expect(settings.permissions.allow).toContain("Bash(*)");
    }
  });
});

// ─── recloneReposIntoWorkspace ────────────────────────────────────────────────

describe("recloneReposIntoWorkspace", () => {
  beforeEach(() => mkdirSync(TMP_ROOT, { recursive: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it("clones repos when no previous clone exists", async () => {
    const ghClone = makeGitCloneMock();

    const paths = await recloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    expect(ghClone).toHaveBeenCalledWith("org/my-app", join(TMP_ROOT, "my-app"));
    expect(paths).toEqual([join(TMP_ROOT, "my-app")]);
  });

  it("deletes an existing clone dir before recloning", async () => {
    const existingClone = join(TMP_ROOT, "my-app");
    mkdirSync(existingClone, { recursive: true });
    const ghClone = makeGitCloneMock();

    await recloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    // ghClone was called (meaning rmSync ran first, otherwise gh would fail on existing dir)
    expect(ghClone).toHaveBeenCalledWith("org/my-app", existingClone);
  });

  it("deletes all existing clone dirs when multiple slugs provided", async () => {
    mkdirSync(join(TMP_ROOT, "app-a"), { recursive: true });
    mkdirSync(join(TMP_ROOT, "app-b"), { recursive: true });
    const ghClone = makeGitCloneMock();

    await recloneReposIntoWorkspace(TMP_ROOT, ["org/app-a", "org/app-b"], ghClone);

    expect(ghClone).toHaveBeenCalledTimes(2);
    expect(ghClone).toHaveBeenCalledWith("org/app-a", join(TMP_ROOT, "app-a"));
    expect(ghClone).toHaveBeenCalledWith("org/app-b", join(TMP_ROOT, "app-b"));
  });

  it("returns empty array for empty slugs", async () => {
    const ghClone = makeGitCloneMock();
    const result = await recloneReposIntoWorkspace(TMP_ROOT, [], ghClone);
    expect(result).toEqual([]);
    expect(ghClone).not.toHaveBeenCalled();
  });
});

// ─── agentSourceDirFromEntry ──────────────────────────────────────────────────

describe("agentSourceDirFromEntry", () => {
  it("returns the directory of the entry file under AGENTS_ROOT", () => {
    const result = agentSourceDirFromEntry("agents/get-shit-done/main.ts");
    expect(result).toBe(join(TMP_ROOT, "agents", "get-shit-done"));
  });

  it("handles nested paths", () => {
    const result = agentSourceDirFromEntry("agents/memory-dream/main.ts");
    expect(result).toBe(join(TMP_ROOT, "agents", "memory-dream"));
  });
});
