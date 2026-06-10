import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeRunner, ensureWorktree } from "./claude-runner.js";

const TMP_DIR = join(tmpdir(), `claude-runner-test-${process.pid}`);

function makeRepo(suffix: string): string {
  const p = join(TMP_DIR, suffix);
  mkdirSync(p, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: p });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: p });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: p });
  writeFileSync(join(p, "README.md"), "init");
  execFileSync("git", ["add", "README.md"], { cwd: p });
  execFileSync("git", ["commit", "-m", "init"], { cwd: p });
  return p;
}

describe("ClaudeRunner", () => {
  describe("writeLog", () => {
    const runner = new ClaudeRunner(TMP_DIR, "/dev/null");

    it("writes content to log file with correct name", () => {
      mkdirSync(TMP_DIR, { recursive: true });
      try {
        const path = runner.writeLog("task", "EC-123", "forge output here");
        expect(path).toBe(join(TMP_DIR, "task-EC-123.log"));
        expect(readFileSync(path, "utf-8")).toBe("forge output here");
      } finally {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    });

    it("returns the full path to the log file", () => {
      mkdirSync(TMP_DIR, { recursive: true });
      try {
        const path = runner.writeLog("merge", "EC-456", "merge output");
        expect(path.endsWith("merge-EC-456.log")).toBe(true);
      } finally {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    });
  });

  describe("SIGTERM/SIGINT handler lifecycle", () => {
    it("registers handlers during run and removes them after", async () => {
      const runner = new ClaudeRunner(TMP_DIR, "");

      const before = process.listenerCount("SIGTERM");

      // No ANTHROPIC_API_KEY → SDK throws during connect, run returns quickly.
      const runPromise = runner.run("test prompt", {
        cwd: TMP_DIR,
        taskName: "test",
        timeoutMs: 100,
      });

      // Handler should be registered while run is in progress
      const during = process.listenerCount("SIGTERM");
      expect(during).toBe(before + 1);

      await runPromise.catch(() => {});

      // Handler should be removed after run completes
      const after = process.listenerCount("SIGTERM");
      expect(after).toBe(before);
    });
  });
});

describe("worktreeCopy", () => {
  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("copies given paths into the worktree before the run starts", async () => {
    const repo = makeRepo("wt-copy");
    const srcDir = join(TMP_DIR, "copy-src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "file.txt"), "payload");
    const wtPath = join(repo, ".claude", "worktrees", "fix/copy-test");

    const runner = new ClaudeRunner(TMP_DIR, "");
    // No ANTHROPIC_API_KEY → SDK throws during connect, but the copy runs first.
    await runner
      .run("test prompt", {
        cwd: repo,
        taskName: "copy-test",
        worktree: "fix/copy-test",
        worktreeCopy: [{ src: srcDir, dst: join(wtPath, "nested", "dest") }],
        timeoutMs: 100,
      })
      .catch(() => {});

    expect(readFileSync(join(wtPath, "nested", "dest", "file.txt"), "utf8")).toBe("payload");
  });
});

describe("ensureWorktree", () => {
  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("creates worktree at .claude/worktrees/<branch> with correct branch name", async () => {
    const repo = makeRepo("wt-create");
    const wtPath = await ensureWorktree(repo, "fix/my-branch");
    expect(wtPath).toBe(join(repo, ".claude", "worktrees", "fix/my-branch"));
    expect(existsSync(wtPath)).toBe(true);
    const branch = execFileSync("git", ["branch", "--show-current"], { cwd: wtPath })
      .toString()
      .trim();
    expect(branch).toBe("fix/my-branch");
  });

  it("reuses existing worktree on second call (retry semantics)", async () => {
    const repo = makeRepo("wt-retry");
    const first = await ensureWorktree(repo, "fix/retry-branch");
    writeFileSync(join(first, "change.txt"), "work in progress");
    const second = await ensureWorktree(repo, "fix/retry-branch");
    expect(second).toBe(first);
    expect(existsSync(join(second, "change.txt"))).toBe(true);
  });

  it("symlinks .claude/settings.local.json into worktree when it exists in repo root", async () => {
    const repo = makeRepo("wt-settings-local");
    const claudeDir = join(repo, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.local.json"), '{"permissions":{}}');
    const wtPath = await ensureWorktree(repo, "fix/settings-test");
    const wtSettingsLocal = join(wtPath, ".claude", "settings.local.json");
    expect(existsSync(wtSettingsLocal)).toBe(true);
    expect(lstatSync(wtSettingsLocal).isSymbolicLink()).toBe(true);
  });

  it("skips symlink when .claude/settings.local.json does not exist in repo", async () => {
    const repo = makeRepo("wt-no-settings-local");
    const wtPath = await ensureWorktree(repo, "fix/no-settings-test");
    const wtSettingsLocal = join(wtPath, ".claude", "settings.local.json");
    expect(existsSync(wtSettingsLocal)).toBe(false);
  });
});
