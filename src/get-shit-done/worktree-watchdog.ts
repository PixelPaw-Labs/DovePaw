import { existsSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_POLL_MS = 5_000;

interface WatchdogOpts {
  timeoutMs?: number;
  pollMs?: number;
}

export interface WatchdogHandle {
  hung: Promise<"hung">;
  cancel: () => void;
}

/**
 * Watches for a worktree directory to appear on disk.
 * If it doesn't appear within the timeout, resolves as "hung".
 * Once the directory appears, the watchdog stands down (never resolves).
 */
export class WorktreeWatchdog {
  private readonly timeoutMs: number;
  private readonly pollMs: number;

  constructor(opts?: WatchdogOpts) {
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  }

  watch(path: string): WatchdogHandle {
    let intervalId: ReturnType<typeof setInterval>;
    const hung = new Promise<"hung">((resolve) => {
      const deadline = Date.now() + this.timeoutMs;
      intervalId = setInterval(() => {
        if (existsSync(path)) {
          clearInterval(intervalId);
          return;
        }
        if (Date.now() >= deadline) {
          clearInterval(intervalId);
          resolve("hung");
        }
      }, this.pollMs);
      if (typeof intervalId === "object" && "unref" in intervalId) intervalId.unref();
    });

    return {
      hung,
      cancel: () => clearInterval(intervalId),
    };
  }

  get timeoutSec(): number {
    return this.timeoutMs / 1000;
  }
}
