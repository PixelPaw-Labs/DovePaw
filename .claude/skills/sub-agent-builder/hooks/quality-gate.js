#!/usr/bin/env node
// Sub-agent-builder quality gate (Stop hook)
// Blocks stop if the last assistant message does not contain a confidence score >= 90.

import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8").trim() || "{}");

const lastMsg = input.last_assistant_message ?? "";

// Parse JSON confidence report emitted by Claude at the end of its response.
// Expected format (last JSON object in message): {"confidence": 92, "issues": [...]}
let score = -1;
const jsonMatches = lastMsg.match(/\{[^{}]*"confidence"\s*:\s*(\d+)[^{}]*\}/g);
if (jsonMatches) {
  try {
    const last = JSON.parse(jsonMatches[jsonMatches.length - 1]);
    score = typeof last.confidence === "number" ? last.confidence : -1;
  } catch {
    // malformed JSON — treat as no score
  }
}

// Score check first — Claude responded with >= 90 after being prompted.
if (score >= 90) process.exit(0);

// Safety net: if we already fired once and Claude still didn't reach 90, let it stop.
// Blocking again would cause an infinite loop since stop_hook_active stays true.
if (input.stop_hook_active) process.exit(0);

process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason:
      "Sub-agent-builder quality gate: Re-read every file you created or edited and verify each check. " +
      "(1) main.ts — all {{PLACEHOLDER}} values substituted; INSTRUCTION read from process.argv[2] and passed through as plain text (never parsed, split, or regex-matched); publishStatusToUI called at meaningful steps and always awaited; no dead branches or unused imports; subprocess env correct (CLAUDECODE unset, clean PATH); every runner.run() call supplies BOTH claudeOpts AND codexOpts (omitting either silently breaks runner switching via AGENT_SCRIPT_MODEL). " +
      "(2) Runner / worktree — if the agent writes to repos using Claude: claudeOpts.worktree is set (Pattern B); NO git worktree add or git worktree remove commands appear anywhere in main.ts, run.ts, or any skill body (Claude Code manages the worktree lifecycle automatically). " +
      "(3) agent.json — all required fields present (name, alias, displayName, description, personality, schedulingEnabled, repos, envVars, iconName, iconBg, iconColor, doveCard, suggestions); pluginPath NOT set; every envVars entry has an id UUID (missing id causes Zod to silently drop the agent from the Kiln group). " +
      '(4) SKILL.md (if created) — frontmatter has name, description, argument-hint; $ARGUMENTS parsing documented at the top; output contract defined (structured JSON last line if agent calls skill in a loop, plain text otherwise); main.ts invokes via Skill("/skill-name ${INSTRUCTION}") with task logic not duplicated elsewhere. ' +
      '(5) agent-local (if agent-local/<name>/ exists in the project root) — agent.json has no pluginPath; every envVars entry has an id UUID; all envVars[*].value are "" in source (secrets must not be committed — filled via Settings UI at runtime); main.ts is present and non-empty. ' +
      "Fix all issues first, then end your final message with a JSON object on its own line: " +
      '```json\n{"confidence": <0-100>, "issues": ["<remaining issue>", ...]}\n```. ' +
      "The JSON must come AFTER all fixes so it reflects the post-fix state.",
  }) + "\n",
);
