import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @@/lib/paths before importing agents-config ─────────────────────────

const { tmpDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const dir = path.join(os.tmpdir(), `agents-config-test-${Date.now()}`);
  return { tmpDir: dir };
});

vi.mock("@@/lib/paths", () => ({
  AGENT_SETTINGS_DIR: tmpDir,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  agentConfigDir: (n: string) => require("node:path").join(tmpDir, n),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  agentDefinitionFile: (n: string) => require("node:path").join(tmpDir, n, "agent.json"),
  // tmp dir: use a subdirectory so it is always empty and distinct from settings dir
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DOVEPAW_TMP_DIR: require("node:path").join(tmpDir, "__tmp__"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  tmpAgentDefinitionFile: (n: string) =>
    require("node:path").join(tmpDir, "__tmp__", n, "agent.json"),
}));

import {
  readAgentConfigEntries,
  readAgentsConfig,
  readAgentFile,
  createAgentFile,
  patchAgentFile,
  deleteAgentDefinition,
} from "@@/lib/agents-config";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const FIXTURE_AGENT: AgentConfigEntry = {
  name: "memory-dream",
  alias: "mdr",
  displayName: "Memory Dream",
  description: "Dream and consolidate memories",
  scheduleDisplay: "daily 00:00",
  schedule: { type: "calendar", hour: 0, minute: 0 },
  doveCard: {
    title: "Memory Dream",
    description: "What does it do?",
    prompt: "What does Memory Dream do?",
  },
  suggestions: [
    { title: "Run now", description: "Run Memory Dream now", prompt: "Run Memory Dream now" },
  ],
};

const FIXTURE_AGENT_2: AgentConfigEntry = {
  name: "get-shit-done",
  alias: "gsd",
  displayName: "Get Shit Done",
  description: "Automated ticket implementer",
  scheduleDisplay: "every 5 min",
  schedule: { type: "interval", seconds: 300 },
  doveCard: {
    title: "Get Shit Done",
    description: "How does it work?",
    prompt: "How does Get Shit Done work?",
  },
  suggestions: [{ title: "Run now", description: "Run GSD now", prompt: "Run Get Shit Done now" }],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agentDir(name: string) {
  return join(tmpDir, name);
}

function agentFile(name: string) {
  return join(tmpDir, name, "agent.json");
}

function cleanup() {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("readAgentConfigEntries", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("returns [] when settings dir does not exist", async () => {
    expect(await readAgentConfigEntries()).toEqual([]);
  });

  it("returns [] when settings dir is empty", async () => {
    mkdirSync(tmpDir, { recursive: true });
    expect(await readAgentConfigEntries()).toEqual([]);
  });

  it("returns entries from agent directories", async () => {
    await createAgentFile(FIXTURE_AGENT);
    const entries = await readAgentConfigEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("memory-dream");
  });

  it("returns multiple entries when multiple agent dirs exist", async () => {
    await createAgentFile(FIXTURE_AGENT);
    await createAgentFile(FIXTURE_AGENT_2);
    const entries = await readAgentConfigEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name).toSorted()).toEqual(["get-shit-done", "memory-dream"]);
  });

  it("strips repos and envVars from returned entries", async () => {
    await createAgentFile(FIXTURE_AGENT);
    const entries = await readAgentConfigEntries();
    expect(entries[0]).not.toHaveProperty("repos");
    expect(entries[0]).not.toHaveProperty("envVars");
  });

  it("skips directories without a valid agent.json", async () => {
    mkdirSync(agentDir("broken-agent"), { recursive: true });
    writeFileSync(agentFile("broken-agent"), "NOT JSON", "utf-8");
    await createAgentFile(FIXTURE_AGENT);
    const entries = await readAgentConfigEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("memory-dream");
  });
});

describe("createAgentFile", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("creates the agent directory and agent.json", async () => {
    await createAgentFile(FIXTURE_AGENT);
    expect(existsSync(agentFile("memory-dream"))).toBe(true);
    expect(existsSync(`${agentFile("memory-dream")}.bak`)).toBe(true);
  });

  it("creates file with empty repos and envVars", async () => {
    await createAgentFile(FIXTURE_AGENT);
    const file = await readAgentFile("memory-dream");
    expect(file?.repos).toEqual([]);
    expect(file?.envVars).toEqual([]);
  });

  it("stores all definition fields", async () => {
    await createAgentFile(FIXTURE_AGENT);
    const file = await readAgentFile("memory-dream");
    expect(file?.displayName).toBe("Memory Dream");
    expect(file?.alias).toBe("mdr");
    expect(file?.schedule).toEqual({ type: "calendar", hour: 0, minute: 0 });
  });
});

describe("patchAgentFile", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("updates only specified fields, preserving others", async () => {
    await createAgentFile(FIXTURE_AGENT);
    await patchAgentFile("memory-dream", { repos: ["r1", "r2"] });
    const file = await readAgentFile("memory-dream");
    expect(file?.repos).toEqual(["r1", "r2"]);
    expect(file?.displayName).toBe("Memory Dream"); // unchanged
    expect(file?.envVars).toEqual([]); // unchanged
  });

  it("updates definition fields without touching repos/envVars", async () => {
    await createAgentFile(FIXTURE_AGENT);
    await patchAgentFile("memory-dream", { repos: ["r1"] });
    await patchAgentFile("memory-dream", { displayName: "Memory Dream Updated" });
    const file = await readAgentFile("memory-dream");
    expect(file?.repos).toEqual(["r1"]); // preserved
    expect(file?.displayName).toBe("Memory Dream Updated");
  });

  it("creates .bak file on every write", async () => {
    await createAgentFile(FIXTURE_AGENT);
    await patchAgentFile("memory-dream", { repos: ["r1"] });
    expect(existsSync(`${agentFile("memory-dream")}.bak`)).toBe(true);
  });
});

