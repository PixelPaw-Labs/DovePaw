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
      "Sub-agent-builder quality gate: Before stopping, evaluate ALL files you created or edited against the sub-agent-builder SKILL.md specification. " +
      "Check: (1) main.ts — all {{PLACEHOLDER}} values substituted, spawning pattern correct, INSTRUCTION passed through, agent script flow steps and logic are correct without flaw (no dead branches, correct error handling, publishStatusToUI called appropriately (awaited), subprocess env correct etc); " +
      "(2) agent.json — all required fields present, no pluginPath set, every envVars entry has an `id` UUID (missing id causes Zod to silently drop the agent from the Kiln group); " +
      '(3) SKILL.md if created — frontmatter valid for Claude Code, argument pattern documented, output contract defined; and main.ts invokes it via Skill("/skill-name ${INSTRUCTION}") with no duplicate task prompt elsewhere; ' +
      "(4) if the agent writes to repos and uses Claude (not Codex), claudeOpts.worktree must be set in runner.run() opts (Pattern B). " +
      "Fix all listed issues first, then — after all fixes are complete — " +
      'end your final message with a JSON object on its own line: ```json\n{"confidence": <0-100>, "issues": ["<remaining issue>", ...]}\n```. ' +
      "The JSON must come AFTER all fixes so it reflects the post-fix state.",
  }) + "\n",
);
