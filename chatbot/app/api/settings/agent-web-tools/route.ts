/**
 * PUT /api/settings/agent-web-tools
 *   Body: { agentName: string; allowSdkWebTools: boolean; allowScriptWebTools: boolean }
 *   Updates per-agent web tool access for the SDK sub-agent and script runner paths.
 */

import { z } from "zod";
import { readAgentFile, patchAgentFile } from "@@/lib/agents-config";
import { parseBody } from "@/lib/env-var-routes";

const putBodySchema = z.object({
  agentName: z.string().min(1),
  allowSdkWebTools: z.boolean(),
  allowScriptWebTools: z.boolean(),
});

export async function PUT(request: Request) {
  const parsed = await parseBody(request, putBodySchema);
  if (!parsed.ok) return parsed.response;

  const { agentName, allowSdkWebTools, allowScriptWebTools } = parsed.data;

  if (!(await readAgentFile(agentName))) {
    return Response.json({ error: `Agent "${agentName}" not found` }, { status: 404 });
  }

  await patchAgentFile(agentName, { allowSdkWebTools, allowScriptWebTools });
  return Response.json({ allowSdkWebTools, allowScriptWebTools });
}
