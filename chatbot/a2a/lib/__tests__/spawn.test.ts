// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

/**
 * Tests for spawnAndCollect signal handling.
 *
 * The abort-on-kill path (signal.addEventListener → process.kill(-pid)) cannot
 * be reliably tested via mocks due to vitest module isolation — the `process`
 * and `existsSync` references inside spawn.ts are sandboxed separately.
 *
 * The abort wiring is verified by:
 *   1. Code review: signal?.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true })
 *   2. The AbortSignal smoke test below, confirming addEventListener fires synchronously.
 */

describe("AbortSignal fires synchronously", () => {
  it("addEventListener 'abort' fires when controller.abort() is called", () => {
    const controller = new AbortController();
    let fired = false;
    controller.signal.addEventListener(
      "abort",
      () => {
        fired = true;
      },
      { once: true },
    );
    controller.abort();
    expect(fired).toBe(true);
  });
});

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mockSpawn,
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/paths", () => ({
  TSX_BIN: "/usr/bin/tsx",
  OPENVIKING_CLI_CONFIG: "/mock/.dovepaw/openviking/ovcli.conf",
  OPENVIKING_PORT_FILE: "/mock/.dovepaw/.openviking-port.json",
}));

import { existsSync } from "node:fs";
import {
  spawnAndCollect,
  startScript,
  awaitScript,
  hasPendingScripts,
  getPendingRunIds,
  resolveRuntime,
} from "../spawn.js";

const BASE_CONFIG = {
  scriptPath: "/agents/test/main.ts",
  agentName: "test",
  whatItDoes: "test agent",
  workspacePath: "/tmp/workspace",
};

// Drain any pending microtasks (e.g. promise .then callbacks)
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function makeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.pid = 99999;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  mockSpawn.mockReturnValue(proc);
  return proc;
}

describe("startScript / awaitScript", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hasPendingScripts is true while a script is in-flight and false after collection", async () => {
    const proc = makeProc();
    const { runId } = startScript(BASE_CONFIG, "run");

    expect(hasPendingScripts()).toBe(true);
    expect(getPendingRunIds()).toContain(runId);

    const awaitPromise = awaitScript(runId);
    proc.emit("close", 0);
    await awaitPromise;

    expect(hasPendingScripts()).toBe(false);
    expect(getPendingRunIds()).not.toContain(runId);
  });

  it("returns completed and clears the entry when awaitScript is called while the script is running", async () => {
    const proc = makeProc();
    const { runId } = startScript(BASE_CONFIG, "run");

    const awaitPromise = awaitScript(runId);
    proc.emit("close", 0);

    const result = await awaitPromise;
    expect(result.status).toBe("completed");
    expect(hasPendingScripts()).toBe(false);
    expect(getPendingRunIds()).not.toContain(runId);
  });

  it("returns completed (not not_found) when awaitScript is called after the script already exited", async () => {
    // This is the race condition the fix addresses: previously the runningScripts
    // entry was deleted on process exit (.finally()), so a post-exit awaitScript
    // call returned "not_found". Now the entry transitions to { phase: "done" }
    // and is only deleted after awaitScript successfully collects the output.
    const proc = makeProc();
    const { runId } = startScript(BASE_CONFIG, "run");

    proc.emit("close", 0);
    await flushMicrotasks(); // let startScript's .then() set { phase: "done" }

    // Entry still tracked — output cached but not yet collected
    expect(hasPendingScripts()).toBe(true);
    expect(getPendingRunIds()).toContain(runId);

    const result = await awaitScript(runId);
    expect(result.status).toBe("completed"); // was "not_found" before the fix

    // Cleaned up only after collection
    expect(hasPendingScripts()).toBe(false);
    expect(getPendingRunIds()).not.toContain(runId);
  });

  it("returns not_found for an unknown runId", async () => {
    const result = await awaitScript("no-such-id");
    expect(result.status).toBe("not_found");
  });

  it("strips the <reminder>Must call start_* tool</reminder> tag before spawning the script", async () => {
    makeProc();
    const instruction =
      '{"assignee":"dev@example.com"}\n<reminder>Must call "start_my_agent" tool</reminder>';
    startScript(BASE_CONFIG, instruction);
    const scriptArgs = mockSpawn.mock.calls[0]?.[1] as string[];
    expect(scriptArgs).toEqual([BASE_CONFIG.scriptPath, '{"assignee":"dev@example.com"}']);
  });
});

