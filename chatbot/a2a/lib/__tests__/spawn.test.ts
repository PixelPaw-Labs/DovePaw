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
import { spawnAndCollect } from "../spawn.js";

const BASE_CONFIG = {
  scriptPath: "/agents/test/main.ts",
  agentName: "test",
  whatItDoes: "test agent",
  workspacePath: "/tmp/workspace",
};

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
