import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeRunner, buildClaudeArgs } from "./claude-runner.js";
import { WorktreeWatchdog } from "./worktree-watchdog.js";
import type { SpawnClaudeHandle } from "./claude.js";

const TMP_DIR = join(tmpdir(), `claude-runner-test-${process.pid}`);

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
});

// ─── buildClaudeArgs ─────────────────────────────────────────────────────────

describe("buildClaudeArgs", () => {
  it("includes --add-dir for each repo when no worktree", () => {
    const args = buildClaudeArgs({
      taskName: "t",
      cwd: "/workspace/abc",
      repos: ["/workspace/abc/repo-alpha", "/workspace/abc/repo-beta"],
    });
    const idx = args.indexOf("--add-dir");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("/workspace/abc/repo-alpha");
    expect(args[idx + 2]).toBe("/workspace/abc/repo-beta");
  });

  it("omits --add-dir when a worktree is set", () => {
    const args = buildClaudeArgs({
      taskName: "t",
      cwd: "/workspace/abc",
      repos: ["/workspace/abc/repo-alpha"],
      worktree: "feat/my-branch",
    });
    expect(args.includes("--add-dir")).toBe(false);
  });

  it("omits --add-dir when repos is not provided", () => {
    const args = buildClaudeArgs({ taskName: "t", cwd: "/workspace/abc" });
    expect(args.includes("--add-dir")).toBe(false);
  });

  it("omits --add-dir when repos is empty", () => {
    const args = buildClaudeArgs({ taskName: "t", cwd: "/workspace/abc", repos: [] });
    expect(args.includes("--add-dir")).toBe(false);
  });

  it("includes --agent before --model when agent is set", () => {
    const args = buildClaudeArgs({
      taskName: "t",
      cwd: "/workspace/abc",
      agent: "EC-1-orchestrator",
      model: "opus",
    });
    const agentIdx = args.indexOf("--agent");
    const modelIdx = args.indexOf("--model");
    expect(agentIdx).not.toBe(-1);
    expect(args[agentIdx + 1]).toBe("EC-1-orchestrator");
    expect(agentIdx).toBeLessThan(modelIdx);
  });

  it("omits --agent when not set", () => {
    const args = buildClaudeArgs({ taskName: "t", cwd: "/workspace/abc", model: "opus" });
    expect(args.includes("--agent")).toBe(false);
  });

  it("defaults --model to sonnet when model is not set", () => {
    const args = buildClaudeArgs({ taskName: "t", cwd: "/workspace/abc" });
    const idx = args.indexOf("--model");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("sonnet");
  });

  it("omits --permission-mode when not set", () => {
    const args = buildClaudeArgs({ taskName: "t", cwd: "/workspace/abc" });
    expect(args.includes("--permission-mode")).toBe(false);
  });

  it("includes --permission-mode when permissionMode is set", () => {
    const args = buildClaudeArgs({
      taskName: "t",
      cwd: "/workspace/abc",
      permissionMode: "acceptEdits",
    });
    const idx = args.indexOf("--permission-mode");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("acceptEdits");
  });

  it("includes --session-id when sessionId is set", () => {
    const args = buildClaudeArgs({ taskName: "t", cwd: "/workspace/abc", sessionId: "abc-123" });
    const idx = args.indexOf("--session-id");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("abc-123");
  });

  it("includes --resume when resumeSession is set", () => {
    const args = buildClaudeArgs({
      taskName: "t",
      cwd: "/workspace/abc",
      resumeSession: "abc-123",
    });
    const idx = args.indexOf("--resume");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("abc-123");
  });
});

// ─── Watchdog retry logic ────────────────────────────────────────────────────
// ClaudeRunner.run calls spawnClaude (can't mock without mock.module) + WorktreeWatchdog.
// We test the retry contract by extracting the core logic into a harness
// that accepts an injected spawn function.

const WORKTREE_MAX_ATTEMPTS = 2;

