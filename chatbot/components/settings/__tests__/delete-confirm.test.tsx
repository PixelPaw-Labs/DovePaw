import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EnvVarTable } from "../env-var-table";
import { RepoTable } from "../repo-table";
import type { EnvVar, Repository } from "@@/lib/settings-schemas";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@@/lib/agents", () => ({
  buildAgentDef: (entry: { name: string; displayName: string }) => ({
    ...entry,
    icon: () => null,
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const envVar: EnvVar = {
  id: "ev-1",
  key: "MY_TOKEN",
  value: "secret",
  isSecret: false,
};

const repo: Repository = {
  id: "repo-1",
  name: "my-app",
  githubRepo: "example/my-app",
};

// ─── EnvVarTable ──────────────────────────────────────────────────────────────

describe("EnvVarTable delete confirmation", () => {
  it("does not call onRemove when delete is clicked without confirming", () => {
    const onRemove = vi.fn();
    render(<EnvVarTable envVars={[envVar]} onEdit={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getByTitle("Remove MY_TOKEN"));
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("shows confirm/cancel after delete click", () => {
    render(<EnvVarTable envVars={[envVar]} onEdit={vi.fn()} onRemove={vi.fn()} />);

    fireEvent.click(screen.getByTitle("Remove MY_TOKEN"));
    expect(screen.getByText(/Delete.*MY_TOKEN/)).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("calls onRemove with the correct id on confirm", () => {
    const onRemove = vi.fn();
    render(<EnvVarTable envVars={[envVar]} onEdit={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getByTitle("Remove MY_TOKEN"));
    fireEvent.click(screen.getByText("Confirm"));
    expect(onRemove).toHaveBeenCalledWith("ev-1");
  });

  it("dismisses confirm state on cancel without calling onRemove", () => {
    const onRemove = vi.fn();
    render(<EnvVarTable envVars={[envVar]} onEdit={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getByTitle("Remove MY_TOKEN"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByText("Confirm")).toBeNull();
  });
});

// ─── RepoTable ────────────────────────────────────────────────────────────────

describe("RepoTable delete confirmation", () => {
  it("does not call onRemove when delete is clicked without confirming", () => {
    const onRemove = vi.fn();
    render(
      <RepoTable
        agentConfigs={[]}
        repositories={[repo]}
        agentRepos={{}}
        onEdit={vi.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByTitle("Remove my-app"));
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("shows confirm/cancel after delete click", () => {
    render(
      <RepoTable
        agentConfigs={[]}
        repositories={[repo]}
        agentRepos={{}}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("Remove my-app"));
    expect(screen.getByText(/Delete.*my-app/)).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("calls onRemove with the correct id on confirm", () => {
    const onRemove = vi.fn();
    render(
      <RepoTable
        agentConfigs={[]}
        repositories={[repo]}
        agentRepos={{}}
        onEdit={vi.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByTitle("Remove my-app"));
    fireEvent.click(screen.getByText("Confirm"));
    expect(onRemove).toHaveBeenCalledWith("repo-1");
  });

  it("dismisses confirm state on cancel without calling onRemove", () => {
    const onRemove = vi.fn();
    render(
      <RepoTable
        agentConfigs={[]}
        repositories={[repo]}
        agentRepos={{}}
        onEdit={vi.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByTitle("Remove my-app"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByText("Confirm")).toBeNull();
  });
});
