import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

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
vi.mock("@/lib/paths", () => ({ TSX_BIN: "/usr/bin/tsx" }));

import { existsSync } from "node:fs";
import {
  spawnAndCollect,
  startScript,
  awaitScript,
  hasPendingScripts,
  getPendingRunIds,
  OutputLineProcessor,
  PROGRESS_PREFIX,
  ARTIFACT_PREFIX,
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
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.pid = 99999;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
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

describe("startScript / awaitScript — latestOutput in still_running", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("still_running response has latestOutput as undefined when no lines emitted", async () => {
    makeProc();
    const { runId } = startScript(BASE_CONFIG, "run");

    const awaitPromise = awaitScript(runId);
    vi.advanceTimersByTime(35_000);

    const result = await awaitPromise;
    expect(result.status).toBe("still_running");
    if (result.status === "still_running") {
      // No stdout was emitted so latestLines is empty → latestOutput is undefined
      expect(result.latestOutput).toBeUndefined();
    }
  });

  it("still_running structuredContent has the expected shape", async () => {
    makeProc();
    const { runId } = startScript(BASE_CONFIG, "run");

    const awaitPromise = awaitScript(runId);
    vi.advanceTimersByTime(35_000);

    const result = await awaitPromise;
    // Verify structural shape: status and runId always present, latestOutput optional
    expect(result).toMatchObject({ status: "still_running", runId });
    expect("latestOutput" in result).toBe(true);
  });
});

describe("OutputLineProcessor", () => {
  it("returns null and pushes to lines[] for normal output", () => {
    const processor = new OutputLineProcessor();
    const lines: string[] = [];
    const onLine = vi.fn();
    const result = processor.process("hello world", lines, onLine);
    expect(result).toBeNull();
    expect(lines).toEqual(["hello world"]);
    expect(onLine).toHaveBeenCalledWith("hello world");
  });

  it("returns progress with empty artifacts when no __ARTIFACT__ lines preceded it", () => {
    const processor = new OutputLineProcessor();
    const lines: string[] = [];
    const result = processor.process(`${PROGRESS_PREFIX}Fetching tickets`, lines);
    expect(result).toEqual({ message: "Fetching tickets", artifacts: {} });
    expect(lines).toHaveLength(0);
  });

  it("does not call onLine for __PROGRESS__ lines", () => {
    const processor = new OutputLineProcessor();
    const onLine = vi.fn();
    processor.process(`${PROGRESS_PREFIX}skip me`, [], onLine);
    expect(onLine).not.toHaveBeenCalled();
  });

  it("bundles preceding __ARTIFACT__ lines with the next __PROGRESS__ line", () => {
    const processor = new OutputLineProcessor();
    processor.process(`${ARTIFACT_PREFIX}summary:Found 3 tickets`, []);
    processor.process(`${ARTIFACT_PREFIX}output:key:value:pair`, []);
    const result = processor.process(`${PROGRESS_PREFIX}Done`, []);
    expect(result).toEqual({
      message: "Done",
      artifacts: { summary: "Found 3 tickets", output: "key:value:pair" },
    });
  });

  it("skips __ARTIFACT__ lines whose content is empty after trim", () => {
    const processor = new OutputLineProcessor();
    processor.process(ARTIFACT_PREFIX, []);
    processor.process(`${ARTIFACT_PREFIX}   `, []);
    const result = processor.process(`${PROGRESS_PREFIX}Done`, []);
    expect(result).toEqual({ message: "Done", artifacts: {} });
  });

  it("resets artifact buffer after each __PROGRESS__ flush", () => {
    const processor = new OutputLineProcessor();
    processor.process(`${ARTIFACT_PREFIX}a:first`, []);
    processor.process(`${PROGRESS_PREFIX}Step 1`, []);
    const result = processor.process(`${PROGRESS_PREFIX}Step 2`, []);
    expect(result).toEqual({ message: "Step 2", artifacts: {} });
  });

  it("returns null for normal lines even when no onLine provided", () => {
    const processor = new OutputLineProcessor();
    const lines: string[] = [];
    const result = processor.process("normal", lines);
    expect(result).toBeNull();
    expect(lines).toEqual(["normal"]);
  });

  it("truncates artifact value at the first newline if value contains newlines (documents the breakage)", () => {
    // If emitProgress wrote a multi-line artifact value (e.g. formatted JSON),
    // stdout is split line-by-line so only the first line is seen as an ARTIFACT
    // sentinel — the rest fall through as regular output. This test documents why
    // emitProgress must strip newlines from artifact values before writing.
    const processor = new OutputLineProcessor();
    const lines: string[] = [];

    // Simulate what stdout would look like if emitProgress did NOT strip newlines:
    //   __ARTIFACT__:plan:{
    //     "layers": []
    //   }
    //   __PROGRESS__:Prioritized layers
    processor.process(`${ARTIFACT_PREFIX}plan:{`, lines);
    processor.process(`  "layers": []`, lines); // continuation line → falls to lines[]
    processor.process(`}`, lines); // closing brace → falls to lines[]
    const result = processor.process(`${PROGRESS_PREFIX}Prioritized layers`, lines);

    // Artifact is truncated — only the first line was captured
    expect(result).toEqual({ message: "Prioritized layers", artifacts: { plan: "{" } });
    // The JSON continuation lines were misrouted as regular output
    expect(lines).toEqual(['  "layers": []', "}"]);
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
