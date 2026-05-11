import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentPersistentMetaDir } from "@@/lib/paths";

const MAX_ENTRIES = 10;

const DELAY_NO_HISTORY =
  "start with 30000ms. On each still_running halve the previous timeoutMs (min 10000ms).";
const DELAY_STILL_RUNNING_RULE = "Each still_running → halve previous timeoutMs (min 10000ms).";

function buildDelayPrompt(
  base: string,
  noHistoryLabel: string,
  info: { historySummary: string; firstDelay: number; p75Label: string } | null,
): string {
  if (!info) return `${base} ${noHistoryLabel} — ${DELAY_NO_HISTORY}`;
  return [
    base,
    info.historySummary,
    `Algorithm: 1st await → ${info.firstDelay}ms (≈ ${info.p75Label} × 1.2).`,
    DELAY_STILL_RUNNING_RULE,
  ].join(" ");
}

type RuntimeEntry = { toolName: string; durationMs: number; completedAt: string };

function readAllEntries(file: string): RuntimeEntry[] {
  try {
    if (!existsSync(file)) return [];
    return (
      readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        .map((l) => JSON.parse(l) as RuntimeEntry)
    );
  } catch {
    return [];
  }
}

function readToolRuntime(agentName: string, toolName: string): number[] {
  const file = join(agentPersistentMetaDir(agentName), "runtime.jsonl");
  return readAllEntries(file)
    .filter((e) => e.toolName === toolName)
    .map((e) => e.durationMs);
}

/**
 * Builds the delayMs describe() string for a group await tool.
 * Uses the max p75 across all member agents — the slowest member drives the wait.
 */
function buildGroupDelayMsDescription(members: { agentName: string; toolName: string }[]): string {
  const base = "Milliseconds to wait for all group members to respond (min 10000).";
  const histories = members.map((m) => ({
    toolName: m.toolName,
    durations: readToolRuntime(m.agentName, m.toolName),
  }));
  const withHistory = histories.filter((h) => h.durations.length > 0);
  if (withHistory.length === 0) {
    return buildDelayPrompt(base, "No member history yet", null);
  }
  const p75s = withHistory.map(({ toolName, durations }) => {
    const sorted = durations.toSorted((a, b) => a - b);
    return { toolName, p75: sorted[Math.min(Math.floor(sorted.length * 0.75), sorted.length - 1)] };
  });
  const maxP75 = Math.max(...p75s.map((e) => e.p75));
  const memberSummary = p75s.map((e) => `${e.toolName} p75: ${e.p75}ms`).join(", ");
  return buildDelayPrompt(base, "No member history yet", {
    historySummary: `Member history — ${memberSummary}. Max p75: ${maxP75}ms.`,
    firstDelay: Math.max(10000, Math.round(maxP75 * 1.2)),
    p75Label: "max p75",
  });
}

/**
 * Builds the delayMs describe() string for an await tool.
 * Embeds historical durations so the agent can calculate an adaptive delay.
 */
function buildDelayMsDescription(agentName: string, toolName: string): string {
  const history = readToolRuntime(agentName, toolName);
  const base = "Milliseconds to wait for the agent to respond (min 10000).";
  if (history.length === 0) {
    return buildDelayPrompt(base, "No history yet", null);
  }
  const sorted = history.toSorted((a, b) => a - b);
  const p75 = sorted[Math.min(Math.floor(sorted.length * 0.75), sorted.length - 1)];
  const avg = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
  return buildDelayPrompt(base, "No history yet", {
    historySummary: `History (ms): [${history.join(", ")}]. p75: ${p75}ms, Avg: ${avg}ms.`,
    firstDelay: Math.max(10000, Math.round(p75 * 1.2)),
    p75Label: "p75",
  });
}

function appendTaskRuntime(agentName: string, toolName: string, durationMs: number): void {
  try {
    const dir = agentPersistentMetaDir(agentName);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "runtime.jsonl");

    let entries = readAllEntries(file);

    entries.push({ toolName, durationMs, completedAt: new Date().toISOString() });

    // Keep at most MAX_ENTRIES per toolName (rotate oldest first).
    const byTool = new Map<string, RuntimeEntry[]>();
    for (const e of entries) {
      const bucket = byTool.get(e.toolName) ?? [];
      bucket.push(e);
      byTool.set(e.toolName, bucket);
    }
    const trimmed: RuntimeEntry[] = [];
    for (const bucket of byTool.values()) {
      trimmed.push(...(bucket.length > MAX_ENTRIES ? bucket.slice(-MAX_ENTRIES) : bucket));
    }

    writeFileSync(file, trimmed.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } catch {
    // Non-fatal — never fail the tool call due to a runtime log write error.
  }
}

/**
 * Tracks task start times and persists execution durations to JSONL.
 * Owns the full task-runtime lifecycle: start → record → describe.
 */
export class TaskRuntime {
  private readonly startTimes = new Map<string, number>();

  /** Record when a task was submitted. */
  start(id: string): void {
    this.startTimes.set(id, Date.now());
  }

  /**
   * Compute elapsed ms since start(id) and persist to JSONL.
   * No-op (skips append) if id was never started.
   */
  record(id: string, agentName: string, toolName: string): void {
    const t = this.startTimes.get(id);
    this.startTimes.delete(id);
    if (t !== undefined) appendTaskRuntime(agentName, toolName, Date.now() - t);
  }

  /** Persist a known durationMs directly (e.g. from script completion). */
  append(agentName: string, toolName: string, durationMs: number): void {
    appendTaskRuntime(agentName, toolName, durationMs);
  }

  buildDescription(agentName: string, toolName: string): string {
    return buildDelayMsDescription(agentName, toolName);
  }

  buildGroupDescription(members: { agentName: string; toolName: string }[]): string {
    return buildGroupDelayMsDescription(members);
  }
}

export const taskRuntime = new TaskRuntime();
