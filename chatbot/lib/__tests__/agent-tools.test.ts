import { describe, expect, it } from "vitest";

// ─── Module mocks (must come before imports) ──────────────────────────────────

import { vi } from "vitest";

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

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { buildSubAgentPrompt, START_SCRIPT_TOOL, AWAIT_SCRIPT_TOOL } from "@/lib/agent-tools";
import type { AgentDef } from "@@/lib/agents";

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
