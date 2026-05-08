import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AgentRunner,
  resolveClaudeSecurityOpts,
  resolveCodexSandboxMode,
  resolveCodexApprovalPolicy,
  resolveCodexWebSearchEnabled,
} from "./agent-runner.js";
import { getSecurityModeStrategy } from "./security-policy.js";

const TMP_DIR = join(tmpdir(), `agent-runner-test-${process.pid}`);

describe("resolveClaudeSecurityOpts", () => {
  it("returns undefined permissionMode and blocks web tools when no env or opts", () => {
    const result = resolveClaudeSecurityOpts(undefined, {});
    expect(result.permissionMode).toBeUndefined();
    expect(result.disallowedTools).toEqual(["WebFetch", "WebSearch"]);
  });

  it("read-only env overrides permissionMode to 'default'", () => {
    const result = resolveClaudeSecurityOpts(
      { permissionMode: "acceptEdits" },
      { DOVEPAW_SECURITY_MODE: "read-only" },
    );
    expect(result.permissionMode).toBe("default");
  });

  it("read-only env returns strategy disallowedTools plus web tools", () => {
    const result = resolveClaudeSecurityOpts(undefined, { DOVEPAW_SECURITY_MODE: "read-only" });
    expect(result.disallowedTools).toEqual([
      ...getSecurityModeStrategy("read-only").disallowedTools,
      "WebFetch",
      "WebSearch",
    ]);
  });

  it("supervised env sets permissionMode to 'acceptEdits'", () => {
    const result = resolveClaudeSecurityOpts(
      { permissionMode: "bypassPermissions" },
      { DOVEPAW_SECURITY_MODE: "supervised" },
    );
    expect(result.permissionMode).toBe("acceptEdits");
  });

  it("autonomous env sets permissionMode to 'bypassPermissions'", () => {
    const result = resolveClaudeSecurityOpts(
      { permissionMode: "default" },
      { DOVEPAW_SECURITY_MODE: "autonomous" },
    );
    expect(result.permissionMode).toBe("bypassPermissions");
  });

  it("merges mode disallowedTools with claudeOpts disallowedTools", () => {
    const result = resolveClaudeSecurityOpts(
      { disallowedTools: ["ExtraToolA"] },
      { DOVEPAW_SECURITY_MODE: "read-only" },
    );
    expect(result.disallowedTools).toEqual([
      ...getSecurityModeStrategy("read-only").disallowedTools,
      "WebFetch",
      "WebSearch",
      "ExtraToolA",
    ]);
  });

  it("returns empty hooks in non-read-only mode", () => {
    const result = resolveClaudeSecurityOpts(undefined, { DOVEPAW_SECURITY_MODE: "supervised" });
    expect(result.hooks).toEqual({});
  });

  it("returns a PreToolUse Bash hook in read-only mode", () => {
    const result = resolveClaudeSecurityOpts(undefined, { DOVEPAW_SECURITY_MODE: "read-only" });
    expect(result.hooks.PreToolUse).toHaveLength(1);
    expect(result.hooks.PreToolUse?.[0].matcher).toBe("Bash");
  });

  it("hook denies Bash write redirect", async () => {
    const result = resolveClaudeSecurityOpts(undefined, { DOVEPAW_SECURITY_MODE: "read-only" });
    const cb = result.hooks.PreToolUse?.[0].hooks[0];
    const outcome = await cb?.(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "cat /etc/passwd > /tmp/out.txt" },
      } as unknown as Parameters<NonNullable<typeof cb>>[0],
      undefined,
      { signal: new AbortController().signal },
    );
    expect(
      (outcome as unknown as { hookSpecificOutput?: { permissionDecision?: string } })
        .hookSpecificOutput?.permissionDecision,
    ).toBe("deny");
  });

  it("disallows WebFetch and WebSearch when DOVEPAW_ALLOW_WEB_TOOLS is absent", () => {
    const result = resolveClaudeSecurityOpts(undefined, {});
    expect(result.disallowedTools).toContain("WebFetch");
    expect(result.disallowedTools).toContain("WebSearch");
  });

  it("disallows WebFetch and WebSearch when DOVEPAW_ALLOW_WEB_TOOLS is '0'", () => {
    const result = resolveClaudeSecurityOpts(undefined, { DOVEPAW_ALLOW_WEB_TOOLS: "0" });
    expect(result.disallowedTools).toContain("WebFetch");
    expect(result.disallowedTools).toContain("WebSearch");
  });

  it("allows WebFetch and WebSearch when DOVEPAW_ALLOW_WEB_TOOLS is '1'", () => {
    const result = resolveClaudeSecurityOpts(undefined, { DOVEPAW_ALLOW_WEB_TOOLS: "1" });
    expect(result.disallowedTools).not.toContain("WebFetch");
    expect(result.disallowedTools).not.toContain("WebSearch");
  });

  it("hook allows Bash read-only command", async () => {
    const result = resolveClaudeSecurityOpts(undefined, { DOVEPAW_SECURITY_MODE: "read-only" });
    const cb = result.hooks.PreToolUse?.[0].hooks[0];
    const outcome = await cb?.(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "cat /etc/passwd" },
      } as unknown as Parameters<NonNullable<typeof cb>>[0],
      undefined,
      { signal: new AbortController().signal },
    );
    expect((outcome as unknown as { continue?: boolean }).continue).toBe(true);
  });
});

