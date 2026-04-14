import { ChatApp } from "@/components/chat-app";
import { readAgentConfigEntries, readTmpAgentConfigEntries } from "@@/lib/agents-config";
import { listPlugins } from "@@/lib/plugin-manager";
import { readSettings } from "@@/lib/settings";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";

export default async function Home() {
  const [agentConfigs, tmpAgentConfigs, plugins, doveRaw] = await Promise.all([
    readAgentConfigEntries(),
    readTmpAgentConfigEntries(),
    listPlugins(),
    readSettings(),
  ]);
  const initialDoveSettings = effectiveDoveSettings(doveRaw);
  return (
    <ChatApp
      agentConfigs={agentConfigs}
      tmpAgentConfigs={tmpAgentConfigs}
      plugins={plugins}
      initialDoveSettings={initialDoveSettings}
    />
  );
}
