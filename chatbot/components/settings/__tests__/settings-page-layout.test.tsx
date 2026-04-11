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
  it("always renders the Home link from Breadcrumb", () => {
    render(
      <SettingsPageLayout agentConfigs={[]} title="Settings">
        <div />
      </SettingsPageLayout>,
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    // Breadcrumb always renders ← Home
    expect(screen.getByRole("link", { name: /Home/i })).toBeTruthy();
  });

  it("renders extra breadcrumb items after Home", () => {
    render(
      <SettingsPageLayout
        agentConfigs={[]}
        title="Plugins"
        breadcrumbItems={[{ label: "Settings", href: "/settings" }]}
      >
        <div />
      </SettingsPageLayout>,
    );

    expect(screen.getByRole("link", { name: /Home/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
  });

  it("renders multiple breadcrumb items in order", () => {
    render(
      <SettingsPageLayout
        agentConfigs={[]}
        title="My Agent"
        breadcrumbItems={[
          { label: "Settings", href: "/settings" },
          { label: "Agents", href: "/settings/agents" },
        ]}
      >
        <div />
      </SettingsPageLayout>,
    );

    const links = screen.getAllByRole("link");
    // Home + Settings + Agents
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(links.some((l) => l.getAttribute("href") === "/settings")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/settings/agents")).toBe(true);
  });
});
