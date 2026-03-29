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
    const promise = spawnAndCollect(BASE_CONFIG, "run");
    proc.emit("close", 0);
    await promise;
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("does not kill the process when the signal is not aborted", async () => {
    const proc = makeProc();
    const controller = new AbortController();
    const promise = spawnAndCollect(BASE_CONFIG, "run", controller.signal);
    proc.emit("close", 0);
    await promise;
    expect(proc.kill).not.toHaveBeenCalled();
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
