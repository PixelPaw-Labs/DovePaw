/**
 * Zendesk Triager - Support ticket investigator
 *
 * When spawned by the chatbot A2A server, receives the user's instruction as argv[2].
 * When run via launchd with no argv[2], defaults to "last 7 days".
 *
 * Searches configured Slack channels for Zendesk ticket discussions, clusters by theme,
 * and investigates configured repos for potential root causes.
 *
 * Required env vars: REPO_LIST
 * Optional env vars: SLACK_WORKSPACE, ZENDESK_SLACK_CHANNELS (fallback if not inferrable from context)
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, makeTimestamp, cleanupOldLogs } from "../lib/logger.js";
import { spawnClaude, AUTONOMY_PREFIX } from "../lib/claude.js";
import { parseRepos } from "../lib/repos.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const REPOS = parseRepos("REPO_LIST");
const INSTRUCTION = process.argv[2] || "last 7 days";
const SLACK_WORKSPACE = process.env.SLACK_WORKSPACE || "";
const ZENDESK_CHANNELS = process.env.ZENDESK_SLACK_CHANNELS || "";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.AGENT_WORKSPACE
  ? join(process.env.AGENT_WORKSPACE, "agent_logs")
  : SCRIPT_DIR;
const LOG_DIR = join(WORK_DIR, "logs/.zendesk-triager");
const LOG_FILE = join(LOG_DIR, `zendesk-triager-${makeTimestamp()}.log`);
const { log } = createLogger(LOG_DIR, LOG_FILE);

function buildPrompt(): string {
  const lines = [
    `[Zendesk Triager] ${AUTONOMY_PREFIX}`,
    "",
    `Repos: ${REPOS.join(", ")}`,
  ];
  if (SLACK_WORKSPACE) lines.push(`Slack workspace: ${SLACK_WORKSPACE}`);
  if (ZENDESK_CHANNELS) lines.push(`Zendesk channels: ${ZENDESK_CHANNELS}`);
  const skillArgs = INSTRUCTION ?? "";
  lines.push("", `Skill("/zendesk-triager ${skillArgs}")`, "", "Report completion as plain text.");
  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log("=== Zendesk Triager started ===");
  log(`Instruction: ${INSTRUCTION}`);
  log(`Slack workspace: ${SLACK_WORKSPACE || "(none — skill will infer)"}`);
  log(`Zendesk channels: ${ZENDESK_CHANNELS || "(none — skill will infer)"}`);
  log(`Repos: ${REPOS.join(", ") || "(none)"}`);

  const prompt = buildPrompt();
  log("Invoking Claude CLI...");

  const { code: exitCode, stdout: claudeOutput } = await spawnClaude(
    ["--permission-mode", "acceptEdits", "-p", prompt],
    { cwd: WORK_DIR, taskName: "zendesk-triager", timeoutMs: 24 * 60 * 60 * 1000 },
  ).result;

  log(`Claude CLI exited with code: ${exitCode}`);
  log("--- Response ---");
  log(claudeOutput);
  log("=== Zendesk Triager finished ===");

  cleanupOldLogs(LOG_DIR, ["zendesk-triager-"], 30);
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
