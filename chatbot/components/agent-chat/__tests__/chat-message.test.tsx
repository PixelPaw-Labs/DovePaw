import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { resolveAvatar, ChatMessageItem } from "../chat-message";
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
  Reasoning: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="reasoning">{children}</div>
  ),
  ReasoningContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReasoningTrigger: () => null,
}));
vi.mock("@/components/ai-elements/shimmer", () => ({
  Shimmer: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
  },
];

const assistantMsg: ChatMessage = {
  id: "a1",
  role: "assistant",
  segments: [{ type: "text", content: "Hello" }],
  agentId: "zendesk-triager",
  processContent: "thinking...",
};

const userMsg: ChatMessage = {
  id: "u1",
  role: "user",
  segments: [{ type: "text", content: "Hi" }],
};

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

describe("ChatMessageItem hideReasoning", () => {
  it("renders reasoning block by default", () => {
    const { getByTestId } = render(
      <ChatMessageItem msg={assistantMsg} agentConfigs={agentConfigs} />,
    );
    expect(getByTestId("reasoning")).toBeTruthy();
  });

  it("hides reasoning block when hideReasoning=true", () => {
    const { queryByTestId } = render(
      <ChatMessageItem msg={assistantMsg} agentConfigs={agentConfigs} hideReasoning />,
    );
    expect(queryByTestId("reasoning")).toBeNull();
  });
});

describe("ChatMessageItem hideAvatars", () => {
  it("renders user avatar img by default for user message", () => {
    const { container } = render(<ChatMessageItem msg={userMsg} agentConfigs={agentConfigs} />);
    expect(container.querySelector('img[alt="You"]')).toBeTruthy();
  });

  it("omits user avatar when hideAvatars=true", () => {
    const { container } = render(
      <ChatMessageItem msg={userMsg} agentConfigs={agentConfigs} hideAvatars />,
    );
    expect(container.querySelector('img[alt="You"]')).toBeNull();
  });

  it("renders dove avatar by default for assistant message with no agentId", () => {
    const msg: ChatMessage = { ...assistantMsg, agentId: undefined };
    const { container } = render(<ChatMessageItem msg={msg} agentConfigs={agentConfigs} />);
    expect(container.querySelector('img[alt="Dove"]')).toBeTruthy();
  });

  it("omits assistant avatar when hideAvatars=true", () => {
    const msg: ChatMessage = { ...assistantMsg, agentId: undefined };
    const { container } = render(
      <ChatMessageItem msg={msg} agentConfigs={agentConfigs} hideAvatars />,
    );
    expect(container.querySelector('img[alt="Dove"]')).toBeNull();
  });
});
