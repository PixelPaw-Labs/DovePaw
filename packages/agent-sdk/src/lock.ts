import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { parseJson } from "./json.js";

interface LockData {
  pid: number;
  children: number[];
  retained?: boolean;
}

export function isLockData(v: unknown): v is LockData {
  return (
    typeof v === "object" &&
    v !== null &&
    "pid" in v &&
    typeof v.pid === "number" &&
    "children" in v &&
    Array.isArray(v.children)
  );
}

function readLock(lockFile: string): LockData | null {
  try {
    return parseJson(readFileSync(lockFile, "utf-8"), isLockData);
  } catch {
    return null;
  }
}

function writeLock(lockFile: string, data: LockData): void {
  writeFileSync(lockFile, JSON.stringify(data));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let currentLockFile: string | null = null;
let trackedChildren = new Set<number>();

/** Reset module state — for testing only */
export function _resetForTest(): void {
  currentLockFile = null;
  trackedChildren = new Set();
}

export function registerChildPid(pid: number): void {
  trackedChildren.add(pid);
  if (currentLockFile) {
    const data = readLock(currentLockFile);
    if (data) {
      data.children = [...trackedChildren];
      writeLock(currentLockFile, data);
    }
  }
}

export function unregisterChildPid(pid: number): void {
  trackedChildren.delete(pid);
  if (currentLockFile) {
    const data = readLock(currentLockFile);
    if (data) {
      data.children = [...trackedChildren];
      writeLock(currentLockFile, data);
    }
  }
}

export function acquireLock(lockFile: string): boolean {
  if (existsSync(lockFile)) {
    const existing = readLock(lockFile);
    if (existing) {
      if (existing.retained) {
        return false; // intentionally retained after error — manual intervention required
      }
      if (isAlive(existing.pid)) {
        return false; // another instance running
      }
      // Parent is dead — kill any orphaned children
      for (const childPid of existing.children ?? []) {
        try {
          process.kill(childPid, "SIGTERM");
        } catch {}
      }
      unlinkSync(lockFile); // stale lock
    }
  }

  currentLockFile = lockFile;
  writeLock(lockFile, { pid: process.pid, children: [] });

  // Convert signals to exit so process.on("exit") handlers fire
  process.on("SIGINT", () => process.exit(1));
  process.on("SIGTERM", () => process.exit(1));
  return true;
}

/** Mark the lock as intentionally retained so future runs won't reclaim it. */
export function retainLock(): void {
  if (currentLockFile) {
    const data = readLock(currentLockFile);
    if (data) {
      data.retained = true;
      writeLock(currentLockFile, data);
    }
  }
}

/** Remove the lock file. Call this in process.on("exit") from the entry point. */
export function releaseLock(): void {
  if (currentLockFile) {
    try {
      unlinkSync(currentLockFile);
    } catch {}
    currentLockFile = null;
  }
}
