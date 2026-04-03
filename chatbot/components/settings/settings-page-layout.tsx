import { AgentSidebar } from "@/components/agent-chat/agent-sidebar";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";

interface SettingsPageLayoutProps {
  agentConfigs: AgentConfigEntry[];
  title: string;
  children: React.ReactNode;
}

export function SettingsPageLayout({ agentConfigs, title, children }: SettingsPageLayoutProps) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AgentSidebar agentConfigs={agentConfigs} />

      <main className="flex-1 flex flex-col bg-background relative min-w-0 overflow-y-auto">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/20 flex items-center w-full px-8 py-4 shrink-0">
          <h1 className="text-xl font-bold text-foreground tracking-tight">{title}</h1>
        </header>

        <div className="flex-1 px-8 py-8 max-w-7xl mx-auto w-full">{children}</div>
      </main>
    </div>
  );
}
