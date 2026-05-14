/**
 * OpenViking console process owner.
 *
 * The console (Python `openviking.console.bootstrap`) is a separate process
 * from the OpenViking server. We spawn it lazily on the first user click in
 * the chat header and keep it alive until Next.js exits. Idempotent — repeat
 * calls return the same URL without spawning a second process.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { consola } from "consola";
import { OPENVIKING_CONSOLE_PID_FILE } from "@@/lib/paths";
import {
  killStaleProcess,
  onProcessExit,
  removePidFile,
  terminateChild,
  writePidFile,
} from "@@/lib/process-orphan-cleanup";
import { getAvailablePort } from "@@/lib/get-available-port";
import { httpHealthProbe } from "@@/lib/http-health-probe";

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_INTERVAL_MS = 250;
const CONSOLE_CMDLINE_RE = /openviking\.console\.bootstrap/;

let activeConsole: { url: string; proc: ChildProcess } | null = null;

export function getConsoleUrl(): string | null {
  return activeConsole?.url ?? null;
}

export async function launchConsole(sidecarPort: number): Promise<string> {
  if (activeConsole) return activeConsole.url;
  // Reap any orphan console from a parent that didn't run shutdown handlers.
  await killStaleProcess(OPENVIKING_CONSOLE_PID_FILE, CONSOLE_CMDLINE_RE);
  const consolePort = await getAvailablePort();
  const url = `http://127.0.0.1:${consolePort}`;
  const proc = spawn(
    "python3",
    [
      "-m",
      "openviking.console.bootstrap",
      "--host",
      "127.0.0.1",
      "--port",
      String(consolePort),
      "--openviking-url",
      `http://127.0.0.1:${sidecarPort}`,
    ],
    { stdio: ["ignore", "inherit", "inherit"], env: process.env },
  );
  proc.on("error", (err) => {
    consola.error("openviking console failed to spawn:", err.message);
  });
  proc.on("exit", (code) => {
    consola.info(`openviking console exited (code ${code ?? "?"})`);
    if (activeConsole?.proc === proc) activeConsole = null;
  });
  try {
    await waitForReady(consolePort);
  } catch (err) {
    try {
      proc.kill("SIGTERM");
    } catch {}
    throw err;
  }
  activeConsole = { url, proc };
  if (proc.pid !== undefined) writePidFile(OPENVIKING_CONSOLE_PID_FILE, proc.pid);
  installShutdownHandlers();
  return url;
}

export function shutdownConsole(): void {
  if (!activeConsole) return;
  terminateChild(activeConsole.proc);
  removePidFile(OPENVIKING_CONSOLE_PID_FILE);
  activeConsole = null;
}

// ─── Internals ────────────────────────────────────────────────────────────────

function waitForReady(port: number): Promise<void> {
  return httpHealthProbe(`http://127.0.0.1:${port}/`, {
    timeoutMs: READY_TIMEOUT_MS,
    intervalMs: READY_POLL_INTERVAL_MS,
  });
}

let shutdownHandlersInstalled = false;
function installShutdownHandlers(): void {
  if (shutdownHandlersInstalled) return;
  shutdownHandlersInstalled = true;
  onProcessExit(() => shutdownConsole());
}
