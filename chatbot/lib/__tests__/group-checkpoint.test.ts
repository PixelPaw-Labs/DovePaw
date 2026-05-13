import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  return { tmpDir: path.join(os.tmpdir(), `group-checkpoint-test-${Date.now()}-${process.pid}`) };
});

vi.mock("@@/lib/paths", () => ({
  GROUP_TASKS_DIR: tmpDir,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  groupTasksFile: (id: string) => require("node:path").join(tmpDir, `${id}.json`),
}));

import {
  buildGroupGoalIntent,
  buildCorrectionPrompt,
  detectGaps,
  writeGroupGoal,
  readGroupGoal,
  writeGroupCheckpoint,
  readGroupCheckpoints,
  groupCheckpointsDir,
} from "../group-checkpoint";
import type { GroupCheckpoint, GroupGap } from "../group-checkpoint";
import type { GroupTask } from "../group-task-store";
import type { AgentLink } from "@@/lib/agent-links-schemas";

const workspace = tmpDir;

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── buildGroupGoalIntent ─────────────────────────────────────────────────────

describe("buildGroupGoalIntent", () => {
  it("includes group name", () => {
    expect(buildGroupGoalIntent("my-team")).toContain("my-team");
  });

  it("appends description when provided", () => {
    const intent = buildGroupGoalIntent("my-team", "ship the feature");
    expect(intent).toContain("ship the feature");
  });

  it("omits description when not provided", () => {
    const intent = buildGroupGoalIntent("my-team");
    expect(intent).not.toContain("Group focus");
  });
});

// ─── buildCorrectionPrompt ───────────────────────────────────────────────────

describe("buildCorrectionPrompt", () => {
  const gap: GroupGap = {
    sourceCheckpoint: {
      memberKey: "agent_a",
      displayName: "Agent A",
      taskId: "task-111",
      contextId: "ctx-111",
      completedAt: "2024-01-01T00:00:00.000Z",
      outputSummary: "did stuff",
    },
    expectedTargetKey: "agent_b",
    expectedTargetDisplayName: "Agent B",
    source: "chat",
  };

  it("includes the source task ID", () => {
    const prompt = buildCorrectionPrompt(gap, "ship everything");
    expect(prompt).toContain("task-111");
  });

  it("includes the expected target name", () => {
    const prompt = buildCorrectionPrompt(gap, "ship everything");
    expect(prompt).toContain("Agent B");
  });

  it("includes the goal intent", () => {
    const prompt = buildCorrectionPrompt(gap, "ship everything");
    expect(prompt).toContain("ship everything");
  });

  it("lists numbered corrective cases", () => {
    const prompt = buildCorrectionPrompt(gap, "ship everything");
    expect(prompt).toContain("1.");
    expect(prompt).toContain("2.");
    expect(prompt).toContain("3.");
  });

  it("uses (no summary recorded) when outputSummary is empty", () => {
    const prompt = buildCorrectionPrompt(
      { ...gap, sourceCheckpoint: { ...gap.sourceCheckpoint, outputSummary: "" } },
      "goal",
    );
    expect(prompt).toContain("no summary recorded");
  });
});

// ─── detectGaps ──────────────────────────────────────────────────────────────

