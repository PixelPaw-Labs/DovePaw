/**
 * Orphan cleanup for long-running child processes (OpenViking sidecar,
 * OpenViking console).
 *
 * Why this exists: Next.js dev sometimes exits without firing our
 * SIGINT/SIGTERM/exit hooks (intercepted, crashed, SIGKILL'd). Any python
 * child we spawned survives the parent and keeps listening on its port. The
 * next boot then collides with stale state, or worse, talks to an
 * incompatible sidecar that's serving an old config.
 *
 * The fix mirrors the existing A2A pattern: write a PID file on spawn,
 * check it on next boot, kill the named process if it's still alive.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const KILL_ESCALATION_MS = 1_000;

/**
 * Schedule `SIGKILL` against `pid` after `KILL_ESCALATION_MS`. Used after
 * `SIGTERM` to backstop servers that ignore polite shutdown. Non-blocking;
 * the timer is unrefed so it never holds the event loop alive.
 */
export function scheduleSigkill(pid: number, delayMs: number = KILL_ESCALATION_MS): void {
  setTimeout(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }, delayMs).unref();
}

/**
 * Send `SIGTERM` to a child process and schedule `SIGKILL` as a backstop.
 * Safe to call when the process is already gone (errors swallowed).
 */
export function terminateChild(proc: { pid?: number; kill(sig: NodeJS.Signals): boolean }): void {
  try {
    proc.kill("SIGTERM");
  } catch {}
  if (proc.pid) scheduleSigkill(proc.pid);
}

/**
 * Register the same handler on `SIGINT`, `SIGTERM`, and `exit`. The handler
 * runs at most once per signal kind — once.
 */
export function onProcessExit(handler: () => void): void {
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  process.once("exit", handler);
}

/**
 * If `pidFile` points to an alive process whose `ps -o command=` output
 * matches `cmdlineMatcher`, send SIGTERM, wait `KILL_ESCALATION_MS`, then
 * SIGKILL. Always removes the PID file at the end (even if the process was
 * already gone or didn't match).
 */
export async function killStaleProcess(pidFile: string, cmdlineMatcher: RegExp): Promise<void> {
  if (!existsSync(pidFile)) return;
  const raw = readFileSync(pidFile, "utf-8").trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 1) {
    removePidFile(pidFile);
    return;
  }
  if (!isAlive(pid)) {
    removePidFile(pidFile);
    return;
  }
  const cmdline = await getCmdline(pid);
  if (!cmdline || !cmdlineMatcher.test(cmdline)) {
    // PID was reused by an unrelated process — leave it alone, but drop the
    // stale file so we don't keep checking.
    removePidFile(pidFile);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    removePidFile(pidFile);
    return;
  }
  await new Promise((r) => setTimeout(r, KILL_ESCALATION_MS));
  if (isAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  removePidFile(pidFile);
}

export function writePidFile(pidFile: string, pid: number): void {
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, String(pid));
}

export function removePidFile(pidFile: string): void {
  try {
    rmSync(pidFile, { force: true });
  } catch {
    // already gone
  }
}

function isAlive(pid: number): boolean {
  try {
    // signal 0: probe — throws ESRCH if dead, EPERM if alive but not ours
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means alive in another user's process tree; ESRCH means gone.
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as Record<string, unknown>).code === "EPERM"
    );
  }
}

async function getCmdline(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "command=", "-p", String(pid)]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
