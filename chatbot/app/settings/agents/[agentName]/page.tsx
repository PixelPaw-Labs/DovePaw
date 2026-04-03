import { notFound } from "next/navigation";
import { AgentSidebar } from "@/components/agent-chat/agent-sidebar";
import { AgentSettingsContent } from "@/components/settings/agent-settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { readAgentsConfig } from "@@/lib/agents-config";

interface Props {
  params: Promise<{ agentName: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { agentName } = await params;
  const agent = readAgentsConfig().find((a) => a.name === agentName);
  if (!agent) return { title: "Not Found — DovePaw" };
  return { title: `${agent.displayName} Settings — DovePaw` };
}

export default async function AgentSettingsPage({ params }: Props) {
  const { agentName } = await params;
  const agent = readAgentsConfig().find((a) => a.name === agentName);
  if (!agent) notFound();

  const globalSettings = readSettings();
  const agentSettings = readAgentSettings(agentName);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AgentSidebar />

      <main className="flex-1 flex flex-col bg-background relative min-w-0 overflow-y-auto">
        {/* Glass header */}
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/20 flex items-center w-full px-8 py-4 shrink-0">
          <h1 className="text-xl font-bold text-foreground tracking-tight">Agent Settings</h1>
        </header>

        <div className="flex-1 px-8 py-8 max-w-5xl mx-auto w-full">
          <AgentSettingsContent
            agentName={agentName}
            repositories={globalSettings.repositories}
            initialEnabledRepoIds={agentSettings.repos}
            initialAgentEnvVars={agentSettings.envVars}
            globalEnvVars={globalSettings.envVars}
          />
        </div>
      </main>
    </div>
  );
}
