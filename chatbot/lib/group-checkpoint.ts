/**
 * Group chat checkpoint management.
 *
 * Tracks every completed agent task inside a group context and detects
 * pipeline gaps by walking the agent link topology. Enables Dove to resume
 * stalled sessions with a corrective prompt without touching agent scripts.
 *
 * Layout inside the shared group workspace:
 *   .group-recovery/
 *     goal.json                          — Dove's intent for this run
 *     checkpoints/{taskId}.json          — one file per successfully completed task
 */

import { mkdir, readFile, writeFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentLink, AgentLinkStrategy } from "@@/lib/agent-links-schemas";
import { groupTaskSourceSchema } from "@/lib/group-task-store";
import type { GroupTask } from "@/lib/group-task-store";

// ─── Path helpers ─────────────────────────────────────────────────────────────

export const groupRecoveryDir = (workspacePath: string): string =>
  join(workspacePath, ".group-recovery");

export const groupGoalFile = (workspacePath: string): string =>
  join(groupRecoveryDir(workspacePath), "goal.json");

export const groupCheckpointsDir = (workspacePath: string): string =>
  join(groupRecoveryDir(workspacePath), "checkpoints");

export const groupCheckpointFile = (workspacePath: string, taskId: string): string =>
  join(groupCheckpointsDir(workspacePath), `${taskId}.json`);

// ─── Types ────────────────────────────────────────────────────────────────────

const groupGoalSchema = z.object({
  intent: z.string(),
  groupContextId: z.string(),
  startedAt: z.string(),
});

const groupCheckpointSchema = z.object({
  memberKey: z.string(),
  displayName: z.string(),
  taskId: z.string(),
  contextId: z.string(),
  completedAt: z.string(),
  outputSummary: z.string(),
  /** How this task was dispatched — determines which handoff tool the recovery uses. */
  source: groupTaskSourceSchema.optional(),
});

export type GroupGoal = z.infer<typeof groupGoalSchema>;
export type GroupCheckpoint = z.infer<typeof groupCheckpointSchema>;

export type GroupGap = {
  /** The completed task that should have dispatched a downstream agent but didn't. */
  sourceCheckpoint: GroupCheckpoint;
  /** manifestKey of the agent that was never dispatched. */
  expectedTargetKey: string;
  /** Human-readable name for the expected target (resolved by caller from memberDefs). */
  expectedTargetDisplayName: string;
  /** Dispatch strategy derived from the link — determines which handoff tool to call. */
  source: AgentLinkStrategy;
};

// ─── Goal ─────────────────────────────────────────────────────────────────────

/**
 * Builds the high-level intent string for a group run.
 * Intent is deliberately vague — no ticket keys or branch names —
 * so recovery prompts remain valid regardless of specific deliverables.
 */
