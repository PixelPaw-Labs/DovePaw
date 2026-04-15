import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { AgentLinksContent } from "@/components/settings/agent-links-content";
import { readSplitAgentConfigEntries } from "@@/lib/agents-config";
import { readAgentLinksFile } from "@@/lib/agent-links";

export const metadata = { title: "Agent Links — DovePaw" };

export default async function AgentLinksPage() {
  const [{ entries: agentConfigs, tmpEntries: tmpAgentConfigs }, linksFile] = await Promise.all([
    readSplitAgentConfigEntries(),
    Promise.resolve(readAgentLinksFile()),
  ]);
  return (
    <SettingsPageLayout title="Agent Links">
      <AgentLinksContent
        agentConfigs={agentConfigs}
        tmpAgentConfigs={tmpAgentConfigs}
        initialLinks={linksFile.links}
        initialGroups={linksFile.groups}
      />
    </SettingsPageLayout>
  );
}
