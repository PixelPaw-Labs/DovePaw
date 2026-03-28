/**
 * Tests for A2A agent server configuration.
 * Verifies each agent in the shared config has a real script file
 * and documents its required env vars.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AGENTS_ROOT } from "@/lib/paths";
import { AGENTS } from "@@/lib/agents";

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

describe.each(AGENTS)("$name agent", ({ name: _name, entryPath, requiredEnvVars }) => {
  it("script exists in agents/", () => {
    expect(existsSync(resolve(AGENTS_ROOT, entryPath))).toBe(true);
  });

  it("shared config documents required env vars", () => {
    const src = readFileSync(resolve(AGENTS_ROOT, "lib/agents.ts"), "utf-8");
    for (const v of requiredEnvVars) {
      expect(src).toContain(v);
    }
  });
});

it("createServerFromDef is exported from base-server", () => {
  expect(typeof createServerFromDef).toBe("function");
});
