import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ClaudeRunner, buildClaudeArgs } from "./claude-runner.js";

const TMP_DIR = join(import.meta.dirname, ".test-tmp-claude-runner");

void describe("ClaudeRunner", () => {
  void describe("writeLog", () => {
    const runner = new ClaudeRunner(TMP_DIR, "/dev/null");

    void it("writes content to log file with correct name", () => {
      mkdirSync(TMP_DIR, { recursive: true });
      try {
        const path = runner.writeLog("task", "EC-123", "forge output here");
        assert.equal(path, join(TMP_DIR, "task-EC-123.log"));
        assert.equal(readFileSync(path, "utf-8"), "forge output here");
      } finally {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    });

    void it("returns the full path to the log file", () => {
      mkdirSync(TMP_DIR, { recursive: true });
      try {
        const path = runner.writeLog("merge", "EC-456", "merge output");
        assert.ok(path.endsWith("merge-EC-456.log"));
      } finally {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    });
  });
});

// ─── buildClaudeArgs ─────────────────────────────────────────────────────────

void describe("buildClaudeArgs", () => {
  void it("includes --add-dir for each repo when no worktree", () => {
    const args = buildClaudeArgs({
      taskName: "t",
      cwd: "/workspace/abc",
      repos: ["/workspace/abc/repo-alpha", "/workspace/abc/repo-beta"],
    });
    const idx = args.indexOf("--add-dir");
    assert.ok(idx !== -1, "--add-dir must be present");
    assert.equal(args[idx + 1], "/workspace/abc/repo-alpha");
    assert.equal(args[idx + 2], "/workspace/abc/repo-beta");
  });

  void it("omits --add-dir when a worktree is set", () => {
    const args = buildClaudeArgs({
      taskName: "t",
      cwd: "/workspace/abc",
      repos: ["/workspace/abc/repo-alpha"],
      worktree: "feat/my-branch",
    });
    assert.ok(!args.includes("--add-dir"));
  });

  void it("omits --add-dir when repos is not provided", () => {
    const args = buildClaudeArgs({ taskName: "t", cwd: "/workspace/abc" });
    assert.ok(!args.includes("--add-dir"));
  });

  void it("omits --add-dir when repos is empty", () => {
    const args = buildClaudeArgs({ taskName: "t", cwd: "/workspace/abc", repos: [] });
    assert.ok(!args.includes("--add-dir"));
  });
});

// ─── Watchdog retry logic ────────────────────────────────────────────────────
// ClaudeRunner.run calls spawnClaude (can't mock without mock.module) + WorktreeWatchdog.
// We test the retry contract by extracting the core logic into a harness
// that accepts an injected spawn function.

import { WorktreeWatchdog } from "./worktree-watchdog.js";
import type { SpawnClaudeHandle } from "../lib/claude.js";

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

void describe("watchdog retry logic", () => {
  void it("returns result when spawn completes before watchdog timeout", async () => {
    const alive = keepAlive(500);
    const wtDir = join(TMP_DIR, "wt-success");
    mkdirSync(wtDir, { recursive: true });
    try {
      const watchdog = new WorktreeWatchdog({ timeoutMs: 200, pollMs: 20 });

      const result = await runWithWatchdog(successSpawnFn, watchdog, wtDir);
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "done");
    } finally {
      alive.clear();
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  void it("retries once when watchdog fires hung", async () => {
    const alive = keepAlive(1000);
    const wtDir = join(TMP_DIR, "wt-retry");
    rmSync(TMP_DIR, { recursive: true, force: true });

    let spawnCount = 0;
    let killCount = 0;
    const watchdog = new WorktreeWatchdog({ timeoutMs: 50, pollMs: 10 });

    const spawnFn = (): SpawnClaudeHandle => {
      spawnCount++;
      if (spawnCount === 1) {
        // First attempt: never resolve (simulates hung process)
        return {
          result: new Promise(() => {}),
          kill: async () => {
            killCount++;
          },
        };
      }
      // Second attempt: create the dir and resolve
      mkdirSync(wtDir, { recursive: true });
      return {
        result: Promise.resolve({ code: 0, stdout: "retried" }),
        kill: async () => {},
      };
    };

    const result = await runWithWatchdog(spawnFn, watchdog, wtDir);

    alive.clear();
    rmSync(TMP_DIR, { recursive: true, force: true });

    assert.equal(spawnCount, 2, "should have spawned twice");
    assert.equal(killCount, 1, "should have killed the hung process");
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "retried");
  });

  void it("gives up after max attempts", async () => {
    const alive = keepAlive(1000);
    rmSync(TMP_DIR, { recursive: true, force: true });

    let spawnCount = 0;
    let killCount = 0;
    const watchdog = new WorktreeWatchdog({ timeoutMs: 50, pollMs: 10 });
    const wtDir = join(TMP_DIR, "wt-giveup");

    const spawnFn = (): SpawnClaudeHandle => {
      spawnCount++;
      return {
        result: new Promise(() => {}), // always hang
        kill: async () => {
          killCount++;
        },
      };
    };

    const result = await runWithWatchdog(spawnFn, watchdog, wtDir);

    alive.clear();

    assert.equal(spawnCount, 2, "should have tried twice");
    assert.equal(killCount, 2, "should have killed both attempts");
    assert.equal(result.code, 1);
    assert.ok(result.stdout.includes("HUNG"));
  });

  void it("passes through non-zero exit codes without retry", async () => {
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

      assert.equal(spawnCount, 1, "should not retry on normal failure");
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "error output");
    } finally {
      alive.clear();
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });
});
