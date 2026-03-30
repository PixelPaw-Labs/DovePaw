import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolCallList } from "../tool-call-badge";
import type { ToolCall } from "@/components/hooks/use-messages";

// Shimmer renders animated text via motion/react — mock it to a plain span
vi.mock("@/components/ai-elements/shimmer", () => ({
  Shimmer: ({ children, className }: { children: string; className?: string }) => (
    <span data-testid="shimmer" className={className}>
      {children}
    </span>
  ),
}));

// Tooltip wrapping used by MessageAction — mock Radix to avoid jsdom issues
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const bashTool: ToolCall = { name: "Bash", input: { command: "echo hello" } };
const skillTool: ToolCall = { name: "Skill", input: { skill: "cloudflare-traffic-investigator" } };

const LONG_CMD = "a".repeat(100); // 100 chars — exceeds 80-char limit

describe("ToolCallList — isActive shimmer", () => {
  it("renders label as plain text when isActive is false (default)", () => {
    render(<ToolCallList toolCalls={[bashTool]} />);
    expect(screen.queryAllByTestId("shimmer")).toHaveLength(0);
    // label and detail combined into one span: "Bash · echo hello"
    expect(screen.getByText(/Bash/)).toBeTruthy();
  });

  it("renders label as plain text when isActive is explicitly false", () => {
    render(<ToolCallList toolCalls={[bashTool]} isActive={false} />);
    expect(screen.queryAllByTestId("shimmer")).toHaveLength(0);
  });

  it("wraps label and detail together in one Shimmer when isActive is true", () => {
    render(<ToolCallList toolCalls={[bashTool]} isActive />);
    const shimmers = screen.getAllByTestId("shimmer");
    // One shimmer covering "Bash · echo hello" as a single unit
    expect(shimmers).toHaveLength(1);
    expect(shimmers[0].textContent).toContain("Bash");
    expect(shimmers[0].textContent).toContain("echo hello");
  });

  it("shows one Shimmer per tool whether or not detail exists", () => {
    const noDetailTool: ToolCall = { name: "Bash", input: { command: "" } };
    render(<ToolCallList toolCalls={[noDetailTool]} isActive />);
    expect(screen.getAllByTestId("shimmer")).toHaveLength(1);
  });

  it("renders one Shimmer per tool when multiple tools and isActive", () => {
    render(<ToolCallList toolCalls={[bashTool, skillTool]} isActive />);
    const shimmers = screen.getAllByTestId("shimmer");
    expect(shimmers).toHaveLength(2);
    const texts = shimmers.map((s) => s.textContent ?? "");
    expect(texts.some((t) => t.includes("Bash"))).toBe(true);
    expect(texts.some((t) => t.includes("Skill"))).toBe(true);
  });

  it("no Shimmers when multiple tools and isActive is false", () => {
    render(<ToolCallList toolCalls={[bashTool, skillTool]} isActive={false} />);
    expect(screen.queryAllByTestId("shimmer")).toHaveLength(0);
  });
});

describe("ToolCallList — detail truncation at 80 chars", () => {
  it("shows full detail when command is within 80 chars", () => {
    const tool: ToolCall = { name: "Bash", input: { command: "echo hello" } };
    render(<ToolCallList toolCalls={[tool]} />);
    expect(screen.getAllByText(/echo hello/).length).toBeGreaterThan(0);
  });

  it("truncates Bash command at 80 chars with ellipsis", () => {
    const tool: ToolCall = { name: "Bash", input: { command: LONG_CMD } };
    render(<ToolCallList toolCalls={[tool]} />);
    // Combined span: "Bash · <truncated>…"
    const span = screen.getByText(/^Bash/);
    expect(span.textContent).toContain("…");
  });

  it("does not truncate commands exactly 80 chars long", () => {
    const cmd80 = "b".repeat(80);
    const tool: ToolCall = { name: "Bash", input: { command: cmd80 } };
    render(<ToolCallList toolCalls={[tool]} />);
    const span = screen.getByText(/^Bash/);
    expect(span.textContent).not.toContain("…");
  });

  it("truncates Grep pattern at 80 chars", () => {
    const tool: ToolCall = { name: "Grep", input: { pattern: LONG_CMD } };
    render(<ToolCallList toolCalls={[tool]} />);
    const span = screen.getByText(/^Grep/);
    expect(span.textContent).toContain("…");
  });

  it("truncates default tool first string value at 80 chars", () => {
    const tool: ToolCall = { name: "Skill", input: { skill: LONG_CMD } };
    render(<ToolCallList toolCalls={[tool]} />);
    const span = screen.getByText(/^Skill/);
    expect(span.textContent).toContain("…");
  });
});
