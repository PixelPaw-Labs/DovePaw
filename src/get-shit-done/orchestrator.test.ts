import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GSDOrchestrator, type OrchestratorDeps } from "./orchestrator.js";
import { SprintDiscovery } from "./discovery.js";
import { Prioritizer } from "./prioritizer.js";
import { Pipeline } from "./pipeline.js";
import { DagStore } from "./dag-store.js";
import type { ClaudeRunner, LogFn } from "./claude-runner.js";
import type { DevServerManager } from "./dev-servers.js";
import type { JiraClient } from "./jira.js";
import type { PrioritizeResult, SkippedTicket } from "./prioritizer.js";
import type { DiscoverResult } from "./discovery.js";

// ─── Shared DB setup ─────────────────────────────────────────────────────────
// One database for the entire file — cleared between tests to avoid
// SIGSEGV from rapid create/close cycles in the LadybugDB native addon.

let store: DagStore;

before(async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
  store = await DagStore.create(join(tempDir, "dag.lbug"));
});

beforeEach(async () => {
  await store.clear();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectLogs(): { logs: string[]; log: LogFn } {
  const logs: string[] = [];
  return { logs, log: (msg: string) => logs.push(msg) };
}

function makeJira(
  sprint: string | null = "Sprint 1",
  tickets: Array<{ key: string; status: string }> = [],
): JiraClient {
  return {
    getActiveSprint: async () => sprint,
    fetchSprintTickets: async () => tickets,
    ticketUrl: (key: string) => `https://jira/${key}`,
    moveTicket: async () => true,
    getParentKey: async () => null,
    hasUnfinishedSubtasks: async () => true,
    promoteToReview: async () => {},
  } as unknown as JiraClient;
}

function makeRunner(): ClaudeRunner {
  return {
    run: async (_prompt: string, opts: { taskName: string }) => {
      if (opts.taskName.includes("forge")) return { code: 0, stdout: '{"worktree_path": "/wt/t"}' };
      return { code: 0, stdout: "branch-name" };
    },
    writeLog: () => "/fake",
  } as unknown as ClaudeRunner;
}

function makeDevServers(): DevServerManager {
  return {
    devUrl: "http://localhost:3000",
    startAll: async () => {},
    stopAll: () => {},
    restartOnBranch: async (_branchByRepo: Map<string, string>) => {},
  } as unknown as DevServerManager;
}

/** Build a minimal PrioritizeResult (replaces raw JSON string in old tests). */
function makeResult(
  layers: Array<{
    key: string;
    repoPath?: string;
    dependsOn?: string | null;
    complexity?: "trivial" | "moderate" | "complex";
  }>,
): PrioritizeResult {
  return {
    layers: layers.map((l) => ({
      group: [
        {
          key: l.key,
          repos: l.repoPath ? [{ repoPath: l.repoPath, branch: `${l.key.toLowerCase()}-fix` }] : [],
          complexity: l.complexity ?? "moderate",
        },
      ],
      relation: null,
      verification: { required: false, reason: "test" },
      dependsOn: l.dependsOn ?? null,
    })),
    skipped: [],
    excluded: [],
  };
}

function makeDeps(
  overrides: Partial<OrchestratorDeps & { logs: string[] }> = {},
): OrchestratorDeps & { logs: string[] } {
  const { logs, log } = collectLogs();
  const jira = overrides.jira ?? makeJira();
  const baseRepos = overrides.baseRepos ?? [];
  const runner = makeRunner();
  const devServers = makeDevServers();
  // Always use the shared store — state is reset via beforeEach
  const runState = store;
  return {
    discovery: new SprintDiscovery(jira, runState, baseRepos),
    prioritizer: overrides.prioritizer ?? new Prioritizer({ runner, scriptDir: "/tmp", log }),
    pipeline: overrides.pipeline ?? new Pipeline({ runner, devServers, jira, runState, log }),
    jira,
    runState,
    baseRepos,
    log,
    logs,
    ...overrides,
  };
}

/** Jira spy that records addComment and promoteToReview calls. */
function makeJiraSpy(
  sprint = "Sprint 1",
  tickets: Array<{ key: string; status: string }> = [],
): JiraClient & { comments: Map<string, string>; promoted: string[] } {
  const comments = new Map<string, string>();
  const promoted: string[] = [];
  return {
    ...makeJira(sprint, tickets),
    promoteToReview: async (key: string) => {
      promoted.push(key);
    },
    addComment: async (key: string, reason: string) => {
      comments.set(key, reason);
      return true;
    },
    comments,
    promoted,
  } as unknown as JiraClient & { comments: Map<string, string>; promoted: string[] };
}

/** Build an orchestrator whose prioritizer returns a fixed all-blocked or all-redundant result.
 *  allKeys must have >1 entry to bypass the Prioritizer's single-ticket fallback path. */
function makeBlockedOrchestrator(
  skipped: Array<{ key: string; reason: string; [k: string]: unknown }>,
): GSDOrchestrator {
  const runner = {
    run: async () => ({
      code: 0,
      stdout: JSON.stringify({ layers: [], skipped, excluded: [{ key: "EC-2", reason: "Done" }] }),
    }),
    writeLog: () => "/fake",
  } as unknown as ClaudeRunner;
  const { log } = collectLogs();
  return new GSDOrchestrator(
    makeDeps({ prioritizer: new Prioritizer({ runner, scriptDir: "/tmp", log }), baseRepos: [] }),
  );
}

/** Build a minimal DiscoverResult for process() tests. */
function makeDiscovery(unprocessed: string[], allKeys?: string[]): DiscoverResult {
  return {
    sprint: "Sprint 1",
    allKeys: allKeys ?? unprocessed,
    unprocessed,
    skippedCount: 0,
  };
}

/** Build a PrioritizeResult with skipped tickets only (no layers). */
function makeSkippedResult(skipped: SkippedTicket[]): PrioritizeResult {
  return { layers: [], skipped, excluded: [] };
}

// ─── prioritize ──────────────────────────────────────────────────────────────

void describe("GSDOrchestrator.prioritize", () => {
  void it("passes previous result as guidance and preserves saved groupStates", async () => {
    // Simulate previous run: EC-1 was completed with a PR
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "Sprint 1");
    await store.updateGroupStates(
      new Map([
        [
          "EC-1",
          {
            branches: new Map([["/repo", "ec-1-merge"]]),
            prUrls: new Map([["/repo", "https://pr/1"]]),
          },
        ],
      ]),
    );

    let capturedPrompt = "";
    const runner = {
      run: async (prompt: string) => {
        capturedPrompt = prompt;
        return {
          code: 0,
          stdout: JSON.stringify({
            layers: [
              {
                group: [
                  { key: "EC-1", repos: [{ repo: "my-repo", branch: "ec-1-fix" }] },
                  { key: "EC-2", repos: [{ repo: "my-repo", branch: "ec-2-new" }] },
                ],
                relation: null,
                verification: { required: false, reason: "test" },
                depends_on: null,
              },
            ],
            skipped: [],
            excluded: [],
          }),
        };
      },
      writeLog: () => "/fake",
    } as unknown as ClaudeRunner;

    const { log } = collectLogs();
    const deps = makeDeps({
      prioritizer: new Prioritizer({ runner, scriptDir: "/tmp", log }),
      baseRepos: ["/abs/my-repo"],
    });
    const orch = new GSDOrchestrator(deps);

    const result = await orch.prioritize(["EC-1", "EC-2"], ["EC-1", "EC-2"], "Sprint 1");

    assert.ok(capturedPrompt.includes("PREVIOUS RUN GUIDANCE"));
    assert.ok(result.initialGroupStates);
    assert.equal(result.initialGroupStates.get("EC-1")?.branches.get("/repo"), "ec-1-merge");
  });

  void it("runs fresh prioritization when no saved state exists", async () => {
    let capturedPrompt = "";
    const runner = {
      run: async (prompt: string) => {
        capturedPrompt = prompt;
        return {
          code: 0,
          stdout: JSON.stringify({
            layers: [
              {
                group: [{ key: "EC-1", repos: [{ repo: "my-repo", branch: "ec-1-fix" }] }],
                relation: null,
                verification: { required: false, reason: "test" },
                depends_on: null,
              },
            ],
            skipped: [],
            excluded: [],
          }),
        };
      },
      writeLog: () => "/fake",
    } as unknown as ClaudeRunner;

    const { log } = collectLogs();
    const deps = makeDeps({
      prioritizer: new Prioritizer({ runner, scriptDir: "/tmp", log }),
      baseRepos: ["/abs/my-repo"],
    });
    const orch = new GSDOrchestrator(deps);
    const result = await orch.prioritize(["EC-1"], ["EC-1"], "Sprint 1");

    assert.ok(!capturedPrompt.includes("PREVIOUS RUN GUIDANCE"));
    assert.equal(result.initialGroupStates, undefined);
  });

  void it("skips LLM and returns empty result when all unprocessed tickets are in waiting state", async () => {
    await store.saveWaiting("Sprint 1", ["EC-1"]);

    let prioritizerCalled = false;
    const prioritizer = {
      prioritize: async () => {
        prioritizerCalled = true;
        return { resolved: makeResult([]), rawJson: "{}" };
      },
    } as unknown as Prioritizer;

    const { log, logs } = collectLogs();
    const orch = new GSDOrchestrator(
      makeDeps({ prioritizer, log } as Partial<OrchestratorDeps & { logs: string[] }>),
    );
    const result = await orch.prioritize(["EC-1", "EC-2", "EC-3"], ["EC-1"], "Sprint 1");

    assert.equal(prioritizerCalled, false, "prioritizer must not be called during throttle");
    assert.deepEqual(result, { layers: [], skipped: [], excluded: [] });
    assert.ok(logs.some((l) => l.includes("WAITING")));
  });

  void it("bypasses throttle and calls LLM when a new unprocessed ticket appears", async () => {
    await store.saveWaiting("Sprint 1", ["EC-1"]);

    let prioritizerCalled = false;
    const prioritizer = {
      prioritize: async () => {
        prioritizerCalled = true;
        return {
          resolved: { layers: [], skipped: [], excluded: [] },
          rawJson: "{}",
        };
      },
    } as unknown as Prioritizer;

    const orch = new GSDOrchestrator(makeDeps({ prioritizer, baseRepos: [] }));
    await orch.prioritize(["EC-1", "EC-2"], ["EC-1", "EC-2"], "Sprint 1");

    assert.equal(prioritizerCalled, true, "prioritizer must be called when new ticket appears");
    assert.equal(
      await store.loadWaiting("Sprint 1"),
      null,
      "waiting state cleared before LLM call",
    );
  });

  void it("saves waiting state when all pending tickets are in-flight blocked", async () => {
    const orch = makeBlockedOrchestrator([
      { key: "EC-1", reason: "blocked on EC-0 (In Review)", in_flight_dependency: true },
    ]);
    await orch.prioritize(["EC-1", "EC-2"], ["EC-1"], "Sprint 1");

    assert.deepEqual(await store.loadWaiting("Sprint 1"), ["EC-1"]);
  });

  void it("does not save waiting state when skipped tickets are permanently skipped (not in-flight)", async () => {
    const orch = makeBlockedOrchestrator([
      { key: "EC-1", reason: "redundant with EC-2", redundantWith: "EC-2" },
    ]);
    await orch.prioritize(["EC-1", "EC-2"], ["EC-1"], "Sprint 1");

    assert.equal(await store.loadWaiting("Sprint 1"), null);
  });

  void it("marks excluded tickets as completed so discover skips them next run", async () => {
    const runner = {
      run: async () => ({
        code: 0,
        stdout: JSON.stringify({
          layers: [
            {
              group: [{ key: "EC-2", repos: [{ repo: "my-repo", branch: "ec-2-fix" }] }],
              relation: null,
              verification: { required: false, reason: "test" },
              depends_on: null,
            },
          ],
          skipped: [],
          excluded: [{ key: "EC-1", reason: "Pure container story" }],
        }),
      }),
      writeLog: () => "/fake",
    } as unknown as ClaudeRunner;

    const { log } = collectLogs();
    const deps = makeDeps({
      prioritizer: new Prioritizer({ runner, scriptDir: "/tmp", log }),
      baseRepos: ["/abs/my-repo"],
    });
    const orch = new GSDOrchestrator(deps);
    await orch.prioritize(["EC-1", "EC-2"], ["EC-1", "EC-2"], "Sprint 1");

    const completed = await store.completedTicketKeys();
    assert.ok(completed.has("EC-1"), "excluded ticket marked completed");
    assert.ok(!completed.has("EC-2"), "non-excluded ticket not affected");
  });
});

// ─── process (skipped ticket handling) ───────────────────────────────────────

void describe("GSDOrchestrator.process — skipped ticket handling", () => {
  void it("in-flight blocked ticket: adds JIRA comment but does not promote or mark completed", async () => {
    const jira = makeJiraSpy("Sprint 1", [{ key: "EC-1", status: "To Do" }]);
    const deps = makeDeps({ jira });
    const orch = new GSDOrchestrator(deps);

    await orch.process(
      makeDiscovery(["EC-1"]),
      makeSkippedResult([
        { key: "EC-1", reason: "blocked on EC-0 (In Review)", inFlightDependency: true },
      ]),
    );

    assert.ok(jira.comments.has("EC-1"), "JIRA comment must be added");
    assert.equal(jira.promoted.length, 0, "ticket must NOT be promoted to In Review");
    const completed = await store.completedTicketKeys();
    assert.ok(
      !completed.has("EC-1"),
      "ticket must NOT be marked completed — needs retry when dependency merges",
    );
    assert.ok(deps.logs.some((l) => l.includes("WAITING: EC-1")));
  });

  void it("permanently skipped ticket: adds JIRA comment, promotes to In Review, marks completed", async () => {
    const jira = makeJiraSpy("Sprint 1", [{ key: "EC-1", status: "To Do" }]);
    await store.save(makeResult([{ key: "EC-1" }]), "Sprint 1");
    const deps = makeDeps({ jira });
    const orch = new GSDOrchestrator(deps);

    await orch.process(
      makeDiscovery(["EC-1"]),
      makeSkippedResult([
        { key: "EC-1", reason: "redundant with EC-2", inFlightDependency: false },
      ]),
    );

    assert.ok(jira.comments.has("EC-1"), "JIRA comment must be added");
    assert.ok(jira.promoted.includes("EC-1"), "ticket must be promoted to In Review");
    const completed = await store.completedTicketKeys();
    assert.ok(completed.has("EC-1"), "ticket must be marked completed");
    assert.ok(deps.logs.some((l) => l.includes("SKIPPED: EC-1")));
  });

  void it("ticket not in unprocessed set is ignored regardless of inFlightDependency", async () => {
    const jira = makeJiraSpy();
    const deps = makeDeps({ jira });
    const orch = new GSDOrchestrator(deps);

    // EC-1 is skipped but is NOT in unprocessed (already completed by another path)
    await orch.process(
      makeDiscovery([]),
      makeSkippedResult([{ key: "EC-1", reason: "blocked on EC-0", inFlightDependency: true }]),
    );

    assert.equal(jira.comments.size, 0, "no comment for ticket outside unprocessed set");
    assert.equal(jira.promoted.length, 0);
  });
});

// ─── summarize ───────────────────────────────────────────────────────────────

void describe("GSDOrchestrator.summarize", () => {
  void it("preserves all state on success for next-run guidance", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "Sprint 1");
    await store.updateGroupStates(
      new Map([["EC-1", { branches: new Map([["/r", "b"]]), prUrls: new Map() }]]),
    );

    const deps = makeDeps();
    const orch = new GSDOrchestrator(deps);
    orch.summarize(1, 0, 0);

    // State must be preserved after summarize
    const groupStates = await store.loadGroupStates();
    assert.ok(groupStates.size > 0, "groupStates preserved for merge chain");
    const guidance = await store.buildGuidance();
    assert.ok(guidance !== null, "guidance available (graph state preserved)");
  });

  void it("preserves run state when there are failures", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "Sprint 1");

    const deps = makeDeps();
    const orch = new GSDOrchestrator(deps);
    orch.summarize(1, 0, 2);

    const guidance = await store.buildGuidance();
    assert.ok(guidance !== null);
  });
});

