import { notFound } from "next/navigation";
import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { AgentSettingsContent } from "@/components/settings/agent-settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { readAllAgentConfigEntries, readAgentFile } from "@@/lib/agents-config";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";

interface Props {
  params: Promise<{ agentName: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { agentName } = await params;
  const all = await readAllAgentConfigEntries();
  const entry = all.find((a) => a.name === agentName);
  if (!entry) return { title: "Not Found — DovePaw" };
  return { title: `${entry.displayName} Settings — DovePaw` };
}

export default async function AgentSettingsPage({ params }: Props) {
  const { agentName } = await params;
  const [all, agentSettings, agentFile, globalSettings] = await Promise.all([
    readAllAgentConfigEntries(),
    readAgentSettings(agentName),
    readAgentFile(agentName),
    readSettings(),
  ]);

  const agentEntry = all.find((a) => a.name === agentName);
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
        doveDisplayName={effectiveDoveSettings(globalSettings).displayName}
        initialLocked={agentFile?.locked ?? false}
        initialNotifications={agentSettings.notifications ?? null}
      />
    </SettingsPageLayout>
  );
}
