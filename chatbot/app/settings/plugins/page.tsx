import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { PluginManagementContent } from "@/components/settings/plugin-management-content";
import { listPlugins } from "@@/lib/plugin-manager";

export const metadata = { title: "Plugins — DovePaw" };

export default async function PluginsPage() {
  const initialPlugins = await listPlugins();
  return (
    <SettingsPageLayout title="Plugins">
      <PluginManagementContent initialPlugins={initialPlugins} />
    </SettingsPageLayout>
  );
}
