import { AgentChat } from "@/components/agent-chat";
import { readAgentConfigEntries } from "@@/lib/agents-config";

export default async function Home() {
  return <AgentChat agentConfigs={await readAgentConfigEntries()} />;
}