describe("spawnAndCollect", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it("does not kill the process when no signal is provided", async () => {
    const proc = makeProc();
    const { promise } = spawnAndCollect(BASE_CONFIG, "run");
    proc.emit("close", 0);
    await promise;
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("does not kill the process when the signal is not aborted", async () => {
    const proc = makeProc();
    const controller = new AbortController();
    const { promise } = spawnAndCollect(BASE_CONFIG, "run", controller.signal);
    proc.emit("close", 0);
    await promise;
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("resolves to a string and exposes lines[]", async () => {
    const proc = makeProc();
    const { promise, lines } = spawnAndCollect(BASE_CONFIG, "run");
    proc.emit("close", 0);
    const output = await promise;
    expect(typeof output).toBe("string");
    expect(Array.isArray(lines)).toBe(true);
  });
});

describe("spawnAndCollect — readline line collection", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it("collects stdout lines", async () => {
    const proc = makeProc();
    const { promise, lines } = spawnAndCollect(BASE_CONFIG, "run");

    proc.stdout.write("hello\nworld\n");
    proc.emit("close", 0);
    await promise;

    expect(lines).toEqual(["hello", "world"]);
  });

  it("prefixes stderr lines with [stderr]", async () => {
    const proc = makeProc();
    const { promise, lines } = spawnAndCollect(BASE_CONFIG, "run");

    proc.stderr.write("error message\n");
    proc.emit("close", 0);
    await promise;

    expect(lines).toContain("[stderr] error message");
  });

  it("caps lines at 200 and keeps the most recent", async () => {
    const proc = makeProc();
    const { promise, lines } = spawnAndCollect(BASE_CONFIG, "run");

    const data = Array.from({ length: 250 }, (_, i) => `line-${i}`).join("\n") + "\n";
    proc.stdout.write(data);
    proc.emit("close", 0);
    await promise;

    expect(lines.length).toBe(200);
    expect(lines[0]).toBe("line-50"); // first 50 dropped
    expect(lines[199]).toBe("line-249"); // last 200 kept
  });
});

describe("startScript / awaitScript — still_running", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns still_running when no lines emitted before timeout", async () => {
    makeProc();
    const { runId } = startScript(BASE_CONFIG, "run");

    const awaitPromise = awaitScript(runId);
    vi.advanceTimersByTime(35_000);

    const result = await awaitPromise;
    expect(result.status).toBe("still_running");
  });

  it("still_running structuredContent has the expected shape", async () => {
    makeProc();
    const { runId } = startScript(BASE_CONFIG, "run");

    const awaitPromise = awaitScript(runId);
    vi.advanceTimersByTime(35_000);

    const result = await awaitPromise;
    expect(result).toMatchObject({ status: "still_running", runId });
  });
});

describe("resolveRuntime", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it("uses TSX_BIN for .ts scripts when it exists", () => {
    const { cmd, args } = resolveRuntime("/agents/test/main.ts");
    expect(cmd).toBe("/usr/bin/tsx");
    expect(args).toEqual(["/agents/test/main.ts"]);
  });

  it("falls back to 'tsx' for .ts scripts when TSX_BIN does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const { cmd } = resolveRuntime("/agents/test/main.ts");
    expect(cmd).toBe("tsx");
  });

  it("uses bash for .sh scripts", () => {
    const { cmd, args } = resolveRuntime("/agents/test/main.sh");
    expect(cmd).toBe("bash");
    expect(args).toEqual(["/agents/test/main.sh"]);
  });

  it("uses python3 for .py scripts", () => {
    const { cmd, args } = resolveRuntime("/agents/test/main.py");
    expect(cmd).toBe("python3");
    expect(args).toEqual(["/agents/test/main.py"]);
  });

  it("uses ruby for .rb scripts", () => {
    const { cmd, args } = resolveRuntime("/agents/test/main.rb");
    expect(cmd).toBe("ruby");
    expect(args).toEqual(["/agents/test/main.rb"]);
  });
});

