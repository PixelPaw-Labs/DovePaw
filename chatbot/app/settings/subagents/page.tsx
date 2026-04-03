import { AgentSidebar } from "@/components/agent-chat/agent-sidebar";
import { SubagentsContent } from "@/components/settings/subagents-content";
import { readAgentConfigEntries } from "@@/lib/agents-config";

export const metadata = { title: "Subagent Config — DovePaw" };

export default function SubagentsPage() {
  const agents = readAgentConfigEntries();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AgentSidebar />

      <main className="flex-1 flex flex-col bg-background relative min-w-0 overflow-y-auto">
        {/* Glass header */}
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/20 flex items-center w-full px-8 py-4 shrink-0">
          <h1 className="text-xl font-bold text-foreground tracking-tight">Subagent Config</h1>
        </header>

        <div className="flex-1 px-8 py-8 max-w-5xl mx-auto w-full">
          <SubagentsContent initialAgents={agents} />
        </div>
      </main>
    </div>
  );
}
