import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pipeline } from "./pipeline.js";
import type { GroupStates, LayerState } from "./dag.js";
import type { ClaudeRunner, LogFn } from "./claude-runner.js";
import type { DevServerManager } from "./dev-servers.js";
import type { JiraClient } from "./jira.js";
import type { ForgeResult } from "./prompts.js";
import type { DagStore } from "./dag-store.js";
import type { GroupedLayer, Verification } from "./prioritizer.js";

const NO_BASE: LayerState = { branches: new Map(), prUrls: new Map() };
const VERIFY: Verification = { required: true, reason: "test" };
const NO_VERIFY: Verification = { required: false, reason: "test" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectLogs(): { logs: string[]; log: LogFn } {
  const logs: string[] = [];
  return { logs, log: (msg: string) => logs.push(msg) };
}

function makeRunner(responses: Array<{ code: number; stdout: string }>): ClaudeRunner {
  let callIndex = 0;
  return {
    run: async () => responses[callIndex++] ?? { code: 0, stdout: "" },
    writeLog: () => "/fake/log",
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  } as unknown as ClaudeRunner;
}

function makeDevServers(devUrl = "http://localhost:3000"): DevServerManager {
  return {
    devUrl,
    startAll: async () => {},
    stopAll: () => {},
    restartOnBranch: async (_branchByRepo: Map<string, string>) => {},
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  } as unknown as DevServerManager;
}

function makeJira(): JiraClient {
  return {
    ticketUrl: (key: string) => `https://jira/${key}`,
    moveTicket: async () => true,
    getParentKey: async () => null,
    hasUnfinishedSubtasks: async () => true,
    promoteToReview: async () => {},
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  } as unknown as JiraClient;
}

function makeDagStore(): DagStore {
  return {
    markCompleted: async () => {},
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  } as unknown as DagStore;
}

function makePipeline(
  runner: ClaudeRunner,
  log: LogFn,
  overrides: {
    devServers?: DevServerManager;
    jira?: JiraClient;
  } = {},
): Pipeline {
  return new Pipeline({
    runner,
    devServers: overrides.devServers ?? makeDevServers(),
    jira: overrides.jira ?? makeJira(),
    runState: makeDagStore(),
    log,
  });
}

// ─── mergeAndVerify ──────────────────────────────────────────────────────────

void describe("mergeAndVerify", () => {
  const successForges: ForgeResult[] = [
    {
      ticketKey: "EC-1",
      status: "success",
      worktrees: [{ repoPath: "/repo", worktreePath: "/wt/ec-1" }],
      affectedUrls: [],
    },
    {
      ticketKey: "EC-2",
      status: "success",
      worktrees: [{ repoPath: "/repo", worktreePath: "/wt/ec-2" }],
      affectedUrls: [],
    },
  ];

  void it("returns all succeeded when merge, verify, and PR pass", async () => {
    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "" }, // commit EC-2
      { code: 0, stdout: "EC-1-merge-branch" }, // merge
      { code: 0, stdout: "verify ok" }, // verify
      { code: 0, stdout: "pr created" }, // PR
    ]);
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.mergeAndVerify(
      successForges,
      [
        { key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
        { key: "EC-2", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
      ],
      VERIFY,
      NO_BASE,
    );

    assert.deepEqual(result.succeeded, ["EC-1", "EC-2"]);
    assert.deepEqual(result.failed, []);
  });

  void it("logs all ticket keys in group, not just primary", async () => {
    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "" }, // commit EC-2
      { code: 0, stdout: "EC-1-merge-branch" }, // merge
      { code: 0, stdout: "verify ok" }, // verify
      { code: 0, stdout: "pr created" }, // PR
    ]);
    const { logs, log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    await pipeline.mergeAndVerify(
      successForges,
      [
        { key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
        { key: "EC-2", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
      ],
      VERIFY,
      NO_BASE,
    );

    assert.ok(logs.some((l) => l.includes("COMMITTING: EC-1, EC-2")));
    assert.ok(logs.some((l) => l.includes("MERGING: EC-1, EC-2")));
    assert.ok(logs.some((l) => l.includes("VERIFYING: EC-1, EC-2")));
    assert.ok(logs.some((l) => l.includes("CREATING PR: EC-1, EC-2")));
  });

  void it("returns all failed when no successful forges", async () => {
    const forges: ForgeResult[] = [
      { ticketKey: "EC-1", status: "failed", worktrees: [], affectedUrls: [] },
    ];
    const runner = makeRunner([]);
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.mergeAndVerify(
      forges,
      [{ key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] }],
      VERIFY,
      NO_BASE,
    );

    assert.deepEqual(result.succeeded, []);
    assert.deepEqual(result.failed, ["EC-1"]);
  });

  void it("returns all failed when merge fails", async () => {
    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "" }, // commit EC-2
      { code: 1, stdout: "" }, // merge fails
    ]);
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.mergeAndVerify(
      successForges,
      [
        { key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
        { key: "EC-2", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
      ],
      VERIFY,
      NO_BASE,
    );

    assert.deepEqual(result.succeeded, []);
    assert.ok(result.failed.includes("EC-1"));
    assert.ok(result.failed.includes("EC-2"));
  });

  void it("separates failed forges from successful ones in result", async () => {
    const mixed: ForgeResult[] = [
      {
        ticketKey: "EC-1",
        status: "success",
        worktrees: [{ repoPath: "/repo", worktreePath: "/wt/ec-1" }],
        affectedUrls: [],
      },
      { ticketKey: "EC-2", status: "failed", worktrees: [], affectedUrls: [] },
    ];
    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "merge-branch" },
      { code: 0, stdout: "verify ok" },
      { code: 0, stdout: "pr ok" },
    ]);
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.mergeAndVerify(
      mixed,
      [
        { key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
        { key: "EC-2", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
      ],
      VERIFY,
      NO_BASE,
    );

    assert.deepEqual(result.succeeded, ["EC-1"]);
    assert.deepEqual(result.failed, ["EC-2"]);
  });

  void it("moves tickets to In Review via jira", async () => {
    const movedTickets: string[] = [];
    const jira = {
      ticketUrl: () => "",
      moveTicket: async (key: string) => {
        movedTickets.push(key);
        return true;
      },
      getParentKey: async () => null,
      hasUnfinishedSubtasks: async () => true,
      promoteToReview: async (key: string) => {
        movedTickets.push(key);
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as JiraClient;

    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "" }, // commit EC-2
      { code: 0, stdout: "branch" },
      { code: 0, stdout: "ok" },
      { code: 0, stdout: "ok" },
    ]);
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log, { jira });

    await pipeline.mergeAndVerify(
      successForges,
      [
        { key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
        { key: "EC-2", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] },
      ],
      VERIFY,
      NO_BASE,
    );

    assert.deepEqual(movedTickets, ["EC-1", "EC-2"]);
  });

  void it("always runs verify even when verification.required is false", async () => {
    let runCallCount = 0;
    const runner = {
      run: async () => {
        runCallCount++;
        return { code: 0, stdout: "branch" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    await pipeline.mergeAndVerify(
      [successForges[0]],
      [{ key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] }],
      NO_VERIFY,
      NO_BASE,
    );

    // commit + merge + verify + PR = 4 calls (verify always runs)
    assert.equal(runCallCount, 4);
  });

  void it("calls restartOnBranch when needsVerification and merge succeeds", async () => {
    let restartedBranch = "";
    const devServers = {
      devUrl: "http://localhost:3000",
      startAll: async () => {},
      stopAll: () => {},
      restartOnBranch: async (branchByRepo: Map<string, string>) => {
        restartedBranch = [...branchByRepo.values()][0] ?? "";
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as DevServerManager;

    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "my-merge-branch" },
      { code: 0, stdout: "ok" },
      { code: 0, stdout: "ok" },
    ]);
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log, { devServers });

    await pipeline.mergeAndVerify(
      [successForges[0]],
      [{ key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] }],
      VERIFY,
      NO_BASE,
    );

    assert.equal(restartedBranch, "my-merge-branch");
  });

  void it("passes per-repo branch map to restartOnBranch for multi-repo tickets", async () => {
    let capturedBranchByRepo = new Map<string, string>();
    const devServers = {
      devUrl: "http://localhost:3000",
      startAll: async () => {},
      stopAll: () => {},
      restartOnBranch: async (branchByRepo: Map<string, string>) => {
        capturedBranchByRepo = new Map(branchByRepo);
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as DevServerManager;

    const multiRepoForges: ForgeResult[] = [
      {
        ticketKey: "EC-1",
        status: "success",
        worktrees: [{ repoPath: "/repo-a", worktreePath: "/wt/ec-1-a" }],
        affectedUrls: [],
      },
      {
        ticketKey: "EC-2",
        status: "success",
        worktrees: [{ repoPath: "/repo-b", worktreePath: "/wt/ec-1-b" }],
        affectedUrls: [],
      },
    ];

    let mergeCallCount = 0;
    const runner = {
      run: async (_prompt: string, opts: { taskName: string }) => {
        if (opts.taskName.includes("commit")) return { code: 0, stdout: "" };
        if (opts.taskName.includes("merge")) {
          mergeCallCount++;
          return { code: 0, stdout: `branch-repo-${mergeCallCount}` };
        }
        return { code: 0, stdout: "" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;

    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log, { devServers });

    await pipeline.mergeAndVerify(
      multiRepoForges,
      [
        { key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo-a", branch: "ec-1-a" }] },
        { key: "EC-2", complexity: "moderate", repos: [{ repoPath: "/repo-b", branch: "ec-1-b" }] },
      ],
      VERIFY,
      NO_BASE,
    );

    assert.equal(capturedBranchByRepo.size, 2);
    assert.equal(capturedBranchByRepo.get("/repo-a"), "branch-repo-1");
    assert.equal(capturedBranchByRepo.get("/repo-b"), "branch-repo-2");
  });

  void it("does not restart servers when needsVerification is false", async () => {
    let restarted = false;
    const devServers = {
      devUrl: "http://localhost:3000",
      startAll: async () => {},
      stopAll: () => {},
      restartOnBranch: async (_branchByRepo: Map<string, string>) => {
        restarted = true;
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as DevServerManager;

    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "branch" },
      { code: 0, stdout: "ok" },
    ]);
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log, { devServers });

    await pipeline.mergeAndVerify(
      [successForges[0]],
      [{ key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] }],
      NO_VERIFY,
      NO_BASE,
    );

    assert.equal(restarted, false);
  });

  void it("logs warning when jira promoteToReview fails", async () => {
    const jira = {
      ticketUrl: () => "",
      moveTicket: async () => false,
      getParentKey: async () => null,
      hasUnfinishedSubtasks: async () => true,
      promoteToReview: async (key: string, logFn: (msg: string) => void) => {
        logFn(`WARN: Could not move ${key} to In Review`);
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as JiraClient;

    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "branch" },
      { code: 0, stdout: "ok" },
      { code: 0, stdout: "ok" },
    ]);
    const { logs, log } = collectLogs();
    const pipeline = makePipeline(runner, log, { jira });

    await pipeline.mergeAndVerify(
      [successForges[0]],
      [{ key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] }],
      VERIFY,
      NO_BASE,
    );

    assert.ok(logs.some((l) => l.includes("WARN: Could not move EC-1")));
  });

  void it("still succeeds when verify fails", async () => {
    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "branch" },
      { code: 1, stdout: "verify failed" }, // verify fails
      { code: 0, stdout: "pr ok" },
    ]);
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.mergeAndVerify(
      [successForges[0]],
      [{ key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] }],
      VERIFY,
      NO_BASE,
    );

    assert.deepEqual(result.succeeded, ["EC-1"]);
  });

  void it("runs verify once per repo and posts per-repo result to each PR", async () => {
    const multiRepoForges: ForgeResult[] = [
      {
        ticketKey: "EC-1",
        status: "success",
        worktrees: [{ repoPath: "/repo-a", worktreePath: "/wt/ec-1-a" }],
        affectedUrls: [],
      },
      {
        ticketKey: "EC-2",
        status: "success",
        worktrees: [{ repoPath: "/repo-b", worktreePath: "/wt/ec-1-b" }],
        affectedUrls: [],
      },
    ];

    const verifyCallCwds: string[] = [];
    const prCallCwds: string[] = [];
    const runner = {
      run: async (prompt: string, opts: { taskName: string; cwd?: string }) => {
        if (opts.taskName.includes("commit")) return { code: 0, stdout: "" };
        if (opts.taskName.includes("merge")) return { code: 0, stdout: "merge-branch" };
        if (opts.taskName.includes("verify")) {
          verifyCallCwds.push(opts.cwd ?? "");
          return {
            code: 0,
            stdout: JSON.stringify({
              status: "passed",
              summary: `verified in ${opts.cwd}`,
              screenshots: [],
            }),
          };
        }
        if (opts.taskName.includes(": pr ")) {
          prCallCwds.push(opts.cwd ?? "");
          return {
            code: 0,
            stdout: JSON.stringify({ status: "success", pr_url: `https://pr/${opts.cwd}` }),
          };
        }
        return { code: 0, stdout: "" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;

    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    await pipeline.mergeAndVerify(
      multiRepoForges,
      [
        { key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo-a", branch: "ec-1-a" }] },
        { key: "EC-2", complexity: "moderate", repos: [{ repoPath: "/repo-b", branch: "ec-1-b" }] },
      ],
      NO_VERIFY,
      NO_BASE,
    );

    // verify runs once per repo
    assert.equal(verifyCallCwds.length, 2);
    assert.ok(verifyCallCwds.includes("/repo-a"));
    assert.ok(verifyCallCwds.includes("/repo-b"));

    // PR created for each repo
    assert.equal(prCallCwds.length, 2);
    assert.ok(prCallCwds.includes("/repo-a"));
    assert.ok(prCallCwds.includes("/repo-b"));
  });

  void it("still succeeds when PR creation fails", async () => {
    const runner = makeRunner([
      { code: 0, stdout: "" }, // commit EC-1
      { code: 0, stdout: "branch" },
      { code: 0, stdout: "ok" },
      { code: 1, stdout: "pr failed" }, // PR fails
    ]);
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.mergeAndVerify(
      [successForges[0]],
      [{ key: "EC-1", complexity: "moderate", repos: [{ repoPath: "/repo", branch: "ec-1-fix" }] }],
      VERIFY,
      NO_BASE,
    );

    assert.deepEqual(result.succeeded, ["EC-1"]);
  });
});

// ─── processLayers ───────────────────────────────────────────────────────────

void describe("processLayers", () => {
  function makeFullRunner(forgeCode = 0): ClaudeRunner {
    return {
      run: async (_prompt: string, opts: { taskName: string }) => {
        if (opts.taskName.includes("forge")) {
          return { code: forgeCode, stdout: '{"worktree_path": "/wt/t"}' };
        }
        return { code: 0, stdout: "branch-name" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
  }

  void it("processes all layers and counts results", async () => {
    const layers: GroupedLayer[] = [
      {
        group: [
          {
            key: "EC-1",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: null,
      },
      {
        group: [
          {
            key: "EC-2",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: null,
      },
    ];
    const runner = makeFullRunner();
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.processLayers(
      layers,
      new Set(["EC-1", "EC-2"]),
      new Set(),
      new Set(),
    );

    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 0);
  });

  void it("skips empty layers after filtering", async () => {
    const layers: GroupedLayer[] = [
      {
        group: [
          {
            key: "EC-1",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: null,
      },
      {
        group: [
          {
            key: "EC-99",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: null,
      }, // not in unprocessed
    ];
    const runner = makeFullRunner();
    const { logs, log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.processLayers(layers, new Set(["EC-1"]), new Set(), new Set());

    assert.equal(result.succeeded, 1);
    assert.ok(!logs.some((l) => l.includes("EC-99")));
  });

  void it("respects skipped and excluded sets", async () => {
    const layers: GroupedLayer[] = [
      {
        group: [
          {
            key: "EC-1",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
          {
            key: "EC-2",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
          {
            key: "EC-3",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: null,
      },
    ];
    const runner = makeFullRunner();
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.processLayers(
      layers,
      new Set(["EC-1", "EC-2", "EC-3"]),
      new Set(["EC-2"]),
      new Set(["EC-3"]),
    );

    // Only EC-1 should be processed
    assert.equal(result.succeeded, 1);
  });

  void it("counts failures from forge errors", async () => {
    const layers: GroupedLayer[] = [
      {
        group: [
          {
            key: "EC-1",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: null,
      },
    ];
    const runner = makeFullRunner(1); // forge fails
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.processLayers(layers, new Set(["EC-1"]), new Set(), new Set());

    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 1);
  });

  void it("returns zeros for empty layers", async () => {
    const runner = makeFullRunner();
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.processLayers([], new Set(), new Set(), new Set());

    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 0);
  });

  void it("logs layer info with relation", async () => {
    const layers: GroupedLayer[] = [
      {
        group: [
          {
            key: "EC-1",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
        ],
        relation: "same-epic",
        verification: { required: false, reason: "test" },
        dependsOn: null,
      },
    ];
    const runner = makeFullRunner();
    const { logs, log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    await pipeline.processLayers(layers, new Set(["EC-1"]), new Set(), new Set());

    assert.ok(logs.some((l) => l.includes("Layer 0") && l.includes("(same-epic)")));
  });

  void it("logs layer info without relation when null", async () => {
    const layers: GroupedLayer[] = [
      {
        group: [
          {
            key: "EC-1",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-1-fix" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: null,
      },
    ];
    const runner = makeFullRunner();
    const { logs, log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    await pipeline.processLayers(layers, new Set(["EC-1"]), new Set(), new Set());

    const layerLog = logs.find((l) => l.includes("Layer 0"));
    assert.ok(layerLog);
    assert.ok(!layerLog.includes("("));
  });

  void it("threads baseBranch and PR URL via dependsOn (stacked chain)", async () => {
    const layers: GroupedLayer[] = [
      {
        group: [
          {
            key: "EC-10",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-10-auth" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: null,
      },
      {
        group: [
          {
            key: "EC-20",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-20-rate-limit" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: "EC-10",
      },
    ];

    const capturedOpts: Array<{ prompt: string; cwd?: string; taskName: string }> = [];
    const runner = {
      run: async (prompt: string, opts: { taskName: string; cwd?: string }) => {
        capturedOpts.push({ prompt, cwd: opts.cwd, taskName: opts.taskName });
        if (opts.taskName.includes("forge"))
          return { code: 0, stdout: '{"worktree_path": "/wt/t"}' };
        if (opts.taskName.includes("merge")) return { code: 0, stdout: "EC-10-merge-auth" };
        if (opts.taskName.includes("pr"))
          return {
            code: 0,
            stdout: JSON.stringify({ status: "success", pr_url: "https://pr/42" }),
          };
        return { code: 0, stdout: "ok" };
      },
      writeLog: () => "/fake",
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    await pipeline.processLayers(layers, new Set(["EC-10", "EC-20"]), new Set(), new Set());

    // Find the merge call for EC-20 — it should reference the base branch from EC-10
    const ec20Merge = capturedOpts.find(
      (o) => o.taskName.includes("merge") && o.prompt.includes("EC-20"),
    );
    assert.ok(ec20Merge, "merge call for EC-20 should exist");
    assert.ok(
      ec20Merge.prompt.includes("EC-10-merge-auth"),
      "EC-20 merge should reference EC-10's branch as base",
    );

    // Find the PR call for EC-20 — it should reference the base branch
    const ec20Pr = capturedOpts.find(
      (o) => o.taskName.includes("pr") && o.prompt.includes("EC-20"),
    );
    assert.ok(ec20Pr, "PR call for EC-20 should exist");
    assert.ok(
      ec20Pr.prompt.includes("EC-10-merge-auth"),
      "EC-20 PR should reference EC-10's branch as base",
    );
  });
});

// ─── Real-world regression: multi-repo group with stacked dependencies ──────

void describe("real-world: EC-10798 team tabs resume", () => {
  void it("passes initialGroupStates to dag for mid-run resume", async () => {
    const savedStates: GroupStates = new Map([
      [
        "EC-10798",
        {
          branches: new Map([["/repo-sf", "EC-10798-merge-team-tabs"]]),
          prUrls: new Map([["/repo-sf", "https://github.com/org/sf/pull/99"]]),
        },
      ],
    ]);

    const layers: GroupedLayer[] = [
      {
        group: [
          {
            key: "EC-10798",
            complexity: "moderate",
            repos: [{ repoPath: "/repo-sf", branch: "ec-10798-tabs" }],
          },
        ],
        relation: null,
        verification: { required: true, reason: "UI" },
        dependsOn: null,
      },
      {
        group: [
          {
            key: "EC-10800",
            complexity: "moderate",
            repos: [{ repoPath: "/repo-sf", branch: "ec-10800-fix" }],
          },
        ],
        relation: "same-epic",
        verification: { required: true, reason: "UI" },
        dependsOn: "EC-10798",
      },
    ];

    const capturedMergePrompts: string[] = [];
    const runner = {
      run: async (prompt: string, opts: { taskName: string }) => {
        if (opts.taskName.includes("merge")) capturedMergePrompts.push(prompt);
        if (opts.taskName.includes("forge")) return { code: 0, stdout: '{"ok": true}' };
        return { code: 0, stdout: "merge-branch" };
      },
      writeLog: () => "/fake",
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    // First group is already done (in savedStates), only EC-10800 is unprocessed
    await pipeline.processLayers(layers, new Set(["EC-10800"]), new Set(), new Set(), savedStates);

    // EC-10800's merge should use EC-10798's branch as base
    const ec10800Merge = capturedMergePrompts.find((p) => p.includes("EC-10800"));
    assert.ok(ec10800Merge, "EC-10800 merge prompt should exist");
    assert.ok(
      ec10800Merge.includes("EC-10798-merge-team-tabs"),
      "should branch from saved EC-10798 merge branch",
    );
  });

  void it("skips downstream group when dependency group fails", async () => {
    const layers: GroupedLayer[] = [
      {
        group: [
          {
            key: "EC-10798",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-10798-tabs" }],
          },
        ],
        relation: null,
        verification: { required: false, reason: "test" },
        dependsOn: null,
      },
      {
        group: [
          {
            key: "EC-10800",
            complexity: "moderate",
            repos: [{ repoPath: "/repo", branch: "ec-10800-fix" }],
          },
        ],
        relation: "same-epic",
        verification: { required: false, reason: "test" },
        dependsOn: "EC-10798",
      },
    ];

    const runner = {
      run: async (_prompt: string, _opts: { taskName: string }) => {
        return { code: 1, stdout: "" }; // everything fails
      },
      writeLog: () => "/fake",
    } as unknown as ClaudeRunner;
    const { logs, log } = collectLogs();
    const pipeline = makePipeline(runner, log);

    const result = await pipeline.processLayers(
      layers,
      new Set(["EC-10798", "EC-10800"]),
      new Set(),
      new Set(),
    );

    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 2);
    assert.ok(logs.some((l) => l.includes("SKIP: dependency")));
  });
});
