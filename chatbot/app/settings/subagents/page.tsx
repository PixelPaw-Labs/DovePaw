import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { SubagentsContent } from "@/components/settings/subagents-content";
import { readAgentConfigEntries } from "@@/lib/agents-config";

export const metadata = { title: "Subagent Config — DovePaw" };

export default function SubagentsPage() {
  const agents = readAgentConfigEntries();

  return (
    <SettingsPageLayout agentConfigs={agents} title="Subagent Config">
      <SubagentsContent initialAgents={agents} />
    </SettingsPageLayout>
  );
}
