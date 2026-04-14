import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { SettingsContent } from "@/components/settings/settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { readAgentConfigEntries, readTmpAgentConfigEntries } from "@@/lib/agents-config";
import { listPlugins } from "@@/lib/plugin-manager";

export const metadata = { title: "Settings — DovePaw" };

export default async function SettingsPage() {
  const [settings, allAgentEntries, tmpAgentConfigs, plugins] = await Promise.all([
    readSettings(),
    readAgentConfigEntries(),
    readTmpAgentConfigEntries(),
    listPlugins(),
  ]);
  const scheduledAgentEntries = allAgentEntries.filter((a) => a.schedulingEnabled !== false);
  const initialAgentRepos: Record<string, string[]> = Object.fromEntries(
    await Promise.all(
      allAgentEntries.map(
        async (a): Promise<[string, string[]]> => [a.name, (await readAgentSettings(a.name)).repos],
      ),
    ),
  );

  return (
    <SettingsPageLayout
      agentConfigs={allAgentEntries}
      tmpAgentConfigs={tmpAgentConfigs}
      plugins={plugins}
      title="Settings"
    >
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
