import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prioritizer } from "./prioritizer.js";
import type { ClaudeRunner, LogFn } from "./claude-runner.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const REPOS = ["/repo-a", "/repo-b"];

function collectLogs(): { logs: string[]; log: LogFn } {
  const logs: string[] = [];
  return { logs, log: (msg: string) => logs.push(msg) };
}

function makeRunner(response: { code: number; stdout: string }): ClaudeRunner {
  return {
    run: async () => response,
    writeLog: () => "/fake/log",
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  } as unknown as ClaudeRunner;
}

function makePrioritizer(runner: ClaudeRunner, log: LogFn): Prioritizer {
  return new Prioritizer({ runner, scriptDir: "/dir", log });
}

function keys(group: Array<{ key: string }>): string[] {
  return group.map((t) => t.key);
}

// ─── prioritize ─────────────────────────────────────────────────────────────

void describe("Prioritizer.prioritize", () => {
  void it("returns fallback for single ticket without calling runner", async () => {
    let called = false;
    const runner = {
      run: async () => {
        called = true;
        return { code: 0, stdout: "" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    const { resolved } = await prioritizer.prioritize(["EC-1"], REPOS);

    assert.equal(called, false);
    assert.equal(resolved.layers.length, 1);
    assert.deepEqual(keys(resolved.layers[0].group), ["EC-1"]);
  });

  void it("returns fallback for empty tickets without calling runner", async () => {
    let called = false;
    const runner = {
      run: async () => {
        called = true;
        return { code: 0, stdout: "" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    const { resolved } = await prioritizer.prioritize([], REPOS);

    assert.equal(called, false);
    assert.deepEqual(keys(resolved.layers[0].group), []);
  });

  void it("parses successful prioritizer output", async () => {
    const output = JSON.stringify({
      layers: [
        {
          group: [
            { key: "EC-1", repos: [{ repo: "repo-a", branch: "ec-1-fix" }] },
            { key: "EC-2", repos: [{ repo: "repo-b", branch: "ec-2-fix" }] },
          ],
          relation: "same-epic",
          verification: { required: true, reason: "test" },
        },
        {
          group: [{ key: "EC-3", repos: [{ repo: "repo-a", branch: "ec-3-fix" }] }],
          relation: null,
          verification: { required: false, reason: "API-only" },
        },
      ],
      skipped: [{ key: "EC-4", reason: "blocked" }],
      excluded: [{ key: "EC-5", reason: "Done" }],
    });
    const runner = makeRunner({ code: 0, stdout: output });
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    const { resolved } = await prioritizer.prioritize(
      ["EC-1", "EC-2", "EC-3", "EC-4", "EC-5"],
      REPOS,
    );

    assert.equal(resolved.layers.length, 2);
    assert.deepEqual(keys(resolved.layers[0].group), ["EC-1", "EC-2"]);
    assert.equal(resolved.skipped.length, 1);
    assert.equal(resolved.excluded.length, 1);
  });

  void it("rawJson contains original LLM field names (repo, depends_on)", async () => {
    const output = JSON.stringify({
      layers: [
        {
          group: [{ key: "EC-1", repos: [{ repo: "repo-a", branch: "ec-1-fix" }] }],
          relation: null,
          verification: { required: false, reason: "test" },
        },
      ],
      skipped: [],
      excluded: [],
    });
    const runner = makeRunner({ code: 0, stdout: output });
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    const { resolved, rawJson } = await prioritizer.prioritize(["EC-1", "EC-2"], REPOS);
    const raw = JSON.parse(rawJson) as {
      layers: Array<{ group: Array<{ repos: Array<{ repo: string }> }> }>;
    };

    // resolved has full paths with repoPath
    assert.equal(resolved.layers[0].group[0].repos[0].repoPath, "/repo-a");
    // rawJson has basenames with original "repo" field
    assert.equal(raw.layers[0].group[0].repos[0].repo, "repo-a");
  });

  void it("rawJson is independent from resolved mutations", async () => {
    const output = JSON.stringify({
      layers: [
        {
          group: [{ key: "EC-1", repos: [{ repo: "repo-a", branch: "ec-1-fix" }] }],
          relation: null,
          verification: { required: false, reason: "test" },
        },
      ],
      skipped: [],
      excluded: [],
    });
    const runner = makeRunner({ code: 0, stdout: output });
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    const { resolved, rawJson } = await prioritizer.prioritize(["EC-1", "EC-2"], REPOS);

    // mutating resolved does not affect rawJson
    resolved.layers[0].group[0].repos[0].repoPath = "/mutated";
    const raw = JSON.parse(rawJson) as {
      layers: Array<{ group: Array<{ repos: Array<{ repo: string }> }> }>;
    };
    assert.equal(raw.layers[0].group[0].repos[0].repo, "repo-a");
  });

  void it("rawJson preserves all fields across multiple layers", async () => {
    const output = JSON.stringify({
      layers: [
        {
          group: [
            { key: "EC-1", repos: [{ repo: "repo-a", branch: "ec-1-fix" }] },
            { key: "EC-2", repos: [{ repo: "repo-b", branch: "ec-2-fix" }] },
          ],
          relation: "same-epic",
          verification: { required: true, reason: "UI change" },
          depends_on: null,
        },
        {
          group: [{ key: "EC-3", repos: [{ repo: "repo-a", branch: "ec-3-fix" }] }],
          relation: null,
          verification: { required: false, reason: "API-only" },
          depends_on: "EC-1",
        },
      ],
      skipped: [{ key: "EC-4", reason: "blocked" }],
      excluded: [{ key: "EC-5", reason: "Done" }],
    });
    const runner = makeRunner({ code: 0, stdout: output });
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    const { resolved, rawJson } = await prioritizer.prioritize(
      ["EC-1", "EC-2", "EC-3", "EC-4", "EC-5"],
      REPOS,
    );
    const raw = JSON.parse(rawJson) as {
      layers: Array<{
        group: Array<{ repos: Array<{ repo: string; branch: string }> }>;
        relation: string;
        depends_on: string | null;
      }>;
      skipped: Array<{ key: string; reason: string }>;
      excluded: Array<{ key: string; reason: string }>;
    };

    // rawJson uses "repo" (not "repoPath") and "depends_on" (not "dependsOn")
    assert.equal(raw.layers[0].group[0].repos[0].repo, "repo-a");
    assert.equal(raw.layers[1].depends_on, "EC-1");
    assert.deepEqual(raw.skipped, [{ key: "EC-4", reason: "blocked" }]);
    assert.equal(raw.layers[0].group[0].repos[0].branch, "ec-1-fix");

    // resolved uses transformed names with full paths
    assert.equal(resolved.layers[0].group[0].repos[0].repoPath, "/repo-a");
    assert.equal(resolved.layers[1].dependsOn, "EC-1");
  });

  void it("fallback single ticket returns rawJson", async () => {
    const runner = makeRunner({ code: 0, stdout: "" });
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    const { resolved, rawJson } = await prioritizer.prioritize(["EC-1"], REPOS);

    assert.deepEqual(keys(resolved.layers[0].group), ["EC-1"]);
    assert.ok(rawJson);
    assert.ok(rawJson.includes("EC-1"));
  });

  void it("throws on non-zero exit code", async () => {
    const runner = makeRunner({ code: 1, stdout: "" });
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    await assert.rejects(
      () => prioritizer.prioritize(["EC-1", "EC-2"], REPOS),
      /exited with code 1/,
    );
  });

  void it("throws on invalid JSON output", async () => {
    const runner = makeRunner({ code: 0, stdout: "not json" });
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    await assert.rejects(() => prioritizer.prioritize(["EC-1", "EC-2"], REPOS), /parse failed/);
  });

  void it("throws when output has empty layers", async () => {
    const output = JSON.stringify({ layers: [], skipped: [], excluded: [] });
    const runner = makeRunner({ code: 0, stdout: output });
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    await assert.rejects(() => prioritizer.prioritize(["EC-1", "EC-2"], REPOS), /parse failed/);
  });

  void it("logs prioritization summary on success", async () => {
    const output = JSON.stringify({
      layers: [
        {
          group: [{ key: "EC-1", repos: [{ repo: "repo-a", branch: "ec-1-fix" }] }],
          relation: null,
          verification: { required: true, reason: "test" },
        },
      ],
      skipped: [],
      excluded: [],
    });
    const runner = makeRunner({ code: 0, stdout: output });
    const { logs, log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    await prioritizer.prioritize(["EC-1", "EC-2"], REPOS);

    assert.ok(logs.some((l) => l.includes("PRIORITIZED: 1 layer(s)")));
  });

  void it("logs skipped and excluded tickets", async () => {
    const output = JSON.stringify({
      layers: [
        {
          group: [{ key: "EC-1", repos: [{ repo: "repo-a", branch: "ec-1-fix" }] }],
          relation: null,
          verification: { required: true, reason: "test" },
        },
      ],
      skipped: [{ key: "EC-2", reason: "blocked" }],
      excluded: [{ key: "EC-3", reason: "Done" }],
    });
    const runner = makeRunner({ code: 0, stdout: output });
    const { logs, log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    await prioritizer.prioritize(["EC-1", "EC-2", "EC-3"], REPOS);

    assert.ok(logs.some((l) => l.includes("SKIPPED: EC-2")));
    assert.ok(logs.some((l) => l.includes("EXCLUDED: EC-3")));
  });

  void it("passes correct options to runner", async () => {
    let capturedOpts: Record<string, unknown> = {};
    const runner = {
      run: async (_prompt: string, opts: Record<string, unknown>) => {
        capturedOpts = opts;
        return { code: 1, stdout: "" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const prioritizer = new Prioritizer({ runner, scriptDir: "/my/dir", log });

    await assert.rejects(() => prioritizer.prioritize(["EC-1", "EC-2"], REPOS));

    assert.equal(capturedOpts.cwd, "/my/dir");
    assert.equal(capturedOpts.model, "opus");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test assertion on captured mock data
    assert.ok((capturedOpts.taskName as string).includes("prioritizing 2 tickets"));
  });

  void it("includes ticket list and repo names in prompt", async () => {
    let capturedPrompt = "";
    const runner = {
      run: async (prompt: string) => {
        capturedPrompt = prompt;
        return { code: 1, stdout: "" };
      },
      writeLog: () => "/fake",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    } as unknown as ClaudeRunner;
    const { log } = collectLogs();
    const prioritizer = makePrioritizer(runner, log);

    await assert.rejects(() => prioritizer.prioritize(["EC-1", "EC-2", "EC-3"], REPOS));

    assert.ok(capturedPrompt.includes("EC-1,EC-2,EC-3"));
    assert.ok(capturedPrompt.includes("jira-ticket-prioritizer"));
    assert.ok(capturedPrompt.includes("repo-a"));
  });
});
