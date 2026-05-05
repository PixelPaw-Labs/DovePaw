export const dynamic = "force-dynamic";

import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { SettingsContent } from "@/components/settings/settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { readAllAgentConfigEntries, readAgentConfigEntries } from "@@/lib/agents-config";
import { listPlugins } from "@@/lib/plugin-manager";

export const metadata = { title: "Settings — DovePaw" };

export default async function SettingsPage() {
  const [settings, allAgentEntries, permanentEntries, plugins] = await Promise.all([
    readSettings(),
    readAllAgentConfigEntries(),
    readAgentConfigEntries(), // permanent-only: scheduled agents + repo settings
    listPlugins(),
  ]);
  const scheduledAgentEntries = permanentEntries.filter((a) => a.schedulingEnabled !== false);
  const initialAgentRepos: Record<string, string[]> = Object.fromEntries(
    await Promise.all(
      permanentEntries.map(
        async (a): Promise<[string, string[]]> => [a.name, (await readAgentSettings(a.name)).repos],
      ),
    ),
  );

  return (
    <SettingsPageLayout title="Settings">
      <SettingsContent
        initialSettings={settings}
        initialAgentRepos={initialAgentRepos}
        agentConfigs={allAgentEntries}
        scheduledAgentConfigs={scheduledAgentEntries}
        plugins={plugins}
      />
    </SettingsPageLayout>
  );
}
