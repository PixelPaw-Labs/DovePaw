import { writeFileSync, rmSync, existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock paths before importing ──────────────────────────────────────────────

const { tmpFile, tmpAgentSettingsDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const base = path.join(os.tmpdir(), `settings-test-${Date.now()}`);
  return {
    tmpFile: `${base}.json`,
    tmpAgentSettingsDir: `${base}-agents`,
  };
});

vi.mock("@/lib/paths", () => ({
  SETTINGS_FILE: tmpFile,
  AGENT_SETTINGS_DIR: tmpAgentSettingsDir,
  agentSettingsFile: (agentName: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    return path.join(tmpAgentSettingsDir, `${agentName}.json`);
  },
}));

import {
  readSettings,
  writeSettings,
  readAgentSettings,
  writeAgentSettings,
  makeRepository,
  makeEnvVar,
  isDovepawManaged,
  defaultSettings,
  defaultAgentSettings,
} from "@@/lib/settings";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeRaw(data: unknown) {
  writeFileSync(tmpFile, JSON.stringify(data), "utf-8");
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  if (existsSync(tmpFile)) rmSync(tmpFile);
  if (existsSync(tmpAgentSettingsDir)) rmSync(tmpAgentSettingsDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpFile)) rmSync(tmpFile);
  if (existsSync(tmpAgentSettingsDir)) rmSync(tmpAgentSettingsDir, { recursive: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("defaultSettings", () => {
  it("returns version 1 with empty repositories and envVars", () => {
    expect(defaultSettings()).toEqual({
      version: 1,
      repositories: [],
      envVars: [],
    });
  });
});

describe("defaultAgentSettings", () => {
  it("returns empty repos array and empty envVars", () => {
    expect(defaultAgentSettings()).toEqual({ repos: [], envVars: [] });
  });
});

describe("readSettings", () => {
  it("returns default when file does not exist", () => {
    expect(readSettings()).toEqual(defaultSettings());
  });

  it("returns default when file contains invalid JSON", () => {
    writeFileSync(tmpFile, "not json", "utf-8");
    expect(readSettings()).toEqual(defaultSettings());
  });

  it("returns default when schema validation fails", () => {
    writeRaw({ version: 2, repositories: [] });
    expect(readSettings()).toEqual(defaultSettings());
  });

  it("reads a valid settings file", () => {
    const settings = {
      version: 1 as const,
      repositories: [{ id: "abc", githubRepo: "org/bar", name: "bar" }],
      envVars: [{ id: "ev1", key: "MY_TOKEN", value: "secret", isSecret: false }],
    };
    writeRaw(settings);
    expect(readSettings()).toEqual(settings);
  });

  it("defaults envVars to empty array when field is absent in file", () => {
    writeRaw({ version: 1, repositories: [] });
    expect(readSettings().envVars).toEqual([]);
  });

  it("migrates old agentRepos to per-agent files", () => {
    writeRaw({
      version: 1,
      repositories: [],
      envVars: [],
      agentRepos: { "get-shit-done": ["r1", "r2"] },
    });
    readSettings();
    const agentSettings = readAgentSettings("get-shit-done");
    expect(agentSettings.repos).toEqual(["r1", "r2"]);
    // agentRepos should be gone from global settings after migration
    const global = readSettings();
    expect(global).not.toHaveProperty("agentRepos");
  });

  it("does not create agent file for agent with empty repos during migration", () => {
    writeRaw({
      version: 1,
      repositories: [],
      envVars: [],
      agentRepos: { "some-agent": [] },
    });
    readSettings();
    expect(readAgentSettings("some-agent").repos).toEqual([]);
  });
});

describe("writeSettings", () => {
  it("writes settings to disk and can be read back", () => {
    const settings = {
      version: 1 as const,
      repositories: [{ id: "xyz", githubRepo: "org/repo", name: "repo" }],
      envVars: [{ id: "ev1", key: "MY_TOKEN", value: "val", isSecret: false }],
    };
    writeSettings(settings);
    expect(readSettings()).toEqual(settings);
  });

  it("overwrites existing settings", () => {
    writeSettings({
      version: 1,
      repositories: [{ id: "a", githubRepo: "org/a", name: "a" }],
      envVars: [],
    });
    writeSettings({ version: 1, repositories: [], envVars: [] });
    expect(readSettings().repositories).toHaveLength(0);
  });
});

describe("readAgentSettings", () => {
  it("returns default when file does not exist", () => {
    expect(readAgentSettings("nonexistent-agent")).toEqual({ repos: [], envVars: [] });
  });

  it("reads saved agent settings", () => {
    writeAgentSettings("my-agent", { repos: ["r1", "r2"], envVars: [] });
    expect(readAgentSettings("my-agent")).toEqual({ repos: ["r1", "r2"], envVars: [] });
  });
});

describe("writeAgentSettings", () => {
  it("creates the agent settings directory if needed", () => {
    writeAgentSettings("test-agent", { repos: ["r1"], envVars: [] });
    expect(existsSync(tmpAgentSettingsDir)).toBe(true);
  });

  it("writes and reads back agent settings", () => {
    writeAgentSettings("my-agent", { repos: ["r1", "r2", "r3"], envVars: [] });
    expect(readAgentSettings("my-agent")).toEqual({ repos: ["r1", "r2", "r3"], envVars: [] });
  });

  it("overwrites existing agent settings", () => {
    writeAgentSettings("my-agent", { repos: ["r1"], envVars: [] });
    writeAgentSettings("my-agent", { repos: ["r2", "r3"], envVars: [] });
    expect(readAgentSettings("my-agent").repos).toEqual(["r2", "r3"]);
  });

  it("keeps agent settings isolated per agent", () => {
    writeAgentSettings("agent-a", { repos: ["r1"], envVars: [] });
    writeAgentSettings("agent-b", { repos: ["r2", "r3"], envVars: [] });
    expect(readAgentSettings("agent-a").repos).toEqual(["r1"]);
    expect(readAgentSettings("agent-b").repos).toEqual(["r2", "r3"]);
  });
});

describe("makeEnvVar", () => {
  it("stores trimmed key and value for non-secret", () => {
    const ev = makeEnvVar("  MY_KEY  ", "my-value", false);
    expect(ev.key).toBe("MY_KEY");
    expect(ev.value).toBe("my-value");
    expect(ev.isSecret).toBe(false);
  });

  it("stores empty value for secret (value lives in keychain)", () => {
    const ev = makeEnvVar("MY_SECRET", "s3cr3t", true);
    expect(ev.key).toBe("MY_SECRET");
    expect(ev.value).toBe("");
    expect(ev.isSecret).toBe(true);
  });

  it("sets keychainService and keychainAccount for linked entries", () => {
    const ev = makeEnvVar("AWS_KEY", "", true, "aws", "default");
    expect(ev.keychainService).toBe("aws");
    expect(ev.keychainAccount).toBe("default");
  });

  it("defaults keychainAccount to key when only service is given", () => {
    const ev = makeEnvVar("MY_TOKEN", "", true, "myapp");
    expect(ev.keychainAccount).toBe("MY_TOKEN");
  });

  it("does not set keychain fields when no service given", () => {
    const ev = makeEnvVar("MY_KEY", "val", false);
    expect(ev.keychainService).toBeUndefined();
    expect(ev.keychainAccount).toBeUndefined();
  });

  it("defaults isSecret to false", () => {
    const ev = makeEnvVar("MY_KEY", "val");
    expect(ev.isSecret).toBe(false);
  });

  it("generates a unique id", () => {
    const a = makeEnvVar("KEY_A", "val");
    const b = makeEnvVar("KEY_B", "val");
    expect(a.id).not.toBe(b.id);
  });
});

describe("isDovepawManaged", () => {
  it("returns true for a secret with no keychainService", () => {
    expect(isDovepawManaged({ id: "1", key: "K", value: "", isSecret: true })).toBe(true);
  });

  it("returns false for a linked secret", () => {
    expect(
      isDovepawManaged({ id: "1", key: "K", value: "", isSecret: true, keychainService: "aws" }),
    ).toBe(false);
  });

  it("returns false for a non-secret", () => {
    expect(isDovepawManaged({ id: "1", key: "K", value: "v", isSecret: false })).toBe(false);
  });
});

describe("makeRepository", () => {
  it("derives name from the repo slug", () => {
    const repo = makeRepository("owner/my-repo");
    expect(repo.name).toBe("my-repo");
    expect(repo.githubRepo).toBe("owner/my-repo");
  });

  it("trims whitespace", () => {
    const repo = makeRepository("  org/foo  ");
    expect(repo.githubRepo).toBe("org/foo");
    expect(repo.name).toBe("foo");
  });

  it("generates a unique id", () => {
    const a = makeRepository("org/a");
    const b = makeRepository("org/b");
    expect(a.id).not.toBe(b.id);
  });
});
