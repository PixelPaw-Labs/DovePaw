import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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

/** Spawn a long-lived child process and return its PID */
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
        else resolve(false); // still alive
      } catch {
        resolve(true); // dead
      }
    };
    check();
  });
}

void describe("lock", () => {
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

  void it("acquires lock and writes pid to file", () => {
    const result = acquireLock(lockFile);
    assert.equal(result, true);
    assert.equal(existsSync(lockFile), true);

    const data = readLockData(lockFile);
    assert.equal(data.pid, process.pid);
    assert.deepEqual(data.children, []);
  });

  void it("rejects second acquire when first is alive", () => {
    acquireLock(lockFile);
    const second = acquireLock(lockFile);
    assert.equal(second, false);
  });

  void it("reclaims stale lock from dead process", () => {
    writeFileSync(lockFile, JSON.stringify({ pid: 999999, children: [] }));

    const result = acquireLock(lockFile);
    assert.equal(result, true);

    const data = readLockData(lockFile);
    assert.equal(data.pid, process.pid);
  });

  void it("registerChildPid adds child to lock file", () => {
    acquireLock(lockFile);

    const sleeper = spawnSleeper();
    sleepers.push(sleeper);

    registerChildPid(sleeper.pid);

    const data = readLockData(lockFile);
    assert.ok(data.children.includes(sleeper.pid));
  });

  void it("unregisterChildPid removes child from lock file", () => {
    acquireLock(lockFile);

    const sleeper = spawnSleeper();
    sleepers.push(sleeper);

    registerChildPid(sleeper.pid);
    unregisterChildPid(sleeper.pid);

    const data = readLockData(lockFile);
    assert.ok(!data.children.includes(sleeper.pid));
  });

  void it("tracks multiple children correctly", () => {
    acquireLock(lockFile);

    const s1 = spawnSleeper();
    const s2 = spawnSleeper();
    sleepers.push(s1, s2);

    registerChildPid(s1.pid);
    registerChildPid(s2.pid);

    let data = readLockData(lockFile);
    assert.equal(data.children.length, 2);
    assert.ok(data.children.includes(s1.pid));
    assert.ok(data.children.includes(s2.pid));

    unregisterChildPid(s1.pid);

    data = readLockData(lockFile);
    assert.equal(data.children.length, 1);
    assert.ok(data.children.includes(s2.pid));
  });

  void it("releaseLock removes the lock file", () => {
    acquireLock(lockFile);
    assert.equal(existsSync(lockFile), true);

    releaseLock();
    assert.equal(existsSync(lockFile), false);
  });

  void it("releaseLock is safe when no lock acquired", () => {
    releaseLock(); // should not throw
  });

  void it("releaseLock is safe to call twice", () => {
    acquireLock(lockFile);
    releaseLock();
    releaseLock(); // should not throw
    assert.equal(existsSync(lockFile), false);
  });

  void it("rejects acquire when lock is retained", () => {
    writeFileSync(lockFile, JSON.stringify({ pid: 999999, children: [], retained: true }));

    const result = acquireLock(lockFile);
    assert.equal(result, false);
    assert.equal(existsSync(lockFile), true, "retained lock should not be deleted");
  });

  void it("retainLock marks current lock as retained", () => {
    acquireLock(lockFile);
    retainLock();

    const raw = JSON.parse(readFileSync(lockFile, "utf-8")) as { retained?: boolean };
    assert.equal(raw.retained, true);
  });

  void it("retained lock survives dead pid", () => {
    // Simulate: process exited but lock was retained
    writeFileSync(lockFile, JSON.stringify({ pid: 999999, children: [], retained: true }));

    _resetForTest();
    const result = acquireLock(lockFile);
    assert.equal(result, false, "should not reclaim a retained lock even with dead pid");
  });

  void it("kills orphaned children when reclaiming stale lock", async () => {
    const sleeper = spawnSleeper();
    sleepers.push(sleeper);

    // Verify the child is alive
    assert.doesNotThrow(() => process.kill(sleeper.pid, 0));

    // Simulate a stale lock from a dead parent with a live child
    writeFileSync(lockFile, JSON.stringify({ pid: 999999, children: [sleeper.pid] }));

    acquireLock(lockFile);

    const died = await waitForDeath(sleeper.pid);
    assert.equal(died, true, "orphaned child should have been killed");
  });
});