// ─── run (end-to-end) ────────────────────────────────────────────────────────

void describe("GSDOrchestrator.run", () => {
  void it("exits early when discover returns null", async () => {
    const deps = makeDeps({ jira: makeJira(null) });
    const orch = new GSDOrchestrator(deps);
    await orch.run();
    assert.ok(!deps.logs.some((l) => l.includes("PRIORITIZ")));
  });

  void it("preserves cross-sprint state when PRs are not yet merged", async () => {
    // Simulate Sprint 1: EC-1 completed with an open PR
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "Sprint 1");
    await store.updateGroupStates(
      new Map([
        [
          "EC-1",
          {
            branches: new Map([["/repo", "ec-1-merge"]]),
            prUrls: new Map([["/repo", "https://pr/1"]]),
          },
        ],
      ]),
    );

    // Sprint 2: EC-2 depends on EC-1's branch
    const jira = makeJira("Sprint 2", [{ key: "EC-2", status: "To Do" }]);

    const prioritizer = {
      prioritize: async () => ({
        resolved: {
          layers: [
            {
              group: [{ key: "EC-2", repos: [{ repoPath: "/abs/my-repo", branch: "ec-2-new" }] }],
              relation: null,
              verification: { required: false, reason: "test" },
              dependsOn: null,
            },
          ],
          skipped: [],
          excluded: [],
        },
        rawJson: "{}",
      }),
    } as unknown as Prioritizer;

    const pipeline = {
      processLayers: async () => ({ succeeded: 1, failed: 0 }),
    } as unknown as Pipeline;

    const deps = makeDeps({ jira, prioritizer, pipeline, baseRepos: ["/abs/my-repo"] });
    const orch = new GSDOrchestrator(deps);
    await orch.run();

    // EC-1 PR not merged — state preserved across sprint boundary
    assert.ok(!deps.logs.some((l) => l.includes("PRUNED")));
    const completed = await store.completedTicketKeys();
    assert.equal(completed.has("EC-1"), true);
  });

  void it("re-includes in-flight tickets from previous run on restart", async () => {
    // Simulate previous run: EC-1 was prioritized and forged (moved to In Progress)
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "Sprint 1");

    // EC-1 is "In Progress", EC-2 is "To Do"
    const jira = makeJira("Sprint 1", [
      { key: "EC-1", status: "In Progress" },
      { key: "EC-2", status: "To Do" },
    ]);

    const prioritizer = {
      prioritize: async () => ({
        resolved: {
          layers: [
            {
              group: [
                { key: "EC-1", repos: [{ repoPath: "/abs/my-repo", branch: "ec-1-fix" }] },
                { key: "EC-2", repos: [{ repoPath: "/abs/my-repo", branch: "ec-2-new" }] },
              ],
              relation: null,
              verification: { required: false, reason: "test" },
              dependsOn: null,
            },
          ],
          skipped: [],
          excluded: [],
        },
        rawJson: "{}",
      }),
    } as unknown as Prioritizer;

    let capturedUnprocessed: Set<string> | null = null;
    const pipeline = {
      processLayers: async (_layers: unknown, unprocessed: Set<string>) => {
        capturedUnprocessed = new Set(unprocessed);
        return { succeeded: 2, failed: 0 };
      },
    } as unknown as Pipeline;

    const deps = makeDeps({ jira, prioritizer, pipeline, baseRepos: ["/abs/my-repo"] });
    const orch = new GSDOrchestrator(deps);
    await orch.run();

    assert.notEqual(capturedUnprocessed, null, "processLayers should have been called");
    assert.ok(capturedUnprocessed!.has("EC-1"), "EC-1 should be re-included as unprocessed");
    assert.ok(capturedUnprocessed!.has("EC-2"), "EC-2 should be unprocessed normally");
    assert.ok(deps.logs.some((l) => l.includes("RESUME: EC-1")));
  });

  void it("does not re-add merged-PR ticket after pruneMergedGroups moves it to extraCompleted", async () => {
    // EC-1 was forged and PR was created last run
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "Sprint 1");
    await store.updateGroupStates(
      new Map([
        [
          "EC-1",
          {
            branches: new Map([["/repo", "ec-1-merge"]]),
            prUrls: new Map([["/repo", "https://pr/1"]]),
          },
        ],
      ]),
    );

    // EC-1 PR is merged — move to extraCompleted
    await store.pruneMergedGroups(() => true);

    const jira = makeJira("Sprint 1", [
      { key: "EC-1", status: "In Review" },
      { key: "EC-2", status: "To Do" },
    ]);

    let capturedUnprocessed: Set<string> | null = null;
    const prioritizer = {
      prioritize: async () => ({
        resolved: {
          layers: [
            {
              group: [{ key: "EC-2", repos: [{ repoPath: "/abs/my-repo", branch: "ec-2-new" }] }],
              relation: null,
              verification: { required: false, reason: "test" },
              dependsOn: null,
            },
          ],
          skipped: [],
          excluded: [],
        },
        rawJson: "{}",
      }),
    } as unknown as Prioritizer;

    const pipeline = {
      processLayers: async (_layers: unknown, unprocessed: Set<string>) => {
        capturedUnprocessed = new Set(unprocessed);
        return { succeeded: 1, failed: 0 };
      },
    } as unknown as Pipeline;

    const deps = makeDeps({ jira, prioritizer, pipeline, baseRepos: ["/abs/my-repo"] });
    const orch = new GSDOrchestrator(deps);
    await orch.run();

    assert.notEqual(capturedUnprocessed, null);
    assert.ok(!capturedUnprocessed!.has("EC-1"), "EC-1 must not be re-added after PR merged");
    assert.ok(capturedUnprocessed!.has("EC-2"), "EC-2 should be unprocessed normally");
    assert.ok(deps.logs.some((l) => l.includes("SKIP RESUME: EC-1")));
  });

  void it("does not resume tickets from completed groups (has PRs)", async () => {
    // EC-1 was fully completed in a previous run (has PR URLs)
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "Sprint 1");
    await store.updateGroupStates(
      new Map([
        [
          "EC-1",
          {
            branches: new Map([["/repo", "ec-1-merge"]]),
            prUrls: new Map([["/repo", "https://github.com/org/repo/pull/42"]]),
          },
        ],
      ]),
    );

    const jira = makeJira("Sprint 1", [
      { key: "EC-1", status: "In Review" },
      { key: "EC-2", status: "To Do" },
    ]);

    let capturedUnprocessed: Set<string> | null = null;
    const prioritizer = {
      prioritize: async () => ({
        resolved: {
          layers: [
            {
              group: [{ key: "EC-2", repos: [{ repoPath: "/abs/my-repo", branch: "ec-2-new" }] }],
              relation: null,
              verification: { required: false, reason: "test" },
              dependsOn: null,
            },
          ],
          skipped: [],
          excluded: [],
        },
        rawJson: "{}",
      }),
    } as unknown as Prioritizer;

    const pipeline = {
      processLayers: async (_layers: unknown, unprocessed: Set<string>) => {
        capturedUnprocessed = new Set(unprocessed);
        return { succeeded: 1, failed: 0 };
      },
    } as unknown as Pipeline;

    const deps = makeDeps({ jira, prioritizer, pipeline, baseRepos: ["/abs/my-repo"] });
    const orch = new GSDOrchestrator(deps);
    await orch.run();

    assert.notEqual(capturedUnprocessed, null);
    assert.ok(!capturedUnprocessed!.has("EC-1"), "EC-1 should not be resumed — already completed");
    assert.ok(capturedUnprocessed!.has("EC-2"), "EC-2 should be unprocessed normally");
    assert.ok(deps.logs.some((l) => l.includes("SKIP RESUME: EC-1")));
  });
});
