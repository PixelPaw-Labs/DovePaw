import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ForgeService } from "./forge.js";
import type { ClaudeRunner, LogFn } from "./claude-runner.js";
import type { JiraClient } from "./jira.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRunner(response: { code: number; stdout: string }): ClaudeRunner {
  return {
    run: async () => response,
    writeLog: () => "/fake/log",
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  } as unknown as ClaudeRunner;
}

function makeJira(server = "https://jira.test"): JiraClient {
  return {
    ticketUrl: (key: string) => `${server}/browse/${key}`,
    moveTicket: async () => true,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  } as unknown as JiraClient;
}

function collectLogs(): { logs: string[]; log: LogFn } {
  const logs: string[] = [];
  return { logs, log: (msg: string) => logs.push(msg) };
}

function makeForge(runner: ClaudeRunner, log: LogFn, jira?: JiraClient): ForgeService {
  return new ForgeService({ runner, jira: jira ?? makeJira(), log });
}

// ─── forgeTicket ─────────────────────────────────────────────────────────────

void describe("forgeTicket", () => {
  void it("returns success with worktree path on exit code 0", async () => {
    const runner = makeRunner({ code: 0, stdout: "some output" });
    const { log } = collectLogs();
    const forge = makeForge(runner, log);

    const result = await forge.forgeTicket(
      {
        key: "EC-1",
        complexity: "moderate",
        repos: [{ repoPath: "/repo", branch: "ec-1-fix-bug" }],
      },
      "",
    );

    assert.equal(result.ticketKey, "EC-1");
    assert.equal(result.status, "success");
    assert.deepEqual(result.worktrees, [
      { repoPath: "/repo", worktreePath: "/repo/.claude/worktrees/ec-1-fix-bug" },
    ]);
  });

  void it("returns failed on non-zero exit code", async () => {
    const runner = makeRunner({ code: 1, stdout: "error" });
    const { log } = collectLogs();
    const forge = makeForge(runner, log);

    const result = await forge.forgeTicket(
      {
        key: "EC-2",
        complexity: "moderate",
        repos: [{ repoPath: "/repo", branch: "ec-2-fix-bug" }],
      },
      "",
    );

    assert.equal(result.status, "failed");
    assert.deepEqual(result.worktrees, []);
  });

  void it("logs forging start and result", async () => {
    const runner = makeRunner({ code: 0, stdout: "" });
    const { logs, log } = collectLogs();
    const forge = makeForge(runner, log);

    await forge.forgeTicket(
      {
        key: "EC-3",
        complexity: "moderate",
        repos: [{ repoPath: "/repo", branch: "ec-1-fix-bug" }],
      },
      "",
    );

    assert.ok(logs.some((l) => l.includes("FORGING: EC-3")));
    assert.ok(logs.some((l) => l.includes("FORGED (success): EC-3")));
  });

  void it("logs failure message on non-zero exit", async () => {
    const runner = makeRunner({ code: 1, stdout: "" });
    const { logs, log } = collectLogs();
    const forge = makeForge(runner, log);

    await forge.forgeTicket(
      {
        key: "EC-4",
        complexity: "moderate",
        repos: [{ repoPath: "/repo", branch: "ec-1-fix-bug" }],
      },
      "",
    );

    assert.ok(logs.some((l) => l.includes("FORGE FAILED: EC-4")));
  });

  void it("uses jira.ticketUrl for the ticket URL", async () => {
    let capturedPrompt = "";
    const runner = {
      run: async (prompt: string) => {
        capturedPrompt = prompt;
        return { code: 0, stdout: "" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
    const jira = makeJira("https://custom.jira");
    const { log } = collectLogs();
    const forge = makeForge(runner, log, jira);

    await forge.forgeTicket(
      {
        key: "EC-5",
        complexity: "moderate",
        repos: [{ repoPath: "/repo", branch: "ec-1-fix-bug" }],
      },
      "",
    );

    assert.ok(capturedPrompt.includes("https://custom.jira/browse/EC-5"));
  });

  void it("calls runner.writeLog with task prefix", async () => {
    let loggedPrefix = "";
    let loggedId = "";
    const runner = {
      run: async () => ({ code: 0, stdout: "" }),
      writeLog: (prefix: string, id: string) => {
        loggedPrefix = prefix;
        loggedId = id;
        return "/fake";
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const forge = makeForge(runner, log);

    await forge.forgeTicket(
      {
        key: "EC-6",
        complexity: "moderate",
        repos: [{ repoPath: "/repo", branch: "ec-1-fix-bug" }],
      },
      "",
    );

    assert.equal(loggedPrefix, "task");
    assert.equal(loggedId, "EC-6-ec-1-fix-bug");
  });
});

// ─── forgeGroup ──────────────────────────────────────────────────────────────

void describe("forgeGroup", () => {
  void it("returns results for all tickets in group", async () => {
    const runner = makeRunner({ code: 0, stdout: "" });
    const { log } = collectLogs();
    const forge = makeForge(runner, log);

    const results = await forge.forgeGroup(
      [
        {
          key: "EC-1",
          complexity: "moderate",
          repos: [{ repoPath: "/repo", branch: "ec-1-fix-bug" }],
        },
        {
          key: "EC-2",
          complexity: "moderate",
          repos: [{ repoPath: "/repo", branch: "ec-2-fix-bug" }],
        },
      ],
      "",
    );

    assert.equal(results.length, 2);
    assert.equal(results[0].ticketKey, "EC-1");
    assert.equal(results[1].ticketKey, "EC-2");
  });

  void it("logs group start", async () => {
    const runner = makeRunner({ code: 0, stdout: "" });
    const { logs, log } = collectLogs();
    const forge = makeForge(runner, log);

    await forge.forgeGroup(
      [
        {
          key: "EC-1",
          complexity: "moderate",
          repos: [{ repoPath: "/repo", branch: "ec-1-fix-bug" }],
        },
        {
          key: "EC-2",
          complexity: "moderate",
          repos: [{ repoPath: "/repo", branch: "ec-2-fix-bug" }],
        },
      ],
      "",
    );

    assert.ok(logs.some((l) => l.includes("FORGING GROUP: EC-1, EC-2")));
  });

  void it("handles mixed success and failure", async () => {
    let callCount = 0;
    const runner = {
      run: async () => {
        callCount++;
        if (callCount === 1) return { code: 0, stdout: "" };
        return { code: 1, stdout: "" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const forge = makeForge(runner, log);

    const results = await forge.forgeGroup(
      [
        {
          key: "EC-1",
          complexity: "moderate",
          repos: [{ repoPath: "/repo", branch: "ec-1-fix-bug" }],
        },
        {
          key: "EC-2",
          complexity: "moderate",
          repos: [{ repoPath: "/repo", branch: "ec-2-fix-bug" }],
        },
      ],
      "",
    );

    assert.equal(results[0].status, "success");
    assert.equal(results[1].status, "failed");
  });

  void it("returns failed for rejected promises", async () => {
    const runner = {
      run: async () => {
        throw new Error("boom");
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const forge = makeForge(runner, log);

    const results = await forge.forgeGroup(
      [
        {
          key: "EC-1",
          complexity: "moderate",
          repos: [{ repoPath: "/repo", branch: "ec-1-fix-bug" }],
        },
      ],
      "",
    );

    assert.equal(results[0].status, "failed");
    assert.equal(results[0].ticketKey, "EC-1");
    assert.deepEqual(results[0].worktrees, []);
  });

  void it("handles empty group", async () => {
    const runner = makeRunner({ code: 0, stdout: "" });
    const { log } = collectLogs();
    const forge = makeForge(runner, log);

    const results = await forge.forgeGroup([], "");

    assert.equal(results.length, 0);
  });
});
