import { ChatApp } from "@/components/chat-app";
import { readSplitAgentConfigEntries } from "@@/lib/agents-config";
import { listPlugins } from "@@/lib/plugin-manager";
import { readSettings } from "@@/lib/settings";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";

export default async function Home() {
  const [{ entries: agentConfigs, tmpEntries: tmpAgentConfigs }, plugins, doveRaw] =
    await Promise.all([readSplitAgentConfigEntries(), listPlugins(), readSettings()]);
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
