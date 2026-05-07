import { readAllAgentConfigEntries } from "@@/lib/agents-config";
import { readAgentLinksFile } from "@@/lib/agent-links";
import { AgentLinksCanvas } from "@/components/settings/agent-links-canvas";

export const metadata = { title: "Agent Canvas — DovePaw" };

export default async function AgentLinksCanvasPage() {
  const [agentConfigs, linksFile] = await Promise.all([
    readAllAgentConfigEntries(),
    readAgentLinksFile(),
  ]);
  return <AgentLinksCanvas agentConfigs={agentConfigs} linksFile={linksFile} />;
}
