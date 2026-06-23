/**
 * POST /api/servers/restart
 *
 * Kills the running A2A servers process and spawns a fresh one via
 * `npm run chatbot:servers` — identical to how Electron starts servers.
 */

import { killAllServers, createServersProcess, writeServersPidFile } from "@@/lib/server-manager";

export async function POST() {
  await killAllServers();

  const port = Number(process.env.DOVEPAW_PORT) || 7473;
  const child = createServersProcess(port, "ignore");
  if (child.pid !== undefined) {
    writeServersPidFile(child.pid);
  }
  child.unref();

  return Response.json({ ok: true, pid: child.pid });
}
