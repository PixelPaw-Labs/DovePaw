/**
 * Per-group task ledger keyed strictly by `groupContextId`.
 *
 * Every async task spawned inside a group's context (start_group_*,
 * start_chat_to_*, start_review_with_*, start_escalate_to_*) is recorded
 * here on dispatch and marked `done` when it reaches a terminal state. Dove
 * (or `await_group_*`) reads pendingGroupTasks(groupContextId) to know what
 * is still in flight and skip already-finished work.
 *
 * No fallback storage — tasks fired outside a group are not persisted.
 */

import { mkdir, readFile, writeFile, readdir, unlink, rename, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GROUP_TASKS_DIR, groupTasksFile } from "@@/lib/paths";

export const groupTaskSourceSchema = z.enum(["group", "chat", "review", "escalation"]);
const groupTaskSchema = z.object({
  taskId: z.string(),
  source: groupTaskSourceSchema,
  memberKey: z.string(),
  displayName: z.string(),
  status: z.enum(["running", "done"]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  /** A2A context ID for session resumption in recovery. */
  contextId: z.string().optional(),
});
const groupTaskRecordSchema = z.object({
  groupContextId: z.string(),
  /** Shared workspace path for this group run — used by checkpoint writer. */
  groupWorkspacePath: z.string().optional(),
  tasks: z.array(groupTaskSchema),
});

export type GroupTaskSource = z.infer<typeof groupTaskSourceSchema>;
export type GroupTask = z.infer<typeof groupTaskSchema>;
export type GroupTaskRecord = z.infer<typeof groupTaskRecordSchema>;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readRecord(groupContextId: string): Promise<GroupTaskRecord | undefined> {
  const file = groupTasksFile(groupContextId);
  if (!(await exists(file))) return undefined;
  const result = groupTaskRecordSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  return result.success ? result.data : undefined;
}

async function writeRecord(record: GroupTaskRecord): Promise<void> {
  await mkdir(GROUP_TASKS_DIR, { recursive: true });
  // Atomic write: writeFile opens with truncate, leaving a zero-byte window
  // a concurrent reader can land in. Stage to a tmp path, then rename.
  const file = groupTasksFile(record.groupContextId);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2));
  await rename(tmp, file);
}

export async function recordGroupTask(
  groupContextId: string,
  task: Omit<GroupTask, "status" | "startedAt" | "completedAt">,
  groupWorkspacePath?: string,
): Promise<void> {
  const existing = (await readRecord(groupContextId)) ?? { groupContextId, tasks: [] };
  if (existing.tasks.some((t) => t.taskId === task.taskId)) return;
  // Persist the workspace path on the record on first write (or backfill if absent).
  if (groupWorkspacePath && !existing.groupWorkspacePath) {
    existing.groupWorkspacePath = groupWorkspacePath;
  }
  existing.tasks.push({ ...task, status: "running", startedAt: new Date().toISOString() });
  await writeRecord(existing);
}

export async function markGroupTaskDone(taskId: string): Promise<void> {
  if (!(await exists(GROUP_TASKS_DIR))) return;
  const entries = (await readdir(GROUP_TASKS_DIR)).filter((e) => e.endsWith(".json"));
  const records = await Promise.all(entries.map((e) => readRecord(e.slice(0, -".json".length))));
  const hit = records
    .map((record) => {
      const task = record?.tasks.find((t) => t.taskId === taskId && t.status === "running");
      return task && record ? { record, task } : undefined;
    })
    .find((x): x is { record: GroupTaskRecord; task: GroupTask } => x !== undefined);
  if (!hit) return;
  hit.task.status = "done";
  hit.task.completedAt = new Date().toISOString();
  await writeRecord(hit.record);
}

export async function pendingGroupTasks(groupContextId: string): Promise<GroupTask[]> {
  const record = await readRecord(groupContextId);
  if (!record) return [];
  return record.tasks.filter((t) => t.status === "running");
}

export async function readGroupTaskRecord(
  groupContextId: string,
): Promise<GroupTaskRecord | undefined> {
  return readRecord(groupContextId);
}

/**
 * Looks up the group workspace path and A2A context ID for a given task ID.
 * Used by TaskPoller.poll() to write checkpoints without knowing the group context upfront.
 * Returns undefined when the task was not group-scoped or has no contextId.
 */
export async function getGroupWorkspaceForTask(taskId: string): Promise<
  | {
      workspacePath: string;
      contextId: string;
      source: GroupTaskSource;
    }
  | undefined
> {
  if (!(await exists(GROUP_TASKS_DIR))) return undefined;
  const entries = (await readdir(GROUP_TASKS_DIR)).filter((e) => e.endsWith(".json"));
  const records = await Promise.all(entries.map((e) => readRecord(e.slice(0, -".json".length))));
  for (const record of records) {
    if (!record?.groupWorkspacePath) continue;
    const task = record.tasks.find((t) => t.taskId === taskId);
    if (task?.contextId) {
      return {
        workspacePath: record.groupWorkspacePath,
        contextId: task.contextId,
        source: task.source,
      };
    }
  }
  return undefined;
}

export async function deleteGroupTaskLedger(groupContextId: string): Promise<void> {
  const file = groupTasksFile(groupContextId);
  if (await exists(file)) await unlink(file);
}

/** Removes every ledger file in GROUP_TASKS_DIR. Used by the bulk "delete all sessions" route. */
export async function deleteAllGroupTaskLedgers(): Promise<void> {
  if (!(await exists(GROUP_TASKS_DIR))) return;
  const entries = (await readdir(GROUP_TASKS_DIR)).filter((e) => e.endsWith(".json"));
  await Promise.all(entries.map((e) => deleteGroupTaskLedger(e.slice(0, -".json".length))));
}
