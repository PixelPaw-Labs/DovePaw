/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * Owns the OpenViking sidecar lifecycle:
 *   - reap any orphan from a previous parent (PID file recovery)
 *   - allocate a free port, spawn openviking-server via OpenVikingMemoryProvider.boot
 *   - write the port to ~/.dovepaw/.openviking-port.json so the A2A process
 *     can discover the sidecar via getMemoryProvider()'s disk fallback
 *   - install an in-memory provider override so this process bypasses disk
 *     lookups and holds the ChildProcess handle for shutdown
 *
 * On boot failure: leaves no port file, no override; getMemoryProvider() falls
 * back to MarkdownMemoryProvider in both processes.
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { consola } from "consola";
import { OPENVIKING_PORT_FILE, OPENVIKING_SIDECAR_PID_FILE } from "@@/lib/paths";
import { setMemoryProvider } from "@/lib/memory";
import { OpenVikingMemoryProvider } from "@/lib/memory/openviking";
import {
  killStaleProcess,
  onProcessExit,
  removePidFile,
  writePidFile,
} from "@/lib/process-orphan-cleanup";
import { getAvailablePort } from "@/lib/get-available-port";

const SIDECAR_CMDLINE_RE = /openviking-server/;

let booted = false;
let activeProvider: OpenVikingMemoryProvider | null = null;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (booted) return;
  booted = true;

  await killStaleProcess(OPENVIKING_SIDECAR_PID_FILE, SIDECAR_CMDLINE_RE);
  const port = await getAvailablePort();
  try {
    activeProvider = await OpenVikingMemoryProvider.boot(port);
    setMemoryProvider(activeProvider);
    const pid = activeProvider.proc?.pid;
    if (pid !== undefined) writePidFile(OPENVIKING_SIDECAR_PID_FILE, pid);
    await mkdir(dirname(OPENVIKING_PORT_FILE), { recursive: true });
    await writeFile(OPENVIKING_PORT_FILE, JSON.stringify({ port }, null, 2));
    installShutdownHandlers();
    consola.success(`OpenViking sidecar ready at http://localhost:${port}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Wipe any stale port file from a previous successful boot — otherwise
    // callers reading `~/.dovepaw/.openviking-port.json` see a dead port.
    await rm(OPENVIKING_PORT_FILE, { force: true }).catch(() => {});
    consola.warn(
      `OpenViking sidecar boot failed on port ${port} (${msg}). Group chat will fall back to .md moments.`,
    );
  }
}

function installShutdownHandlers(): void {
  // Provider.shutdown() does SIGTERM + SIGKILL backstop internally — see
  // OpenVikingMemoryProvider.shutdown() → terminateChild(). The cleanup here
  // only owns DovePaw-side state (port file, PID file).
  onProcessExit(() => {
    try {
      activeProvider?.shutdown();
    } catch {}
    void rm(OPENVIKING_PORT_FILE, { force: true }).catch(() => {});
    removePidFile(OPENVIKING_SIDECAR_PID_FILE);
  });
}