/** Reimplements ClaudeRunner.runOnce logic for testability with injected spawn */
async function runWithWatchdog(
  spawnFn: () => SpawnClaudeHandle,
  watchdog: WorktreeWatchdog,
  wtPath: string,
  attempt = 1,
): Promise<{ code: number; stdout: string }> {
  const handle = spawnFn();
  const wd = watchdog.watch(wtPath);
  const result = await Promise.race([
    handle.result.then((r) => ({ kind: "done" as const, ...r })),
    wd.hung.then((kind) => ({ kind })),
  ]);

  wd.cancel();

  if (result.kind === "hung") {
    await handle.kill();
    if (attempt < WORKTREE_MAX_ATTEMPTS) {
      return runWithWatchdog(spawnFn, watchdog, wtPath, attempt + 1);
    }
    return {
      code: 1,
      stdout: `HUNG: worktree never created after ${WORKTREE_MAX_ATTEMPTS} attempts`,
    };
  }
  return { code: result.code, stdout: result.stdout };
}

function keepAlive(ms: number): { clear: () => void } {
  const t = setTimeout(() => {}, ms);
  return { clear: () => clearTimeout(t) };
}

const successSpawnFn = () => ({
  result: Promise.resolve({ code: 0, stdout: "done" }),
  kill: async () => {},
});

describe("watchdog retry logic", () => {
  it("returns result when spawn completes before watchdog timeout", async () => {
    const alive = keepAlive(500);
    const wtDir = join(TMP_DIR, "wt-success");
    mkdirSync(wtDir, { recursive: true });
    try {
      const watchdog = new WorktreeWatchdog({ timeoutMs: 200, pollMs: 20 });
      const result = await runWithWatchdog(successSpawnFn, watchdog, wtDir);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("done");
    } finally {
      alive.clear();
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("retries once when watchdog fires hung", async () => {
    const alive = keepAlive(1000);
    const wtDir = join(TMP_DIR, "wt-retry");
    rmSync(TMP_DIR, { recursive: true, force: true });

    let spawnCount = 0;
    let killCount = 0;
    const watchdog = new WorktreeWatchdog({ timeoutMs: 50, pollMs: 10 });

    const spawnFn = (): SpawnClaudeHandle => {
      spawnCount++;
      if (spawnCount === 1) {
        return {
          result: new Promise(() => {}),
          kill: async () => {
            killCount++;
          },
        };
      }
      mkdirSync(wtDir, { recursive: true });
      return {
        result: Promise.resolve({ code: 0, stdout: "retried" }),
        kill: async () => {},
      };
    };

    const result = await runWithWatchdog(spawnFn, watchdog, wtDir);

    alive.clear();
    rmSync(TMP_DIR, { recursive: true, force: true });

    expect(spawnCount).toBe(2);
    expect(killCount).toBe(1);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("retried");
  });

  it("gives up after max attempts", async () => {
    const alive = keepAlive(1000);
    rmSync(TMP_DIR, { recursive: true, force: true });

    let spawnCount = 0;
    let killCount = 0;
    const watchdog = new WorktreeWatchdog({ timeoutMs: 50, pollMs: 10 });
    const wtDir = join(TMP_DIR, "wt-giveup");

    const spawnFn = (): SpawnClaudeHandle => {
      spawnCount++;
      return {
        result: new Promise(() => {}),
        kill: async () => {
          killCount++;
        },
      };
    };

    const result = await runWithWatchdog(spawnFn, watchdog, wtDir);

    alive.clear();

    expect(spawnCount).toBe(2);
    expect(killCount).toBe(2);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("HUNG");
  });

  it("passes through non-zero exit codes without retry", async () => {
    const alive = keepAlive(500);
    const wtDir = join(TMP_DIR, "wt-fail");
    mkdirSync(wtDir, { recursive: true });
    try {
      const watchdog = new WorktreeWatchdog({ timeoutMs: 200, pollMs: 20 });
      let spawnCount = 0;

      const spawnFn = (): SpawnClaudeHandle => {
        spawnCount++;
        return {
          result: Promise.resolve({ code: 1, stdout: "error output" }),
          kill: async () => {},
        };
      };

      const result = await runWithWatchdog(spawnFn, watchdog, wtDir);

      expect(spawnCount).toBe(1);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("error output");
    } finally {
      alive.clear();
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });
});
