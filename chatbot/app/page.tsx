import { ChatApp } from "@/components/chat-app";
import { readSplitAgentConfigEntries } from "@@/lib/agents-config";
import { listPlugins } from "@@/lib/plugin-manager";
import { readSettings } from "@@/lib/settings";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";
import { readAgentLinksFile } from "@@/lib/agent-links";

export default async function Home() {
  const [{ entries: agentConfigs, tmpEntries: tmpAgentConfigs }, plugins, doveRaw, linksFile] =
    await Promise.all([
      readSplitAgentConfigEntries(),
      listPlugins(),
      readSettings(),
      Promise.resolve(readAgentLinksFile()),
    ]);
  const initialDoveSettings = effectiveDoveSettings(doveRaw);
  return (
    <ChatApp
      agentConfigs={agentConfigs}
      tmpAgentConfigs={tmpAgentConfigs}
      plugins={plugins}
      initialDoveSettings={initialDoveSettings}
      initialGroups={linksFile.groups}
    />
  );
}
