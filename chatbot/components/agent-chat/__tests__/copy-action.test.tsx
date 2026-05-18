import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CopyAction } from "../copy-action";

describe("CopyAction", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders with title 'Copy' by default", () => {
    render(<CopyAction text="hello" />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("calls clipboard.writeText with the provided text on click", () => {
    render(<CopyAction text="test content" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test content");
  });

  it("shows 'Copied!' title immediately after click", () => {
    render(<CopyAction text="hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();
  });

  it("reverts to 'Copy' title after 1500ms", () => {
    render(<CopyAction text="hi" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });
});
