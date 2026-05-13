import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  return { tmpDir: path.join(os.tmpdir(), `group-task-store-test-${Date.now()}-${process.pid}`) };
});

vi.mock("@@/lib/paths", () => ({
  GROUP_TASKS_DIR: tmpDir,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  groupTasksFile: (id: string) => require("node:path").join(tmpDir, `${id}.json`),
}));

import {
  recordGroupTask,
  markGroupTaskDone,
  pendingGroupTasks,
  readGroupTaskRecord,
  deleteGroupTaskLedger,
} from "../group-task-store";

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

const sampleTask = (overrides: Partial<{ taskId: string; memberKey: string }> = {}) => ({
  taskId: overrides.taskId ?? "t-1",
  source: "group" as const,
  memberKey: overrides.memberKey ?? "agent_a",
  displayName: "Agent A",
});

describe("group-task-store", () => {
  it("records a task with running status and timestamps", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    const record = await readGroupTaskRecord("ctx-1");
    expect(record).toBeDefined();
    expect(record!.groupContextId).toBe("ctx-1");
    expect(record!.tasks).toHaveLength(1);
    expect(record!.tasks[0]).toMatchObject({
      taskId: "t-1",
      source: "group",
      memberKey: "agent_a",
      displayName: "Agent A",
      status: "running",
    });
    expect(record!.tasks[0].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("appends additional tasks under the same groupContextId", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    await recordGroupTask("ctx-1", {
      taskId: "t-2",
      source: "chat_to",
      memberKey: "agent_b",
      displayName: "Agent B",
    });
    const record = await readGroupTaskRecord("ctx-1");
    expect(record!.tasks.map((t) => t.taskId)).toEqual(["t-1", "t-2"]);
    expect(record!.tasks[1].source).toBe("chat_to");
  });

  it("isolates tasks per groupContextId", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    await recordGroupTask("ctx-2", {
      taskId: "t-2",
      source: "review",
      memberKey: "agent_c",
      displayName: "Agent C",
    });
    expect((await readGroupTaskRecord("ctx-1"))!.tasks).toHaveLength(1);
    expect((await readGroupTaskRecord("ctx-2"))!.tasks).toHaveLength(1);
    expect((await readGroupTaskRecord("ctx-2"))!.tasks[0].taskId).toBe("t-2");
  });

  it("returns undefined for an unknown groupContextId", async () => {
    expect(await readGroupTaskRecord("missing")).toBeUndefined();
  });

  it("marks a task done and stamps completedAt", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    await markGroupTaskDone("t-1");
    const task = (await readGroupTaskRecord("ctx-1"))!.tasks[0];
    expect(task.status).toBe("done");
    expect(task.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("locates the task by taskId across multiple groups", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    await recordGroupTask("ctx-2", {
      taskId: "t-2",
      source: "escalate",
      memberKey: "agent_b",
      displayName: "Agent B",
    });
    await markGroupTaskDone("t-2");
    expect((await readGroupTaskRecord("ctx-1"))!.tasks[0].status).toBe("running");
    expect((await readGroupTaskRecord("ctx-2"))!.tasks[0].status).toBe("done");
  });

  it("is a no-op for an unknown taskId", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    await expect(markGroupTaskDone("unknown")).resolves.toBeUndefined();
    expect((await readGroupTaskRecord("ctx-1"))!.tasks[0].status).toBe("running");
  });

  it("pendingGroupTasks returns only running tasks for a group", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    await recordGroupTask("ctx-1", {
      taskId: "t-2",
      source: "group",
      memberKey: "agent_b",
      displayName: "Agent B",
    });
    await markGroupTaskDone("t-1");
    const pending = await pendingGroupTasks("ctx-1");
    expect(pending).toHaveLength(1);
    expect(pending[0].taskId).toBe("t-2");
  });

  it("pendingGroupTasks returns [] for an unknown groupContextId", async () => {
    expect(await pendingGroupTasks("missing")).toEqual([]);
  });

  it("recording a duplicate taskId does not create a second row", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    await recordGroupTask("ctx-1", sampleTask());
    expect((await readGroupTaskRecord("ctx-1"))!.tasks).toHaveLength(1);
  });

  it("persists the record as JSON on disk", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    const parsed = JSON.parse(readFileSync(join(tmpDir, "ctx-1.json"), "utf8"));
    expect(parsed.groupContextId).toBe("ctx-1");
    expect(parsed.tasks[0].taskId).toBe("t-1");
  });

  it("deleteGroupTaskLedger removes the file for the given groupContextId", async () => {
    await recordGroupTask("ctx-1", sampleTask());
    expect(existsSync(join(tmpDir, "ctx-1.json"))).toBe(true);
    await deleteGroupTaskLedger("ctx-1");
    expect(existsSync(join(tmpDir, "ctx-1.json"))).toBe(false);
    expect(await readGroupTaskRecord("ctx-1")).toBeUndefined();
  });

  it("deleteGroupTaskLedger is a no-op for an unknown groupContextId", async () => {
    await expect(deleteGroupTaskLedger("missing")).resolves.toBeUndefined();
  });

  it("concurrent markGroupTaskDone across many groups never throws and marks every task done", async () => {
    // Many groups + interleaved markDone calls scan ALL files (Promise.all in
    // markGroupTaskDone). Without atomic writes, one group's writeFile truncate
    // window collides with another's parallel read → JSON.parse("") throws.
    const N = 30;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        recordGroupTask(`ctx-race-${i}`, {
          taskId: `t-${i}`,
          source: "group",
          memberKey: `agent_${i}`,
          displayName: `Agent ${i}`,
        }),
      ),
    );
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => markGroupTaskDone(`t-${i}`)),
    );
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    // Every group's single task must end up "done" — no lost updates.
    const statuses = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const rec = await readGroupTaskRecord(`ctx-race-${i}`);
        return rec?.tasks[0]?.status;
      }),
    );
    expect(statuses.every((s) => s === "done")).toBe(true);
  });

  it("writeRecord never leaves a zero-byte or invalid-JSON file at the target path", async () => {
    // Hammer the same groupContextId from many concurrent writers. Atomic
    // rename guarantees a reader on the canonical path only ever sees a fully
    // written record — never the truncate window.
    const groupContextId = "ctx-atomic";
    await recordGroupTask(groupContextId, {
      taskId: "t-seed",
      source: "group",
      memberKey: "agent_seed",
      displayName: "Seed",
    });
    const writers = Array.from({ length: 50 }, (_, i) =>
      recordGroupTask(groupContextId, {
        taskId: `t-extra-${i}`,
        source: "group",
        memberKey: `agent_${i}`,
        displayName: `Agent ${i}`,
      }),
    );
    // Race a reader loop against the writers — every observation must parse.
    let observed = 0;
    const reader = (async () => {
      while (observed < 200) {
        const rec = await readGroupTaskRecord(groupContextId);
        if (rec) expect(rec.groupContextId).toBe(groupContextId);
        observed++;
      }
    })();
    await Promise.all([...writers, reader]);
  });
});
