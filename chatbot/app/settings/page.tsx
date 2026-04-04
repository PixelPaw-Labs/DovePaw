import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { SettingsContent } from "@/components/settings/settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { readAgentConfigEntries } from "@@/lib/agents-config";

export const metadata = { title: "Settings — DovePaw" };

export default async function SettingsPage() {
  const settings = readSettings();

  const allAgentEntries = await readAgentConfigEntries();
  const scheduledAgentEntries = allAgentEntries.filter((a) => a.schedulingEnabled !== false);
  const initialAgentRepos: Record<string, string[]> = Object.fromEntries(
    await Promise.all(
      allAgentEntries.map(
        async (a): Promise<[string, string[]]> => [a.name, (await readAgentSettings(a.name)).repos],
      ),
    ),
  );

  return (
    <SettingsPageLayout agentConfigs={allAgentEntries} title="Settings">
      <SettingsContent
        initialSettings={settings}
        initialAgentRepos={initialAgentRepos}
        agentConfigs={allAgentEntries}
        scheduledAgentConfigs={scheduledAgentEntries}
      />
    </SettingsPageLayout>
  );
}
