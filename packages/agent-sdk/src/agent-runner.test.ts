import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRunner } from "./agent-runner.js";

const TMP_DIR = join(tmpdir(), `agent-runner-test-${process.pid}`);

describe("AgentRunner", () => {
  describe("writeLog", () => {
    const runner = new AgentRunner(TMP_DIR);

    it("writes content to log file with correct name", () => {
      mkdirSync(TMP_DIR, { recursive: true });
      try {
        const path = runner.writeLog("task", "run-123", "agent output here");
        expect(path).toBe(join(TMP_DIR, "task-run-123.log"));
        expect(readFileSync(path, "utf-8")).toBe("agent output here");
      } finally {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    });

    it("returns the full path to the log file", () => {
      mkdirSync(TMP_DIR, { recursive: true });
      try {
        const path = runner.writeLog("agent", "abc-456", "data");
        expect(path.endsWith("agent-abc-456.log")).toBe(true);
      } finally {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    });
  });

  describe("model dispatch", () => {
    const runner = new AgentRunner(TMP_DIR, "/dev/null");

    it("throws for unrecognized model identifiers", async () => {
      await expect(
        runner.run("prompt", { cwd: TMP_DIR, taskName: "t", model: "gemini-pro" }),
      ).rejects.toThrow('Unknown model: "gemini-pro"');
    });

    it('routes model "codex" to Codex runner', async () => {
      const err = await runner
        .run("prompt", { cwd: TMP_DIR, taskName: "t", model: "codex", timeoutMs: 100 })
        .catch((e: Error) => e);
      if (err instanceof Error) {
        expect(err.message).not.toContain("Unknown model");
      }
    });

    it("routes gpt-* models to Codex runner", async () => {
      const err = await runner
        .run("prompt", { cwd: TMP_DIR, taskName: "t", model: "gpt-5.4-mini", timeoutMs: 100 })
        .catch((e: Error) => e);
      if (err instanceof Error) {
        expect(err.message).not.toContain("Unknown model");
      }
    });

    it("passes codexOpts.sandboxMode to Codex runner without error", async () => {
      const err = await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "t",
          model: "gpt-5.4-mini",
          timeoutMs: 100,
          codexOpts: { sandboxMode: "danger-full-access" },
        })
        .catch((e: Error) => e);
      if (err instanceof Error) {
        expect(err.message).not.toContain("Unknown model");
      }
    });

    it("passes codexOpts.config to Codex runner without error", async () => {
      const err = await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "t",
          model: "gpt-5.4-mini",
          timeoutMs: 100,
          codexOpts: { config: { service_tier: "fast" } },
        })
        .catch((e: Error) => e);
      if (err instanceof Error) {
        expect(err.message).not.toContain("Unknown model");
      }
    });

    it("passes appendSystemPrompt to Codex runner without error", async () => {
      const err = await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "t",
          model: "gpt-5.4-mini",
          timeoutMs: 100,
          appendSystemPrompt: "Always explain your reasoning.",
        })
        .catch((e: Error) => e);
      if (err instanceof Error) {
        expect(err.message).not.toContain("Unknown model");
      }
    });

    it("passes appendSystemPrompt to Claude runner without error", async () => {
      const err = await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "t",
          model: "claude-sonnet-4-6",
          timeoutMs: 100,
          appendSystemPrompt: "Always explain your reasoning.",
        })
        .catch((e: Error) => e);
      if (err instanceof Error) {
        expect(err.message).not.toContain("Unknown model");
      }
    });

    it("passes resumeSession to Codex runner without error", async () => {
      const err = await runner
        .run("prompt", {
          cwd: TMP_DIR,
          taskName: "t",
          model: "gpt-5.4-mini",
          resumeSession: "thread-abc",
          timeoutMs: 100,
        })
        .catch((e: Error) => e);
      if (err instanceof Error) {
        expect(err.message).not.toContain("Unknown model");
      }
    });
  });

  describe("onCodexPrompt callback", () => {
    const runner = new AgentRunner(TMP_DIR, "/dev/null");

    it("calls onCodexPrompt with original prompt when Codex model is selected", async () => {
      const transform = vi.fn((p: string) => p + " [appended]");
      await runner
        .run("base prompt", {
          cwd: TMP_DIR,
          taskName: "t",
          model: "gpt-5.4-mini",
          timeoutMs: 100,
          onCodexPrompt: transform,
        })
        .catch(() => {});
      expect(transform).toHaveBeenCalledWith("base prompt");
    });
  });

  describe("AGENT_SCRIPT_MODEL env var", () => {
    const runner = new AgentRunner(TMP_DIR, "/dev/null");
    let prev: string | undefined;

    beforeEach(() => {
      prev = process.env.AGENT_SCRIPT_MODEL;
    });

    afterEach(() => {
      if (prev === undefined) delete process.env.AGENT_SCRIPT_MODEL;
      else process.env.AGENT_SCRIPT_MODEL = prev;
    });

    it("routes to Codex when AGENT_SCRIPT_MODEL is a gpt-* model", async () => {
      process.env.AGENT_SCRIPT_MODEL = "gpt-5.4-mini";
      const err = await runner
        .run("prompt", { cwd: TMP_DIR, taskName: "t", timeoutMs: 100 })
        .catch((e: Error) => e);
      if (err instanceof Error) {
        expect(err.message).not.toContain("Unknown model");
      }
    });

    it("throws when AGENT_SCRIPT_MODEL is an unrecognized identifier", async () => {
      process.env.AGENT_SCRIPT_MODEL = "gemini-ultra";
      await expect(runner.run("prompt", { cwd: TMP_DIR, taskName: "t" })).rejects.toThrow(
        'Unknown model: "gemini-ultra"',
      );
    });

    it("opts.model takes precedence over AGENT_SCRIPT_MODEL", async () => {
      process.env.AGENT_SCRIPT_MODEL = "gpt-5.4";
      await expect(
        runner.run("prompt", { cwd: TMP_DIR, taskName: "t", model: "gemini-pro" }),
      ).rejects.toThrow('Unknown model: "gemini-pro"');
    });
  });
});