describe("readAgentFile", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("returns null when file does not exist", async () => {
    mkdirSync(tmpDir, { recursive: true });
    expect(await readAgentFile("nonexistent")).toBeNull();
  });

  it("falls back to .bak when primary is corrupt", async () => {
    await createAgentFile(FIXTURE_AGENT);
    const bak = `${agentFile("memory-dream")}.bak`;
    writeFileSync(agentFile("memory-dream"), "CORRUPT", "utf-8");
    // bak was written by createAgentFile, so it has valid content
    const file = await readAgentFile("memory-dream");
    expect(file?.name).toBe("memory-dream");
    expect(existsSync(bak)).toBe(true);
  });
});

describe("deleteAgentDefinition", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("removes the entire agent directory", async () => {
    await createAgentFile(FIXTURE_AGENT);
    await deleteAgentDefinition("memory-dream");
    expect(existsSync(agentDir("memory-dream"))).toBe(false);
  });

  it("is a no-op when the file does not exist", async () => {
    mkdirSync(tmpDir, { recursive: true });
    await expect(deleteAgentDefinition("ghost")).resolves.not.toThrow();
  });

  it("entry no longer appears in readAgentConfigEntries after deletion", async () => {
    await createAgentFile(FIXTURE_AGENT);
    await createAgentFile(FIXTURE_AGENT_2);
    await deleteAgentDefinition("memory-dream");
    const entries = await readAgentConfigEntries();
    expect(entries.map((e) => e.name)).not.toContain("memory-dream");
    expect(entries.map((e) => e.name)).toContain("get-shit-done");
  });
});

describe("buildAgentDef", () => {
  it("derives entryPath from name", () => {
    const def = buildAgentDef(FIXTURE_AGENT);
    expect(def.entryPath).toBe("agents/memory-dream/main.ts");
  });

  it("derives manifestKey by replacing dashes with underscores", () => {
    const def = buildAgentDef(FIXTURE_AGENT_2);
    expect(def.manifestKey).toBe("get_shit_done");
  });

  it("derives toolName with yolo_ prefix", () => {
    const def = buildAgentDef(FIXTURE_AGENT);
    expect(def.toolName).toBe("yolo_memory_dream");
  });

  it("derives label from displayName", () => {
    const def = buildAgentDef(FIXTURE_AGENT);
    expect(def.label).toBe("Claude Code Agent - Memory Dream");
  });

  it("attaches an icon to known agents", () => {
    const def = buildAgentDef(FIXTURE_AGENT);
    expect(def.icon).toBeTruthy();
  });

  it("uses Bot icon for unknown agent names", () => {
    const unknown: AgentConfigEntry = {
      name: "unknown-agent",
      alias: "ua",
      displayName: "Unknown",
      description: "desc",
      scheduleDisplay: "on demand",
      doveCard: { title: "t", description: "d", prompt: "p" },
      suggestions: [],
    };
    const def = buildAgentDef(unknown);
    expect(def.icon).toBeTruthy();
  });

  it("hydrates doveCard with icon and prompt text from config", () => {
    const def = buildAgentDef(FIXTURE_AGENT);
    expect(def.doveCard.prompt).toBe(FIXTURE_AGENT.doveCard.prompt);
    expect(def.doveCard.title).toBe(FIXTURE_AGENT.doveCard.title);
    expect(def.doveCard.icon).toBeTruthy();
  });

  it("hydrates suggestions from config", () => {
    const def = buildAgentDef(FIXTURE_AGENT);
    expect(def.suggestions).toHaveLength(FIXTURE_AGENT.suggestions.length);
    expect(def.suggestions[0]?.prompt).toBe(FIXTURE_AGENT.suggestions[0]?.prompt);
  });
});

describe("readAgentsConfig", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("returns [] when no agent dirs exist", async () => {
    expect(await readAgentsConfig()).toHaveLength(0);
  });

  it("returns AgentDef[] with derived fields from agent dirs", async () => {
    await createAgentFile(FIXTURE_AGENT);
    await createAgentFile(FIXTURE_AGENT_2);
    const defs = await readAgentsConfig();
    expect(defs).toHaveLength(2);
    for (const def of defs) {
      expect(def.manifestKey).not.toContain("-");
      expect(def.toolName.startsWith("yolo_")).toBe(true);
      expect(def.icon).toBeTruthy();
    }
  });
});

describe("agentConfigEntrySchema validation", () => {
  it("rejects non-kebab-case names", async () => {
    const { agentConfigEntrySchema } = await import("@@/lib/agents-config-schemas");
    const result = agentConfigEntrySchema.safeParse({
      name: "MyAgent",
      alias: "ma",
      displayName: "My Agent",
      description: "desc",
      scheduleDisplay: "on demand",
      doveCard: { title: "t", description: "d", prompt: "p" },
      suggestions: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid kebab-case name", async () => {
    const { agentConfigEntrySchema } = await import("@@/lib/agents-config-schemas");
    const result = agentConfigEntrySchema.safeParse({
      name: "my-agent-2",
      alias: "ma",
      displayName: "My Agent",
      description: "desc",
      scheduleDisplay: "on demand",
      doveCard: { title: "t", description: "d", prompt: "p" },
      suggestions: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid schedule structure", async () => {
    const { agentConfigEntrySchema } = await import("@@/lib/agents-config-schemas");
    const result = agentConfigEntrySchema.safeParse({
      name: "my-agent",
      alias: "ma",
      displayName: "My Agent",
      description: "desc",
      scheduleDisplay: "daily",
      schedule: { type: "invalid" },
      doveCard: { title: "t", description: "d", prompt: "p" },
      suggestions: [],
    });
    expect(result.success).toBe(false);
  });
});
