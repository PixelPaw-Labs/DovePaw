import { mkdirSync, appendFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

export function makeTimestamp(): string {
  return new Date().toLocaleString("sv-SE").replace(/[ :]/g, "_");
}

export function createLogger(logDir: string, logFile: string) {
  mkdirSync(logDir, { recursive: true });

  function log(msg: string): void {
    const line = `[${new Date().toLocaleString("sv-SE")}] ${msg}`;
    console.log(line);
    appendFileSync(logFile, line + "\n");
  }

  return { log, logFile };
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
