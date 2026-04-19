import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ tool: vi.fn() }));

vi.mock("@/lib/a2a-client", () => ({
  resolveAgentPort: vi.fn(),
  startAgentStream: vi.fn(),
  collectStreamResult: vi.fn(),
  collectAgentStreamContext: vi.fn(),
  formatAgentStreamContext: vi.fn(),
  createAgentClient: vi.fn(),
  subscribeTaskStream: vi.fn(),
}));

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
  makeStartChatToTool,
  makeReviewTool,
  makeEscalateTool,
  startRunScriptToolName,
  awaitRunScriptToolName,
  startChatToToolName,
  awaitChatToToolName,
  reviewWithToolName,
  escalateToToolName,
} from "@/lib/agent-tools";
import type { CollectedStream } from "@/lib/a2a-client";
import {
  resolveAgentPort,
  startAgentStream,
  collectStreamResult,
  formatAgentStreamContext,
} from "@/lib/a2a-client";
import type { AgentDef } from "@@/lib/agents";
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

  it("defaults to calling the start_run_script tool — does not tell agent to ask the user to clarify", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).not.toMatch(/ask the user to clarify/i);
    expect(prompt).toContain(startRunScriptToolName(AGENT.manifestKey));
  });

  it("does not include a <reminder> block (injected per-prompt via UserPromptSubmit hook instead)", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).not.toContain("<reminder>");
  });

  it("includes the agent label in the launchd section", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain(AGENT.label);
  });

  it("shows infer-intent guidance for a scheduled agent", () => {
    const scheduled: AgentDef = {
      ...AGENT,
      schedule: { type: "calendar", hour: 0, minute: 0 },
      schedulingEnabled: true,
    };
    const prompt = buildSubAgentPrompt(scheduled);
    expect(prompt).toMatch(/infer intent before acting/i);
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

    expect(startScript).toHaveBeenCalledWith(
      expect.anything(),
      "",
      undefined,
      onProgress,
      undefined,
    );
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

// ─── makeStartChatToTool ──────────────────────────────────────────────────────

describe("makeStartChatToTool", () => {
  async function* mockStream() {
    /* empty stream */
  }

  function captureStartChatToHandler(backgroundTasks?: Promise<CollectedStream>[]) {
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    return makeStartChatToTool(AGENT, undefined, backgroundTasks) as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAgentPort).mockReturnValue(9999);
    vi.mocked(startAgentStream).mockResolvedValue({
      taskId: "task-123",
      contextId: "ctx-456",
      stream: mockStream(),
      client: {} as any,
    });
    vi.mocked(collectStreamResult).mockResolvedValue({
      taskId: "task-123",
      result: { output: "", progress: [], thinking: "", toolCalls: [] },
    });
  });

  it("uses startAgentStream — not sendMessage", async () => {
    const handler = captureStartChatToHandler();
    await handler({ instruction: "do something" });
    expect(startAgentStream).toHaveBeenCalledWith(
      9999,
      'do something\n<reminder>Must call "start_test_agent" tool</reminder>',
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("returns taskId and contextId from the stream handle", async () => {
    const handler = captureStartChatToHandler();
    const result = (await handler({ instruction: "do something" })) as any;
    expect(result.structuredContent).toEqual({
      taskId: "task-123",
      contextId: "ctx-456",
      manifestKey: "test_agent",
    });
  });

  it("drains stream via collectStreamResult in background", async () => {
    const handler = captureStartChatToHandler();
    await handler({ instruction: "do something" });
    expect(collectStreamResult).toHaveBeenCalled();
  });

  it("pushes drain task into backgroundTasks when provided", async () => {
    const backgroundTasks: Promise<CollectedStream>[] = [];
    const handler = captureStartChatToHandler(backgroundTasks);
    await handler({ instruction: "do something" });
    expect(backgroundTasks).toHaveLength(1);
  });

  it("returns error when agent port not found", async () => {
    vi.mocked(resolveAgentPort).mockReturnValue(null);
    const handler = captureStartChatToHandler();
    const result = (await handler({ instruction: "do something" })) as any;
    expect(result.content[0].text).toContain("A2A servers are not running");
    expect(startAgentStream).not.toHaveBeenCalled();
  });

  it("returns error when startAgentStream returns null", async () => {
    vi.mocked(startAgentStream).mockResolvedValue(null);
    const handler = captureStartChatToHandler();
    const result = (await handler({ instruction: "do something" })) as any;
    expect(result.content[0].text).toContain("task ID not received");
  });

  it("passes contextId to startAgentStream when provided", async () => {
    const handler = captureStartChatToHandler();
    await handler({ instruction: "resume", contextId: "existing-ctx" });
    expect(startAgentStream).toHaveBeenCalledWith(
      9999,
      'resume\n<reminder>Must call "start_test_agent" tool</reminder>',
      undefined,
      "existing-ctx",
      undefined,
      undefined,
    );
  });
});

// ─── Tool name helpers ────────────────────────────────────────────────────────

describe("tool name helpers", () => {
  it("startRunScriptToolName", () => {
    expect(startRunScriptToolName("fixer")).toBe("start_fixer");
  });

  it("awaitRunScriptToolName", () => {
    expect(awaitRunScriptToolName("fixer")).toBe("await_fixer");
  });

  it("startChatToToolName", () => {
    expect(startChatToToolName("fixer")).toBe("start_chat_to_fixer");
  });

  it("awaitChatToToolName", () => {
    expect(awaitChatToToolName("fixer")).toBe("await_chat_to_fixer");
  });

  it("reviewWithToolName", () => {
    expect(reviewWithToolName("reviewer")).toBe("review_with_reviewer");
  });

  it("escalateToToolName", () => {
    expect(escalateToToolName("supervisor")).toBe("escalate_to_supervisor");
  });
});

// ─── makeStartChatToTool — groupMeta propagation ──────────────────────────────

describe("makeStartChatToTool — groupMeta", () => {
  async function* mockStream() {
    /* empty stream */
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAgentPort).mockReturnValue(9999);
    vi.mocked(startAgentStream).mockResolvedValue({
      taskId: "task-123",
      contextId: "ctx-456",
      stream: mockStream(),
      client: {} as any,
    });
    vi.mocked(collectStreamResult).mockResolvedValue({
      taskId: "task-123",
      result: { output: "", progress: [], thinking: "", toolCalls: [] },
    });
  });

  it("forwards groupMeta as extraMetadata when provided", async () => {
    const groupMeta = { isGroupChat: true, groupContextId: "gc-1", groupWorkspacePath: "/ws" };
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    const handler = makeStartChatToTool(
      AGENT,
      undefined,
      undefined,
      undefined,
      undefined,
      groupMeta,
    ) as any;
    await handler({ instruction: "do something" });
    expect(startAgentStream).toHaveBeenCalledWith(
      9999,
      expect.any(String),
      undefined,
      undefined,
      undefined,
      groupMeta,
    );
  });

  it("passes undefined extraMetadata when groupMeta is not provided", async () => {
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    const handler = makeStartChatToTool(AGENT) as any;
    await handler({ instruction: "do something" });
    expect(startAgentStream).toHaveBeenCalledWith(
      9999,
      expect.any(String),
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });
});

// ─── makeReviewTool ───────────────────────────────────────────────────────────

describe("makeReviewTool", () => {
  async function* mockStream() {
    /* empty stream */
  }

  function captureReviewHandler() {
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    return makeReviewTool(AGENT) as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAgentPort).mockReturnValue(9999);
    vi.mocked(formatAgentStreamContext).mockReturnValue("context output");
    vi.mocked(startAgentStream).mockResolvedValue({
      taskId: "task-123",
      contextId: "ctx-456",
      stream: mockStream(),
      client: {} as any,
    });
  });

  it("returns APPROVED when reviewer JSON says APPROVED", async () => {
    vi.mocked(collectStreamResult).mockResolvedValue({
      taskId: "task-123",
      result: {
        output: '{"decision":"APPROVED","reason":"looks good"}\nFull feedback here.',
        progress: [],
        thinking: "",
        toolCalls: [],
      },
    });
    const handler = captureReviewHandler();
    const result = (await handler({ content: "my work" })) as any;
    expect(result.structuredContent.decision).toBe("APPROVED");
    expect(result.structuredContent.reason).toBe("looks good");
    expect(result.content[0].text).toContain("APPROVED");
    expect(result.content[0].text).toContain("looks good");
  });

  it("returns REJECTED when reviewer JSON says REJECTED", async () => {
    vi.mocked(collectStreamResult).mockResolvedValue({
      taskId: "task-123",
      result: {
        output: '{"decision":"REJECTED","reason":"missing tests"}\nFeedback.',
        progress: [],
        thinking: "",
        toolCalls: [],
      },
    });
    const handler = captureReviewHandler();
    const result = (await handler({ content: "my work" })) as any;
    expect(result.structuredContent.decision).toBe("REJECTED");
    expect(result.structuredContent.reason).toBe("missing tests");
  });

  it("returns NO_DECISION when output has no JSON", async () => {
    vi.mocked(collectStreamResult).mockResolvedValue({
      taskId: "task-123",
      result: {
        output: "I think it looks fine actually.",
        progress: [],
        thinking: "",
        toolCalls: [],
      },
    });
    const handler = captureReviewHandler();
    const result = (await handler({ content: "my work" })) as any;
    expect(result.structuredContent.decision).toBe("NO_DECISION");
    expect(result.structuredContent.reason).toBeUndefined();
  });

  it("returns NO_DECISION when JSON is malformed", async () => {
    vi.mocked(collectStreamResult).mockResolvedValue({
      taskId: "task-123",
      result: {
        output: '{"decision":APPROVED}\nFeedback.',
        progress: [],
        thinking: "",
        toolCalls: [],
      },
    });
    const handler = captureReviewHandler();
    const result = (await handler({ content: "my work" })) as any;
    expect(result.structuredContent.decision).toBe("NO_DECISION");
  });

  it("returns error when agent port is not found", async () => {
    vi.mocked(resolveAgentPort).mockReturnValue(null);
    const handler = captureReviewHandler();
    const result = (await handler({ content: "my work" })) as any;
    expect(result.content[0].text).toContain("not reachable");
    expect(startAgentStream).not.toHaveBeenCalled();
  });

  it("returns error when startAgentStream returns null", async () => {
    vi.mocked(startAgentStream).mockResolvedValue(null);
    const handler = captureReviewHandler();
    const result = (await handler({ content: "my work" })) as any;
    expect(result.content[0].text).toContain("did not start");
  });

  it("forwards groupMeta as extraMetadata when provided", async () => {
    const groupMeta = { isGroupChat: true, groupContextId: "gc-1", groupWorkspacePath: "/ws" };
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    const handler = makeReviewTool(AGENT, undefined, undefined, groupMeta) as any;
    await handler({ content: "my work" });
    expect(startAgentStream).toHaveBeenCalledWith(
      9999,
      expect.any(String),
      undefined,
      undefined,
      undefined,
      groupMeta,
    );
  });
});

