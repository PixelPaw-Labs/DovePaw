/**
 * Tests for A2A agent server configuration.
 * Verifies each agent in the shared config has a real script file
 * and documents its required env vars.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AGENTS_ROOT } from "@/lib/paths";
import { readAgentConfigEntries } from "@@/lib/agents-config";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";

vi.mock("express", () => {
  const app = {
    use: vi.fn(),
    listen: vi.fn((_p: unknown, _h: unknown, cb?: () => void) => cb?.()),
  };
  return { default: vi.fn(() => app) };
});
vi.mock("@a2a-js/sdk", () => ({ AGENT_CARD_PATH: ".well-known/agent-card.json" }));
vi.mock("@a2a-js/sdk/server", () => ({
  DefaultRequestHandler: vi.fn(),
  InMemoryTaskStore: vi.fn(),
}));
vi.mock("@a2a-js/sdk/server/express", () => ({
  agentCardHandler: vi.fn(),
  jsonRpcHandler: vi.fn(),
  restHandler: vi.fn(),
  UserBuilder: { noAuthentication: {} },
}));
vi.mock("consola", () => ({
  consola: { start: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { createServerFromDef } from "@/a2a/lib/base-server";

// ─── Tests ────────────────────────────────────────────────────────────────────

let cases: AgentConfigEntry[] = [];

beforeAll(async () => {
  cases = await readAgentConfigEntries();
});

describe("agent script existence", () => {
  it("every agent has a script in its source directory", () => {
    for (const agent of cases) {
      // Plugin agents live in their plugin repo, not in AGENTS_ROOT/agents/
      const scriptPath = agent.pluginPath
        ? resolve(agent.pluginPath, `agents/${agent.name}/main.ts`)
        : resolve(AGENTS_ROOT, `agents/${agent.name}/main.ts`);
      expect(existsSync(scriptPath), `${agent.name}: script not found at ${scriptPath}`).toBe(true);
    }
  });
});

it("createServerFromDef is exported from base-server", () => {
  expect(typeof createServerFromDef).toBe("function");
});
