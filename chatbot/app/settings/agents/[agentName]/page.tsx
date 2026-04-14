import { notFound } from "next/navigation";
import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { AgentSettingsContent } from "@/components/settings/agent-settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import {
  readAgentConfigEntries,
  readAgentFile,
  readTmpAgentConfigEntries,
} from "@@/lib/agents-config";
import { listPlugins } from "@@/lib/plugin-manager";

interface Props {
  params: Promise<{ agentName: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { agentName } = await params;
  const [entries, tmpEntries] = await Promise.all([
    readAgentConfigEntries(),
    readTmpAgentConfigEntries(),
  ]);
  const entry =
    entries.find((a) => a.name === agentName) ?? tmpEntries.find((a) => a.name === agentName);
  if (!entry) return { title: "Not Found — DovePaw" };
  return { title: `${entry.displayName} Settings — DovePaw` };
}

export default async function AgentSettingsPage({ params }: Props) {
  const { agentName } = await params;
  const [allEntries, tmpAgentConfigs, agentSettings, agentFile, plugins, globalSettings] =
    await Promise.all([
      readAgentConfigEntries(),
      readTmpAgentConfigEntries(),
      readAgentSettings(agentName),
      readAgentFile(agentName),
      listPlugins(),
      readSettings(),
    ]);

  const agentEntry =
    allEntries.find((a) => a.name === agentName) ??
    tmpAgentConfigs.find((a) => a.name === agentName);
  if (!agentEntry) notFound();

  return (
    <SettingsPageLayout
      agentConfigs={allEntries}
      tmpAgentConfigs={tmpAgentConfigs}
      plugins={plugins}
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
