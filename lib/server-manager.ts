/**
 * Shared A2A server lifecycle helpers.
 *
 * Canonical usage of `npm run chatbot:servers` lives here so that every
 * caller — Electron menubar, Next.js API route, CLI — uses the same command.
 *
 * Importers:
 *   chatbot/app/api/servers/restart/route.ts   via  @@/lib/server-manager
 *   electron/main.ts                            via  ../lib/server-manager
 *     (Electron bundles with tsup so the relative import resolves correctly)
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { AGENTS_ROOT, A2A_SERVERS_PID_FILE } from "./paths";
import { KILL_ESCALATION_MS } from "./process-constants";

/**
 * Kill the A2A servers process identified by the PID file.
 * No-ops silently if the file is absent or the process is already gone.
 */
export function killServers(): void {
  const pid = readAndRemoveServersPid();
  if (pid === null) return;
  signalServerProcess(pid, "SIGTERM");
}

function readAndRemoveServersPid(): number | null {
  if (!existsSync(A2A_SERVERS_PID_FILE)) return null;

  const pid = Number.parseInt(readFileSync(A2A_SERVERS_PID_FILE, "utf-8").trim(), 10);
  try {
    rmSync(A2A_SERVERS_PID_FILE, { force: true });
  } catch {
    // Best effort. The restart path must not fail just because stale PID cleanup failed.
  }

  return Number.isFinite(pid) ? pid : null;
}

/** Kill the tracked A2A server process group and wait before escalating. */
export async function killAllServers(): Promise<void> {
  const pid = readAndRemoveServersPid();
  if (pid === null) return;

  signalServerProcess(pid, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, KILL_ESCALATION_MS));
  signalServerProcess(pid, "SIGKILL");
}

function signalServerProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone — fine.
    }
  }
}

export function writeServersPidFile(pid: number): void {
  writeFileSync(A2A_SERVERS_PID_FILE, String(pid), "utf-8");
}

/**
 * Spawn a fresh A2A servers process via `npm run chatbot:servers`.
 *
 * Returns the raw ChildProcess so the caller can:
 *   - Electron: pipe stdout/stderr to a log file and watch for exit to auto-restart
 *   - API route: call unref() to detach and write child.pid to the PID file
 *
 * @param port  Value forwarded as DOVEPAW_PORT env var (default 7473)
 * @param stdio "pipe" for Electron (log piping), "ignore" for detached API restarts
 */
export function createServersProcess(
  port: number = 7473,
  stdio: "pipe" | "ignore" = "ignore",
): ChildProcess {
  return spawn("npm", ["run", "chatbot:servers"], {
    cwd: AGENTS_ROOT,
    env: { ...process.env, DOVEPAW_PORT: String(port) },
    stdio,
    detached: true,
  });
}
