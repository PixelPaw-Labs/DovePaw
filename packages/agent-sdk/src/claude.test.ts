import { spawn } from "node:child_process";
import { buildSpawnEnv, PERSONA_RULES } from "./claude.js";

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

describe("PERSONA_RULES", () => {
  it("instructs first-person responses", () => {
    expect(PERSONA_RULES).toMatch(/first person/i);
  });

  it("forbids preamble", () => {
    expect(PERSONA_RULES).toMatch(/no preamble/i);
  });

  it("enforces role boundaries", () => {
    expect(PERSONA_RULES).toMatch(/stay within your role/i);
  });
});

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
