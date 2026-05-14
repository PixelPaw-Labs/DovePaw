/**
 * Boot the OpenViking sidecar before starting Next.js.
 * Runs as a pre-step in chatbot:dev — exits after the sidecar is ready,
 * leaving it running detached (survives this script's exit).
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { OPENVIKING_PORT_FILE, OPENVIKING_SIDECAR_PID_FILE } from "../lib/paths";
import { bootOpenViking } from "../lib/openviking-spawner";
import { getAvailablePort } from "../lib/get-available-port";
import { killStaleProcess, writePidFile } from "../lib/process-orphan-cleanup";

const SIDECAR_CMDLINE_RE = /openviking-server/;

await killStaleProcess(OPENVIKING_SIDECAR_PID_FILE, SIDECAR_CMDLINE_RE);
const port = await getAvailablePort();
try {
  const proc = await bootOpenViking(port, { detached: true });
  if (proc.pid !== undefined) writePidFile(OPENVIKING_SIDECAR_PID_FILE, proc.pid);
  await mkdir(dirname(OPENVIKING_PORT_FILE), { recursive: true });
  await writeFile(OPENVIKING_PORT_FILE, JSON.stringify({ port }, null, 2));
  console.log(`✓ OpenViking sidecar ready at http://localhost:${port}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`⚠ OpenViking boot failed: ${msg} — will fall back to .md moments`);
}
