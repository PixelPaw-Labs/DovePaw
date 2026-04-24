import { AgentSidebar } from "@/components/agent-chat/agent-sidebar";
import { readSplitAgentConfigEntries } from "@@/lib/agents-config";
import { listPlugins } from "@@/lib/plugin-manager";
import { readAgentLinksFile } from "@@/lib/agent-links";

export const metadata = { title: "About — DovePaw" };

export default async function AboutLayout({ children }: { children: React.ReactNode }) {
  const [{ entries: agentConfigs, tmpEntries: tmpAgentConfigs }, plugins, linksFile] =
    await Promise.all([readSplitAgentConfigEntries(), listPlugins(), readAgentLinksFile()]);
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AgentSidebar
        agentConfigs={agentConfigs}
        tmpAgentConfigs={tmpAgentConfigs}
        plugins={plugins}
        groups={linksFile.groups}
      />
      <main className="flex-1 flex flex-col bg-background relative min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
