import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolCallChain } from "../tool-call-badge";
import type { ToolCall } from "@/components/hooks/use-messages";

// Shimmer renders animated text via motion/react — mock it to a plain span
vi.mock("@/components/ai-elements/shimmer", () => ({
  Shimmer: ({ children, className }: { children: string; className?: string }) => (
    <span data-testid="shimmer" className={className}>
      {children}
    </span>
  ),
}));

// Mock chain-of-thought to avoid Radix/jsdom issues — focus on ToolCallChain logic
vi.mock("@/components/ai-elements/chain-of-thought", () => ({
  ChainOfThought: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ChainOfThoughtHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="cot-header">{children}</div>
  ),
  ChainOfThoughtContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ChainOfThoughtStep: ({
    label,
    status,
  }: {
    label: React.ReactNode;
    status: string;
    icon?: unknown;
  }) => (
    <div data-testid="cot-step" data-status={status}>
      {label}
    </div>
  ),
}));

const bashTool: ToolCall = { name: "Bash", input: { command: "echo hello" } };
const skillTool: ToolCall = { name: "Skill", input: { skill: "cloudflare-traffic-investigator" } };
const LONG_CMD = "a".repeat(100); // 100 chars — exceeds 80-char limit

describe("ToolCallChain — header label", () => {
  it("shows step count when isActive is false", () => {
    render(<ToolCallChain toolCalls={[bashTool]} />);
    expect(screen.getByTestId("cot-header").textContent).toContain("1 step");
  });

  it('uses plural "steps" for multiple tools', () => {
    render(<ToolCallChain toolCalls={[bashTool, skillTool]} />);
    expect(screen.getByTestId("cot-header").textContent).toContain("2 steps");
  });

  it("renders ShimmerLabel with 'Working…' when isActive is true", () => {
    render(<ToolCallChain toolCalls={[bashTool]} isActive />);
    const shimmer = screen.getByTestId("shimmer");
    expect(shimmer.textContent).toContain("Working");
  });

  it("renders no ShimmerLabel when isActive is false", () => {
    render(<ToolCallChain toolCalls={[bashTool]} />);
    expect(screen.queryByTestId("shimmer")).toBeNull();
  });
});

describe("ToolCallChain — step status", () => {
  it("marks all steps complete when isActive is false", () => {
    render(<ToolCallChain toolCalls={[bashTool, skillTool]} isActive={false} />);
    const steps = screen.getAllByTestId("cot-step");
    expect(steps.every((s) => s.dataset.status === "complete")).toBe(true);
  });

  it("marks only the last step active when isActive is true", () => {
    render(<ToolCallChain toolCalls={[bashTool, skillTool]} isActive />);
    const steps = screen.getAllByTestId("cot-step");
    expect(steps[0].dataset.status).toBe("complete");
    expect(steps[1].dataset.status).toBe("active");
  });

  it("marks the single step active when isActive is true", () => {
    render(<ToolCallChain toolCalls={[bashTool]} isActive />);
    const steps = screen.getAllByTestId("cot-step");
    expect(steps[0].dataset.status).toBe("active");
  });
});

describe("ToolCallChain — step labels and truncation", () => {
  it("renders step label with tool name and detail", () => {
    render(<ToolCallChain toolCalls={[bashTool]} />);
    const step = screen.getByTestId("cot-step");
    expect(step.textContent).toContain("Bash");
    expect(step.textContent).toContain("echo hello");
  });

  it("renders step label with tool name only when detail is empty", () => {
    const noDetailTool: ToolCall = { name: "Bash", input: { command: "" } };
    render(<ToolCallChain toolCalls={[noDetailTool]} />);
    const step = screen.getByTestId("cot-step");
    expect(step.textContent).toBe("Bash");
  });

  it("truncates Bash command at 80 chars with ellipsis", () => {
    const tool: ToolCall = { name: "Bash", input: { command: LONG_CMD } };
    render(<ToolCallChain toolCalls={[tool]} />);
    expect(screen.getByTestId("cot-step").textContent).toContain("…");
  });

  it("does not truncate commands exactly 80 chars long", () => {
    const tool: ToolCall = { name: "Bash", input: { command: "b".repeat(80) } };
    render(<ToolCallChain toolCalls={[tool]} />);
    expect(screen.getByTestId("cot-step").textContent).not.toContain("…");
  });

  it("truncates Grep pattern at 80 chars", () => {
    const tool: ToolCall = { name: "Grep", input: { pattern: LONG_CMD } };
    render(<ToolCallChain toolCalls={[tool]} />);
    expect(screen.getByTestId("cot-step").textContent).toContain("…");
  });

  it("truncates default tool first string value at 80 chars", () => {
    const tool: ToolCall = { name: "Skill", input: { skill: LONG_CMD } };
    render(<ToolCallChain toolCalls={[tool]} />);
    expect(screen.getByTestId("cot-step").textContent).toContain("…");
  });
});
