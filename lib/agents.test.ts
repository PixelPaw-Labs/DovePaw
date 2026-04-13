import { describe, expect, it } from "vitest";
import { Bot, Brain, Zap } from "lucide-react";
import { buildAgentDef } from "./agents.js";
import { DEFAULT_ICON_STYLE } from "./icon-registry.js";
import type { AgentConfigEntry } from "./agents-config-schemas.js";

const BASE_ENTRY: AgentConfigEntry = {
  name: "my-agent",
  alias: "ma",
  displayName: "My Agent",
  description: "A test agent",
  doveCard: { title: "My Agent", description: "What does it do?", prompt: "What does it do?" },
  suggestions: [{ title: "Run now", description: "Run it", prompt: "Run my-agent now" }],
};

describe("buildAgentDef — icon resolution", () => {
  it("resolves iconName to the correct LucideIcon", () => {
    const def = buildAgentDef({ ...BASE_ENTRY, iconName: "Brain" });
    expect(def.icon).toBe(Brain);
  });

  it("falls back to Bot when iconName is absent", () => {
    const def = buildAgentDef(BASE_ENTRY);
    expect(def.icon).toBe(Bot);
  });

  it("falls back to Bot for an unknown iconName", () => {
    const def = buildAgentDef({ ...BASE_ENTRY, iconName: "DoesNotExist" });
    expect(def.icon).toBe(Bot);
  });
});

describe("buildAgentDef — color fields", () => {
  it("uses iconBg and iconColor from the entry on AgentDef", () => {
    const def = buildAgentDef({
      ...BASE_ENTRY,
      iconBg: "bg-yellow-100 group-hover:bg-primary",
      iconColor: "text-yellow-700 group-hover:text-primary-foreground",
    });
    expect(def.iconBg).toBe("bg-yellow-100 group-hover:bg-primary");
    expect(def.iconColor).toBe("text-yellow-700 group-hover:text-primary-foreground");
  });

  it("falls back to DEFAULT_ICON_STYLE when iconBg/iconColor are absent", () => {
    const def = buildAgentDef(BASE_ENTRY);
    expect(def.iconBg).toBe(DEFAULT_ICON_STYLE.iconBg);
    expect(def.iconColor).toBe(DEFAULT_ICON_STYLE.iconColor);
  });

  it("propagates iconBg/iconColor to doveCard", () => {
    const def = buildAgentDef({
      ...BASE_ENTRY,
      iconBg: "bg-purple-100 group-hover:bg-primary",
      iconColor: "text-purple-700 group-hover:text-primary-foreground",
    });
    expect(def.doveCard.iconBg).toBe("bg-purple-100 group-hover:bg-primary");
    expect(def.doveCard.iconColor).toBe("text-purple-700 group-hover:text-primary-foreground");
  });

  it("propagates iconBg/iconColor to all suggestions", () => {
    const def = buildAgentDef({
      ...BASE_ENTRY,
      iconBg: "bg-red-100 group-hover:bg-primary",
      iconColor: "text-red-600 group-hover:text-primary-foreground",
    });
    for (const s of def.suggestions) {
      expect(s.iconBg).toBe("bg-red-100 group-hover:bg-primary");
      expect(s.iconColor).toBe("text-red-600 group-hover:text-primary-foreground");
    }
  });
});

describe("buildAgentDef — per-suggestion icon override", () => {
  it("uses suggestion iconName when provided", () => {
    const def = buildAgentDef({
      ...BASE_ENTRY,
      iconName: "Brain",
      suggestions: [{ title: "Custom", description: "desc", prompt: "prompt", iconName: "Zap" }],
    });
    expect(def.suggestions[0]!.icon).toBe(Zap);
  });

  it("falls back to agent iconName when suggestion has no iconName", () => {
    const def = buildAgentDef({
      ...BASE_ENTRY,
      iconName: "Brain",
      suggestions: [{ title: "Default", description: "desc", prompt: "prompt" }],
    });
    expect(def.suggestions[0]!.icon).toBe(Brain);
  });
});

describe("buildAgentDef — derived fields", () => {
  it("derives manifestKey by replacing hyphens with underscores", () => {
    const def = buildAgentDef({ ...BASE_ENTRY, name: "get-shit-done" });
    expect(def.manifestKey).toBe("get_shit_done");
  });

  it("derives toolName as yolo_<manifestKey>", () => {
    const def = buildAgentDef({ ...BASE_ENTRY, name: "my-agent" });
    expect(def.toolName).toBe("yolo_my_agent");
  });
});

describe("buildAgentDef — pluginPath", () => {
  it("propagates pluginPath when set", () => {
    const def = buildAgentDef({
      ...BASE_ENTRY,
      pluginPath: "/home/user/.dovepaw/plugins/my-plugin",
    });
    expect(def.pluginPath).toBe("/home/user/.dovepaw/plugins/my-plugin");
  });

  it("leaves pluginPath undefined when absent", () => {
    const def = buildAgentDef(BASE_ENTRY);
    expect(def.pluginPath).toBeUndefined();
  });
});
