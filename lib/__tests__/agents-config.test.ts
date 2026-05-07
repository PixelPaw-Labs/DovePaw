import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { symlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TMP, AGENT_SETTINGS_DIR } = vi.hoisted(() => {
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const tmp = path.join(os.tmpdir(), `agents-config-test-${process.pid}`);
  return {
    TMP: tmp,
    AGENT_SETTINGS_DIR: path.join(tmp, "settings.agents"),
  };
});

vi.mock("../paths.js", () => ({
  AGENT_SETTINGS_DIR,
  DOVEPAW_TMP_DIR: join(TMP, "tmp"),
  agentConfigDir: (name: string) => join(AGENT_SETTINGS_DIR, name),
  agentDefinitionFile: (name: string) => join(AGENT_SETTINGS_DIR, name, "agent.json"),
  tmpAgentDefinitionFile: (name: string) => join(TMP, "tmp", name, "agent.json"),
}));

import { readAgentFile } from "../agents-config.js";

const VALID_AGENT = {
  version: 1,
  name: "test-agent",
  alias: "ta",
  displayName: "Test Agent",
  description: "A test agent",
  doveCard: { title: "Test", description: "Test", prompt: "Run test" },
  suggestions: [],
  repos: [],
  envVars: [],
  locked: false,
};

beforeEach(() => {
  mkdirSync(join(AGENT_SETTINGS_DIR, "test-agent"), { recursive: true });
  mkdirSync(join(TMP, "tmp"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("readAgentFile — broken symlink recovery", () => {
  it("recovers from .bak when agent.json is a broken symlink", async () => {
    const agentDir = join(AGENT_SETTINGS_DIR, "test-agent");
    const agentJson = join(agentDir, "agent.json");
    const agentBak = join(agentDir, "agent.json.bak");

    writeFileSync(agentBak, JSON.stringify(VALID_AGENT, null, 2) + "\n");
    // Create a broken symlink pointing to a non-existent target
    await symlink(join(agentDir, "nonexistent-plugin", "agent.json"), agentJson);

    const result = await readAgentFile("test-agent");

    expect(result).not.toBeNull();
    expect(result?.name).toBe("test-agent");

    // Broken symlink should be replaced with a regular file
    const stat = await lstat(agentJson);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isFile()).toBe(true);
  });
});
