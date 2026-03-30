import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolCallItem } from "../tool-call-badge";
import type { ToolCall } from "@/components/hooks/use-messages";

// Mock Tool components to avoid Radix/jsdom issues — focus on ToolCallItem logic
vi.mock("@/components/ai-elements/tool", () => ({
  Tool: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ToolHeader: ({
    title,
    toolName,
    state,
  }: {
    title?: string;
    toolName: string;
    state: string;
    type: string;
  }) => (
    <div data-testid="tool-header" data-tool-name={toolName} data-state={state}>
      {title ?? toolName}
    </div>
  ),
  ToolContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ToolInput: ({ input }: { input: unknown }) => (
    <div data-testid="tool-input">{JSON.stringify(input)}</div>
  ),
}));

const bashTool: ToolCall = { name: "Bash", input: { command: "echo hello" } };
const skillTool: ToolCall = { name: "Skill", input: { skill: "cloudflare-traffic-investigator" } };
const LONG_CMD = "a".repeat(100);

describe("ToolCallItem — header state", () => {
  it("shows input-available state when isActive", () => {
    render(<ToolCallItem tool={bashTool} isActive />);
    expect(screen.getByTestId("tool-header").dataset.state).toBe("input-available");
  });

  it("shows output-available state when not active", () => {
    render(<ToolCallItem tool={bashTool} />);
    expect(screen.getByTestId("tool-header").dataset.state).toBe("output-available");
  });
});

describe("ToolCallItem — title label", () => {
  it("renders tool name and detail in title", () => {
    render(<ToolCallItem tool={bashTool} />);
    const header = screen.getByTestId("tool-header");
    expect(header.textContent).toContain("Bash");
    expect(header.textContent).toContain("echo hello");
  });

  it("renders tool name only when detail is empty", () => {
    const noDetailTool: ToolCall = { name: "Bash", input: { command: "" } };
    render(<ToolCallItem tool={noDetailTool} />);
    expect(screen.getByTestId("tool-header").textContent).toBe("Bash");
  });

  it("passes toolName prop matching tool name", () => {
    render(<ToolCallItem tool={skillTool} />);
    expect(screen.getByTestId("tool-header").dataset.toolName).toBe("Skill");
  });
});

describe("ToolCallItem — input display", () => {
  it("renders tool input as JSON", () => {
    render(<ToolCallItem tool={bashTool} />);
    const input = screen.getByTestId("tool-input");
    expect(input.textContent).toContain("echo hello");
  });
});

describe("ToolCallItem — detail truncation at 60 chars", () => {
  it("truncates Bash command at 60 chars with ellipsis", () => {
    const tool: ToolCall = { name: "Bash", input: { command: LONG_CMD } };
    render(<ToolCallItem tool={tool} />);
    expect(screen.getByTestId("tool-header").textContent).toContain("…");
  });

  it("does not truncate commands exactly 60 chars long", () => {
    const tool: ToolCall = { name: "Bash", input: { command: "b".repeat(60) } };
    render(<ToolCallItem tool={tool} />);
    expect(screen.getByTestId("tool-header").textContent).not.toContain("…");
  });

  it("truncates Grep pattern at 60 chars", () => {
    const tool: ToolCall = { name: "Grep", input: { pattern: LONG_CMD } };
    render(<ToolCallItem tool={tool} />);
    expect(screen.getByTestId("tool-header").textContent).toContain("…");
  });
});