export function buildGroupGoalIntent(name: string, description?: string): string {
  return [
    `Complete all work items for group "${name}" end-to-end.`,
    description && `Group focus: ${description}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Writes the group goal file. Called by makeInitGroupTool.
 * The intent is a high-level description of what the team should accomplish —
 * no specific ticket keys or branch names.
 */
export async function writeGroupGoal(
  workspacePath: string,
  groupContextId: string,
  intent: string,
): Promise<void> {
  await mkdir(groupRecoveryDir(workspacePath), { recursive: true });
  const goal: GroupGoal = { intent, groupContextId, startedAt: new Date().toISOString() };
  await writeFile(groupGoalFile(workspacePath), JSON.stringify(goal, null, 2));
}

export async function readGroupGoal(workspacePath: string): Promise<GroupGoal | undefined> {
  try {
    const raw = await readFile(groupGoalFile(workspacePath), "utf-8");
    const result = groupGoalSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

// ─── Checkpoints ──────────────────────────────────────────────────────────────

/**
 * Writes a checkpoint for a successfully completed task.
 * Called by TaskPoller.poll() on successful task completion.
 * Atomic write via rename to avoid partial reads.
 */
export async function writeGroupCheckpoint(
  workspacePath: string,
  checkpoint: GroupCheckpoint,
): Promise<void> {
  const dir = groupCheckpointsDir(workspacePath);
  await mkdir(dir, { recursive: true });
  const dest = groupCheckpointFile(workspacePath, checkpoint.taskId);
  const tmp = `${dest}.${checkpoint.taskId.slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(checkpoint, null, 2));
  await rename(tmp, dest);
}

export async function readGroupCheckpoints(workspacePath: string): Promise<GroupCheckpoint[]> {
  try {
    const dir = groupCheckpointsDir(workspacePath);
    const entries = (await readdir(dir)).filter((e) => e.endsWith(".json"));
    const results = await Promise.all(
      entries.map(async (e) => {
        try {
          const raw = await readFile(join(dir, e), "utf-8");
          const result = groupCheckpointSchema.safeParse(JSON.parse(raw));
          return result.success ? result.data : undefined;
        } catch {
          return undefined;
        }
      }),
    );
    return results.filter((r): r is GroupCheckpoint => r !== undefined);
  } catch {
    return [];
  }
}

// ─── Gap detection ────────────────────────────────────────────────────────────

/**
 * Detects pipeline gaps by walking the agent link topology.
 *
 * For each link (source → target) in the group, this function checks
 * whether every completed source checkpoint was followed by at least one
 * target task starting after it. Uses temporal windowing: a target task
 * "belongs to" a source checkpoint when it started after source completed
 * and before the next source completed. This correctly attributes N concurrent
 * dispatches without requiring per-ticket tagging on the tasks.
 */
export function detectGaps(
  checkpoints: GroupCheckpoint[],
  tasks: GroupTask[],
  links: AgentLink[],
  groupName: string,
): GroupGap[] {
  const gaps: GroupGap[] = [];
  const relevantLinks = links.filter((l) => l.group === groupName || !l.group);

  for (const link of relevantLinks) {
    const sourceCheckpoints = checkpoints
      .filter((c) => c.memberKey === link.source)
      .toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));

    if (sourceCheckpoints.length === 0) continue;

    const allTargetTasks = tasks.filter((t) => t.memberKey === link.target);

    for (let i = 0; i < sourceCheckpoints.length; i++) {
      const src = sourceCheckpoints[i];
      // Window closes at the next source checkpoint's completion, or open-ended
      const windowEnd = sourceCheckpoints[i + 1]?.completedAt ?? "9999-99-99T99:99:99.999Z";

      const hasTarget = allTargetTasks.some(
        (t) => t.startedAt > src.completedAt && t.startedAt < windowEnd,
      );

      if (!hasTarget) {
        gaps.push({
          sourceCheckpoint: src,
          expectedTargetKey: link.target,
          expectedTargetDisplayName: link.target, // caller resolves from memberDefs
          source: link.strategy,
        });
      }
    }
  }

  return gaps;
}

// ─── Correction prompt ────────────────────────────────────────────────────────

/**
 * Builds the corrective prompt injected into a resumed agent session.
 *
 * Generic recovery brief — does not assume which case applies.
 * The agent diagnoses the situation and takes the appropriate action.
 */
export function buildCorrectionPrompt(gap: GroupGap, goalIntent: string): string {
  return [
    `The team pipeline has stalled — ${gap.expectedTargetDisplayName} has not started any work since your task (taskId: ${gap.sourceCheckpoint.taskId}) completed.`,
    ``,
    `Team goal: ${goalIntent}`,
    ``,
    `Your last recorded output:`,
    gap.sourceCheckpoint.outputSummary || "(no summary recorded)",
    ``,
    `Assess what happened and take the right corrective action:`,
    `1. If your work is complete and ${gap.expectedTargetDisplayName} should have been dispatched — dispatch it now.`,
    `2. If your work was incomplete or produced an error — complete it, then dispatch ${gap.expectedTargetDisplayName}.`,
    `3. If something else is blocking progress — address it first.`,
    ``,
    `Do NOT re-do work that is already done.`,
  ].join("\n");
}
