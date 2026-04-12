import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { AgentLinksContent } from "@/components/settings/agent-links-content";
import { readAgentConfigEntries } from "@@/lib/agents-config";
import { readAgentLinks } from "@@/lib/agent-links";

export const metadata = { title: "Agent Links — DovePaw" };

export default async function AgentLinksPage() {
  const [agentConfigs, initialLinks] = await Promise.all([
    readAgentConfigEntries(),
    Promise.resolve(readAgentLinks()),
  ]);

  return (
    <SettingsPageLayout agentConfigs={agentConfigs} title="Agent Links">
      <AgentLinksContent agentConfigs={agentConfigs} initialLinks={initialLinks} />
    </SettingsPageLayout>
  );
}
