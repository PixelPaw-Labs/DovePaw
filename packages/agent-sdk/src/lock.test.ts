import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import {
  acquireLock,
  releaseLock,
  retainLock,
  registerChildPid,
  unregisterChildPid,
  _resetForTest,
  isLockData,
} from "./lock.js";
import { parseJson } from "./json.js";

interface LockData {
  pid: number;
  children: number[];
}
function readLockData(lockFile: string): LockData {
  const data = parseJson(readFileSync(lockFile, "utf-8"), isLockData);
  if (!data) throw new Error("Invalid lock data");
  return data;
}

function spawnSleeper(): { pid: number; kill: () => void } {
  const child = spawn("sleep", ["300"], { stdio: "ignore" });
  return {
    pid: child.pid!,
    kill: () => {
      try {
        process.kill(child.pid!, "SIGTERM");
      } catch {}
    },
  };
}

function waitForDeath(pid: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      try {
        process.kill(pid, 0);
        if (Date.now() < deadline) setTimeout(check, 50);
        else resolve(false);
      } catch {
        resolve(true);
      }
    };
    check();
  });
}

describe("lock", () => {
  let tmpDir: string;
  let lockFile: string;
  const sleepers: Array<{ kill: () => void }> = [];

  beforeEach(() => {
    _resetForTest();
    tmpDir = mkdtempSync(join(tmpdir(), "lock-test-"));
    lockFile = join(tmpDir, "lock");
  });

  afterEach(() => {
    try {
      unlinkSync(lockFile);
    } catch {}
    sleepers.forEach((s) => s.kill());
    sleepers.length = 0;
  });

  it("acquires lock and writes pid to file", () => {
    expect(acquireLock(lockFile)).toBe(true);
    expect(existsSync(lockFile)).toBe(true);
    const data = readLockData(lockFile);
    expect(data.pid).toBe(process.pid);
    expect(data.children).toEqual([]);
  });

  it("rejects second acquire when first is alive", () => {
    acquireLock(lockFile);
    expect(acquireLock(lockFile)).toBe(false);
  });

  it("reclaims stale lock from dead process", () => {
    writeFileSync(lockFile, JSON.stringify({ pid: 999999, children: [] }));
    expect(acquireLock(lockFile)).toBe(true);
    expect(readLockData(lockFile).pid).toBe(process.pid);
  });

  it("registerChildPid adds child to lock file", () => {
    acquireLock(lockFile);
    const sleeper = spawnSleeper();
    sleepers.push(sleeper);
    registerChildPid(sleeper.pid);
    expect(readLockData(lockFile).children).toContain(sleeper.pid);
  });

  it("unregisterChildPid removes child from lock file", () => {
    acquireLock(lockFile);
    const sleeper = spawnSleeper();
    sleepers.push(sleeper);
    registerChildPid(sleeper.pid);
    unregisterChildPid(sleeper.pid);
    expect(readLockData(lockFile).children).not.toContain(sleeper.pid);
  });

  it("tracks multiple children correctly", () => {
    acquireLock(lockFile);
    const s1 = spawnSleeper();
    const s2 = spawnSleeper();
    sleepers.push(s1, s2);
    registerChildPid(s1.pid);
    registerChildPid(s2.pid);
    let data = readLockData(lockFile);
    expect(data.children).toHaveLength(2);
    expect(data.children).toContain(s1.pid);
    expect(data.children).toContain(s2.pid);
    unregisterChildPid(s1.pid);
    data = readLockData(lockFile);
    expect(data.children).toHaveLength(1);
    expect(data.children).toContain(s2.pid);
  });

  it("releaseLock removes the lock file", () => {
    acquireLock(lockFile);
    expect(existsSync(lockFile)).toBe(true);
    releaseLock();
    expect(existsSync(lockFile)).toBe(false);
  });

  it("releaseLock is safe when no lock acquired", () => {
    expect(() => releaseLock()).not.toThrow();
  });

  it("releaseLock is safe to call twice", () => {
    acquireLock(lockFile);
    releaseLock();
    expect(() => releaseLock()).not.toThrow();
    expect(existsSync(lockFile)).toBe(false);
  });

  it("rejects acquire when lock is retained", () => {
    writeFileSync(lockFile, JSON.stringify({ pid: 999999, children: [], retained: true }));
    expect(acquireLock(lockFile)).toBe(false);
    expect(existsSync(lockFile)).toBe(true);
  });

  it("retainLock marks current lock as retained", () => {
    acquireLock(lockFile);
    retainLock();
    const raw = JSON.parse(readFileSync(lockFile, "utf-8")) as { retained?: boolean };
    expect(raw.retained).toBe(true);
  });

  it("retained lock survives dead pid", () => {
    writeFileSync(lockFile, JSON.stringify({ pid: 999999, children: [], retained: true }));
    _resetForTest();
    expect(acquireLock(lockFile)).toBe(false);
  });

  it("kills orphaned children when reclaiming stale lock", async () => {
    const sleeper = spawnSleeper();
    sleepers.push(sleeper);
    expect(() => process.kill(sleeper.pid, 0)).not.toThrow();
    writeFileSync(lockFile, JSON.stringify({ pid: 999999, children: [sleeper.pid] }));
    acquireLock(lockFile);
    expect(await waitForDeath(sleeper.pid)).toBe(true);
  });
});
