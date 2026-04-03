import { writeFileSync, rmSync, existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @@/lib/paths before importing agents-config ─────────────────────────

const { tmpConfigFile } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const base = path.join(os.tmpdir(), `agents-config-test-${Date.now()}`);
  return { tmpConfigFile: `${base}.json` };
});

vi.mock("@@/lib/paths", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DOVEPAW_DIR: require("node:path").dirname(tmpConfigFile),
  AGENTS_CONFIG_FILE: tmpConfigFile,
  SETTINGS_FILE: `${tmpConfigFile}-settings.json`,
  AGENT_SETTINGS_DIR: `${tmpConfigFile}-agents`,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  agentSettingsFile: (n: string) =>
    require("node:path").join(`${tmpConfigFile}-agents`, `${n}.json`),
}));

import { readAgentConfigEntries, readAgentsConfig, writeAgentsConfig } from "@@/lib/agents-config";
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

function writeRaw(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data), "utf-8");
}

function cleanup() {
  for (const f of [tmpConfigFile, `${tmpConfigFile}.bak`]) {
    if (existsSync(f)) rmSync(f);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("readAgentConfigEntries", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("returns [] when file does not exist", () => {
    const entries = readAgentConfigEntries();
    expect(entries).toEqual([]);
  });

  it("returns entries from file when valid", () => {
    writeRaw(tmpConfigFile, { version: 1, agents: [FIXTURE_AGENT] });

    const entries = readAgentConfigEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("memory-dream");
  });

  it("falls back to .bak file when primary is corrupt", () => {
    writeRaw(`${tmpConfigFile}.bak`, { version: 1, agents: [FIXTURE_AGENT, FIXTURE_AGENT_2] });
    writeFileSync(tmpConfigFile, "NOT JSON", "utf-8");

    const entries = readAgentConfigEntries();
    expect(entries).toHaveLength(2);
  });

  it("returns [] when both primary and bak are absent", () => {
    const entries = readAgentConfigEntries();
    expect(entries).toEqual([]);
  });
});

describe("writeAgentsConfig", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("writes agents.json and creates .bak", () => {
    writeAgentsConfig([FIXTURE_AGENT]);

    expect(existsSync(tmpConfigFile)).toBe(true);
    expect(existsSync(`${tmpConfigFile}.bak`)).toBe(true);

    const read = readAgentConfigEntries();
    expect(read).toHaveLength(1);
    expect(read[0]?.name).toBe("memory-dream");
  });

  it("roundtrips multiple agents without loss", () => {
    const fixtures = [FIXTURE_AGENT, FIXTURE_AGENT_2];
    writeAgentsConfig(fixtures);
    const read = readAgentConfigEntries();
    expect(read).toHaveLength(2);
    expect(read.map((a) => a.name)).toEqual(fixtures.map((a) => a.name));
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

  it("returns [] when no file exists", () => {
    const defs = readAgentsConfig();
    expect(defs).toHaveLength(0);
  });

  it("returns AgentDef[] with derived fields from file", () => {
    writeAgentsConfig([FIXTURE_AGENT, FIXTURE_AGENT_2]);
    const defs = readAgentsConfig();
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