describe("detectGaps", () => {
  const link: AgentLink = {
    source: "agent_a",
    target: "agent_b",
    direction: "single",
    strategy: "chat",
    group: "my-group",
  };

  const checkpoint = (taskId: string, completedAt: string): GroupCheckpoint => ({
    memberKey: "agent_a",
    displayName: "Agent A",
    taskId,
    contextId: `ctx-${taskId}`,
    completedAt,
    outputSummary: "done",
  });

  const task = (taskId: string, startedAt: string, memberKey = "agent_b"): GroupTask => ({
    taskId,
    memberKey,
    displayName: "Agent B",
    source: "chat",
    status: "running",
    startedAt,
  });

  it("returns no gaps when target task starts after source completes", () => {
    const checkpoints = [checkpoint("t1", "2024-01-01T01:00:00.000Z")];
    const tasks = [task("t2", "2024-01-01T02:00:00.000Z")];
    expect(detectGaps(checkpoints, tasks, [link], "my-group")).toHaveLength(0);
  });

  it("detects a gap when no target task follows a source checkpoint", () => {
    const checkpoints = [checkpoint("t1", "2024-01-01T01:00:00.000Z")];
    const gaps = detectGaps(checkpoints, [], [link], "my-group");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.sourceCheckpoint.taskId).toBe("t1");
    expect(gaps[0]?.expectedTargetKey).toBe("agent_b");
    expect(gaps[0]?.source).toBe("chat");
  });

  it("detects a gap when target task predates source completion", () => {
    const checkpoints = [checkpoint("t1", "2024-01-01T02:00:00.000Z")];
    const tasks = [task("t2", "2024-01-01T01:00:00.000Z")]; // before source completed
    const gaps = detectGaps(checkpoints, tasks, [link], "my-group");
    expect(gaps).toHaveLength(1);
  });

  it("uses temporal windowing to avoid false gaps for sequential checkpoints", () => {
    const checkpoints = [
      checkpoint("t1", "2024-01-01T01:00:00.000Z"),
      checkpoint("t2", "2024-01-01T03:00:00.000Z"),
    ];
    // target task falls in the window of t1 (after t1 completed, before t2 completed)
    const tasks = [task("t3", "2024-01-01T02:00:00.000Z")];
    const gaps = detectGaps(checkpoints, tasks, [link], "my-group");
    // t1 has a target in window, t2 does not → one gap for t2
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.sourceCheckpoint.taskId).toBe("t2");
  });

  it("ignores links for other groups", () => {
    const otherGroupLink: AgentLink = { ...link, group: "other-group" };
    const checkpoints = [checkpoint("t1", "2024-01-01T01:00:00.000Z")];
    expect(detectGaps(checkpoints, [], [otherGroupLink], "my-group")).toHaveLength(0);
  });

  it("includes links with no group (global links)", () => {
    const globalLink: AgentLink = { ...link, group: undefined };
    const checkpoints = [checkpoint("t1", "2024-01-01T01:00:00.000Z")];
    expect(detectGaps(checkpoints, [], [globalLink], "my-group")).toHaveLength(1);
  });
});

// ─── writeGroupGoal / readGroupGoal roundtrip ─────────────────────────────────

describe("writeGroupGoal / readGroupGoal", () => {
  it("roundtrips the goal intent", async () => {
    await writeGroupGoal(workspace, "ctx-1", "ship the feature");
    const goal = await readGroupGoal(workspace);
    expect(goal?.intent).toBe("ship the feature");
    expect(goal?.groupContextId).toBe("ctx-1");
  });

  it("returns undefined when goal file is absent", async () => {
    expect(await readGroupGoal(workspace)).toBeUndefined();
  });
});

// ─── writeGroupCheckpoint / readGroupCheckpoints roundtrip ───────────────────

describe("writeGroupCheckpoint / readGroupCheckpoints", () => {
  it("roundtrips a checkpoint", async () => {
    const cp: GroupCheckpoint = {
      memberKey: "agent_a",
      displayName: "Agent A",
      taskId: "task-999",
      contextId: "ctx-999",
      completedAt: new Date().toISOString(),
      outputSummary: "done",
      source: "chat",
    };
    await writeGroupCheckpoint(workspace, cp);
    const checkpoints = await readGroupCheckpoints(workspace);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.taskId).toBe("task-999");
    expect(checkpoints[0]?.source).toBe("chat");
  });

  it("skips malformed checkpoint files", async () => {
    const dir = groupCheckpointsDir(workspace);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.json"), "not json");
    const checkpoints = await readGroupCheckpoints(workspace);
    expect(checkpoints).toHaveLength(0);
  });

  it("returns empty array when checkpoints dir is absent", async () => {
    expect(await readGroupCheckpoints(workspace)).toEqual([]);
  });
});
