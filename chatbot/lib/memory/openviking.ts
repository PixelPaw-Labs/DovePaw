/**
 * OpenViking memory provider.
 *
 * Routes every group's moments through a `viking://agent/<groupContextId>/moments`
 * namespace on the OpenViking sidecar. The sidecar is started externally
 * (by Electron or scripts/boot-openviking.ts) — this class only owns the
 * HTTP API calls and the in-process provider lifecycle.
 *
 * Per-group bootstrap (instance `initGroup()`):
 *   POST /api/v1/fs/mkdir viking://agent/<id>/moments
 *
 * If anything in the boot path fails, callers fall back to MarkdownMemoryProvider
 * (see `getMemoryProvider()` registry).
 */

import { type ChildProcess } from "node:child_process";
import { z } from "zod";
import { bootOpenViking } from "@@/lib/openviking-spawner";
import type { MemoryProvider } from "./types";
import { indentedMomentsPattern, rosterBullet } from "./types";
import { KILL_ESCALATION_MS } from "@@/lib/process-constants";

export class OpenVikingMemoryProvider implements MemoryProvider {
  /** Port the sidecar process is reachable on. */
  readonly port: number;
  /** Child process handle so callers can SIGTERM on shutdown. */
  readonly proc: ChildProcess | null;

  constructor(port: number, proc: ChildProcess | null = null) {
    this.port = port;
    this.proc = proc;
  }

  /**
   * Boot the OpenViking sidecar in localhost-only dev mode and return a
   * fully-provisioned provider. Rejects on spawn or health-probe failure.
   * Used only when the sidecar has not been started externally (no port file).
   */
  static async boot(port: number): Promise<OpenVikingMemoryProvider> {
    const proc = await bootOpenViking(port);
    return new OpenVikingMemoryProvider(port, proc);
  }

  /**
   * Gracefully terminate the sidecar and wait for it to actually exit so the
   * data-directory file lock is released before any caller tries to spawn a
   * replacement. SIGTERM first, then SIGKILL as a backstop after
   * KILL_ESCALATION_MS.
   */
  async shutdown(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    if (proc.exitCode !== null || proc.signalCode !== null) return;

    const exited = new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
    });
    try {
      proc.kill("SIGTERM");
    } catch {}
    const sigkillTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }, KILL_ESCALATION_MS);
    try {
      await exited;
    } finally {
      clearTimeout(sigkillTimer);
    }
  }

  async initGroup(groupContextId: string, _workspacePath: string): Promise<void> {
    await ensureNamespace(this.port, groupContextId);
  }

  async deleteGroup(groupContextId: string, _workspacePath: string): Promise<void> {
    await removeNamespace(this.port, groupContextId);
  }

  buildReadReminder(workspacePath: string, groupContextId: string): string {
    const base = `http://localhost:${this.port}`;
    return `You are participating in a group task. Before starting:
${rosterBullet(workspacePath)}
- Query past moments before acting via the OpenViking HTTP API:
\`\`\`
curl -sX POST ${base}/api/v1/search/find \\
  -H "X-OpenViking-Agent: ${groupContextId}" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "<topic>", "target_uri": "viking://agent/memories", "limit": 10}'
\`\`\``;
  }

  buildSaveReminder(groupContextId: string, _workspacePath: string): string {
    const base = `http://localhost:${this.port}`;
    return `Save moments (decisions, artifacts, insights) via the sessions API
  — send \`X-OpenViking-Agent: ${groupContextId}\` on all three calls.
  Step 1 returns \`{result:{session_id:SID}}\` — use that SID in steps 2 and 3:
\`\`\`
curl -sX POST ${base}/api/v1/sessions \\
  -H "X-OpenViking-Agent: ${groupContextId}" \\
  -H "Content-Type: application/json" \\
  -d '{}'

curl -sX POST ${base}/api/v1/sessions/SID/messages \\
  -H "X-OpenViking-Agent: ${groupContextId}" \\
  -H "Content-Type: application/json" \\
  -d '{"role": "user", "content": "<moment>"}'

curl -sX POST ${base}/api/v1/sessions/SID/commit \\
  -H "X-OpenViking-Agent: ${groupContextId}" \\
  -H "Content-Type: application/json" \\
  -d '{}'
\`\`\`
  Writing style:
${indentedMomentsPattern()}`;
  }
}

// ─── HTTP API helpers ─────────────────────────────────────────────────────────

async function ensureNamespace(port: number, groupContextId: string): Promise<void> {
  const uri = `viking://agent/${groupContextId}/memories`;
  const response = await fetch(`http://localhost:${port}/api/v1/fs/mkdir`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenViking-Agent": groupContextId,
    },
    body: JSON.stringify({ uri }),
  });
  const bodySchema = z.object({
    status: z.string().optional(),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
  });
  const raw: unknown = await response.json().catch(() => undefined);
  const body = bodySchema.safeParse(raw).data;
  if (response.ok && body?.status === "ok") return;
  if (body?.error?.code === "ALREADY_EXISTS") return;
  const message = body?.error?.message ?? `HTTP ${response.status}`;
  throw new Error(`POST /api/v1/fs/mkdir ${uri} failed: ${message}`);
}

async function removeNamespace(port: number, groupContextId: string): Promise<void> {
  try {
    const uri = encodeURIComponent(`viking://agent/${groupContextId}`);
    await fetch(`http://localhost:${port}/api/v1/fs?uri=${uri}&recursive=true`, {
      method: "DELETE",
      headers: { "X-OpenViking-Agent": groupContextId },
    });
  } catch {
    // sidecar unreachable — drop silently
  }
}
