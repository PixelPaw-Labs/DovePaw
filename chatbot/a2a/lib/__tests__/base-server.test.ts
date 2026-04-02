import { existsSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// vi.hoisted initialises the value before vi.mock factories run.
// Only process.pid (global) is used — no ES imports needed inside.
const { TMP_PORTS } = vi.hoisted(() => ({
  TMP_PORTS: `/tmp/.ports-test-${process.pid}.json`,
}));

vi.mock("@/lib/paths", () => ({
  CHATBOT_ROOT: "/tmp",
  AGENTS_ROOT: "/tmp",
  TSX_BIN: "/usr/bin/tsx",
  PORTS_FILE: TMP_PORTS,
}));

vi.mock("express", () => {
  const app = { use: vi.fn(), listen: vi.fn() };
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

import { getAvailablePort, readPortsManifest, writePortsManifest } from "../base-server";

afterEach(() => {
  if (existsSync(TMP_PORTS)) rmSync(TMP_PORTS);
});

// ─── getAvailablePort ─────────────────────────────────────────────────────────

describe("getAvailablePort", () => {
  it("returns a valid port number", async () => {
    const port = await getAvailablePort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it("returns unique ports on concurrent calls", async () => {
    const ports = await Promise.all([getAvailablePort(), getAvailablePort(), getAvailablePort()]);
    expect(new Set(ports).size).toBe(3);
  });
});

// ─── writePortsManifest / readPortsManifest ───────────────────────────────────

const SAMPLE_PORTS = {
  memory_dream: 51001,
  get_shit_done: 51002,
  release_log_sentinel: 51003,
  memory_distiller: 51004,
  oncall_analyzer: 51005,
  zendesk_triager: 51006,
  dependabot_merger: 51007,
};

describe("readPortsManifest", () => {
  it("returns null when manifest file does not exist", () => {
    expect(readPortsManifest()).toBeNull();
  });

  it("returns parsed manifest after writing", () => {
    writePortsManifest(SAMPLE_PORTS);
    const result = readPortsManifest();
    expect(result).not.toBeNull();
    expect(result?.memory_dream).toBe(51001);
    expect(result?.oncall_analyzer).toBe(51005);
  });

  it("includes updatedAt timestamp", () => {
    writePortsManifest(SAMPLE_PORTS);
    const result = readPortsManifest();
    expect(result?.updatedAt).toBeDefined();
    expect(() => new Date(result!.updatedAt)).not.toThrow();
  });
});

describe("writePortsManifest", () => {
  it("writes all agent port keys", () => {
    writePortsManifest(SAMPLE_PORTS);
    const result = readPortsManifest()!;
    for (const [key, port] of Object.entries(SAMPLE_PORTS)) {
      expect(result[key]).toBe(port);
    }
  });

  it("overwrites an existing manifest", () => {
    writePortsManifest(SAMPLE_PORTS);
    writePortsManifest({ ...SAMPLE_PORTS, memory_dream: 99999 });
    expect(readPortsManifest()?.memory_dream).toBe(99999);
  });
});
