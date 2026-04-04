/**
 * PUT /api/settings/agent-lock
 *   Body: { agentName: string; locked: boolean }
 *   Toggles the locked flag on an agent file.
 */

import { z } from "zod";
import { readAgentFile, patchAgentFile } from "@@/lib/agents-config";
import { parseBody } from "@/lib/env-var-routes";

const putBodySchema = z.object({
  agentName: z.string().min(1),
  locked: z.boolean(),
});

export async function PUT(request: Request) {
  const parsed = await parseBody(request, putBodySchema);
  if (!parsed.ok) return parsed.response;

  const { agentName, locked } = parsed.data;

  if (!(await readAgentFile(agentName))) {
    return Response.json({ error: `Agent "${agentName}" not found` }, { status: 404 });
  }

  await patchAgentFile(agentName, { locked });
  return Response.json({ locked });
}
