import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { killStaleProcess, writePidFile, removePidFile } from "@@/lib/process-orphan-cleanup";

const tmpRoot = mkdtempSync(join(tmpdir(), "dovepaw-orphan-"));
const pidFile = join(tmpRoot, ".pid");

beforeEach(() => {
  if (existsSync(pidFile)) rmSync(pidFile);
});

afterEach(() => {
  if (existsSync(pidFile)) rmSync(pidFile);
});

describe("killStaleProcess", () => {
  it("is a no-op when the PID file is missing", async () => {
    await expect(killStaleProcess(pidFile, /never-matches/)).resolves.toBeUndefined();
  });

  it("is a no-op when the PID file's process is not alive", async () => {
    writeFileSync(pidFile, "9999999"); // unlikely-to-exist PID
    await expect(killStaleProcess(pidFile, /openviking/)).resolves.toBeUndefined();
    // Should also remove the stale PID file.
    expect(existsSync(pidFile)).toBe(false);
  });

  it("does NOT kill a live process whose cmdline doesn't match", async () => {
    // current process — definitely alive, but cmdline is `node`/`vitest`, not `openviking`
    writeFileSync(pidFile, String(process.pid));
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    await killStaleProcess(pidFile, /openviking-server/);
    const deadlyCalls = killSpy.mock.calls.filter(
      ([, sig]) => sig === "SIGTERM" || sig === "SIGKILL",
    );
    expect(deadlyCalls).toHaveLength(0);
    killSpy.mockRestore();
  });

  it("kills the live process when cmdline matches", async () => {
    writeFileSync(pidFile, String(process.pid));
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    // Use a regex that matches the test runner's own cmdline (likely node)
    await killStaleProcess(pidFile, /node|vitest|tsx/);
    // SIGTERM should have been issued at least once
    const sigtermCalls = killSpy.mock.calls.filter(([, sig]) => sig === "SIGTERM");
    expect(sigtermCalls.length).toBeGreaterThan(0);
    killSpy.mockRestore();
  });
});

describe("writePidFile / removePidFile", () => {
  it("writes the PID as a plain integer string", () => {
    writePidFile(pidFile, 12345);
    expect(existsSync(pidFile)).toBe(true);
  });

  it("removePidFile is idempotent when the file is absent", () => {
    expect(() => removePidFile(pidFile)).not.toThrow();
  });
});