// ─── makeEscalateTool — groupMeta propagation ─────────────────────────────────

describe("makeEscalateTool — groupMeta", () => {
  async function* mockStream() {
    /* empty stream */
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAgentPort).mockReturnValue(9999);
    vi.mocked(startAgentStream).mockResolvedValue({
      taskId: "task-123",
      contextId: "ctx-456",
      stream: mockStream(),
      client: {} as any,
    });
    vi.mocked(collectStreamResult).mockResolvedValue({
      taskId: "task-123",
      result: {
        output: "Guidance: proceed with caution.",
        progress: [],
        thinking: "",
        toolCalls: [],
      },
    });
    vi.mocked(formatAgentStreamContext).mockReturnValue("context output");
  });

  it("forwards groupMeta as extraMetadata when provided", async () => {
    const groupMeta = { isGroupChat: true, groupContextId: "gc-1", groupWorkspacePath: "/ws" };
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    const handler = makeEscalateTool(AGENT, undefined, undefined, groupMeta) as any;
    await handler({ blocker: "stuck", context: "tried X" });
    expect(startAgentStream).toHaveBeenCalledWith(
      9999,
      expect.any(String),
      undefined,
      undefined,
      undefined,
      groupMeta,
    );
  });

  it("passes undefined extraMetadata when groupMeta is not provided", async () => {
    vi.mocked(tool).mockImplementationOnce((_n, _d, _s, handler) => handler as any);
    const handler = makeEscalateTool(AGENT) as any;
    await handler({ blocker: "stuck", context: "tried X" });
    expect(startAgentStream).toHaveBeenCalledWith(
      9999,
      expect.any(String),
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });
});
