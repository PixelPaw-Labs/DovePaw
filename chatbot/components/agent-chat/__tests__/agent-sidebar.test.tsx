import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentSidebar } from "../agent-sidebar";
import { ConversationProvider } from "@/components/hooks/use-conversation-context";

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ConversationProvider isLoading={false} activeAgentId="dove" doveIsRunning={false}>
      {children}
    </ConversationProvider>
  );
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/components/hooks/use-agent-heartbeat", () => ({
  useAgentHeartbeat: () => ({}),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@@/lib/agents", () => ({
  buildAgentDef: (entry: { name: string; displayName: string }) => ({
    ...entry,
    manifestKey: entry.name.replaceAll("-", "_"),
    icon: () => null,
    schedule: undefined,
  }),
}));

// AgentButton is a real component but has its own deps — stub it to keep tests focused
vi.mock("../agent-button", () => ({
  AgentButton: ({
    agent,
    isActive,
    onClick,
  }: {
    agent: { name: string; displayName: string };
    isActive: boolean;
    onClick: () => void;
  }) => (
    <button data-testid={`agent-btn-${agent.name}`} data-active={isActive} onClick={onClick}>
      {agent.displayName}
    </button>
  ),
}));

const agentConfig = {
  name: "get-shit-done",
  displayName: "Get Shit Done",
  doveCard: { title: "", description: "", prompt: "" },
  suggestions: [],
} as unknown as Parameters<typeof AgentSidebar>[0]["agentConfigs"][0];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSidebar — without ConversationProvider", () => {
  it("renders without throwing when outside a ConversationProvider", () => {
    render(<AgentSidebar agentConfigs={[agentConfig]} />);
    expect(screen.getByText("Dove")).toBeTruthy();
  });
});

describe("AgentSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Dove button", () => {
    render(
      <AgentSidebar
        agentConfigs={[
          {
            name: "get-shit-done",
            displayName: "Get Shit Done",
            doveCard: { title: "", description: "", prompt: "" },
            suggestions: [],
          } as unknown as Parameters<typeof AgentSidebar>[0]["agentConfigs"][0],
        ]}
      />,
      { wrapper },
    );
    expect(screen.getByText("Dove")).toBeTruthy();
  });

  it("marks Dove as active when activeAgentId is 'dove' (default)", () => {
    render(
      <AgentSidebar
        agentConfigs={[
          {
            name: "get-shit-done",
            displayName: "Get Shit Done",
            doveCard: { title: "", description: "", prompt: "" },
            suggestions: [],
          } as unknown as Parameters<typeof AgentSidebar>[0]["agentConfigs"][0],
        ]}
        activeAgentId="dove"
        onSelectAgent={vi.fn()}
      />,
      { wrapper },
    );
    const doveBtn = screen.getByText("Dove").closest("button")!;
    expect(doveBtn.className).toContain("bg-primary/10");
  });

  it("calls onSelectAgent with 'dove' when the Dove button is clicked", () => {
    const onSelect = vi.fn();
    render(
      <AgentSidebar
        agentConfigs={[
          {
            name: "get-shit-done",
            displayName: "Get Shit Done",
            doveCard: { title: "", description: "", prompt: "" },
            suggestions: [],
          } as unknown as Parameters<typeof AgentSidebar>[0]["agentConfigs"][0],
        ]}
        activeAgentId="get-shit-done"
        onSelectAgent={onSelect}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByText("Dove").closest("button")!);
    expect(onSelect).toHaveBeenCalledWith("dove");
  });

  it("passes isActive=true to AgentButton for the matching agent", () => {
    render(
      <AgentSidebar
        agentConfigs={[
          {
            name: "get-shit-done",
            displayName: "Get Shit Done",
            doveCard: { title: "", description: "", prompt: "" },
            suggestions: [],
          } as unknown as Parameters<typeof AgentSidebar>[0]["agentConfigs"][0],
        ]}
        activeAgentId="get-shit-done"
        onSelectAgent={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByTestId("agent-btn-get-shit-done").dataset.active).toBe("true");
  });

  it("calls onSelectAgent with the agent name when an AgentButton is clicked", () => {
    const onSelect = vi.fn();
    render(
      <AgentSidebar
        agentConfigs={[
          {
            name: "get-shit-done",
            displayName: "Get Shit Done",
            doveCard: { title: "", description: "", prompt: "" },
            suggestions: [],
          } as unknown as Parameters<typeof AgentSidebar>[0]["agentConfigs"][0],
        ]}
        activeAgentId="dove"
        onSelectAgent={onSelect}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByTestId("agent-btn-get-shit-done"));
    expect(onSelect).toHaveBeenCalledWith("get-shit-done");
  });
});
