/**
 * POST /api/servers/restart
 *
 * Kills the running A2A servers process and spawns a fresh one.
 * Works both inside Electron (which would also auto-restart) and standalone dev.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { A2A_SERVERS_PID_FILE } from "@/lib/paths";
import { TSX_BIN, CHATBOT_ROOT } from "@/lib/paths";
import { join } from "node:path";

export async function POST() {
  // Kill the existing process if running
  if (existsSync(A2A_SERVERS_PID_FILE)) {
    const pid = parseInt(readFileSync(A2A_SERVERS_PID_FILE, "utf-8").trim(), 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone — fine, continue to spawn
      }
    }
  }

  // Spawn fresh A2A servers, detached so they outlive this request
  const child = spawn(TSX_BIN, [join(CHATBOT_ROOT, "a2a/start-all.ts")], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  writeFileSync(A2A_SERVERS_PID_FILE, String(child.pid), "utf-8");
  child.unref();

  return Response.json({ ok: true, pid: child.pid });
}
