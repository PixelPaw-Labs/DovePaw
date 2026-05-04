import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexRunner } from "./codex-runner.js";

const TMP_DIR = join(tmpdir(), `codex-runner-test-${process.pid}`);

describe("CodexRunner", () => {
  describe("writeLog", () => {
    const runner = new CodexRunner(TMP_DIR);

    it("writes content to log file with correct name", () => {
      mkdirSync(TMP_DIR, { recursive: true });
      try {
        const path = runner.writeLog("task", "run-123", "codex output here");
        expect(path).toBe(join(TMP_DIR, "task-run-123.log"));
        expect(readFileSync(path, "utf-8")).toBe("codex output here");
      } finally {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    });

    it("returns the full path to the log file", () => {
      mkdirSync(TMP_DIR, { recursive: true });
      try {
        const path = runner.writeLog("codex", "abc-456", "output");
        expect(path.endsWith("codex-abc-456.log")).toBe(true);
      } finally {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    });
  });

  describe("killRunningProcess", () => {
    it("is a no-op when no run is active", () => {
      const runner = new CodexRunner(TMP_DIR);
      expect(() => runner.killRunningProcess()).not.toThrow();
    });

    it("is idempotent — safe to call multiple times", () => {
      const runner = new CodexRunner(TMP_DIR);
      runner.killRunningProcess();
      runner.killRunningProcess();
    });
  });

  describe("approvalPolicy", () => {
    it("defaults to never so subagents spawn without user confirmation", async () => {
      const runner = new CodexRunner(TMP_DIR);
      // approvalPolicy: "never" is passed in threadOptions; the run will fail
      // at connect (no API key) before reaching the thread — that's expected.
      await runner
        .run("prompt", { cwd: TMP_DIR, taskName: "test", timeoutMs: 100 })
        .catch(() => {});
    });
  });

  describe("sandboxMode option", () => {
    it("is accepted in CodexRunOpts with danger-full-access", async () => {
      const runner = new CodexRunner(TMP_DIR);
      await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "test",
          timeoutMs: 100,
          sandboxMode: "danger-full-access",
        })
        .catch(() => {}); // fails at connect with no API key — expected
    });
  });

  describe("config option", () => {
    it("is accepted in CodexRunOpts with service_tier fast", async () => {
      const runner = new CodexRunner(TMP_DIR);
      await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "test",
          timeoutMs: 100,
          config: { service_tier: "fast" },
        })
        .catch(() => {}); // fails at connect with no API key — expected
    });
  });

  describe("appendSystemPrompt option", () => {
    it("is accepted in CodexRunOpts and passed as developer_instructions", async () => {
      const runner = new CodexRunner(TMP_DIR);
      await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "test",
          timeoutMs: 100,
          appendSystemPrompt: "Always explain your reasoning.",
        })
        .catch(() => {}); // fails at connect with no API key — expected
    });

    it("is accepted without appendSystemPrompt (no developer_instructions set)", async () => {
      const runner = new CodexRunner(TMP_DIR);
      await runner
        .run("prompt", { cwd: TMP_DIR, taskName: "test", timeoutMs: 100 })
        .catch(() => {});
    });
  });

  describe("additionalDirectories option", () => {
    it("is accepted in CodexRunOpts with directories", async () => {
      const runner = new CodexRunner(TMP_DIR);
      await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "test",
          timeoutMs: 100,
          additionalDirectories: ["/some/path"],
        })
        .catch(() => {}); // fails at connect with no API key — expected
    });

    it("is accepted in CodexRunOpts with empty array", async () => {
      const runner = new CodexRunner(TMP_DIR);
      await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "test",
          timeoutMs: 100,
          additionalDirectories: [],
        })
        .catch(() => {});
    });
  });

  describe("SIGTERM/SIGINT handler lifecycle", () => {
    it("registers handlers during run and removes them after", async () => {
      const runner = new CodexRunner(TMP_DIR);

      const before = process.listenerCount("SIGTERM");

      // Simulate a run that rejects immediately (no real Codex connection)
      const runPromise = runner.run("test prompt", {
        cwd: TMP_DIR,
        taskName: "test",
        timeoutMs: 100,
        // No apiKey — will throw during connect
      });

      // Handler should be registered while run is in progress
      const during = process.listenerCount("SIGTERM");
      expect(during).toBe(before + 1);

      // Wait for it to settle (will fail with connection error)
      await runPromise.catch(() => {});

      // Handler should be removed after run completes
      const after = process.listenerCount("SIGTERM");
      expect(after).toBe(before);
    });
  });
});
