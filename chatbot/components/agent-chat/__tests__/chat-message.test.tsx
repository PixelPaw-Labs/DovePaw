import { describe, expect, it, vi } from "vitest";
import { resolveAvatar } from "../chat-message";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";

const mockIcon = () => null;

vi.mock("@@/lib/agents", () => ({
  buildAgentDef: (entry: AgentConfigEntry) => ({
    icon: mockIcon,
    iconBg: `bg-${entry.name}`,
    iconColor: `text-${entry.name}`,
  }),
}));

const agentConfigs: AgentConfigEntry[] = [
  {
    name: "zendesk-triager",
    alias: "zt",
    displayName: "Zendesk Triager",
    description: "Triage Zendesk tickets",
    iconName: "MessageSquare",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    doveCard: { title: "Triage", description: "", prompt: "", iconName: "MessageSquare" },
    suggestions: [],

    scheduleDisplay: "on demand",
  },
];

describe("resolveAvatar", () => {
  it("returns dove for undefined agentId", () => {
    expect(resolveAvatar(undefined, agentConfigs)).toEqual({ type: "dove" });
  });

  it("returns dove for agentId 'dove'", () => {
    expect(resolveAvatar("dove", agentConfigs)).toEqual({ type: "dove" });
  });

  it("returns dove when agentId is not found in configs", () => {
    expect(resolveAvatar("unknown-agent", agentConfigs)).toEqual({ type: "dove" });
  });

  it("returns dove when agentConfigs is undefined", () => {
    expect(resolveAvatar("zendesk-triager", undefined)).toEqual({ type: "dove" });
  });

  it("returns agent info for a known subagent", () => {
    const result = resolveAvatar("zendesk-triager", agentConfigs);
    expect(result.type).toBe("agent");
    if (result.type === "agent") {
      expect(result.icon).toBe(mockIcon);
      expect(result.iconBg).toBe("bg-zendesk-triager");
      expect(result.iconColor).toBe("text-zendesk-triager");
    }
  });
});
