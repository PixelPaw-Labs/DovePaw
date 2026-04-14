/**
 * Tests that the chat POST route merges global settings env vars into the env
 * object passed to query(), in addition to process.env.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@@/lib/settings", () => ({
  readSettings: vi.fn(),
}));

vi.mock("@/lib/env-resolver", () => ({
  resolveSettingsEnv: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/query-events", () => ({
  withMcpQuery: vi.fn(async (_tools: unknown, cb: (server: unknown) => Promise<void>) => cb({})),
  consumeQueryEvents: vi.fn(),
}));

vi.mock("@/lib/query-dispatcher", () => {
  const SseQueryDispatcher = vi.fn(function () {
    return {
      onSession: vi.fn(),
      buildProgress: vi.fn(() => []),
      buildAssistantMessage: vi.fn(() => ({
        id: "mock-id",
        role: "assistant",
        segments: [],
      })),
    };
  });
  return { SseQueryDispatcher };
});

vi.mock("@/lib/query-tools", () => ({
  makeAskTool: vi.fn(() => ({})),
  makeStartTool: vi.fn(() => ({})),
  makeAwaitTool: vi.fn(() => ({})),
  doveAskToolName: vi.fn(() => "ask"),
  doveStartToolName: vi.fn(() => "start"),
  doveAwaitToolName: vi.fn(() => "await"),
}));

vi.mock("@/lib/hooks", () => ({
  buildDoveHooks: vi.fn(() => ({})),
  buildDoveCanUseTool: vi.fn(() => ({ canUseTool: vi.fn(), abortPermissions: vi.fn() })),
}));

vi.mock("@@/lib/agents", () => ({
  AGENTS: [{ name: "test-agent", displayName: "Test Agent" }],
}));

vi.mock("@@/lib/agents-config", () => ({
  readAgentsConfig: vi.fn(() => [
    { name: "test-agent", displayName: "Test Agent", manifestKey: "test_agent" },
  ]),
}));

vi.mock("@@/lib/paths", () => ({
  LAUNCH_AGENTS_DIR: "/mock/launch",
  DOVEPAW_DIR: "/mock/dovepaw",
}));

vi.mock("@/lib/paths", () => ({
  AGENTS_ROOT: "/mock/agents",
  SCHEDULER_ROOT: "/mock/scheduler",
  DOVEPAW_AGENT_LOGS: "/mock/logs",
  DOVEPAW_AGENT_STATE: "/mock/state",
  PORTS_FILE: "/mock/.ports.json",
  AGENT_SETTINGS_DIR: "/mock/agent-settings",
}));

vi.mock("@/lib/db", () => ({
  closeStaleSessions: vi.fn(),
  setSessionStatus: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock("@/lib/session-events", () => ({
  publishSessionEvent: vi.fn(),
  clearSessionBuffer: vi.fn(),
}));

vi.mock("@/lib/session-runner", () => ({
  sessionRunner: {
    register: vi.fn(),
    abort: vi.fn(),
    complete: vi.fn(),
    abortAll: vi.fn(),
  },
}));

import { readSettings } from "@@/lib/settings";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { POST } from "../chat/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: object) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function drainStream(response: Response) {
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const MOCK_SETTINGS = { version: 1 as const, repositories: [], envVars: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSettings).mockResolvedValue(MOCK_SETTINGS);
  vi.mocked(resolveSettingsEnv).mockReturnValue({});
  vi.mocked(query).mockReturnValue(
    (async function* () {})() as unknown as ReturnType<typeof query>,
  );
});

describe("POST /api/chat — settings env var wiring", () => {
  it("calls resolveSettingsEnv with global settings and no agent args", async () => {
    const response = await POST(makeRequest({ message: "hello", sessionId: null }));
    await drainStream(response);

    expect(readSettings).toHaveBeenCalledOnce();
    expect(resolveSettingsEnv).toHaveBeenCalledWith(MOCK_SETTINGS);
  });

  it("merges settings env vars into query env after process.env", async () => {
    vi.mocked(resolveSettingsEnv).mockReturnValue({ JIRA_SERVER: "https://example.atlassian.net" });

    const response = await POST(makeRequest({ message: "hello", sessionId: null }));
    await drainStream(response);

    const callArg = vi.mocked(query).mock.calls[0][0];
    expect(callArg.options?.env).toMatchObject({ JIRA_SERVER: "https://example.atlassian.net" });
  });

  it("settings env vars override process.env values", async () => {
    const original = process.env["OVERRIDDEN_KEY"];
    process.env["OVERRIDDEN_KEY"] = "from-process";
    vi.mocked(resolveSettingsEnv).mockReturnValue({ OVERRIDDEN_KEY: "from-settings" });

    const response = await POST(makeRequest({ message: "hello", sessionId: null }));
    await drainStream(response);

    const callArg = vi.mocked(query).mock.calls[0][0];
    expect(callArg.options?.env?.["OVERRIDDEN_KEY"]).toBe("from-settings");

    if (original === undefined) delete process.env["OVERRIDDEN_KEY"];
    else process.env["OVERRIDDEN_KEY"] = original;
  });

  it("passes process.env vars not overridden by settings", async () => {
    const original = process.env["PROCESS_ONLY_KEY"];
    process.env["PROCESS_ONLY_KEY"] = "from-process";
    vi.mocked(resolveSettingsEnv).mockReturnValue({});

    const response = await POST(makeRequest({ message: "hello", sessionId: null }));
    await drainStream(response);

    const callArg = vi.mocked(query).mock.calls[0][0];
    expect(callArg.options?.env?.["PROCESS_ONLY_KEY"]).toBe("from-process");

    if (original === undefined) delete process.env["PROCESS_ONLY_KEY"];
    else process.env["PROCESS_ONLY_KEY"] = original;
  });
});
