import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentSidebar } from "../agent-sidebar";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/components/hooks/use-agent-statuses", () => ({
  useAgentStatuses: () => ({}),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@@/lib/agents", () => ({
  AGENTS: [
    {
      name: "get-shit-done",
      displayName: "Get Shit Done",
      manifestKey: "get_shit_done",
      icon: () => null,
    },
  ],
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Dove button", () => {
    render(<AgentSidebar />);
    expect(screen.getByText("Dove")).toBeTruthy();
  });

  it("marks Dove as active when activeAgentId is 'dove' (default)", () => {
    render(<AgentSidebar activeAgentId="dove" onSelectAgent={vi.fn()} />);
    const doveBtn = screen.getByText("Dove").closest("button")!;
    expect(doveBtn.className).toContain("bg-blue-100");
  });

  it("calls onSelectAgent with 'dove' when the Dove button is clicked", () => {
    const onSelect = vi.fn();
    render(<AgentSidebar activeAgentId="get-shit-done" onSelectAgent={onSelect} />);
    fireEvent.click(screen.getByText("Dove").closest("button")!);
    expect(onSelect).toHaveBeenCalledWith("dove");
  });

  it("passes isActive=true to AgentButton for the matching agent", () => {
    render(<AgentSidebar activeAgentId="get-shit-done" onSelectAgent={vi.fn()} />);
    expect(screen.getByTestId("agent-btn-get-shit-done").dataset.active).toBe("true");
  });

  it("calls onSelectAgent with the agent name when an AgentButton is clicked", () => {
    const onSelect = vi.fn();
    render(<AgentSidebar activeAgentId="dove" onSelectAgent={onSelect} />);
    fireEvent.click(screen.getByTestId("agent-btn-get-shit-done"));
    expect(onSelect).toHaveBeenCalledWith("get-shit-done");
  });
});
