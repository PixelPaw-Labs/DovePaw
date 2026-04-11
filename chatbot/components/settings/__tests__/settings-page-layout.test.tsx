import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPageLayout } from "../settings-page-layout";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/agent-chat/agent-sidebar", () => ({
  AgentSidebar: () => <nav aria-label="sidebar" />,
}));

describe("SettingsPageLayout — breadcrumbs", () => {
  it("renders title without breadcrumb when breadcrumbs is absent", () => {
    render(
      <SettingsPageLayout agentConfigs={[]} title="Settings">
        <div />
      </SettingsPageLayout>,
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders breadcrumb link before the title", () => {
    render(
      <SettingsPageLayout
        agentConfigs={[]}
        title="Plugins"
        breadcrumbs={[{ label: "Home", href: "/" }]}
      >
        <div />
      </SettingsPageLayout>,
    );

    const link = screen.getByRole("link", { name: "Home" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/");
    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
  });

  it("renders multiple breadcrumb levels in order", () => {
    render(
      <SettingsPageLayout
        agentConfigs={[]}
        title="Repos"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Agent Settings", href: "/settings/agents/my-agent" },
        ]}
      >
        <div />
      </SettingsPageLayout>,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toBe("/");
    expect(links[1]!.getAttribute("href")).toBe("/settings/agents/my-agent");
  });
});
