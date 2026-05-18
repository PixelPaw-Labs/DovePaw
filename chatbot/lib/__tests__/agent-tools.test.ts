import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ tool: vi.fn() }));

vi.mock("@/lib/agent-scheduler", () => ({
  installAgent: vi.fn(),
  uninstallAgent: vi.fn(),
  loadAgent: vi.fn(),
  unloadAgent: vi.fn(),
  isLoaded: vi.fn(),
  getAgentStatus: vi.fn(),
  getAgentLogs: vi.fn(),
}));

vi.mock("@/a2a/lib/processing-registry", () => ({ cancelProcessing: vi.fn() }));

vi.mock("@/lib/paths", () => ({
  agentEntryPath: (p: string) => `/mock/agents/${p}`,
  agentPersistentLogDir: (n: string) => `/mock/logs/${n}`,
  agentPersistentStateDir: (n: string) => `/mock/state/${n}`,
}));

vi.mock("@/a2a/lib/spawn", () => ({
  startScript: vi.fn(),
  awaitScript: vi.fn(),
}));

vi.mock("@/a2a/lib/workspace", () => ({
  recloneReposIntoWorkspace: vi.fn(),
}));

// Memory provider is mocked per-test via vi.mocked(getMemoryProvider) below.
vi.mock("@/lib/memory", async () => {
  const actual = await vi.importActual<typeof import("@/lib/memory")>("@/lib/memory");
  const { MarkdownMemoryProvider } =
    await vi.importActual<typeof import("@/lib/memory/markdown")>("@/lib/memory/markdown");
  return {
    ...actual,
    getMemoryProvider: vi.fn(async () => new MarkdownMemoryProvider()),
  };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  buildSubAgentPrompt,
  makeAgentMgmtTools,
  makeStartScriptTool,
  startRunScriptToolName,
  awaitRunScriptToolName,
  MGMT_TOOL,
} from "@/lib/agent-tools";
import { withStartReminder, stripStartReminder } from "@@/lib/subagent-reminder";
import type { AgentDef } from "@@/lib/agents";
import { scheduler } from "@@/lib/scheduler";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { startScript } from "@/a2a/lib/spawn";
import { recloneReposIntoWorkspace } from "@/a2a/lib/workspace";
import type { AgentConfig } from "@/a2a/lib/agent-config-builder";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const AGENT: AgentDef = {
  name: "test-agent",
  alias: "ta",
  entryPath: "agents/test-agent/main.ts",
  displayName: "Test Agent",
  label: "Claude Code Agent - Test Agent",
  manifestKey: "test_agent",
  toolName: "yolo_test_agent",
  description: "A test agent for unit tests",
  icon: {} as any,
  iconBg: "",
  iconColor: "",
  doveCard: {
    icon: {} as any,
    iconBg: "",
    iconColor: "",
    title: "Test Agent",
    description: "",
    prompt: "",
  },
  suggestions: [],
};

const BASE_CONFIG: AgentConfig = {
  scriptPath: "/agents/test-agent/main.ts",
  agentName: "Test Agent",
  whatItDoes: "does test things",
  workspacePath: "/ws/ta-abc123",
  extraEnv: {},
};

/** Make tool() capture and return the handler function for direct invocation in tests. */
function captureToolHandler(
  agentWithRepos: AgentDef,
  config: AgentConfig,
  slugs: string[],
  signal?: AbortSignal,
  onProgress?: (message: string, artifacts: Record<string, string>) => void,
): (args: { instruction?: string }) => Promise<unknown> {
  vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
  return makeStartScriptTool(agentWithRepos, config, slugs, signal, onProgress) as any;
}

// ─── buildSubAgentPrompt ──────────────────────────────────────────────────────

describe("buildSubAgentPrompt", () => {
  it("opens with the Dove's mice character when no personality is set", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toMatch(/one of Dove's mice/i);
    expect(prompt).toMatch(/Dove, the orchestrator/i);
  });

  it("uses the agent personality instead of the mice line when personality is set", () => {
    const withPersonality: AgentDef = {
      ...AGENT,
      personality: "You are a relentless ticket-closer.",
    };
    const prompt = buildSubAgentPrompt(withPersonality);
    expect(prompt).toMatch(/relentless ticket-closer/i);
    expect(prompt).not.toMatch(/one of Dove's mice/i);
  });

  it("includes the agent display name as assigned role", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain("Test Agent");
  });

  it("includes the agent description", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain(AGENT.description);
  });

  it("does not tell the agent to ask the user to clarify", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).not.toMatch(/ask the user to clarify/i);
  });

  it("does not include a <reminder> block (injected per-prompt via UserPromptSubmit hook instead)", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).not.toContain("<reminder>");
  });

  it("includes the agent scheduler label in the managing section", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain(scheduler.agentLabel(AGENT));
  });

  it("mentions schedule for a scheduled agent and omits on-demand language", () => {
    const scheduled: AgentDef = {
      ...AGENT,
      schedule: { type: "calendar", hour: 0, minute: 0 },
      schedulingEnabled: true,
    };
    const prompt = buildSubAgentPrompt(scheduled);
    expect(prompt).toMatch(/runs on a schedule/i);
    expect(prompt).not.toMatch(/on-demand only/i);
  });

  it("shows on-demand guidance for an agent with no schedule", () => {
    const prompt = buildSubAgentPrompt(AGENT); // AGENT has no schedule field
    expect(prompt).toMatch(/on-demand only/i);
    expect(prompt).not.toMatch(/infer intent before acting/i);
    expect(prompt).not.toMatch(/runs on a schedule/i);
  });

  it("shows on-demand guidance when schedulingEnabled is false even if schedule is set", () => {
    const disabled: AgentDef = {
      ...AGENT,
      schedule: { type: "calendar", hour: 0, minute: 0 },
      schedulingEnabled: false,
    };
    const prompt = buildSubAgentPrompt(disabled);
    expect(prompt).toMatch(/on-demand only/i);
    expect(prompt).not.toMatch(/infer intent before acting/i);
  });
});

