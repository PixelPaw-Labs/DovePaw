import { describe, expect, it } from "vitest";
import { resolvePluginName, groupAgentsByPlugin } from "@@/lib/agent-groups";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";

const makeAgent = (name: string, pluginPath?: string): AgentConfigEntry => ({
  name,
  alias: name.slice(0, 3),
  displayName: name,
  description: "desc",
  scheduleDisplay: "on demand",
  doveCard: { title: name, description: "", prompt: "" },
  suggestions: [],
  pluginPath,
});

describe("resolvePluginName", () => {
  it("returns canonical name from registry when plugin path matches", () => {
    const plugins = [{ path: "/home/.dovepaw/plugins/my-plugin", name: "my-plugin" }];
    expect(resolvePluginName("/home/.dovepaw/plugins/my-plugin", plugins)).toBe("my-plugin");
  });

  it("falls back to path basename when no registry match", () => {
    expect(resolvePluginName("/home/.dovepaw/plugins/my-plugin", [])).toBe("my-plugin");
  });

  it("returns full path when basename is empty (trailing slash edge case)", () => {
    const result = resolvePluginName("/some/path", []);
    expect(result).toBe("path");
  });

  it("uses registry name over path basename when they differ", () => {
    const plugins = [{ path: "/some/path", name: "canonical-name" }];
    expect(resolvePluginName("/some/path", plugins)).toBe("canonical-name");
  });
});

describe("groupAgentsByPlugin", () => {
  it("returns empty when no agents", () => {
    expect(groupAgentsByPlugin([])).toEqual([]);
  });

  it("places agents without pluginPath in ungrouped group with empty name", () => {
    const agents = [makeAgent("dove")];
    const groups = groupAgentsByPlugin(agents);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.pluginName).toBe("");
    expect(groups[0]?.agents).toHaveLength(1);
  });

  it("groups agents by plugin path basename", () => {
    const agents = [
      makeAgent("blog-writer", "/home/.dovepaw/plugins/dovepaw-plugins"),
      makeAgent("memory-distiller", "/home/.dovepaw/plugins/dovepaw-plugins"),
    ];
    const groups = groupAgentsByPlugin(agents);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.pluginName).toBe("dovepaw-plugins");
    expect(groups[0]?.agents).toHaveLength(2);
  });

  it("creates separate groups for different plugins", () => {
    const agents = [
      makeAgent("agent-a", "/home/.dovepaw/plugins/plugin-one"),
      makeAgent("agent-b", "/home/.dovepaw/plugins/plugin-two"),
    ];
    const groups = groupAgentsByPlugin(agents);
    expect(groups).toHaveLength(2);
    const names = groups.map((g) => g.pluginName).toSorted();
    expect(names).toEqual(["plugin-one", "plugin-two"]);
  });

  it("puts ungrouped agents first before plugin groups", () => {
    const agents = [
      makeAgent("ungrouped"),
      makeAgent("plugin-agent", "/home/.dovepaw/plugins/my-plugin"),
    ];
    const groups = groupAgentsByPlugin(agents);
    expect(groups[0]?.pluginName).toBe("");
    expect(groups[1]?.pluginName).toBe("my-plugin");
  });

  it("adds Kilin group at the end when tmp agents provided", () => {
    const agents = [makeAgent("agent-a", "/home/.dovepaw/plugins/my-plugin")];
    const tmpAgents = [makeAgent("session-agent")];
    const groups = groupAgentsByPlugin(agents, tmpAgents);
    expect(groups).toHaveLength(2);
    const last = groups[groups.length - 1]!;
    expect(last.pluginName).toBe("Kilin");
    expect(last.temporary).toBe(true);
    expect(last.agents).toHaveLength(1);
  });

  it("omits Kilin group when tmpAgents is empty", () => {
    const agents = [makeAgent("agent-a", "/home/.dovepaw/plugins/my-plugin")];
    const groups = groupAgentsByPlugin(agents, []);
    expect(groups.find((g) => g.pluginName === "Kilin")).toBeUndefined();
  });

  it("uses canonical plugin name from registry over path basename", () => {
    const agents = [makeAgent("agent-a", "/home/.dovepaw/plugins/my-plugin")];
    const plugins = [{ path: "/home/.dovepaw/plugins/my-plugin", name: "canonical-name" }];
    const groups = groupAgentsByPlugin(agents, [], plugins);
    expect(groups[0]?.pluginName).toBe("canonical-name");
  });
});
