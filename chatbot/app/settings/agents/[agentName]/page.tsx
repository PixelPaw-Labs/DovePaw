import { notFound } from "next/navigation";
import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { AgentSettingsContent } from "@/components/settings/agent-settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { readSplitAgentConfigEntries, readAgentFile } from "@@/lib/agents-config";

interface Props {
  params: Promise<{ agentName: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { agentName } = await params;
  const { entries, tmpEntries } = await readSplitAgentConfigEntries();
  const entry =
    entries.find((a) => a.name === agentName) ?? tmpEntries.find((a) => a.name === agentName);
  if (!entry) return { title: "Not Found — DovePaw" };
  return { title: `${entry.displayName} Settings — DovePaw` };
}

export default async function AgentSettingsPage({ params }: Props) {
  const { agentName } = await params;
  const [{ entries, tmpEntries }, agentSettings, agentFile, globalSettings] = await Promise.all([
    readSplitAgentConfigEntries(),
    readAgentSettings(agentName),
    readAgentFile(agentName),
    readSettings(),
  ]);

  const agentEntry =
    entries.find((a) => a.name === agentName) ?? tmpEntries.find((a) => a.name === agentName);
  if (!agentEntry) notFound();

  return (
    <SettingsPageLayout
      title={agentEntry.displayName}
      breadcrumbItems={[{ label: "Settings", href: "/settings" }]}
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