describe("resolveCodexSandboxMode", () => {
  it("returns undefined when no env or opts", () => {
    expect(resolveCodexSandboxMode(undefined, {})).toBeUndefined();
  });

  it("read-only env forces sandboxMode to 'read-only'", () => {
    expect(
      resolveCodexSandboxMode(
        { sandboxMode: "workspace-write" },
        { DOVEPAW_SECURITY_MODE: "read-only" },
      ),
    ).toBe("read-only");
  });

  it("non-read-only env keeps caller sandboxMode", () => {
    expect(
      resolveCodexSandboxMode(
        { sandboxMode: "workspace-write" },
        { DOVEPAW_SECURITY_MODE: "supervised" },
      ),
    ).toBe("workspace-write");
  });
});

describe("resolveCodexWebSearchEnabled", () => {
  it("returns false when DOVEPAW_ALLOW_WEB_TOOLS is absent and no codexOpts", () => {
    expect(resolveCodexWebSearchEnabled(undefined, {})).toBe(false);
  });

  it("returns false when DOVEPAW_ALLOW_WEB_TOOLS is '0'", () => {
    expect(resolveCodexWebSearchEnabled(undefined, { DOVEPAW_ALLOW_WEB_TOOLS: "0" })).toBe(false);
  });

  it("returns true when DOVEPAW_ALLOW_WEB_TOOLS is '1'", () => {
    expect(resolveCodexWebSearchEnabled(undefined, { DOVEPAW_ALLOW_WEB_TOOLS: "1" })).toBe(true);
  });

  it("returns true from codexOpts.webSearchEnabled when env var absent", () => {
    expect(resolveCodexWebSearchEnabled({ webSearchEnabled: true }, {})).toBe(true);
  });

  it("env var takes precedence over codexOpts.webSearchEnabled false", () => {
    expect(
      resolveCodexWebSearchEnabled({ webSearchEnabled: false }, { DOVEPAW_ALLOW_WEB_TOOLS: "1" }),
    ).toBe(true);
  });
});

describe("resolveCodexApprovalPolicy", () => {
  it("returns 'never' when no env", () => {
    expect(resolveCodexApprovalPolicy({})).toBe("never");
  });

  it("returns 'on-request' in read-only mode", () => {
    expect(resolveCodexApprovalPolicy({ DOVEPAW_SECURITY_MODE: "read-only" })).toBe("on-request");
  });

  it("returns 'on-request' in supervised mode", () => {
    expect(resolveCodexApprovalPolicy({ DOVEPAW_SECURITY_MODE: "supervised" })).toBe("on-request");
  });

  it("returns 'never' in autonomous mode", () => {
    expect(resolveCodexApprovalPolicy({ DOVEPAW_SECURITY_MODE: "autonomous" })).toBe("never");
  });
});

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
