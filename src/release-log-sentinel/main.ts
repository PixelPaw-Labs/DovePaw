/**
 * Release Log Sentinel - Monitors Claude Code releases for JSONL format changes
 * that could break tail-claude-gui (https://github.com/delexw/tail-claude-gui)
 *
 * Runs weekly (Sunday 10:00 AM) via launchd.
 * Invokes Claude CLI with a prompt that:
 *   1. Fetches recent Claude Code release notes
 *   2. Analyzes for JSONL transcription format changes
 *   3. Checks existing GitHub issues to avoid duplicates
 *   4. Creates issues for new breaking changes found
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import { createLogger, makeTimestamp, cleanupOldLogs } from "../lib/logger.js";
import { spawnClaude } from "../lib/claude.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const REPO = "delexw/tail-claude-gui";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.AGENT_WORKSPACE ? join(process.env.AGENT_WORKSPACE, "agent_logs") : SCRIPT_DIR;
const LOG_DIR = join(WORK_DIR, "logs/.release-log-sentinel");
const LOG_FILE = join(LOG_DIR, `release-log-sentinel-${makeTimestamp()}.log`);
const { log } = createLogger(LOG_DIR, LOG_FILE);

// ─── Prompt ─────────────────────────────────────────────────────────────────

const PROMPT = `
You are a compatibility checker. Your job is to review the latest Claude Code release notes for changes that could break the JSONL transcription format used by the tail-claude-gui desktop app (https://github.com/${REPO}).

## Background

tail-claude-gui is a Tauri v2 desktop app that reads Claude Code session JSONL transcription files and displays them as a conversation UI. The default JSONL location is ~/.claude/projects/<project-hash>/sessions/, but this is configurable (e.g. via the \`autoMemoryDirectory\` setting or other Claude Code config). The parser must handle JSONL files regardless of where they are stored. Its Rust parser expects specific JSONL entry fields.

## Known JSONL Entry Fields the Parser Relies On

Each JSONL line is expected to have:

**Critical fields (entry discarded if broken):**
- \`type\` (string): "user", "assistant", "summary", "progress", "system", "file-history-snapshot", "queue-operation"
- \`uuid\` or \`leafUuid\` (string): at least one must be non-empty
- \`timestamp\` (string): ISO 8601 / RFC 3339
- \`message\` (object): contains \`role\`, \`content\`, \`model\`, \`stop_reason\`, \`usage\`

**Standard fields:**
- \`isSidechain\` (boolean), \`isMeta\` (boolean)
- \`cwd\`, \`gitBranch\`, \`permissionMode\` (strings)
- \`requestId\` (string): token deduplication
- \`toolUseResult\`, \`sourceToolUseID\`
- \`summary\` (string): for "summary" type entries
- \`teamName\`, \`agentName\` (strings)

**Content block types within message.content array:**
- \`text\`, \`tool_use\` (with \`id\`, \`name\`, \`input\`), \`thinking\`, \`tool_result\`

**Token fields in message.usage:**
- \`input_tokens\`, \`output_tokens\`, \`cache_read_input_tokens\`, \`cache_creation_input_tokens\`

**MCP tool name pattern:** \`mcp__<server>__<tool>\`

## Instructions

### Step 1: Analyze Release Notes for Breaking Changes

Read the release notes file provided, then scan for changes that could affect JSONL parsing:
- New entry types added to the \`type\` field
- New or renamed fields in the JSONL entry structure
- Changes to \`message.content\` block types
- Changes to token accounting (\`usage\` field, \`requestId\` behavior)
- Changes to streaming behavior (partial entry writes)
- Changes to compaction (compact_boundary or summary format)
- Changes to agent/team/worktree entries (new fields)
- Changes to sidechain handling
- Changes to MCP tool naming pattern
- Changes to hook/progress entries
- Session file location, naming, or directory structure changes (the path is configurable, so changes to default paths, new config options, or directory layout matter)
- Session metadata storage changes

Rate each finding: Critical / Moderate / Low.

### Step 3: Check Existing Issues

Before creating anything, check existing issues:
\`\`\`
gh issue list -R ${REPO} --limit 100 --json title,number,state,labels,body
gh issue list -R ${REPO} --state closed --limit 50 --json title,number,state
\`\`\`

Do NOT create duplicate issues. An issue is a duplicate if ANY open or closed issue describes the same Claude Code change/version or the same parser impact. If the issue already exists (whether open, closed, or resolved), skip it entirely.

### Step 4: Create Issues

For each new non-duplicate finding, run:
\`\`\`
gh issue create -R ${REPO} \\
  --title "[Compat] Claude Code vX.Y.Z: <brief description>" \\
  --body "<body>"
\`\`\`

Issue body format:
\`\`\`
## Claude Code Version
vX.Y.Z (release date)

## Change Description
<What changed>

## Impact on tail-claude-gui
<How this affects the JSONL parser>

**Severity**: Critical / Moderate / Low

## Affected Parser Code
- src-tauri/src/parser/entry.rs - Entry struct
- (other files)

## Suggested Fix
<Brief suggestion>

## Source
<Link to release notes>
\`\`\`

### Step 5: Report

Summarize: releases checked, issues found, duplicates skipped, new issues created (with links). If nothing found, say so.
`.trim();

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log("=== Release Log Sentinel started ===");
  log(`Target repo: ${REPO}`);

  // Step 1: Spawn Claude with /release-notes to get release notes
  log("Fetching release notes via Claude /release-notes...");
  const { code: rnExitCode, stdout: releaseNotes } = await spawnClaude(["-p", "/release-notes"], {
    cwd: WORK_DIR,
    taskName: "release-log-sentinel-fetch",
    timeoutMs: 2 * 60 * 1000,
  }).result;

  if (rnExitCode !== 0 || !releaseNotes.trim()) {
    log(`ERROR: Failed to fetch release notes (exit code: ${rnExitCode})`);
    process.exit(1);
  }
  log(`Fetched release notes (${releaseNotes.length} chars)`);

  // Step 2: Save release notes to temp file
  const tmpFile = join(WORK_DIR, ".jsonl-compat-release-notes.tmp");
  writeFileSync(tmpFile, releaseNotes);
  log(`Saved release notes to ${tmpFile}`);

  // Step 3: Spawn Claude to analyze release notes
  log("Analyzing release notes for JSONL breaking changes...");
  const fullPrompt = `${PROMPT}\n\nThe release notes are saved at: ${tmpFile}\nRead that file first, then proceed with the analysis.`;

  const { code: exitCode, stdout: claudeOutput } = await spawnClaude(
    ["--permission-mode", "acceptEdits", "-p", fullPrompt],
    { cwd: WORK_DIR, taskName: "release-log-sentinel", timeoutMs: 10 * 60 * 1000 },
  ).result;

  // Cleanup temp file
  try {
    unlinkSync(tmpFile);
  } catch {}

  log(`Claude CLI exited with code: ${exitCode}`);
  log("--- Response ---");
  log(claudeOutput);
  log("=== Release Log Sentinel finished ===");

  cleanupOldLogs(LOG_DIR, ["release-log-sentinel-"], 30);
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
