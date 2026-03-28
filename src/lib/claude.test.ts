import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { buildSpawnEnv } from "./claude.js";

/**
 * Minimal reimplementation of spawnClaude's handle pattern for testability.
 * Uses the same kill logic (SIGTERM → 5s → SIGKILL) and close tracking.
 */
function spawnTestProcess(
  cmd: string,
  args: string[],
  timeoutMs = 5_000,
): { result: Promise<{ code: number; stdout: string }>; kill: () => Promise<void> } {
  let closed = false;
  let killFn: () => Promise<void> = async () => {};

  const result = new Promise<{ code: number; stdout: string }>((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    const closedPromise = new Promise<void>((r) => child.on("close", () => r()));

    killFn = async () => {
      if (closed) return;
      child.kill("SIGTERM");
      const waited = await Promise.race([
        closedPromise.then(() => "exited" as const),
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000)),
      ]);
      if (waited === "timeout") {
        child.kill("SIGKILL");
        await closedPromise;
      }
    };

    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));

    const timer = setTimeout(() => void killFn(), timeoutMs);

    child.on("close", (code) => {
      closed = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString() });
    });
  });

  return { result, kill: () => killFn() };
}

void describe("buildSpawnEnv", () => {
  void it("sets CLAUDE_SCHEDULER_TASK to taskName", () => {
    const env = buildSpawnEnv("get-shit-done: forge EC-123");
    assert.equal(env.CLAUDE_SCHEDULER_TASK, "get-shit-done: forge EC-123");
  });

  void it("sets CLAUDE_SCHEDULER_SUPPRESS_NOTIFY=1 when suppressNotify is true", () => {
    const env = buildSpawnEnv("task", true);
    assert.equal(env.CLAUDE_SCHEDULER_SUPPRESS_NOTIFY, "1");
  });

  void it("sets CLAUDE_SCHEDULER_SUPPRESS_NOTIFY to empty when suppressNotify is false", () => {
    const env = buildSpawnEnv("task", false);
    assert.equal(env.CLAUDE_SCHEDULER_SUPPRESS_NOTIFY, "");
  });

  void it("sets CLAUDE_SCHEDULER_SUPPRESS_NOTIFY to empty when suppressNotify is undefined", () => {
    const env = buildSpawnEnv("task");
    assert.equal(env.CLAUDE_SCHEDULER_SUPPRESS_NOTIFY, "");
  });

  void it("unsets CLAUDECODE", () => {
    const env = buildSpawnEnv("task");
    assert.equal(env.CLAUDECODE, undefined);
  });
});

void describe("spawnClaude handle pattern", () => {
  void it("captures stdout and exit code 0", async () => {
    const handle = spawnTestProcess("/bin/echo", ["hello world"]);
    const { code, stdout } = await handle.result;

    assert.equal(code, 0);
    assert.equal(stdout.trim(), "hello world");
  });

  void it("returns non-zero exit code", async () => {
    const handle = spawnTestProcess("/bin/bash", ["-c", "exit 42"]);
    const { code } = await handle.result;

    assert.equal(code, 42);
  });

  void it("kill terminates a running process", async () => {
    const handle = spawnTestProcess("/bin/sleep", ["60"]);

    await handle.kill();
    const { code } = await handle.result;

    assert.ok(code !== 0, `expected non-zero exit code, got ${code}`);
  });

  void it("kill is safe to call on already-exited process", async () => {
    const handle = spawnTestProcess("/bin/bash", ["-c", "exit 0"]);
    await handle.result;

    // Should not throw
    await handle.kill();
  });

  void it("timeout kills the process", async () => {
    const handle = spawnTestProcess("/bin/sleep", ["60"], 100);
    const { code } = await handle.result;

    assert.ok(code !== 0, `expected non-zero exit code from timeout, got ${code}`);
  });
});
