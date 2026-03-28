import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupOldLogs } from "../lib/logger.js";
import type { LogFn } from "./claude-runner.js";
import type { DevServerManager } from "./dev-servers.js";

/**
 * Post-run cleanup for GSD. Runs unconditionally after every run (success or failure)
 * to stop dev servers, remove temp artifacts, and prune old logs.
 */
export function postRunCleanup(
  scriptDir: string,
  logBase: string,
  devServers: DevServerManager,
  log: LogFn,
): void {
  devServers.stopAll();
  devServers.cleanupLogs(log);
  removeTempDirs(scriptDir, log);
  cleanupOldLogs(logBase, [], 7);
}

// ─── Temp directories ────────────────────────────────────────────────────────

/** Known temp directories created during a GSD run, relative to the script/cwd */
const TEMP_DIRS = [".jira-ticket-prioritizer-tmp"];

function removeTempDirs(scriptDir: string, log: LogFn): void {
  for (const name of TEMP_DIRS) {
    const dir = join(scriptDir, name);
    if (!existsSync(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      log(`CLEANUP: removed ${dir}`);
    } catch (err) {
      log(
        `CLEANUP WARN: failed to remove ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
