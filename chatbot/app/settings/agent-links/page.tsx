import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { AgentLinksContent } from "@/components/settings/agent-links-content";
import { readAgentConfigEntries, readTmpAgentConfigEntries } from "@@/lib/agents-config";
import { readAgentLinksFile } from "@@/lib/agent-links";
import { listPlugins } from "@@/lib/plugin-manager";

export const metadata = { title: "Agent Links — DovePaw" };

export default async function AgentLinksPage() {
  const [agentConfigs, tmpAgentConfigs, plugins, linksFile] = await Promise.all([
    readAgentConfigEntries(),
    readTmpAgentConfigEntries(),
    listPlugins(),
    Promise.resolve(readAgentLinksFile()),
  ]);

  return (
    <SettingsPageLayout
      agentConfigs={agentConfigs}
      tmpAgentConfigs={tmpAgentConfigs}
      plugins={plugins}
      title="Agent Links"
    >
      <AgentLinksContent
        agentConfigs={agentConfigs}
        tmpAgentConfigs={tmpAgentConfigs}
        initialLinks={linksFile.links}
        initialGroups={linksFile.groups}
      />
    </SettingsPageLayout>
  );
}
