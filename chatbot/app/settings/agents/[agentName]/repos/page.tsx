import { redirect } from "next/navigation";
import { readAgentsConfig } from "@@/lib/agents-config";

interface Props {
  params: Promise<{ agentName: string }>;
}

export default async function AgentReposRedirectPage({ params }: Props) {
  const { agentName } = await params;
  // Validate agent exists before redirecting
  const agent = (await readAgentsConfig()).find((a) => a.name === agentName);
  const target = agent ? `/settings/agents/${agentName}` : "/settings";
  redirect(target);
}
