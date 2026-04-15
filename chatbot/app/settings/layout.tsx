import { AgentSidebar } from "@/components/agent-chat/agent-sidebar";
import { readSplitAgentConfigEntries } from "@@/lib/agents-config";
import { listPlugins } from "@@/lib/plugin-manager";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [{ entries: agentConfigs, tmpEntries: tmpAgentConfigs }, plugins] = await Promise.all([
    readSplitAgentConfigEntries(),
    listPlugins(),
  ]);
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AgentSidebar
        agentConfigs={agentConfigs}
        tmpAgentConfigs={tmpAgentConfigs}
        plugins={plugins}
      />
      <main className="flex-1 flex flex-col bg-background relative min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
