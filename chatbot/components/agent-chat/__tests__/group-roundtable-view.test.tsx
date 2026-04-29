import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { GroupRoundtableView, bucketOf, arcFor, USER_BUCKET } from "../group-roundtable-view";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { ChatMessage } from "@/components/hooks/use-messages";

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
vi.mock("animejs", () => ({ animate: vi.fn() }));
vi.mock("../animated-message", () => ({
  AnimatedMessage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../copy-action", () => ({ CopyAction: () => null }));
vi.mock("../tool-call-badge", () => ({ EditDiffList: () => null, ToolCallItem: () => null }));
vi.mock("@/components/ai-elements/message", () => ({
  MessageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageResponse: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ai-elements/reasoning", () => ({
  Reasoning: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReasoningContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReasoningTrigger: () => null,
}));
vi.mock("@/components/ai-elements/shimmer", () => ({
  Shimmer: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

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

const agentConfigs: AgentConfigEntry[] = [makeAgent("alpha"), makeAgent("beta")];

const text = (content: string): ChatMessage["segments"] => [{ type: "text", content }];

describe("bucketOf", () => {
  it("buckets assistant messages by agentId", () => {
    expect(bucketOf({ id: "1", role: "assistant", segments: text("hi"), agentId: "alpha" })).toBe(
      "alpha",
    );
  });

  it("buckets human-typed user messages into the user slot", () => {
    expect(bucketOf({ id: "1", role: "user", segments: text("hi"), agentId: "alpha" })).toBe(
      USER_BUCKET,
    );
  });

  it("buckets orchestrator user messages by senderAgentId", () => {
    expect(
      bucketOf({
        id: "1",
        role: "user",
        segments: text("instruction"),
        agentId: "alpha",
        senderAgentId: "alpha",
      }),
    ).toBe("alpha");
  });
});

describe("arcFor", () => {
  it("draws user → recipient for human-typed messages", () => {
    const msgs: ChatMessage[] = [{ id: "1", role: "user", segments: text("hi"), agentId: "alpha" }];
    expect(arcFor(msgs, 0)).toEqual({ from: USER_BUCKET, to: "alpha", msgId: "1" });
  });

  it("draws prev-bucket → current for assistant replies", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "user", segments: text("hi"), agentId: "alpha" },
      { id: "2", role: "assistant", segments: text("hello"), agentId: "alpha" },
    ];
    expect(arcFor(msgs, 1)).toEqual({ from: USER_BUCKET, to: "alpha", msgId: "2" });
  });

  it("returns null when no prior message has a different bucket", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", segments: text("hi"), agentId: "alpha" },
    ];
    expect(arcFor(msgs, 0)).toBeNull();
  });

  it("skips arcs for orchestrator user messages with no recipient encoded", () => {
    const msgs: ChatMessage[] = [
      {
        id: "1",
        role: "user",
        segments: text("go"),
        agentId: "alpha",
        senderAgentId: "alpha",
      },
    ];
    expect(arcFor(msgs, 0)).toBeNull();
  });
});

describe("GroupRoundtableView layout", () => {
  it("renders a slot per member, excluding the user bucket", () => {
    const { container } = render(
      <GroupRoundtableView
        messages={[]}
        memberAgentIds={["alpha", "beta"]}
        agentConfigs={agentConfigs}
      />,
    );
    const slots = container.querySelectorAll("[data-bucket]");
    expect(slots.length).toBe(2);
    const buckets = Array.from(slots).map((el) => el.getAttribute("data-bucket"));
    expect(buckets).toContain("alpha");
    expect(buckets).toContain("beta");
    expect(buckets).not.toContain(USER_BUCKET);
  });

  it("shows only the latest message per bucket by default", () => {
    const messages: ChatMessage[] = [
      { id: "a1", role: "assistant", segments: text("first from alpha"), agentId: "alpha" },
      { id: "a2", role: "assistant", segments: text("second from alpha"), agentId: "alpha" },
      { id: "b1", role: "assistant", segments: text("only from beta"), agentId: "beta" },
    ];
    const { container } = render(
      <GroupRoundtableView
        messages={messages}
        memberAgentIds={["alpha", "beta"]}
        agentConfigs={agentConfigs}
      />,
    );
    const alphaSlot = container.querySelector('[data-bucket="alpha"]')!;
    expect(alphaSlot.textContent).toContain("second from alpha");
    expect(alphaSlot.textContent).not.toContain("first from alpha");
  });

  it("shows placeholder when a member has no messages yet", () => {
    const { container } = render(
      <GroupRoundtableView messages={[]} memberAgentIds={["alpha"]} agentConfigs={agentConfigs} />,
    );
    const slot = container.querySelector('[data-bucket="alpha"]')!;
    expect(slot.textContent).toContain("—");
  });

  it("marks an agent slot as active when it is the handoff host", () => {
    const messages: ChatMessage[] = [
      { id: "b1", role: "assistant", segments: text("from beta"), agentId: "beta" },
      {
        id: "a1",
        role: "assistant",
        segments: text("streaming…"),
        agentId: "alpha",
        isLoading: true,
      },
    ];
    const { container } = render(
      <GroupRoundtableView
        messages={messages}
        memberAgentIds={["alpha", "beta"]}
        agentConfigs={agentConfigs}
      />,
    );
    const alpha = container.querySelector('[data-bucket="alpha"]')!;
    const beta = container.querySelector('[data-bucket="beta"]')!;
    expect(alpha.getAttribute("data-active")).toBe("true");
    expect(beta.getAttribute("data-active")).toBe("false");
  });
});
