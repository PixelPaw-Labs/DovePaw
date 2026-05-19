#!/usr/bin/env npx tsx
/**
 * Handoff range checker for DovePaw agent links.
 *
 * Usage: npx tsx handoff-check.ts <context-file> scoreKey=score [scoreKey=score ...]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GUIDANCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../lib/handoff-guidance");

function callSentence(strategy: string, name: string): string {
  switch (strategy) {
    case "chat":
      return `Delegate to ${name}`;
    case "review":
      return `Send your output to ${name} for peer review`;
    case "escalation":
      return `Escalate to ${name}`;
    default:
      return `Call ${name}`;
  }
}

const STRATEGY_FILES: Record<string, string> = {
  chat: "chat.md",
  review: "review.md",
  escalation: "escalate.md",
};

const [, , contextFile, ...scorePairs] = process.argv;

if (!contextFile || scorePairs.length === 0) {
  console.error(
    "Usage: npx tsx handoff-check.ts <context-file> scoreKey=score [scoreKey=score ...]",
  );
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

// Collect triggered and skipped results, grouped by strategy for triggered ones.
const triggered = new Map<string, string[]>(); // strategy → agent names
const skipped: string[] = [];

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
    const group = triggered.get(link.strategy) ?? [];
    group.push(link.name);
    triggered.set(link.strategy, group);
  } else {
    skipped.push(`Skip ${link.name} because the score is outside the range`);
  }
}

let idx = 1;
for (const [strategy, names] of triggered) {
  const file = STRATEGY_FILES[strategy] ?? "chat.md";
  console.log(
    `${idx++}. **${callSentence(strategy, names.join(", "))}**, read \`${resolve(GUIDANCE_DIR, file)}\` to understand when and how to proceed`,
  );
}

for (const line of skipped) {
  console.log(`~~${line}~~`);
}

if (triggered.size === 0) {
  console.log("\nNo handoffs triggered. Continue without calling any linked agent.");
}
