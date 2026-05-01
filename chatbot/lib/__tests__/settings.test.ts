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
  agentConfigDir: (agentName: string) => require("node:path").join(tmpAgentSettingsDir, agentName),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  agentDefinitionFile: (agentName: string) =>
    require("node:path").join(tmpAgentSettingsDir, agentName, "agent.json"),
  // tmp dir: use a subdirectory so it is always empty and distinct from settings dir
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DOVEPAW_TMP_DIR: require("node:path").join(tmpAgentSettingsDir, "__tmp__"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  tmpAgentDefinitionFile: (agentName: string) =>
    require("node:path").join(tmpAgentSettingsDir, "__tmp__", agentName, "agent.json"),
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
import { effectiveDoveSettings } from "@@/lib/settings-schemas";

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
  it("returns default when file does not exist", async () => {
    expect(await readSettings()).toEqual(defaultSettings());
  });

  it("returns default when file contains invalid JSON", async () => {
    writeFileSync(tmpFile, "not json", "utf-8");
    expect(await readSettings()).toEqual(defaultSettings());
  });

  it("returns default when schema validation fails", async () => {
    writeRaw(tmpFile, { version: 2, repositories: [] });
    expect(await readSettings()).toEqual(defaultSettings());
  });

  it("reads a valid settings file", async () => {
    const settings = {
      version: 1 as const,
      repositories: [{ id: "abc", githubRepo: "org/bar", name: "bar" }],
      envVars: [{ id: "ev1", key: "MY_TOKEN", value: "secret", isSecret: false }],
    };
    writeRaw(tmpFile, settings);
    expect(await readSettings()).toEqual(settings);
  });

  it("defaults envVars to [] when field is absent", async () => {
    writeRaw(tmpFile, { version: 1, repositories: [] });
    expect((await readSettings()).envVars).toEqual([]);
  });

  // ── bak fallback ───────────────────────────────────────────────────────────

  it("falls back to .bak when primary is missing", async () => {
    const settings = {
      version: 1 as const,
      repositories: [{ id: "a", githubRepo: "org/a", name: "a" }],
      envVars: [],
    };
    writeRaw(`${tmpFile}.bak`, settings);
    expect(await readSettings()).toEqual(settings);
  });

  it("restores primary from .bak when primary is missing", async () => {
    const settings = {
      version: 1 as const,
      repositories: [{ id: "a", githubRepo: "org/a", name: "a" }],
      envVars: [],
    };
    writeRaw(`${tmpFile}.bak`, settings);
    await readSettings();
    expect(existsSync(tmpFile)).toBe(true);
    expect(await readSettings()).toEqual(settings);
  });

  it("falls back to .bak when primary has empty arrays", async () => {
    const backup = {
      version: 1 as const,
      repositories: [{ id: "b", githubRepo: "org/b", name: "b" }],
      envVars: [],
    };
    writeRaw(tmpFile, { version: 1, repositories: [], envVars: [] });
    writeRaw(`${tmpFile}.bak`, backup);
    expect(await readSettings()).toEqual(backup);
  });

  it("restores primary from .bak when primary was empty", async () => {
    const backup = {
      version: 1 as const,
      repositories: [{ id: "b", githubRepo: "org/b", name: "b" }],
      envVars: [],
    };
    writeRaw(tmpFile, { version: 1, repositories: [], envVars: [] });
    writeRaw(`${tmpFile}.bak`, backup);
    await readSettings();
    expect((await readSettings()).repositories).toHaveLength(1);
  });

  it("does not fall back to .bak when primary has content", async () => {
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
    expect((await readSettings()).repositories).toHaveLength(1);
  });

  it("returns default when both primary and .bak are missing", async () => {
    expect(await readSettings()).toEqual(defaultSettings());
  });
});

// ─── writeSettings ────────────────────────────────────────────────────────────

describe("writeSettings", () => {
  it("writes and reads back", async () => {
    const s = {
      version: 1 as const,
      repositories: [{ id: "xyz", githubRepo: "org/repo", name: "repo" }],
      envVars: [{ id: "ev1", key: "MY_TOKEN", value: "val", isSecret: false }],
    };
    await writeSettings(s);
    expect(await readSettings()).toEqual(s);
  });

  it("creates a .bak file after write", async () => {
    await writeSettings({ version: 1, repositories: [], envVars: [] });
    expect(existsSync(`${tmpFile}.bak`)).toBe(true);
  });

  it(".bak matches primary after write", async () => {
    const s = {
      version: 1 as const,
      repositories: [{ id: "x", githubRepo: "org/x", name: "x" }],
      envVars: [],
    };
    await writeSettings(s);
    const bak = JSON.parse(require("node:fs").readFileSync(`${tmpFile}.bak`, "utf-8"));
    expect(bak.repositories).toEqual(s.repositories);
  });

  it("overwrites existing settings", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ id: "a", githubRepo: "org/a", name: "a" }],
      envVars: [],
    });
    await writeSettings({ version: 1, repositories: [], envVars: [] });
    // Both primary and .bak are now empty, so returns primary (empty)
    expect((await readSettings()).repositories).toHaveLength(0);
  });
});

