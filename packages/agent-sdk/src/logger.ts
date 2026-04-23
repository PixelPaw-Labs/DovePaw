import { mkdirSync, appendFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

export type LogFn = (msg: string) => void;
export type PublishStatusToUI = (
  message: string,
  artifacts?: Record<string, string>,
) => Promise<void>;

export function makeTimestamp(): string {
  return new Date().toLocaleString("sv-SE").replace(/[ :]/g, "_");
}

/**
 * Emit a transient progress message and optional artifacts to the Workflow UI
 * via HTTP POST to the A2A server's internal progress endpoint.
 * Requires DOVEPAW_A2A_PORT and DOVEPAW_TASK_ID env vars to be set (injected at spawn time).
 */
export async function publishStatusToUI(
  message: string,
  artifacts?: Record<string, string>,
): Promise<void> {
  const port = process.env.DOVEPAW_A2A_PORT;
  const taskId = process.env.DOVEPAW_TASK_ID;
  if (!port || !taskId) return;
  await fetch(`http://localhost:${port}/internal/tasks/${taskId}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, artifacts }),
  });
}

export function createLogger(logDir: string, logFile: string) {
  mkdirSync(logDir, { recursive: true });

  function log(msg: string): void {
    const line = `[${new Date().toLocaleString("sv-SE")}] ${msg}`;
    console.log(line);
    appendFileSync(logFile, line + "\n");
  }

  return { log, logFile, publishStatusToUI };
}

export function cleanupOldLogs(logDir: string, _prefixes: string[], retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  try {
    for (const entry of readdirSync(logDir)) {
      const entryPath = join(logDir, entry);
      const stat = statSync(entryPath);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) {
        rmSync(entryPath, { recursive: true, force: true });
      }
    }
  } catch {}
}
