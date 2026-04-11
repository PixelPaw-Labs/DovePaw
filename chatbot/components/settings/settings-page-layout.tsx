import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AgentSidebar } from "@/components/agent-chat/agent-sidebar";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";

interface BreadcrumbItem {
  label: string;
  href: string;
}

interface SettingsPageLayoutProps {
  agentConfigs: AgentConfigEntry[];
  title: string;
  /** Optional breadcrumb trail rendered before the title, e.g. [{label:"Home",href:"/"}] */
  breadcrumbs?: BreadcrumbItem[];
  children: React.ReactNode;
}

export function SettingsPageLayout({
  agentConfigs,
  title,
  breadcrumbs,
  children,
}: SettingsPageLayoutProps) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AgentSidebar agentConfigs={agentConfigs} />

      <main className="flex-1 flex flex-col bg-background relative min-w-0 overflow-y-auto">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/20 flex items-center gap-2 w-full px-8 py-4 shrink-0">
          {breadcrumbs?.map((crumb) => (
            <span key={crumb.href} className="flex items-center gap-2">
              <Link
                href={crumb.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
            </span>
          ))}
          <h1 className="text-xl font-bold text-foreground tracking-tight">{title}</h1>
        </header>

        <div className="flex-1 px-8 py-8 max-w-7xl mx-auto w-full">{children}</div>
      </main>
    </div>
  );
}
