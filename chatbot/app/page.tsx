import { AgentChat } from "@/components/agent-chat";
import { readAgentConfigEntries } from "@@/lib/agents-config";

export default function Home() {
  return <AgentChat agentConfigs={readAgentConfigEntries()} />;
}
