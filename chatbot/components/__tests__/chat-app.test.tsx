import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ChatApp } from "../chat-app";
import { useConversationContext } from "@/components/hooks/use-conversation-context";

// ─── Captured callbacks ────────────────────────────────────────────────────────

let capturedOnSelectAgent: ((id: string) => void) | undefined;
let capturedOnIsLoadingChange: ((loading: boolean) => void) | undefined;

// ─── Context observer ──────────────────────────────────────────────────────────

function ContextObserver() {
  const { isLoading } = useConversationContext();
  return <span data-testid="is-loading">{String(isLoading)}</span>;
}

// ─── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/components/agent-chat/agent-sidebar", () => ({
  AgentSidebar: ({ onSelectAgent }: { onSelectAgent?: (id: string) => void }) => {
    capturedOnSelectAgent = onSelectAgent;
    return (
      <div>
        <ContextObserver />
        <button onClick={() => onSelectAgent?.("forge")}>Switch to Forge</button>
      </div>
    );
  },
}));

vi.mock("@/components/agent-chat", () => ({
  AgentChat: ({
    onIsLoadingChange,
    onNewSession,
  }: {
    onIsLoadingChange?: (loading: boolean) => void;
    onNewSession?: (fn: () => void) => void;
  }) => {
    capturedOnIsLoadingChange = onIsLoadingChange;
    onNewSession?.(() => {});
    return <div>AgentChat</div>;
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("ChatApp — agent switching resets isLoading", () => {
  it("resets isLoading to false when switching to a different agent", () => {
    render(<ChatApp agentConfigs={[]} />);

    // Simulate the current agent emitting a loading state
    act(() => {
      capturedOnIsLoadingChange?.(true);
    });
    expect(screen.getByTestId("is-loading").textContent).toBe("true");

    // Switch to a different agent
    act(() => {
      capturedOnSelectAgent?.("forge");
    });

    // isLoading must be reset — prevents stale shimmer on the newly selected agent
    expect(screen.getByTestId("is-loading").textContent).toBe("false");
  });

  it("keeps isLoading false when switching while idle", () => {
    render(<ChatApp agentConfigs={[]} />);

    act(() => {
      capturedOnSelectAgent?.("forge");
    });

    expect(screen.getByTestId("is-loading").textContent).toBe("false");
  });
});
