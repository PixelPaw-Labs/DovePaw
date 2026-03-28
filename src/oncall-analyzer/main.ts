/**
 * Oncall Analyzer - Post Incident Record generator
 * Runs daily at 9:00 AM via launchd (default: past 24 hours)
 *
 * When spawned by the chatbot A2A server, receives the user's instruction as argv[2].
 * When run via launchd with no argv[2], falls back to "the past 24 hours".
 *
 * The instruction is passed directly to the /pir skill as its argument string.
 * Examples: "incidents today", "P1AB1234", "past 6 hours example.com:zone123"
 */

import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, makeTimestamp, cleanupOldLogs } from "../lib/logger.js";
import { exec } from "../lib/exec.js";
import { spawnClaude } from "../lib/claude.js";
import { parseRepos } from "../lib/repos.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const REPOS = parseRepos("REPO_LIST");
// Instruction passed as argv[2] from chatbot or launchd ProgramArguments.
const INSTRUCTION = process.argv[2] || "the past 24 hours";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.AGENT_WORKSPACE ? join(process.env.AGENT_WORKSPACE, "agent_logs") : SCRIPT_DIR;
const LOG_DIR = join(WORK_DIR, "logs/.oncall-analyzer");
const LOG_FILE = join(LOG_DIR, `oncall-analyzer-${makeTimestamp()}.log`);
const { log } = createLogger(LOG_DIR, LOG_FILE);

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log("=== Oncall Analyzer started ===");
  log(`Instruction: ${INSTRUCTION}`);

  // Fetch latest from remote main for each repo
  log("Fetching latest remote main for all repos...");
  await Promise.all(
    REPOS.map(async (repo) => {
      const repoName = basename(repo);
      const { ok } = await exec("git", ["fetch", "origin", "main"], { cwd: repo });
      log(ok ? `  Fetched: ${repoName}` : `  WARN: Failed to fetch ${repoName}`);
    }),
  );

  const prompt = `/pir ${INSTRUCTION}`;
  log("Invoking Claude CLI...");

  const { code: exitCode, stdout: claudeOutput } = await spawnClaude(
    ["--permission-mode", "acceptEdits", "--add-dir", ...REPOS, "-p", prompt],
    { cwd: WORK_DIR, taskName: "oncall-analyzer", timeoutMs: 24 * 60 * 60 * 1000 },
  ).result;

  log(`Claude CLI exited with code: ${exitCode}`);
  log("--- Response ---");
  log(claudeOutput);
  log("=== Oncall Analyzer finished ===");

  cleanupOldLogs(LOG_DIR, ["oncall-analyzer-"], 30);
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