// ─── makeStartScriptTool ──────────────────────────────────────────────────────

describe("makeStartScriptTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(startScript).mockReturnValue({ runId: "run-abc" } as any);
  });

  it("reclones repos into workspace before starting the script", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue(["/ws/ta-abc123/my-app"]);
    const handler = captureToolHandler(AGENT, BASE_CONFIG, ["org/my-app"]);

    await handler({});

    expect(recloneReposIntoWorkspace).toHaveBeenCalledWith(
      "/ws/ta-abc123",
      ["org/my-app"],
      undefined,
      undefined, // no onProgress → no clone callback
    );
  });

  it("passes config unchanged to startScript", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue([]);
    const config = { ...BASE_CONFIG, extraEnv: { OTHER: "keep" } };
    const handler = captureToolHandler(AGENT, config, []);

    await handler({});

    expect(startScript).toHaveBeenCalledWith(
      expect.objectContaining({ extraEnv: { OTHER: "keep" } }),
      "",
      undefined,
      undefined,
    );
  });

  it("returns the runId from startScript", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue([]);
    vi.mocked(startScript).mockReturnValue({ runId: "run-xyz" } as any);
    const handler = captureToolHandler(AGENT, BASE_CONFIG, []);

    const result = await handler({});

    expect(result).toMatchObject({ structuredContent: { runId: "run-xyz" } });
  });

  it("passes onProgress as clone callback but not to startScript", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue([]);
    const onProgress = vi.fn();
    const handler = captureToolHandler(AGENT, BASE_CONFIG, [], undefined, onProgress);

    await handler({});

    // startScript no longer receives onProgress — scripts POST progress via HTTP
    expect(startScript).toHaveBeenCalledWith(expect.anything(), "", undefined, undefined);
  });

  it("wraps onProgress as a clone callback that prefixes the slug", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue(["/ws/ta-abc123/my-app"]);
    const onProgress = vi.fn();
    const handler = captureToolHandler(AGENT, BASE_CONFIG, ["org/my-app"], undefined, onProgress);

    await handler({});

    // The 4th arg to recloneReposIntoWorkspace should be a callback that calls onProgress
    const cloneCallback = vi.mocked(recloneReposIntoWorkspace).mock.calls[0][3] as (
      slug: string,
    ) => void;
    cloneCallback("org/my-app");
    expect(onProgress).toHaveBeenCalledWith("Cloning", { repo: "org/my-app" });
  });

  it("passes undefined clone callback to recloneReposIntoWorkspace when no onProgress", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue([]);
    const handler = captureToolHandler(AGENT, BASE_CONFIG, []);

    await handler({});

    expect(recloneReposIntoWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      undefined,
    );
  });

  it("routes group-chat reminder via extraEnv.DOVE_MEMORY_REMINDER and keeps instruction clean", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue([]);
    const { getMemoryProvider } = await import("@/lib/memory");
    const { OpenVikingMemoryProvider } = await import("@/lib/memory/openviking");
    vi.mocked(getMemoryProvider).mockResolvedValue(new OpenVikingMemoryProvider(51234));
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    const handler = makeStartScriptTool(
      AGENT,
      BASE_CONFIG,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      { groupContextId: "grp-xyz-123", groupMomentsPath: "/ws/ta-abc123" },
    ) as any;

    await handler({ instruction: "do work" });

    const passedInstruction = vi.mocked(startScript).mock.calls[0][1];
    const passedConfig = vi.mocked(startScript).mock.calls[0][0];
    expect(passedInstruction).toBe("do work");
    expect(passedInstruction).not.toContain("<reminder>");
    const reminder = passedConfig.extraEnv?.DOVE_MEMORY_REMINDER;
    expect(reminder).toBeDefined();
    expect(reminder).toContain("/ws/ta-abc123/members/roster.md");
    expect(reminder).toContain("/api/v1/search/find");
    expect(reminder).not.toContain("/api/v1/sessions");
    expect(reminder).toContain("X-OpenViking-Agent: grp-xyz-123");
    expect(reminder).not.toContain("ov find");
    expect(reminder).not.toContain("ov add-memory");
    expect(reminder).not.toContain("ov add-resource");
    expect(reminder).not.toContain("All substance stays. Only fluff dies.");
  });

  it("falls back to .md moments reminder when MarkdownMemoryProvider is active", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue([]);
    const { getMemoryProvider } = await import("@/lib/memory");
    const { MarkdownMemoryProvider } = await import("@/lib/memory/markdown");
    vi.mocked(getMemoryProvider).mockResolvedValue(new MarkdownMemoryProvider());
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    const handler = makeStartScriptTool(
      AGENT,
      BASE_CONFIG,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      { groupContextId: "grp-xyz-123", groupMomentsPath: "/ws/ta-abc123" },
    ) as any;

    await handler({ instruction: "do work" });

    const passedInstruction = vi.mocked(startScript).mock.calls[0][1];
    const passedConfig = vi.mocked(startScript).mock.calls[0][0];
    expect(passedInstruction).toBe("do work");
    expect(passedInstruction).not.toContain("<reminder>");
    const reminder = passedConfig.extraEnv?.DOVE_MEMORY_REMINDER;
    expect(reminder).toBeDefined();
    expect(reminder).toContain("/ws/ta-abc123/members/roster.md");
    expect(reminder).toContain("/ws/ta-abc123/moments/");
    expect(reminder).not.toContain("ov find");
    expect(reminder).not.toContain("ov add-resource");
    expect(reminder).not.toContain("All substance stays. Only fluff dies.");
  });

  it("does not set DOVE_MEMORY_REMINDER when groupChat is absent", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue([]);
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    const handler = makeStartScriptTool(AGENT, BASE_CONFIG, []) as any;

    await handler({ instruction: "do work" });

    const passedConfig = vi.mocked(startScript).mock.calls[0][0];
    expect(passedConfig.extraEnv?.DOVE_MEMORY_REMINDER).toBeUndefined();
  });
});

