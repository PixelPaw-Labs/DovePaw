import { notFound } from "next/navigation";
import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { AgentSettingsContent } from "@/components/settings/agent-settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { readAgentConfigEntries } from "@@/lib/agents-config";

interface Props {
  params: Promise<{ agentName: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { agentName } = await params;
  const entry = readAgentConfigEntries().find((a) => a.name === agentName);
  if (!entry) return { title: "Not Found — DovePaw" };
  return { title: `${entry.displayName} Settings — DovePaw` };
}

export default async function AgentSettingsPage({ params }: Props) {
  const { agentName } = await params;
  const allEntries = readAgentConfigEntries();
  const agentEntry = allEntries.find((a) => a.name === agentName);
  if (!agentEntry) notFound();

  const globalSettings = readSettings();
  const agentSettings = readAgentSettings(agentName);

  return (
    <SettingsPageLayout agentConfigs={allEntries} title="Agent Settings">
      <AgentSettingsContent
        agentEntry={agentEntry}
        repositories={globalSettings.repositories}
        initialEnabledRepoIds={agentSettings.repos}
        initialAgentEnvVars={agentSettings.envVars}
        globalEnvVars={globalSettings.envVars}
      />
    </SettingsPageLayout>
  );
}
