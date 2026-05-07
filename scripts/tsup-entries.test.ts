import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { buildTsupEntries } from "./tsup-entries.js";
import type { AgentConfigEntry } from "../lib/agents-config-schemas.js";

function makeEntry(overrides: Partial<AgentConfigEntry> = {}): AgentConfigEntry {
  return {
    name: "my-agent",
    displayName: "My Agent",
    description: "desc",
    schedulingEnabled: true,
    envVars: [],
    repos: [],
    suggestions: [],
    ...overrides,
  } as AgentConfigEntry;
}

describe("buildTsupEntries", () => {
  it("includes agents with default main.ts", () => {
    const entries = buildTsupEntries([makeEntry({ name: "my-agent" })]);
    expect(entries["agents/my-agent"]).toBe("agent-local/my-agent/main.ts");
  });

  it("excludes agents with a .sh scriptFile", () => {
    const entries = buildTsupEntries([makeEntry({ name: "my-agent", scriptFile: "main.sh" })]);
    expect(entries).toEqual({});
  });

  it("excludes agents with a .py scriptFile", () => {
    const entries = buildTsupEntries([makeEntry({ name: "my-agent", scriptFile: "main.py" })]);
    expect(entries).toEqual({});
  });

  it("includes agents with a .ts scriptFile and uses it for the path", () => {
    const entries = buildTsupEntries([makeEntry({ name: "my-agent", scriptFile: "custom.ts" })]);
    expect(entries["agents/my-agent"]).toBe("agent-local/my-agent/custom.ts");
  });

  it("uses pluginPath + join for plugin agents", () => {
    const entries = buildTsupEntries([
      makeEntry({ name: "my-agent", pluginPath: "/plugins/my-plugin" }),
    ]);
    expect(entries["agents/my-agent"]).toBe(
      join("/plugins/my-plugin", "agents", "my-agent", "main.ts"),
    );
  });

  it("mixes TS and non-TS agents, only TS agents appear in output", () => {
    const entries = buildTsupEntries([
      makeEntry({ name: "agent-ts" }),
      makeEntry({ name: "agent-sh", scriptFile: "main.sh" }),
      makeEntry({ name: "agent-custom", scriptFile: "run.ts" }),
    ]);
    expect(Object.keys(entries)).toEqual(["agents/agent-ts", "agents/agent-custom"]);
  });
});
