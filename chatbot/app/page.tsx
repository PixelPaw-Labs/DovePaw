import { ChatApp } from "@/components/chat-app";
import { readAgentConfigEntries, readTmpAgentConfigEntries } from "@@/lib/agents-config";
import { listPlugins } from "@@/lib/plugin-manager";

export default async function Home() {
  const [agentConfigs, tmpAgentConfigs, plugins] = await Promise.all([
    readAgentConfigEntries(),
    readTmpAgentConfigEntries(),
    listPlugins(),
  ]);
  return (
    <ChatApp agentConfigs={agentConfigs} tmpAgentConfigs={tmpAgentConfigs} plugins={plugins} />
  );
}
