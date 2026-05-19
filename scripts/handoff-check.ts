#!/usr/bin/env npx tsx
/**
 * Handoff range checker for DovePaw agent links.
 *
 * Usage: npx tsx handoff-check.ts <context-file> scoreKey=score [scoreKey=score ...]
 *
 * For each agent: if score falls within [handoffScoreMin, handoffScoreMax],
 * prints CALL + the full pattern guidance (sourced directly from
 * lib/agent-link-patterns.ts). If out of range, prints SKIP only.
 */
import { readFileSync } from "node:fs";
import { HANDOFF_PATTERNS, REVIEW_PATTERNS, ESCALATE_PATTERNS } from "../lib/agent-link-patterns";

const STRATEGY_PATTERNS: Record<string, (name?: string) => string> = {
  chat: HANDOFF_PATTERNS,
  review: REVIEW_PATTERNS,
  escalation: ESCALATE_PATTERNS,
};

const [, , contextFile, ...scorePairs] = process.argv;

if (!contextFile || scorePairs.length === 0) {
  console.error(
    "Usage: npx tsx handoff-check.ts <context-file> scoreKey=score [scoreKey=score ...]",
  );
  console.error("Score each agent 0–100. CALL result includes full handoff guidance.");
  process.exit(1);
}

interface HandoffLink {
  scoreKey: string;
  toolKey: string;
  name: string;
  strategy: string;
  handoffScoreMin: number;
  handoffScoreMax: number;
}

interface HandoffContext {
  completedAgent: string;
  links: HandoffLink[];
}

function assertHandoffContext(val: unknown): asserts val is HandoffContext {
  if (typeof val !== "object" || val === null) throw new Error("Invalid context file format");
}

let ctx: HandoffContext;

try {
  const raw: unknown = JSON.parse(readFileSync(contextFile, "utf8"));
  assertHandoffContext(raw);
  ctx = raw;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Failed to read context file: ${msg}`);
  process.exit(1);
}

let anyCalled = false;

for (const pair of scorePairs) {
  const eqIdx = pair.lastIndexOf("=");
  if (eqIdx === -1) {
    console.log(`INVALID  ${pair} — expected scoreKey=score`);
    continue;
  }
  const scoreKey = pair.slice(0, eqIdx);
  const score = parseInt(pair.slice(eqIdx + 1), 10);
  if (isNaN(score)) {
    console.log(`INVALID  ${scoreKey} — score must be a number 0–100`);
    continue;
  }
  const link = ctx.links.find((l) => l.scoreKey === scoreKey);
  if (!link) {
    console.log(`UNKNOWN  ${scoreKey} — not found in context file`);
    continue;
  }

  const inRange = score >= link.handoffScoreMin && score <= link.handoffScoreMax;

  if (inRange) {
    anyCalled = true;
    const patternFn = STRATEGY_PATTERNS[link.strategy] ?? HANDOFF_PATTERNS;
    console.log(
      `\nCALL  ${scoreKey}  (score=${score}, handoffScoreMin=${link.handoffScoreMin}, handoffScoreMax=${link.handoffScoreMax})`,
    );
    console.log(patternFn(link.name));
  } else {
    console.log(
      `SKIP  ${scoreKey}  (score=${score}, outside [${link.handoffScoreMin}, ${link.handoffScoreMax}])`,
    );
  }
}

if (!anyCalled) {
  console.log("\nNo handoffs triggered. Continue without calling any linked agent.");
}
