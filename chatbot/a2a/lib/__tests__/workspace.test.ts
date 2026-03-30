import { existsSync, lstatSync, readlinkSync, rmSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = `/tmp/workspace-test-${process.pid}`;

vi.mock("@@/lib/paths", () => ({
  AGENTS_ROOT: TMP_ROOT,
  DOVEPAW_DIR: join(TMP_ROOT, ".dovepaw"),
  WORKSPACES_DIR: join(TMP_ROOT, ".dovepaw", "workspaces"),
  agentWorkspaceDir: (alias: string) => join(TMP_ROOT, ".dovepaw", "workspaces", `.${alias}`),
}));

const { createAgentWorkspace, agentSourceDirFromEntry, cloneReposIntoWorkspace } =
  await import("../workspace");

// ─── createAgentWorkspace ─────────────────────────────────────────────────────

describe("createAgentWorkspace", () => {
  beforeEach(() => mkdirSync(TMP_ROOT, { recursive: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it("parent dir uses full agent name", () => {
    const sourceDir = join(TMP_ROOT, "src", "my-agent");
    mkdirSync(sourceDir, { recursive: true });

    const ws = createAgentWorkspace("my-agent", "ma", sourceDir);

    expect(existsSync(ws.path)).toBe(true);
    expect(ws.path.startsWith(join(TMP_ROOT, ".dovepaw", "workspaces", ".my-agent"))).toBe(true);
  });

  it("workspace folder name is {alias}-{shortId}", () => {
    const sourceDir = join(TMP_ROOT, "src", "my-agent");
    mkdirSync(sourceDir, { recursive: true });

    const ws = createAgentWorkspace("my-agent", "ma", sourceDir);
    const folderName = basename(ws.path);

    expect(folderName).toMatch(/^ma-[0-9a-f]{8}$/);
  });

  it("uses a custom workspaceRoot when provided", () => {
    const customRoot = join(TMP_ROOT, "custom-workspaces");
    const sourceDir = join(TMP_ROOT, "src", "my-agent");
    mkdirSync(sourceDir, { recursive: true });

    const ws = createAgentWorkspace("my-agent", "ma", sourceDir, customRoot);

    expect(ws.path.startsWith(customRoot)).toBe(true);
    expect(existsSync(ws.path)).toBe(true);
  });

  it("creates a symlink named source_{alias} pointing to agentSourceDir", () => {
    const sourceDir = join(TMP_ROOT, "src", "my-agent");
    mkdirSync(sourceDir, { recursive: true });

    const ws = createAgentWorkspace("my-agent", "ma", sourceDir);
    const symlinkPath = join(ws.path, "source_ma");

    expect(existsSync(symlinkPath)).toBe(true);
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(symlinkPath)).toBe(sourceDir);
  });

  it("each call produces a unique workspace path", () => {
    const sourceDir = join(TMP_ROOT, "src", "my-agent");
    mkdirSync(sourceDir, { recursive: true });

    const ws1 = createAgentWorkspace("my-agent", "ma", sourceDir);
    const ws2 = createAgentWorkspace("my-agent", "ma", sourceDir);

    expect(ws1.path).not.toBe(ws2.path);

    ws1.cleanup();
    ws2.cleanup();
  });

  describe("cleanup()", () => {
    it("removes the workspace directory", () => {
      const sourceDir = join(TMP_ROOT, "src", "my-agent");
      mkdirSync(sourceDir, { recursive: true });

      const ws = createAgentWorkspace("my-agent", "ma", sourceDir);
      expect(existsSync(ws.path)).toBe(true);

      ws.cleanup();

      expect(existsSync(ws.path)).toBe(false);
    });

    it("does not throw if called twice", () => {
      const sourceDir = join(TMP_ROOT, "src", "my-agent");
      mkdirSync(sourceDir, { recursive: true });

      const ws = createAgentWorkspace("my-agent", "ma", sourceDir);
      ws.cleanup();
      expect(() => ws.cleanup()).not.toThrow();
    });

    it("removes the empty parent dir when it is the last workspace", () => {
      const sourceDir = join(TMP_ROOT, "src", "my-agent");
      mkdirSync(sourceDir, { recursive: true });

      const ws = createAgentWorkspace("my-agent", "ma", sourceDir);
      const parentDir = join(TMP_ROOT, ".dovepaw", "workspaces", ".my-agent");

      ws.cleanup();

      expect(existsSync(ws.path)).toBe(false);
      expect(existsSync(parentDir)).toBe(false);
    });

    it("leaves the parent dir when sibling workspaces still exist", () => {
      const sourceDir = join(TMP_ROOT, "src", "my-agent");
      mkdirSync(sourceDir, { recursive: true });

      const ws1 = createAgentWorkspace("my-agent", "ma", sourceDir);
      const ws2 = createAgentWorkspace("my-agent", "ma", sourceDir);
      const parentDir = join(TMP_ROOT, ".dovepaw", "workspaces", ".my-agent");

      ws1.cleanup();

      expect(existsSync(ws2.path)).toBe(true);
      expect(existsSync(parentDir)).toBe(true);

      ws2.cleanup();
    });
  });
});

// ─── cloneReposIntoWorkspace ──────────────────────────────────────────────────

describe("cloneReposIntoWorkspace", () => {
  beforeEach(() => mkdirSync(TMP_ROOT, { recursive: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it("returns empty array for empty slugs", async () => {
    const ghClone = vi.fn().mockResolvedValue(undefined);
    const result = await cloneReposIntoWorkspace(TMP_ROOT, [], ghClone);
    expect(result).toEqual([]);
    expect(ghClone).not.toHaveBeenCalled();
  });

  it("calls ghClone for each slug with derived local path", async () => {
    const ghClone = vi.fn().mockResolvedValue(undefined);

    const paths = await cloneReposIntoWorkspace(TMP_ROOT, ["org/repo-a", "org/repo-b"], ghClone);

    expect(ghClone).toHaveBeenCalledTimes(2);
    expect(ghClone).toHaveBeenCalledWith("org/repo-a", join(TMP_ROOT, "repo-a"));
    expect(ghClone).toHaveBeenCalledWith("org/repo-b", join(TMP_ROOT, "repo-b"));
    expect(paths).toEqual([join(TMP_ROOT, "repo-a"), join(TMP_ROOT, "repo-b")]);
  });

  it("derives repo name from the slug basename", async () => {
    const ghClone = vi.fn().mockResolvedValue(undefined);

    await cloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    expect(ghClone).toHaveBeenCalledWith("org/my-app", join(TMP_ROOT, "my-app"));
  });

  it("rejects when ghClone rejects", async () => {
    const ghClone = vi.fn().mockRejectedValueOnce(new Error("gh: repository not found"));

    await expect(cloneReposIntoWorkspace(TMP_ROOT, ["org/missing"], ghClone)).rejects.toThrow(
      "gh: repository not found",
    );
  });
});

// ─── agentSourceDirFromEntry ──────────────────────────────────────────────────

describe("agentSourceDirFromEntry", () => {
  it("returns the directory of the entry file under AGENTS_ROOT", () => {
    const result = agentSourceDirFromEntry("agents/get-shit-done/main.ts");
    expect(result).toBe(join(TMP_ROOT, "agents", "get-shit-done"));
  });

  it("handles nested paths", () => {
    const result = agentSourceDirFromEntry("agents/experience-reflector/main.ts");
    expect(result).toBe(join(TMP_ROOT, "agents", "experience-reflector"));
  });
});
