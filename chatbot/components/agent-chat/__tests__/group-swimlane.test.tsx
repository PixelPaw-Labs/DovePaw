import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ChatMessage } from "@/components/hooks/use-messages";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const mockIcon = () => null;

vi.mock("@@/lib/agents", () => ({
  buildAgentDef: (entry: AgentConfigEntry) => ({
    icon: mockIcon,
    iconBg: `bg-${entry.name}`,
    iconColor: `text-${entry.name}`,
    displayName: entry.displayName,
    doveCard: entry.doveCard,
  }),
}));
vi.mock("@/lib/avatars", () => ({ DOVE_AVATAR: "/dove.webp", USER_AVATAR: "/user.webp" }));
vi.mock("animejs", () => ({ animate: vi.fn(() => ({ cancel: vi.fn() })) }));

import { GroupChatView } from "../group-chat-view";
import { useGroupChatSession } from "@/components/hooks/use-group-chat-session";

vi.mock("@/components/hooks/use-group-chat-session", () => ({
  useGroupChatSession: vi.fn(),
}));

const text = (content: string): ChatMessage["segments"] => [{ type: "text", content }];

const makeAgent = (name: string): AgentConfigEntry => ({
  name,
  alias: name,
  displayName: name.toUpperCase(),
  description: "",
  iconName: "Bot",
  iconBg: "",
  iconColor: "",
  doveCard: { title: "", description: "", prompt: "", iconName: "Bot" },
  suggestions: [],
});

const agentConfigs: AgentConfigEntry[] = [makeAgent("dove"), makeAgent("alpha"), makeAgent("beta")];

function mockSession(messages: ChatMessage[]) {
  vi.mocked(useGroupChatSession).mockReturnValue({
    messages,
    isLoading: messages.some((m) => m.isLoading),
    agentStatuses: new Map(),
    sendToAgent: vi.fn(),
    clearMessages: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GroupChatView swimlane", () => {
  it("renders lanes with idle state when there are no messages", () => {
    mockSession([]);
    render(
      <GroupChatView
        groupName="Squad"
        memberAgentIds={["dove", "alpha", "beta"]}
        agentConfigs={agentConfigs}
      />,
    );
    expect(document.querySelectorAll("[data-lane]").length).toBe(2);
    expect(screen.getAllByText(/No activity yet/i).length).toBeGreaterThan(0);
  });

  it("renders one lane per non-Dove member, preserving order", () => {
    mockSession([
      { id: "1", role: "assistant", segments: text("hi"), agentId: "alpha" },
      { id: "2", role: "assistant", segments: text("hey"), agentId: "beta" },
    ]);
    render(
      <GroupChatView
        groupName="Squad"
        memberAgentIds={["dove", "alpha", "beta"]}
        agentConfigs={agentConfigs}
      />,
    );
    const lanes = Array.from(document.querySelectorAll("[data-lane]"));
    expect(lanes.map((el) => el.getAttribute("data-lane"))).toEqual(["alpha", "beta"]);
    expect(document.querySelector('[data-lane="dove"]')).toBeNull();
  });

  it("renders dove sender bubbles in the narrator strip, not as a lane", () => {
    mockSession([
      {
        id: "h1",
        role: "user",
        segments: text("Investigate the build"),
        agentId: "dove",
        senderAgentId: "dove",
      },
      { id: "a1", role: "assistant", segments: text("Looking now"), agentId: "alpha" },
    ]);
    render(
      <GroupChatView
        groupName="Squad"
        memberAgentIds={["dove", "alpha"]}
        agentConfigs={agentConfigs}
      />,
    );
    expect(screen.getByText(/Dove handoffs/i)).not.toBeNull();
    expect(screen.getByText(/Investigate the build/i)).not.toBeNull();
    expect(document.querySelector('[data-lane="dove"]')).toBeNull();
  });

  it("marks running messages with data-status='running'", () => {
    mockSession([
      { id: "1", role: "assistant", segments: text("…"), agentId: "alpha", isLoading: true },
    ]);
    render(
      <GroupChatView groupName="Squad" memberAgentIds={["alpha"]} agentConfigs={agentConfigs} />,
    );
    const dot = document.querySelector('[data-step-id="1"]');
    expect(dot?.getAttribute("data-status")).toBe("running");
  });

  it("colors done dots green (overriding the agent's iconBg)", () => {
    mockSession([
      { id: "done-1", role: "assistant", segments: text("finished"), agentId: "alpha" },
    ]);
    render(
      <GroupChatView groupName="Squad" memberAgentIds={["alpha"]} agentConfigs={agentConfigs} />,
    );
    const bubble = document.querySelector('[data-step-id="done-1"]');
    expect(bubble?.getAttribute("data-status")).toBe("done");
    // The first span child renders the dot itself
    const dot = bubble?.querySelector("span");
    expect(dot?.className).toContain("bg-green-500");
    expect(dot?.className).not.toContain("bg-alpha");
  });

  it("renders a single member lane cleanly (no extras)", () => {
    mockSession([{ id: "1", role: "assistant", segments: text("solo"), agentId: "alpha" }]);
    render(
      <GroupChatView groupName="Squad" memberAgentIds={["alpha"]} agentConfigs={agentConfigs} />,
    );
    const lanes = document.querySelectorAll("[data-lane]");
    expect(lanes).toHaveLength(1);
  });

  it("opens the step detail panel when a bubble is clicked, and closes on re-click", () => {
    mockSession([
      { id: "step-x", role: "assistant", segments: text("Full body text here."), agentId: "alpha" },
    ]);
    render(
      <GroupChatView groupName="Squad" memberAgentIds={["alpha"]} agentConfigs={agentConfigs} />,
    );
    const dot = document.querySelector('[data-step-id="step-x"]') as HTMLElement;
    fireEvent.click(dot);
    expect(document.querySelector("[data-step-detail]")).not.toBeNull();
    expect(screen.getByText("Full body text here.")).not.toBeNull();
    expect(dot.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(dot);
    expect(dot.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens a dialog with the full handoff message when a narrator pill is clicked", () => {
    const longInstruction =
      "Investigate why the staging build is failing on the new auth migration. Pay attention to the env vars in the Buildkite step — they were recently rotated and may not have propagated to all agents.";
    mockSession([
      {
        id: "h1",
        role: "user",
        segments: text(longInstruction),
        agentId: "dove",
        senderAgentId: "dove",
      },
    ]);
    render(
      <GroupChatView
        groupName="Squad"
        memberAgentIds={["dove", "alpha"]}
        agentConfigs={agentConfigs}
      />,
    );
    const pillButton = screen.getByRole("button", { name: /open handoff message/i });
    fireEvent.click(pillButton);
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain(longInstruction);
  });

  it("does not render the chat input bar (view-only)", () => {
    mockSession([]);
    render(
      <GroupChatView groupName="Squad" memberAgentIds={["alpha"]} agentConfigs={agentConfigs} />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
