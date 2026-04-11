/**
 * POST /api/servers/restart
 *
 * Kills the running A2A servers process and spawns a fresh one via
 * `npm run chatbot:servers` — identical to how Electron starts servers.
 */

import { writeFileSync } from "node:fs";
import { A2A_SERVERS_PID_FILE } from "@/lib/paths";
import { killServers, createServersProcess } from "@@/lib/server-manager";

export async function POST() {
  killServers();

  const port = Number(process.env.DOVEPAW_PORT) || 7473;
  const child = createServersProcess(port, "ignore");
  if (child.pid !== undefined) {
    writeFileSync(A2A_SERVERS_PID_FILE, String(child.pid), "utf-8");
  }
  child.unref();

  return Response.json({ ok: true, pid: child.pid });
}
