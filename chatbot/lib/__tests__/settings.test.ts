import { writeFileSync, rmSync, existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @@/lib/paths before importing settings ───────────────────────────────

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

// settings.ts imports ./paths which resolves to @@/lib/paths (project root)
vi.mock("@@/lib/paths", () => ({
  DOVEPAW_DIR: require("node:path").dirname(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:path").resolve(require("node:os").tmpdir(), `settings-test-dir`),
  ),
  SETTINGS_FILE: tmpFile,
  AGENT_SETTINGS_DIR: tmpAgentSettingsDir,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  agentSettingsFile: (agentName: string) =>
    require("node:path").join(tmpAgentSettingsDir, `${agentName}.json`),
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

function writeRaw(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data), "utf-8");
}

function cleanup() {
  for (const f of [tmpFile, `${tmpFile}.bak`]) {
    if (existsSync(f)) rmSync(f);
  }
  if (existsSync(tmpAgentSettingsDir)) rmSync(tmpAgentSettingsDir, { recursive: true });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(cleanup);
afterEach(cleanup);

// ─── defaultSettings ──────────────────────────────────────────────────────────

describe("defaultSettings", () => {
  it("returns version 1 with empty arrays", () => {
    expect(defaultSettings()).toEqual({ version: 1, repositories: [], envVars: [] });
  });
});

describe("defaultAgentSettings", () => {
  it("returns empty repos and envVars", () => {
    expect(defaultAgentSettings()).toEqual({ repos: [], envVars: [] });
  });
});

// ─── readSettings ─────────────────────────────────────────────────────────────

describe("readSettings", () => {
  it("returns default when file does not exist", () => {
    expect(readSettings()).toEqual(defaultSettings());
  });

  it("returns default when file contains invalid JSON", () => {
    writeFileSync(tmpFile, "not json", "utf-8");
    expect(readSettings()).toEqual(defaultSettings());
  });

  it("returns default when schema validation fails", () => {
    writeRaw(tmpFile, { version: 2, repositories: [] });
    expect(readSettings()).toEqual(defaultSettings());
  });

  it("reads a valid settings file", () => {
    const settings = {
      version: 1 as const,
      repositories: [{ id: "abc", githubRepo: "org/bar", name: "bar" }],
      envVars: [{ id: "ev1", key: "MY_TOKEN", value: "secret", isSecret: false }],
    };
    writeRaw(tmpFile, settings);
    expect(readSettings()).toEqual(settings);
  });

  it("defaults envVars to [] when field is absent", () => {
    writeRaw(tmpFile, { version: 1, repositories: [] });
    expect(readSettings().envVars).toEqual([]);
  });

  // ── bak fallback ───────────────────────────────────────────────────────────

  it("falls back to .bak when primary is missing", () => {
    const settings = {
      version: 1 as const,
      repositories: [{ id: "a", githubRepo: "org/a", name: "a" }],
      envVars: [],
    };
    writeRaw(`${tmpFile}.bak`, settings);
    expect(readSettings()).toEqual(settings);
  });

  it("restores primary from .bak when primary is missing", () => {
    const settings = {
      version: 1 as const,
      repositories: [{ id: "a", githubRepo: "org/a", name: "a" }],
      envVars: [],
    };
    writeRaw(`${tmpFile}.bak`, settings);
    readSettings();
    expect(existsSync(tmpFile)).toBe(true);
    expect(readSettings()).toEqual(settings);
  });

  it("falls back to .bak when primary has empty arrays", () => {
    const backup = {
      version: 1 as const,
      repositories: [{ id: "b", githubRepo: "org/b", name: "b" }],
      envVars: [],
    };
    writeRaw(tmpFile, { version: 1, repositories: [], envVars: [] });
    writeRaw(`${tmpFile}.bak`, backup);
    expect(readSettings()).toEqual(backup);
  });

  it("restores primary from .bak when primary was empty", () => {
    const backup = {
      version: 1 as const,
      repositories: [{ id: "b", githubRepo: "org/b", name: "b" }],
      envVars: [],
    };
    writeRaw(tmpFile, { version: 1, repositories: [], envVars: [] });
    writeRaw(`${tmpFile}.bak`, backup);
    readSettings();
    expect(readSettings().repositories).toHaveLength(1);
  });

  it("does not fall back to .bak when primary has content", () => {
    const primary = {
      version: 1 as const,
      repositories: [{ id: "p", githubRepo: "org/p", name: "p" }],
      envVars: [],
    };
    const bak = {
      version: 1 as const,
      repositories: [
        { id: "b1", githubRepo: "org/b1", name: "b1" },
        { id: "b2", githubRepo: "org/b2", name: "b2" },
      ],
      envVars: [],
    };
    writeRaw(tmpFile, primary);
    writeRaw(`${tmpFile}.bak`, bak);
    expect(readSettings().repositories).toHaveLength(1);
  });

  it("returns default when both primary and .bak are missing", () => {
    expect(readSettings()).toEqual(defaultSettings());
  });
});

// ─── writeSettings ────────────────────────────────────────────────────────────

describe("writeSettings", () => {
  it("writes and reads back", () => {
    const s = {
      version: 1 as const,
      repositories: [{ id: "xyz", githubRepo: "org/repo", name: "repo" }],
      envVars: [{ id: "ev1", key: "MY_TOKEN", value: "val", isSecret: false }],
    };
    writeSettings(s);
    expect(readSettings()).toEqual(s);
  });

  it("creates a .bak file after write", () => {
    writeSettings({ version: 1, repositories: [], envVars: [] });
    expect(existsSync(`${tmpFile}.bak`)).toBe(true);
  });

  it(".bak matches primary after write", () => {
    const s = {
      version: 1 as const,
      repositories: [{ id: "x", githubRepo: "org/x", name: "x" }],
      envVars: [],
    };
    writeSettings(s);
    const bak = JSON.parse(require("node:fs").readFileSync(`${tmpFile}.bak`, "utf-8"));
    expect(bak.repositories).toEqual(s.repositories);
  });

  it("overwrites existing settings", () => {
    writeSettings({
      version: 1,
      repositories: [{ id: "a", githubRepo: "org/a", name: "a" }],
      envVars: [],
    });
    writeSettings({ version: 1, repositories: [], envVars: [] });
    // Both primary and .bak are now empty, so returns primary (empty)
    expect(readSettings().repositories).toHaveLength(0);
  });
});

// ─── readAgentSettings ────────────────────────────────────────────────────────

describe("readAgentSettings", () => {
  it("returns default when file does not exist", () => {
    expect(readAgentSettings("nonexistent-agent")).toEqual({ repos: [], envVars: [] });
  });

  it("reads saved agent settings", () => {
    writeAgentSettings("my-agent", { repos: ["r1", "r2"], envVars: [] });
    expect(readAgentSettings("my-agent")).toEqual({ repos: ["r1", "r2"], envVars: [] });
  });

  // ── bak fallback ───────────────────────────────────────────────────────────

  it("falls back to .bak when primary is missing", () => {
    const agentFile = require("node:path").join(tmpAgentSettingsDir, "my-agent.json");
    require("node:fs").mkdirSync(tmpAgentSettingsDir, { recursive: true });
    writeRaw(`${agentFile}.bak`, { repos: ["r1"], envVars: [] });
    expect(readAgentSettings("my-agent").repos).toEqual(["r1"]);
  });

  it("restores primary from .bak when primary is missing", () => {
    const agentFile = require("node:path").join(tmpAgentSettingsDir, "my-agent.json");
    require("node:fs").mkdirSync(tmpAgentSettingsDir, { recursive: true });
    writeRaw(`${agentFile}.bak`, { repos: ["r1"], envVars: [] });
    readAgentSettings("my-agent");
    expect(existsSync(agentFile)).toBe(true);
  });

  it("falls back to .bak when primary has empty arrays", () => {
    writeAgentSettings("my-agent", { repos: ["original"], envVars: [] });
    // Overwrite primary with empty (simulating accidental clear)
    const agentFile = require("node:path").join(tmpAgentSettingsDir, "my-agent.json");
    writeRaw(agentFile, { repos: [], envVars: [] });
    expect(readAgentSettings("my-agent").repos).toEqual(["original"]);
  });
});

// ─── writeAgentSettings ───────────────────────────────────────────────────────

describe("writeAgentSettings", () => {
  it("creates the agent settings directory if needed", () => {
    writeAgentSettings("test-agent", { repos: ["r1"], envVars: [] });
    expect(existsSync(tmpAgentSettingsDir)).toBe(true);
  });

  it("writes and reads back", () => {
    writeAgentSettings("my-agent", { repos: ["r1", "r2", "r3"], envVars: [] });
    expect(readAgentSettings("my-agent")).toEqual({ repos: ["r1", "r2", "r3"], envVars: [] });
  });

  it("creates a .bak file after write", () => {
    writeAgentSettings("my-agent", { repos: ["r1"], envVars: [] });
    const agentFile = require("node:path").join(tmpAgentSettingsDir, "my-agent.json");
    expect(existsSync(`${agentFile}.bak`)).toBe(true);
  });

  it("overwrites existing settings", () => {
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

// ─── makeEnvVar ───────────────────────────────────────────────────────────────

describe("makeEnvVar", () => {
  it("stores trimmed key and value for non-secret", () => {
    const ev = makeEnvVar("  MY_KEY  ", "my-value", false);
    expect(ev.key).toBe("MY_KEY");
    expect(ev.value).toBe("my-value");
    expect(ev.isSecret).toBe(false);
  });

  it("stores empty value for secret", () => {
    const ev = makeEnvVar("MY_SECRET", "s3cr3t", true);
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
    expect(makeEnvVar("MY_KEY", "val").isSecret).toBe(false);
  });

  it("generates a unique id", () => {
    expect(makeEnvVar("KEY_A", "val").id).not.toBe(makeEnvVar("KEY_B", "val").id);
  });
});

// ─── isDovepawManaged ─────────────────────────────────────────────────────────

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

// ─── makeRepository ───────────────────────────────────────────────────────────

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
    expect(makeRepository("org/a").id).not.toBe(makeRepository("org/b").id);
  });
});
