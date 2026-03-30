import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ tool: vi.fn() }));

vi.mock("@/lib/launchd", () => ({
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
  plistFilePath: (l: string) => `/mock/plists/${l}.plist`,
}));

vi.mock("@/a2a/lib/spawn", () => ({
  startScript: vi.fn(),
  awaitScript: vi.fn(),
}));

vi.mock("@/a2a/lib/workspace", () => ({
  recloneReposIntoWorkspace: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  buildSubAgentPrompt,
  makeStartScriptTool,
  START_SCRIPT_TOOL,
  AWAIT_SCRIPT_TOOL,
} from "@/lib/agent-tools";
import type { AgentDef } from "@@/lib/agents";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { startScript } from "@/a2a/lib/spawn";
import { recloneReposIntoWorkspace } from "@/a2a/lib/workspace";
import type { AgentConfig } from "@/a2a/lib/spawn";

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
  requiredEnvVars: ["TEST_VAR"],
  scheduleDisplay: "daily 00:00",
  icon: {} as any,
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
): (args: { instruction?: string }) => Promise<unknown> {
  vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
  return makeStartScriptTool(agentWithRepos, config, slugs, signal) as any;
}

// ─── buildSubAgentPrompt ──────────────────────────────────────────────────────

describe("buildSubAgentPrompt", () => {
  it("opens with the Dove's mice character", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toMatch(/one of Dove's mice/i);
    expect(prompt).toMatch(/Dove, the orchestrator/i);
  });

  it("includes the agent display name as assigned role", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain("Test Agent");
  });

  it("includes the agent description", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain(AGENT.description);
  });

  it("defaults to calling START_SCRIPT_TOOL — does not tell agent to ask the user to clarify", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).not.toMatch(/ask the user to clarify/i);
    expect(prompt).toContain(START_SCRIPT_TOOL);
  });

  it("preserves the two-step run instructions referencing AWAIT_SCRIPT_TOOL", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain(START_SCRIPT_TOOL);
    expect(prompt).toContain(AWAIT_SCRIPT_TOOL);
  });

  it("includes the agent label in the launchd section", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain(AGENT.label);
  });

  it("includes required env vars", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain("TEST_VAR");
  });

  it("shows 'none' when no required env vars", () => {
    const agentNoVars: AgentDef = { ...AGENT, requiredEnvVars: [] };
    const prompt = buildSubAgentPrompt(agentNoVars);
    expect(prompt).toMatch(/required:.*none/i);
  });
});

// ─── makeStartScriptTool ──────────────────────────────────────────────────────

describe("makeStartScriptTool", () => {
  const AGENT_WITH_REPOS: AgentDef = { ...AGENT, reposEnvVar: "REPOS" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(startScript).mockReturnValue({ runId: "run-abc" } as any);
  });

  it("reclones repos into workspace before starting the script", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue(["/ws/ta-abc123/my-app"]);
    const handler = captureToolHandler(AGENT_WITH_REPOS, BASE_CONFIG, ["org/my-app"]);

    await handler({});

    expect(recloneReposIntoWorkspace).toHaveBeenCalledWith("/ws/ta-abc123", ["org/my-app"]);
  });

  it("remaps reposEnvVar to cloned local paths in extraEnv passed to startScript", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue(["/ws/ta-abc123/my-app"]);
    const config = { ...BASE_CONFIG, extraEnv: { REPOS: "org/my-app", OTHER: "keep" } };
    const handler = captureToolHandler(AGENT_WITH_REPOS, config, ["org/my-app"]);

    await handler({ instruction: "go" });

    expect(startScript).toHaveBeenCalledWith(
      expect.objectContaining({
        extraEnv: { REPOS: "/ws/ta-abc123/my-app", OTHER: "keep" },
      }),
      "go",
      undefined,
    );
  });

  it("does not remap reposEnvVar when repoSlugs is empty", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue([]);
    const config = { ...BASE_CONFIG, extraEnv: { OTHER: "keep" } };
    const handler = captureToolHandler(AGENT, config, []);

    await handler({});

    expect(startScript).toHaveBeenCalledWith(
      expect.objectContaining({ extraEnv: { OTHER: "keep" } }),
      "",
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
});
