import { spawn } from "node:child_process";
import { join } from "node:path";
import { CLAUDE_CLI, buildSpawnEnv, PERSONA_RULES, sanitizeForSkillArg } from "./claude.js";

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

describe("CLAUDE_CLI", () => {
  it("defaults to ~/.local/bin/claude when CLAUDE_CLI_PATH is not set", () => {
    if (!process.env.CLAUDE_CLI_PATH) {
      expect(CLAUDE_CLI).toBe(join(process.env.HOME!, ".local/bin/claude"));
    }
  });

  it("resolves to CLAUDE_CLI_PATH when env var is set", () => {
    const expected = process.env.CLAUDE_CLI_PATH ?? join(process.env.HOME!, ".local/bin/claude");
    expect(CLAUDE_CLI).toBe(expected);
  });
});

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

describe("sanitizeForSkillArg", () => {
  it("strips single and double quotes that would break the argument wrapper", () => {
    expect(sanitizeForSkillArg(`concurrently pins "shell-quote" at '1.8.3'`)).toBe(
      "concurrently pins shell-quote at 1.8.3",
    );
  });

  it("collapses newlines and runs of whitespace into single spaces", () => {
    expect(sanitizeForSkillArg("line one\n  line two\t\tline three")).toBe(
      "line one line two line three",
    );
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeForSkillArg("  padded reason  ")).toBe("padded reason");
  });

  it("leaves clean text unchanged", () => {
    const clean = "ancestor upgrade could not reach 1.8.4 so a scoped resolution overrides it";
    expect(sanitizeForSkillArg(clean)).toBe(clean);
  });
});
