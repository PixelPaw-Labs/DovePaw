import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { AgentLinksContent } from "@/components/settings/agent-links-content";
import { readAgentConfigEntries, readTmpAgentConfigEntries } from "@@/lib/agents-config";
import { readAgentLinks } from "@@/lib/agent-links";
import { listPlugins } from "@@/lib/plugin-manager";

export const metadata = { title: "Agent Links — DovePaw" };

export default async function AgentLinksPage() {
  const [agentConfigs, tmpAgentConfigs, plugins, initialLinks] = await Promise.all([
    readAgentConfigEntries(),
    readTmpAgentConfigEntries(),
    listPlugins(),
    Promise.resolve(readAgentLinks()),
  ]);

  return (
    <SettingsPageLayout
      agentConfigs={agentConfigs}
      tmpAgentConfigs={tmpAgentConfigs}
      plugins={plugins}
      title="Agent Links"
    >
      <AgentLinksContent agentConfigs={agentConfigs} initialLinks={initialLinks} />
    </SettingsPageLayout>
  );
}
