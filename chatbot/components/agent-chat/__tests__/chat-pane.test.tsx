import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ChatPane } from "../chat-pane";
import type { ChatPaneProps } from "../chat-pane";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@@/lib/agents", () => ({
  buildAgentDef: () => ({ icon: () => null, iconBg: "", iconColor: "", displayName: "Agent" }),
}));
vi.mock("@/lib/avatars", () => ({ DOVE_AVATAR: "", USER_AVATAR: "" }));
vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationEmptyState: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
  ConversationScrollButton: () => null,
}));
vi.mock("../chat-input-bar", () => ({ ChatInputBar: () => null }));
vi.mock("../processing-bar", () => ({ ProcessingBar: () => null }));
vi.mock("../permission-banner", () => ({ PermissionBanner: () => null }));
vi.mock("../chat-message", () => ({
  ChatMessageItem: ({ msg }: { msg: { id: string } }) => <div data-testid={`msg-${msg.id}`} />,
}));
vi.mock("../intro-card", () => ({
  IntroCard: () => <div data-testid="intro-card" />,
}));
vi.mock("@/components/workflow/workflow-panel", () => ({
  WorkflowPanel: ({ progress }: { progress: unknown[] }) => (
    <div data-testid="workflow-panel" data-entries={progress.length} />
  ),
}));
vi.mock("../session-history-panel", () => ({
  SessionHistoryPanel: () => <div data-testid="session-history-panel" />,
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const emptyUserMsg = {
  id: "u1",
  role: "user" as const,
  segments: [{ type: "text" as const, content: "" }],
};

const visibleUserMsg = {
  id: "u2",
  role: "user" as const,
  segments: [{ type: "text" as const, content: "Hello" }],
};

const progressEntries = [
  { message: "Starting…", artifacts: {} },
  { message: "tool-call", artifacts: { "tool-call": "bash", label: "bash" } },
];

function makeProps(overrides: Partial<ChatPaneProps> = {}): ChatPaneProps {
  return {
    agentId: "oncall-analyzer",
    agentConfigs: [],
    messages: [],
    sessionProgress: [],
    sessionCancelled: false,
    isLoading: false,
    currentSessionId: "session-1",
    pendingPermissions: [],
    pendingQuestions: [],
    pendingQueue: [],
    sendMessage: vi.fn(),
    cancelMessage: vi.fn(),
    newSession: vi.fn(),
    deleteSession: vi.fn(),
    setSessionId: vi.fn(),
    resolvePermission: vi.fn(),
    resolveQuestion: vi.fn(),
    removeFromQueue: vi.fn(),
    sessions: [],
    runningSessionIds: new Set(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ChatPane — visible message detection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows IntroCard when messages is empty", () => {
    render(<ChatPane {...makeProps({ messages: [] })} />);
    expect(screen.getByTestId("intro-card")).toBeTruthy();
  });

  it("shows IntroCard when messages only has empty-content user message", () => {
    render(<ChatPane {...makeProps({ messages: [emptyUserMsg] })} />);
    expect(screen.getByTestId("intro-card")).toBeTruthy();
  });

  it("hides IntroCard and renders messages when there is visible content", () => {
    render(<ChatPane {...makeProps({ messages: [visibleUserMsg] })} />);
    expect(screen.queryByTestId("intro-card")).toBeNull();
    expect(screen.getByTestId("msg-u2")).toBeTruthy();
  });

  it("hides Clear chat button when messages have no visible content", () => {
    render(<ChatPane {...makeProps({ messages: [emptyUserMsg] })} />);
    expect(screen.queryByTitle("Clear chat")).toBeNull();
  });

  it("shows Clear chat button when messages have visible content", () => {
    render(<ChatPane {...makeProps({ messages: [visibleUserMsg] })} />);
    expect(screen.getByTitle("Clear chat")).toBeTruthy();
  });
});

describe("ChatPane — workflow auto-open for history sessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("auto-opens workflow panel when progress exists and no visible messages", async () => {
    render(
      <ChatPane {...makeProps({ messages: [emptyUserMsg], sessionProgress: progressEntries })} />,
    );
    // WorkflowPanel should be rendered after the useEffect fires
    await act(async () => {});
    expect(screen.getByTestId("workflow-panel")).toBeTruthy();
  });

  it("does not auto-open workflow panel when messages have visible content", async () => {
    render(
      <ChatPane {...makeProps({ messages: [visibleUserMsg], sessionProgress: progressEntries })} />,
    );
    await act(async () => {});
    expect(screen.queryByTestId("workflow-panel")).toBeNull();
  });

  it("does not auto-open workflow panel when progress is empty", async () => {
    render(<ChatPane {...makeProps({ messages: [emptyUserMsg], sessionProgress: [] })} />);
    await act(async () => {});
    expect(screen.queryByTestId("workflow-panel")).toBeNull();
  });

  it("does not auto-open while loading", async () => {
    render(
      <ChatPane
        {...makeProps({
          messages: [emptyUserMsg],
          sessionProgress: progressEntries,
          isLoading: true,
        })}
      />,
    );
    await act(async () => {});
    expect(screen.queryByTestId("workflow-panel")).toBeNull();
  });
});
