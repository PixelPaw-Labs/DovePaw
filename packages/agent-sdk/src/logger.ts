import { mkdirSync, appendFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROGRESS_PREFIX = "__PROGRESS__:";
const ARTIFACT_PREFIX = "__ARTIFACT__:";

export type LogFn = (msg: string) => void;
export type PublishStatusToUI = (message: string, artifacts?: Record<string, string>) => void;

export function makeTimestamp(): string {
  return new Date().toLocaleString("sv-SE").replace(/[ :]/g, "_");
}

/**
 * Emit a transient progress message and optional artifacts to the Workflow UI
 * via stdout sentinels consumed by the A2A executor's OutputLineProcessor.
 */
export function publishStatusToUI(message: string, artifacts?: Record<string, string>): void {
  for (const [name, text] of Object.entries(artifacts ?? {})) {
    const singleLine = text.replace(/\r?\n/g, " ");
    process.stdout.write(`${ARTIFACT_PREFIX}${name}:${singleLine}\n`);
  }
  process.stdout.write(`${PROGRESS_PREFIX}${message}\n`);
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
