import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = `/tmp/workspace-test-${process.pid}`;

vi.mock("@@/lib/paths", () => ({
  AGENTS_ROOT: TMP_ROOT,
  DOVEPAW_DIR: join(TMP_ROOT, ".dovepaw"),
  WORKSPACES_DIR: join(TMP_ROOT, ".dovepaw", "workspaces"),
  KARPATHY_HOOK_SRC: join(TMP_ROOT, ".claude/hooks/karpathy-guidelines.sh"),
  agentWorkspaceDir: (agentName: string) =>
    join(TMP_ROOT, ".dovepaw", "workspaces", `.${agentName}`),
  agentWorkspacePath: (
    agentName: string,
    alias: string,
    shortId: string,
    workspaceRoot?: string,
  ) => {
    const root = workspaceRoot ?? join(TMP_ROOT, ".dovepaw", "workspaces", `.${agentName}`);
    const path = join(root, `${alias}-${shortId}`);
    mkdirSync(path, { recursive: true });
    return path;
  },
  agentConfigDir: (agentName: string) => {
    const dir = join(TMP_ROOT, ".dovepaw", "settings.agents", agentName);
    mkdirSync(dir, { recursive: true });
    return dir;
  },
}));

const {
  createAgentWorkspace,
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

  describe("writeWorkspaceSettings", () => {
    it("writes .claude/settings.json into the workspace", () => {
      const ws = createAgentWorkspace("my-agent", "ma");
      const settingsPath = join(ws.path, ".claude", "settings.json");
      expect(existsSync(settingsPath)).toBe(true);
    });

    it("settings.json contains PostToolUse hook for ScheduleWakeup that touches flag file", () => {
      const ws = createAgentWorkspace("my-agent", "ma");
      const settings = JSON.parse(readFileSync(join(ws.path, ".claude", "settings.json"), "utf8"));
      const postHooks = settings.hooks?.PostToolUse;
      expect(Array.isArray(postHooks)).toBe(true);
      const scheduleHook = postHooks.find(
        (h: { matcher?: string }) => h.matcher === "ScheduleWakeup",
      );
      expect(scheduleHook).toBeDefined();
      expect(scheduleHook.hooks[0].command).toContain("touch");
      expect(scheduleHook.hooks[0].command).toContain(".wakeup_pending");
    });

    it("settings.json contains Stop hook that blocks when flag file exists", () => {
      const ws = createAgentWorkspace("my-agent", "ma");
      const settings = JSON.parse(readFileSync(join(ws.path, ".claude", "settings.json"), "utf8"));
      const stopHooks = settings.hooks?.Stop;
      expect(Array.isArray(stopHooks)).toBe(true);
      const cmd: string = stopHooks[0].hooks[0].command;
      expect(cmd).toContain(".wakeup_pending");
      expect(cmd).toContain('"decision":"block"');
    });

    it("settings.json contains UserPromptSubmit hook that removes flag file", () => {
      const ws = createAgentWorkspace("my-agent", "ma");
      const settings = JSON.parse(readFileSync(join(ws.path, ".claude", "settings.json"), "utf8"));
      const upHooks = settings.hooks?.UserPromptSubmit;
      expect(Array.isArray(upHooks)).toBe(true);
      expect(upHooks[0].hooks[0].command).toContain("rm -f");
      expect(upHooks[0].hooks[0].command).toContain(".wakeup_pending");
    });
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

// ─── cloneReposIntoWorkspace ──────────────────────────────────────────────────

describe("cloneReposIntoWorkspace", () => {
  beforeEach(() => {
    mkdirSync(join(TMP_ROOT, ".claude/hooks"), { recursive: true });
    writeFileSync(join(TMP_ROOT, ".claude/hooks/karpathy-guidelines.sh"), "#!/usr/bin/env bash\n");
  });
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

  it("writes .claude/settings.local.json granting Write permission to workspacePath", async () => {
    const ghClone = vi.fn().mockResolvedValue(undefined);

    await cloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    const settingsPath = join(TMP_ROOT, "my-app", ".claude", "settings.local.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.permissions).toEqual({ allow: ["Write(/**)", "Edit(/**)", "Bash(*)"] });
    expect(settings.hooks?.PermissionRequest).toHaveLength(1);
    expect(settings.hooks.PermissionRequest[0].matcher).toBe("Edit|Write");
    expect(settings.hooks.PermissionRequest[0].hooks[0].type).toBe("command");
    expect(settings.hooks.PermissionRequest[0].hooks[0].command).toContain('"behavior":"allow"');
    expect(settings.hooks?.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toMatch(
      /^echo [A-Za-z0-9+/=]+ \| base64 -d \| bash$/,
    );
  });

  it("writes settings.local.json for each cloned repo", async () => {
    const ghClone = vi.fn().mockResolvedValue(undefined);

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
  beforeEach(() => {
    mkdirSync(join(TMP_ROOT, ".claude/hooks"), { recursive: true });
    writeFileSync(join(TMP_ROOT, ".claude/hooks/karpathy-guidelines.sh"), "#!/usr/bin/env bash\n");
  });
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it("clones repos when no previous clone exists", async () => {
    const ghClone = vi.fn().mockResolvedValue(undefined);

    const paths = await recloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    expect(ghClone).toHaveBeenCalledWith("org/my-app", join(TMP_ROOT, "my-app"));
    expect(paths).toEqual([join(TMP_ROOT, "my-app")]);
  });

  it("deletes an existing clone dir before recloning", async () => {
    const existingClone = join(TMP_ROOT, "my-app");
    mkdirSync(existingClone, { recursive: true });
    const ghClone = vi.fn().mockResolvedValue(undefined);

    await recloneReposIntoWorkspace(TMP_ROOT, ["org/my-app"], ghClone);

    // ghClone was called (meaning rmSync ran first, otherwise gh would fail on existing dir)
    expect(ghClone).toHaveBeenCalledWith("org/my-app", existingClone);
  });

  it("deletes all existing clone dirs when multiple slugs provided", async () => {
    mkdirSync(join(TMP_ROOT, "app-a"), { recursive: true });
    mkdirSync(join(TMP_ROOT, "app-b"), { recursive: true });
    const ghClone = vi.fn().mockResolvedValue(undefined);

    await recloneReposIntoWorkspace(TMP_ROOT, ["org/app-a", "org/app-b"], ghClone);

    expect(ghClone).toHaveBeenCalledTimes(2);
    expect(ghClone).toHaveBeenCalledWith("org/app-a", join(TMP_ROOT, "app-a"));
    expect(ghClone).toHaveBeenCalledWith("org/app-b", join(TMP_ROOT, "app-b"));
  });

  it("returns empty array for empty slugs", async () => {
    const ghClone = vi.fn().mockResolvedValue(undefined);
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

  it("resolves against a custom scriptRoot (plugin path)", () => {
    const pluginRoot = "/home/user/.dovepaw/plugins/my-plugin";
    const result = agentSourceDirFromEntry("agents/my-agent/main.ts", pluginRoot);
    expect(result).toBe(join(pluginRoot, "agents", "my-agent"));
  });

  it("custom scriptRoot overrides AGENTS_ROOT entirely", () => {
    const pluginRoot = "/opt/plugins/acme";
    const result = agentSourceDirFromEntry("agents/blog-writer/main.ts", pluginRoot);
    expect(result).not.toContain(TMP_ROOT);
    expect(result).toBe(join(pluginRoot, "agents", "blog-writer"));
  });
});
