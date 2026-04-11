import { notFound } from "next/navigation";
import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { AgentSettingsContent } from "@/components/settings/agent-settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { readAgentConfigEntries, readAgentFile } from "@@/lib/agents-config";

interface Props {
  params: Promise<{ agentName: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { agentName } = await params;
  const entry = (await readAgentConfigEntries()).find((a) => a.name === agentName);
  if (!entry) return { title: "Not Found — DovePaw" };
  return { title: `${entry.displayName} Settings — DovePaw` };
}

export default async function AgentSettingsPage({ params }: Props) {
  const { agentName } = await params;
  const allEntries = await readAgentConfigEntries();
  const agentEntry = allEntries.find((a) => a.name === agentName);
  if (!agentEntry) notFound();

  const [agentSettings, agentFile] = await Promise.all([
    readAgentSettings(agentName),
    readAgentFile(agentName),
  ]);
  const globalSettings = readSettings();

  return (
    <SettingsPageLayout
      agentConfigs={allEntries}
      title="Agent Settings"
      breadcrumbs={[{ label: "Home", href: "/" }]}
    >
      <AgentSettingsContent
        agentEntry={agentEntry}
        repositories={globalSettings.repositories}
        initialEnabledRepoIds={agentSettings.repos}
        initialAgentEnvVars={agentSettings.envVars}
        globalEnvVars={globalSettings.envVars}
        initialLocked={agentFile?.locked ?? false}
      />
    </SettingsPageLayout>
  );
}
