import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateGroupDialog } from "../agent-links-canvas";

vi.mock("@@/lib/agents", () => ({
  buildAgentDef: () => ({}),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const ENDPOINT = "/api/settings/agent-links/groups";

function renderDialog(overrides: Partial<Parameters<typeof CreateGroupDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  render(
    <CreateGroupDialog
      open={true}
      onOpenChange={onOpenChange}
      existingGroupNames={[]}
      onSuccess={onSuccess}
      {...overrides}
    />,
  );
  return { onOpenChange, onSuccess };
}

function typeName(value: string) {
  fireEvent.change(screen.getByPlaceholderText("e.g. Engineering"), {
    target: { value },
  });
}

function clickCreate() {
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

describe("CreateGroupDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects empty name without calling fetch", () => {
    renderDialog();
    clickCreate();
    expect(screen.getByText("Group name is required.")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only name", () => {
    renderDialog();
    typeName("   ");
    clickCreate();
    expect(screen.getByText("Group name is required.")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects duplicate name without calling fetch", () => {
    renderDialog({ existingGroupNames: ["Engineering"] });
    typeName("Engineering");
    clickCreate();
    expect(screen.getByText('Group "Engineering" already exists.')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("POSTs trimmed name then fires onSuccess and closes on 200", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const { onOpenChange, onSuccess } = renderDialog();

    typeName("  Engineering  ");
    clickCreate();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("Engineering"));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "Engineering" });
  });

  it("renders server error message from JSON body on non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Server rejected the name" }), {
        status: 400,
      }),
    );
    const { onSuccess } = renderDialog();

    typeName("Engineering");
    clickCreate();

    await waitFor(() => expect(screen.getByText("Server rejected the name")).toBeTruthy());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("falls back to generic message when error JSON has no error field", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));
    renderDialog();

    typeName("Engineering");
    clickCreate();

    await waitFor(() => expect(screen.getByText("Failed to create group.")).toBeTruthy());
  });

  it("renders network error message when fetch rejects", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    const { onSuccess } = renderDialog();

    typeName("Engineering");
    clickCreate();

    await waitFor(() => expect(screen.getByText("Network error. Please try again.")).toBeTruthy());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