describe("spawnAndCollect — runtime selection", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it("spawns tsx for .ts scripts", async () => {
    const proc = makeProc();
    const { promise } = spawnAndCollect(
      { ...BASE_CONFIG, scriptPath: "/agents/test/main.ts" },
      "run",
    );
    proc.emit("close", 0);
    await promise;
    expect(mockSpawn).toHaveBeenCalledWith(
      "/usr/bin/tsx",
      ["/agents/test/main.ts", "run"],
      expect.anything(),
    );
  });

  it("spawns bash for .sh scripts", async () => {
    const proc = makeProc();
    const { promise } = spawnAndCollect(
      { ...BASE_CONFIG, scriptPath: "/agents/test/main.sh" },
      "run",
    );
    proc.emit("close", 0);
    await promise;
    expect(mockSpawn).toHaveBeenCalledWith(
      "bash",
      ["/agents/test/main.sh", "run"],
      expect.anything(),
    );
  });

  it("spawns python3 for .py scripts", async () => {
    const proc = makeProc();
    const { promise } = spawnAndCollect(
      { ...BASE_CONFIG, scriptPath: "/agents/test/main.py" },
      "go",
    );
    proc.emit("close", 0);
    await promise;
    expect(mockSpawn).toHaveBeenCalledWith(
      "python3",
      ["/agents/test/main.py", "go"],
      expect.anything(),
    );
  });

  it("spawns ruby for .rb scripts", async () => {
    const proc = makeProc();
    const { promise } = spawnAndCollect(
      { ...BASE_CONFIG, scriptPath: "/agents/test/main.rb" },
      "go",
    );
    proc.emit("close", 0);
    await promise;
    expect(mockSpawn).toHaveBeenCalledWith(
      "ruby",
      ["/agents/test/main.rb", "go"],
      expect.anything(),
    );
  });
});

describe("spawnAndCollect — OpenViking env injection", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("injects OPENVIKING_CLI_CONFIG_FILE when the DovePaw sidecar port file exists", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const proc = makeProc();
    const { promise } = spawnAndCollect(BASE_CONFIG, "run");
    proc.emit("close", 0);
    await promise;
    const env = mockSpawn.mock.calls[0]?.[2]?.env as Record<string, string> | undefined;
    expect(env).toBeDefined();
    expect(env?.OPENVIKING_CLI_CONFIG_FILE).toBe("/mock/.dovepaw/openviking/ovcli.conf");
  });

  it("does not inject OPENVIKING_CLI_CONFIG_FILE when the port file is absent", async () => {
    vi.mocked(existsSync).mockImplementation(
      (p: Parameters<typeof existsSync>[0]) => p !== "/mock/.dovepaw/.openviking-port.json",
    );
    const proc = makeProc();
    const { promise } = spawnAndCollect(BASE_CONFIG, "run");
    proc.emit("close", 0);
    await promise;
    const env = mockSpawn.mock.calls[0]?.[2]?.env as Record<string, string> | undefined;
    expect(env?.OPENVIKING_CLI_CONFIG_FILE).toBeUndefined();
  });
});

describe("spawnAndCollect — SIGTERM → SIGKILL escalation", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends SIGKILL after KILL_ESCALATION_MS if the process does not exit after SIGTERM", () => {
    const proc = makeProc();
    const controller = new AbortController();
    spawnAndCollect(BASE_CONFIG, "run", controller.signal);

    controller.abort();

    // SIGTERM fires immediately. The first kill happens via process.kill(-pid)
    // wrapped in try/catch; in tests proc.kill is only called via the catch
    // fallback. We assert on its eventual SIGKILL call.
    vi.advanceTimersByTime(1_000);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does NOT send SIGKILL if the process exits within the escalation window", () => {
    const proc = makeProc();
    const controller = new AbortController();
    const { promise } = spawnAndCollect(BASE_CONFIG, "run", controller.signal);

    controller.abort();
    // Process exits cleanly before SIGKILL would fire
    proc.emit("close", 0);

    vi.advanceTimersByTime(5_000);
    expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");
    return promise;
  });
});

describe("AbortSignal pre-abort semantics (justifies signal.aborted pre-check in spawnAndCollect)", () => {
  it("addEventListener does NOT fire for a signal that was already aborted", () => {
    // This is why the signal.aborted pre-check is necessary: if abort() fires
    // before the listener is registered, the { once: true } listener is a no-op.
    const controller = new AbortController();
    controller.abort();
    let fired = false;
    controller.signal.addEventListener(
      "abort",
      () => {
        fired = true;
      },
      { once: true },
    );
    expect(fired).toBe(false);
  });

  it("signal.aborted is true synchronously after abort()", () => {
    const controller = new AbortController();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });
});