// ─── readAgentSettings ────────────────────────────────────────────────────────

describe("readAgentSettings", () => {
  it("returns default when agent dir does not exist", async () => {
    expect(await readAgentSettings("nonexistent-agent")).toEqual({ repos: [], envVars: [] });
  });

  it("reads saved agent settings", async () => {
    await writeAgentSettings("my-agent", { repos: ["r1", "r2"], envVars: [] });
    expect(await readAgentSettings("my-agent")).toEqual({ repos: ["r1", "r2"], envVars: [] });
  });

  it("returns only repos and envVars (not definition fields)", async () => {
    await writeAgentSettings("my-agent", { repos: ["r1"], envVars: [] });
    const settings = await readAgentSettings("my-agent");
    expect(Object.keys(settings).toSorted()).toEqual(["envVars", "notifications", "repos"]);
  });
});

// ─── writeAgentSettings ───────────────────────────────────────────────────────

describe("writeAgentSettings", () => {
  it("creates the agent directory if needed", async () => {
    await writeAgentSettings("test-agent", { repos: ["r1"], envVars: [] });
    const agentDir = require("node:path").join(tmpAgentSettingsDir, "test-agent");
    expect(existsSync(agentDir)).toBe(true);
  });

  it("writes and reads back", async () => {
    await writeAgentSettings("my-agent", { repos: ["r1", "r2", "r3"], envVars: [] });
    expect(await readAgentSettings("my-agent")).toEqual({ repos: ["r1", "r2", "r3"], envVars: [] });
  });

  it("creates a .bak file after write", async () => {
    await writeAgentSettings("my-agent", { repos: ["r1"], envVars: [] });
    const agentFile = require("node:path").join(tmpAgentSettingsDir, "my-agent", "agent.json");
    expect(existsSync(`${agentFile}.bak`)).toBe(true);
  });

  it("patches only repos/envVars, preserving other fields", async () => {
    // First write creates the agent file with minimal skeleton
    await writeAgentSettings("my-agent", { repos: ["r1"], envVars: [] });
    // Second write should update repos without losing other data
    await writeAgentSettings("my-agent", { repos: ["r2", "r3"], envVars: [] });
    expect((await readAgentSettings("my-agent")).repos).toEqual(["r2", "r3"]);
  });

  it("keeps agent settings isolated per agent", async () => {
    await writeAgentSettings("agent-a", { repos: ["r1"], envVars: [] });
    await writeAgentSettings("agent-b", { repos: ["r2", "r3"], envVars: [] });
    expect((await readAgentSettings("agent-a")).repos).toEqual(["r1"]);
    expect((await readAgentSettings("agent-b")).repos).toEqual(["r2", "r3"]);
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

// ─── effectiveDoveSettings ────────────────────────────────────────────────────

describe("effectiveDoveSettings", () => {
  it("returns defaults when dove is absent", () => {
    const s = effectiveDoveSettings({});
    expect(s.displayName).toBe("Dove");
    expect(s.avatarUrl).toBe("/dove-avatar.webp");
    expect(s.persona).toBe("");
    expect(s.tagline).toBe("");
  });

  it("returns stored values when dove is present", () => {
    const s = effectiveDoveSettings({
      dove: {
        displayName: "Kitty",
        tagline: "helper",
        persona: "I am helpful.",
        landingTitle: "Hi!",
        landingDescription: "Ready.",
        avatarUrl: "/uploads/custom.jpg",
        iconName: "Cat",
        iconBg: "bg-pink-100",
        iconColor: "text-pink-700",
      },
    });
    expect(s.displayName).toBe("Kitty");
    expect(s.iconName).toBe("Cat");
    expect(s.avatarUrl).toBe("/uploads/custom.jpg");
  });

  it("fills in missing dove fields with defaults", () => {
    const s = effectiveDoveSettings({ dove: {} });
    expect(s.displayName).toBe("Dove");
    expect(s.iconBg).toBe("bg-purple-100");
  });

  it("persists dove settings through write/read cycle", async () => {
    const settings = defaultSettings();
    settings.dove = {
      displayName: "Meow",
      tagline: "",
      persona: "",
      landingTitle: "",
      landingDescription: "",
      avatarUrl: "/dove-avatar.jpg",
      iconName: "Cat",
      iconBg: "bg-pink-100",
      iconColor: "text-pink-700",
      defaultModel: "",
      doveMode: "supervised" as const,
      allowWebTools: false,
    };
    await writeSettings(settings);
    const loaded = await readSettings();
    expect(effectiveDoveSettings(loaded).displayName).toBe("Meow");
    expect(effectiveDoveSettings(loaded).iconName).toBe("Cat");
  });
});