// ─── Tool name helpers ────────────────────────────────────────────────────────

describe("tool name helpers", () => {
  it("startRunScriptToolName", () => {
    expect(startRunScriptToolName("fixer")).toBe("start_fixer");
  });

  it("awaitRunScriptToolName", () => {
    expect(awaitRunScriptToolName("fixer")).toBe("await_script_fixer");
  });

  it("withStartReminder appends reminder suffix", () => {
    expect(withStartReminder("do the thing", "fixer")).toBe(
      'do the thing\n<reminder>Must call "start_fixer" tool</reminder>',
    );
  });

  it("stripStartReminder removes the reminder suffix added by withStartReminder", () => {
    const wrapped = withStartReminder("do the thing", "fixer");
    expect(stripStartReminder(wrapped)).toBe("do the thing");
  });

  it("stripStartReminder strips reminders for any manifest key and leaves surrounding content intact", () => {
    const instruction =
      '{"assignee": "dev@example.com", "outPath": "/tmp/discovery.json"}\n<reminder>Must call "start_my_agent" tool</reminder>';
    expect(stripStartReminder(instruction)).toBe(
      '{"assignee": "dev@example.com", "outPath": "/tmp/discovery.json"}',
    );
  });

  it("stripStartReminder is a no-op when no start reminder is present", () => {
    expect(stripStartReminder("plain instruction")).toBe("plain instruction");
  });
});

// ─── makeAgentMgmtTools ───────────────────────────────────────────────────────

import { installAgent } from "@/lib/agent-scheduler";

describe("makeAgentMgmtTools install tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns skipped message when agent has schedulingEnabled: false", async () => {
    vi.mocked(installAgent).mockResolvedValue({ loaded: false, skipped: true } as any);

    let installHandler: ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
    vi.mocked(tool).mockImplementation((name, _d, _s, handler) => {
      if (name === MGMT_TOOL.install) installHandler = handler as any;
      return handler as any;
    });

    makeAgentMgmtTools({ ...AGENT, schedulingEnabled: false });
    const result = (await installHandler!({})) as any;
    expect(result.content[0].text).toMatch(/✅.*not scheduling-enabled/i);
  });
});
