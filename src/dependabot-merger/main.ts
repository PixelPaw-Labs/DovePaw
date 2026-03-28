/**
 * Dependabot Merger - Automated dependency PR reviewer and merger
 *
 * When spawned by the chatbot A2A server, receives the user's instruction as argv[2].
 * When run via launchd with no argv[2], processes all configured repos.
 *
 * Lists open Dependabot PRs across configured repos, assesses risk, maps to Jira sprint
 * tickets, and merges safe PRs (or dry-runs if instructed).
 *
 * Required env vars: REPO_LIST
 * Optional env vars: JIRA_SPRINT_PREFIX (fallback if sprint cannot be inferred from context)
 *
 * REPO_LIST should contain local repo paths. The skill derives GitHub slugs from
 * each repo's remote origin URL.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, makeTimestamp, cleanupOldLogs } from "../lib/logger.js";
import { spawnClaude, AUTONOMY_PREFIX } from "../lib/claude.js";
import { parseRepos } from "../lib/repos.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const REPOS = parseRepos("REPO_LIST");
const INSTRUCTION = process.argv[2] || "";
const SPRINT_PREFIX = process.env.JIRA_SPRINT_PREFIX || "";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.AGENT_WORKSPACE
  ? join(process.env.AGENT_WORKSPACE, "agent_logs")
  : SCRIPT_DIR;
const LOG_DIR = join(WORK_DIR, "logs/.dependabot-merger");
const LOG_FILE = join(LOG_DIR, `dependabot-merger-${makeTimestamp()}.log`);
const { log } = createLogger(LOG_DIR, LOG_FILE);

function buildPrompt(): string {
  const lines = [
    `[Dependabot Merger] ${AUTONOMY_PREFIX}`,
    "",
    `Repos: ${REPOS.join(", ")}`,
  ];
  if (SPRINT_PREFIX) lines.push(`Sprint prefix: ${SPRINT_PREFIX}`);
  const skillArgs = INSTRUCTION ?? "";
  lines.push("", `Skill("/dependabot-merger ${skillArgs}")`, "", "Report completion as plain text.");
  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log("=== Dependabot Merger started ===");
  log(`Instruction: ${INSTRUCTION || "(none)"}`);
  log(`Sprint prefix: ${SPRINT_PREFIX || "(none — skill will infer from context)"}`);
  log(`Repos: ${REPOS.join(", ") || "(none)"}`);

  const prompt = buildPrompt();
  log("Invoking Claude CLI...");

  const { code: exitCode, stdout: claudeOutput } = await spawnClaude(
    ["--permission-mode", "acceptEdits", "-p", prompt],
    { cwd: WORK_DIR, taskName: "dependabot-merger", timeoutMs: 4 * 60 * 60 * 1000 },
  ).result;

  log(`Claude CLI exited with code: ${exitCode}`);
  log("--- Response ---");
  log(claudeOutput);
  log("=== Dependabot Merger finished ===");

  cleanupOldLogs(LOG_DIR, ["dependabot-merger-"], 30);
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
