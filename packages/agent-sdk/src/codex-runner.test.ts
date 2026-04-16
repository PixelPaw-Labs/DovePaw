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
