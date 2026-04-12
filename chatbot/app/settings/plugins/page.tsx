import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { PluginManagementContent } from "@/components/settings/plugin-management-content";
import { listPlugins } from "@@/lib/plugin-manager";
import { readAgentConfigEntries, readTmpAgentConfigEntries } from "@@/lib/agents-config";

export const metadata = { title: "Plugins — DovePaw" };

export default async function PluginsPage() {
  const [initialPlugins, agentConfigs, tmpAgentConfigs] = await Promise.all([
    listPlugins(),
    readAgentConfigEntries(),
    readTmpAgentConfigEntries(),
  ]);

  return (
    <SettingsPageLayout
      agentConfigs={agentConfigs}
      tmpAgentConfigs={tmpAgentConfigs}
      plugins={initialPlugins}
      title="Plugins"
    >
      <PluginManagementContent initialPlugins={initialPlugins} />
    </SettingsPageLayout>
  );
}
