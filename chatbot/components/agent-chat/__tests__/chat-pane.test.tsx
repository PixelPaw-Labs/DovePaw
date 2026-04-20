import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
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
vi.mock("../question-banner", () => ({
  QuestionBanner: ({
    request,
    onSubmit,
  }: {
    request: { requestId: string };
    onSubmit: (a: Record<string, string>) => void;
  }) => (
    <div data-testid={`question-banner-${request.requestId}`}>
      <button type="button" onClick={() => onSubmit({})}>
        Submit
      </button>
    </div>
  ),
}));
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
  { message: "Starting…", artifacts: {} as Record<string, string> },
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQuestion(id: string) {
  return {
    type: "question" as const,
    requestId: id,
    questions: [
      {
        header: "Q",
        question: "Pick one",
        options: [{ label: "A", description: "" }],
        multiSelect: false,
      },
    ],
  };
}

// ─── Question navigation ───────────────────────────────────────────────────────

describe("ChatPane — pending question navigation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a single banner with no nav when there is one pending question", () => {
    render(<ChatPane {...makeProps({ pendingQuestions: [makeQuestion("q1")] })} />);
    expect(screen.getByTestId("question-banner-q1")).toBeTruthy();
    expect(screen.queryByText(/Question/)).toBeNull();
    expect(screen.queryByText("Prev")).toBeNull();
    expect(screen.queryByText("Next")).toBeNull();
  });

  it("shows counter and nav buttons when there are multiple pending questions", () => {
    render(
      <ChatPane {...makeProps({ pendingQuestions: [makeQuestion("q1"), makeQuestion("q2")] })} />,
    );
    expect(screen.getByText("1")).toBeTruthy(); // active index label
    expect(screen.getByText("Prev")).toBeTruthy();
    expect(screen.getByText("Next")).toBeTruthy();
  });

  it("starts on the first question and Prev is disabled", () => {
    render(
      <ChatPane {...makeProps({ pendingQuestions: [makeQuestion("q1"), makeQuestion("q2")] })} />,
    );
    expect(screen.getByTestId("question-banner-q1")).toBeTruthy();
    expect(screen.queryByTestId("question-banner-q2")).toBeNull();
    expect((screen.getByText("Prev") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("advances to the next question on Next click", () => {
    render(
      <ChatPane {...makeProps({ pendingQuestions: [makeQuestion("q1"), makeQuestion("q2")] })} />,
    );
    fireEvent.click(screen.getByText("Next"));
    expect(screen.queryByTestId("question-banner-q1")).toBeNull();
    expect(screen.getByTestId("question-banner-q2")).toBeTruthy();
    expect((screen.getByText("Next") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Prev") as HTMLButtonElement).disabled).toBe(false);
  });

  it("goes back on Prev click", () => {
    render(
      <ChatPane {...makeProps({ pendingQuestions: [makeQuestion("q1"), makeQuestion("q2")] })} />,
    );
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Prev"));
    expect(screen.getByTestId("question-banner-q1")).toBeTruthy();
    expect(screen.queryByTestId("question-banner-q2")).toBeNull();
  });

  it("does not crash when the last remaining question is submitted", () => {
    const resolveQuestion = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ChatPane {...makeProps({ pendingQuestions: [makeQuestion("q1")], resolveQuestion })} />,
    );
    fireEvent.click(screen.getByText("Submit"));
    // Simulate parent removing the resolved question
    rerender(<ChatPane {...makeProps({ pendingQuestions: [], resolveQuestion })} />);
    expect(screen.queryByTestId("question-banner-q1")).toBeNull();
  });

  it("stays in bounds when resolving the last question out of two", () => {
    const resolveQuestion = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ChatPane
        {...makeProps({
          pendingQuestions: [makeQuestion("q1"), makeQuestion("q2")],
          resolveQuestion,
        })}
      />,
    );
    // Navigate to q2, then submit it
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Submit"));
    // Parent removes q2; only q1 remains
    rerender(
      <ChatPane {...makeProps({ pendingQuestions: [makeQuestion("q1")], resolveQuestion })} />,
    );
    expect(screen.getByTestId("question-banner-q1")).toBeTruthy();
  });
});
