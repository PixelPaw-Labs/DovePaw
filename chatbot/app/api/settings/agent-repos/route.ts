/**
 * GET  /api/settings/agent-repos?agent=<agentName>
 *   Returns { enabledRepoIds: string[] }
 *   Empty array means no repositories are enabled for this agent.
 *
 * PUT  /api/settings/agent-repos
 *   Body: { agentName: string; enabledRepoIds: string[] }
 *   Saves the per-agent repo selection to its own settings file.
 */

import { z } from "zod";
import { readAgentSettings, writeAgentSettings } from "@@/lib/settings";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentName = url.searchParams.get("agent");
  if (!agentName) {
    return Response.json({ error: "Missing agent query param" }, { status: 400 });
  }
  const agentSettings = await readAgentSettings(agentName);
  return Response.json({ enabledRepoIds: agentSettings.repos });
}

const putBodySchema = z.object({
  agentName: z.string().min(1),
  enabledRepoIds: z.array(z.string()),
});

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { agentName, enabledRepoIds } = parsed.data;
  const existing = await readAgentSettings(agentName);
  await writeAgentSettings(agentName, { ...existing, repos: enabledRepoIds });
  return Response.json({ enabledRepoIds });
}
