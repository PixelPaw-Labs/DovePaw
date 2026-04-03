import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { SettingsContent } from "@/components/settings/settings-content";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { readAgentConfigEntries, readScheduledAgentConfigEntries } from "@@/lib/agents-config";

export const metadata = { title: "Settings — DovePaw" };

export default function SettingsPage() {
  const settings = readSettings();

  const allAgentEntries = readAgentConfigEntries();
  const scheduledAgentEntries = readScheduledAgentConfigEntries();
  const initialAgentRepos: Record<string, string[]> = Object.fromEntries(
    allAgentEntries.map((a) => [a.name, readAgentSettings(a.name).repos]),
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
