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
  scheduleDisplay: "daily 00:00",
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

  it("passes onProgress to startScript when provided", async () => {
    vi.mocked(recloneReposIntoWorkspace).mockResolvedValue([]);
    const onProgress = vi.fn();
    const handler = captureToolHandler(AGENT, BASE_CONFIG, [], undefined, onProgress);

    await handler({});

    expect(startScript).toHaveBeenCalledWith(expect.anything(), "", undefined, onProgress);
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
});
