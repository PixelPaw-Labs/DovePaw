import { describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn(), tool: vi.fn() }));

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

vi.mock("@/lib/memory", () => ({
  getMemoryProvider: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { buildSubAgentPrompt, buildAllowedTools } from "@/lib/sub-agent";
import { HANDOFF_HOOK_TRUST } from "@@/lib/agent-link-patterns";
import type { AgentDef } from "@@/lib/agents";
import { scheduler } from "@@/lib/scheduler";

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

  it("includes the handoff hook trust statement so the links reminder is not read as prompt injection", () => {
    const prompt = buildSubAgentPrompt(AGENT);
    expect(prompt).toContain(HANDOFF_HOOK_TRUST);
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

// ─── buildAllowedTools ────────────────────────────────────────────────────────

/**
 * Invariant: start_script_* must always appear in allowedTools regardless of
 * whether the sub-agent is in ask mode. Previously it was gated behind !isAskMode,
 * which incorrectly excluded it during ask-mode invocations.
 */
describe("buildAllowedTools", () => {
  const MANIFEST_KEY = "my_agent";
  const START_TOOL = `mcp__agents__start_script_${MANIFEST_KEY}`;
  const AWAIT_TOOL = `mcp__agents__await_script_${MANIFEST_KEY}`;

  it("includes start_script tool in ask mode", () => {
    const tools = buildAllowedTools(MANIFEST_KEY, true, null);
    expect(tools).toContain(START_TOOL);
  });

  it("includes start_script tool in non-ask mode", () => {
    const tools = buildAllowedTools(MANIFEST_KEY, false, null);
    expect(tools).toContain(START_TOOL);
  });

  it("always includes await_script tool", () => {
    expect(buildAllowedTools(MANIFEST_KEY, true, null)).toContain(AWAIT_TOOL);
    expect(buildAllowedTools(MANIFEST_KEY, false, null)).toContain(AWAIT_TOOL);
  });

  it("includes linked agent tools only in non-ask mode", () => {
    const linked = [{ name: "linked_agent_tool" }];
    const askMode = buildAllowedTools(MANIFEST_KEY, true, linked);
    const nonAskMode = buildAllowedTools(MANIFEST_KEY, false, linked);

    expect(askMode).not.toContain("mcp__agents__linked_agent_tool");
    expect(nonAskMode).toContain("mcp__agents__linked_agent_tool");
  });
});
