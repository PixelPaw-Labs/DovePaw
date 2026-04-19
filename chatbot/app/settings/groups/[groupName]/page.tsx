import { SettingsPageLayout } from "@/components/settings/settings-page-layout";
import { GroupSettingsContent } from "@/components/settings/group-settings-content";
import { readSettings } from "@@/lib/settings";
import { readOrCreateGroupConfig } from "@@/lib/group-config";

interface Props {
  params: Promise<{ groupName: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { groupName } = await params;
  return { title: `${decodeURIComponent(groupName)} Group Settings — DovePaw` };
}

export default async function GroupSettingsPage({ params }: Props) {
  const { groupName: rawGroupName } = await params;
  const groupName = decodeURIComponent(rawGroupName);

  const [groupConfig, globalSettings] = await Promise.all([
    Promise.resolve(readOrCreateGroupConfig(groupName)),
    readSettings(),
  ]);

  return (
    <SettingsPageLayout
      title={groupName}
      breadcrumbItems={[{ label: "Settings", href: "/settings" }]}
    >
      <GroupSettingsContent
        groupName={groupName}
        repositories={globalSettings.repositories}
        initialEnabledRepoIds={groupConfig.repos}
        initialGroupEnvVars={groupConfig.envVars}
        globalEnvVars={globalSettings.envVars}
      />
    </SettingsPageLayout>
  );
}
