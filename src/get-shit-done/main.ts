/**
 * Get Shit Done - Automated JIRA ticket implementer
 *
 * Runs every 5 minutes via launchd heartbeat.
 * Fetches sprint tickets, prioritizes with grouping, forges in parallel,
 * merges worktree changes, runs verification, and creates PRs.
 */

import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, makeTimestamp } from "../lib/logger.js";
import { parseRepos } from "../lib/repos.js";
import { acquireLock, releaseLock, retainLock } from "../lib/lock.js";
import { JiraClient } from "./jira.js";
import { DevServerManager } from "./dev-servers.js";
import { ClaudeRunner } from "./claude-runner.js";
import { postRunCleanup } from "./cleanup.js";
import { DagStore } from "./dag-store.js";
import { SprintDiscovery } from "./discovery.js";
import { Prioritizer } from "./prioritizer.js";
import { Pipeline } from "./pipeline.js";
import { GSDOrchestrator } from "./orchestrator.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const HOME = process.env.HOME!;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.AGENT_WORKSPACE ? join(process.env.AGENT_WORKSPACE, "agent_logs") : SCRIPT_DIR;
const LOG_BASE = join(WORK_DIR, "logs/.get-shit-done");
const STATE_DIR = join(WORK_DIR, "state/.get-shit-done");

mkdirSync(STATE_DIR, { recursive: true });

const jira = new JiraClient(
  process.env.JIRA_CLI || "/opt/homebrew/bin/jira",
  process.env.JIRA_SERVER || "",
  process.env.JIRA_ASSIGNEE || "",
  process.env.JIRA_SPRINT_PREFIX || "",
);
const baseRepos = parseRepos("REPO_LIST");

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let cleanExit = false;
let log: (msg: string) => void = console.log;
let devServers: DevServerManager | null = null;
let dagStore: DagStore | null = null;

process.on("exit", () => {
  // Skipping dagStore.closeSync() — the LadybugDB native addon SIGSEGV's during
  // sync teardown, which launchd interprets as a crash and unloads the agent.
  // The OS reclaims the file handles on process exit.
  if (devServers) {
    try {
      postRunCleanup(SCRIPT_DIR, LOG_BASE, devServers, log);
    } catch {
      /* best effort */
    }
  }
  if (cleanExit) releaseLock();
  else {
    retainLock();
    log("ERROR: retaining lock to prevent retry — manual intervention required");
  }
});

async function main() {
  if (!acquireLock(join(STATE_DIR, "lock"))) return;

  dagStore = await DagStore.create(join(STATE_DIR, "dag-store.lbug"));
  const discovery = new SprintDiscovery(jira, dagStore, baseRepos);

  // Silent pre-check — no log directory created if nothing to do
  if (!(await discovery.discover())) return;

  // Work found — create timestamped log directory and run
  const LOG_DIR = join(LOG_BASE, makeTimestamp());
  const logger = createLogger(LOG_DIR, join(LOG_DIR, "get-shit-done.log"));
  log = logger.log;

  devServers = new DevServerManager(
    HOME,
    join(SCRIPT_DIR, "bootstrap-services.json"),
    join(SCRIPT_DIR, "logs/.bootstrap"),
    log,
  );

  const runner = new ClaudeRunner(LOG_DIR, logger.logFile);

  await new GSDOrchestrator({
    discovery,
    prioritizer: new Prioritizer({ runner, scriptDir: SCRIPT_DIR, log }),
    pipeline: new Pipeline({ runner, devServers, jira, runState: dagStore, log }),
    jira,
    runState: dagStore,
    baseRepos,
    log,
  }).run();
}

main()
  .then(() => {
    cleanExit = true;
  })
  .catch((err: unknown) => {
    log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  });
