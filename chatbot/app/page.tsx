import { ChatApp } from "@/components/chat-app";
import { readAgentConfigEntries } from "@@/lib/agents-config";

export default async function Home() {
  return <ChatApp agentConfigs={await readAgentConfigEntries()} />;
}
