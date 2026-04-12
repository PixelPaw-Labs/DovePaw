import { AgentSidebar } from "@/components/agent-chat/agent-sidebar";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { PluginRecord } from "@@/lib/plugin-schemas";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface SettingsPageLayoutProps {
  agentConfigs: AgentConfigEntry[];
  tmpAgentConfigs?: AgentConfigEntry[];
  plugins?: readonly Pick<PluginRecord, "path" | "name">[];
  title: string;
  /** Breadcrumb items rendered in the sticky header (after the hardcoded ← Home). */
  breadcrumbItems?: BreadcrumbItem[];
  children: React.ReactNode;
}

export function SettingsPageLayout({
  agentConfigs,
  tmpAgentConfigs = [],
  plugins = [],
  title,
  breadcrumbItems,
  children,
}: SettingsPageLayoutProps) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AgentSidebar
        agentConfigs={agentConfigs}
        tmpAgentConfigs={tmpAgentConfigs}
        plugins={plugins}
      />

      <main className="flex-1 flex flex-col bg-background relative min-w-0 overflow-y-auto">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/20 flex items-center gap-2 w-full px-8 py-4 shrink-0">
          <Breadcrumb items={breadcrumbItems ?? []} />
          <span className="text-muted-foreground/40 text-sm">/</span>
          <h1 className="text-xl font-bold text-foreground tracking-tight">{title}</h1>
        </header>

        <div className="flex-1 px-8 py-8 max-w-7xl mx-auto w-full">{children}</div>
      </main>
    </div>
  );
}
