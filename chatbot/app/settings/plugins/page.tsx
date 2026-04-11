import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { PluginManagementContent } from "@/components/settings/plugin-management-content";
import { listPlugins } from "@@/lib/plugin-manager";
import { readAgentConfigEntries } from "@@/lib/agents-config";

export const metadata = { title: "Plugins — DovePaw" };

export default async function PluginsPage() {
  const [initialPlugins, agentConfigs] = await Promise.all([
    listPlugins(),
    readAgentConfigEntries(),
  ]);

  return (
    <SettingsPageLayout agentConfigs={agentConfigs} title="Plugins">
      <PluginManagementContent initialPlugins={initialPlugins} />
    </SettingsPageLayout>
  );
}
