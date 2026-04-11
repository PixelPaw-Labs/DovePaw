import { spawn } from "node:child_process";
import { buildSpawnEnv, spawnClaudeWithSignals } from "./claude.js";

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

describe("buildSpawnEnv", () => {
  it("sets CLAUDE_SCHEDULER_TASK to taskName", () => {
    const env = buildSpawnEnv("get-shit-done: forge EC-123");
    expect(env.CLAUDE_SCHEDULER_TASK).toBe("get-shit-done: forge EC-123");
  });

  it("sets CLAUDE_SCHEDULER_SUPPRESS_NOTIFY=1 when suppressNotify is true", () => {
    expect(buildSpawnEnv("task", true).CLAUDE_SCHEDULER_SUPPRESS_NOTIFY).toBe("1");
  });

  it("sets CLAUDE_SCHEDULER_SUPPRESS_NOTIFY to empty when suppressNotify is false", () => {
    expect(buildSpawnEnv("task", false).CLAUDE_SCHEDULER_SUPPRESS_NOTIFY).toBe("");
  });

  it("sets CLAUDE_SCHEDULER_SUPPRESS_NOTIFY to empty when suppressNotify is undefined", () => {
    expect(buildSpawnEnv("task").CLAUDE_SCHEDULER_SUPPRESS_NOTIFY).toBe("");
  });

  it("unsets CLAUDECODE", () => {
    expect(buildSpawnEnv("task").CLAUDECODE).toBeUndefined();
  });
});

describe("spawnClaudeWithSignals", () => {
  it("registers SIGTERM/SIGINT handlers during execution and removes them after", async () => {
    const sigtermBefore = process.listenerCount("SIGTERM");
    const sigintBefore = process.listenerCount("SIGINT");
    let sigtermDuring = -1;
    let sigintDuring = -1;

    const handle = spawnTestProcess("/bin/echo", ["ok"]);
    const shutdown = () => void handle.kill().then(() => process.exit(0));
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    sigtermDuring = process.listenerCount("SIGTERM");
    sigintDuring = process.listenerCount("SIGINT");
    try {
      const { code, stdout } = await handle.result;
      expect(code).toBe(0);
      expect(stdout.trim()).toBe("ok");
    } finally {
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
    }

    expect(sigtermDuring).toBe(sigtermBefore + 1);
    expect(sigintDuring).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  });

  it("is exported from claude.ts", () => {
    expect(typeof spawnClaudeWithSignals).toBe("function");
  });
});

describe("spawnClaude handle pattern", () => {
  it("captures stdout and exit code 0", async () => {
    const { code, stdout } = await spawnTestProcess("/bin/echo", ["hello world"]).result;
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("hello world");
  });

  it("returns non-zero exit code", async () => {
    const { code } = await spawnTestProcess("/bin/bash", ["-c", "exit 42"]).result;
    expect(code).toBe(42);
  });

  it("kill terminates a running process", async () => {
    const handle = spawnTestProcess("/bin/sleep", ["60"]);
    await handle.kill();
    const { code } = await handle.result;
    expect(code).not.toBe(0);
  });

  it("kill is safe to call on already-exited process", async () => {
    const handle = spawnTestProcess("/bin/bash", ["-c", "exit 0"]);
    await handle.result;
    await expect(handle.kill()).resolves.toBeUndefined();
  });

  it("timeout kills the process", async () => {
    const { code } = await spawnTestProcess("/bin/sleep", ["60"], 100).result;
    expect(code).not.toBe(0);
  });
});
