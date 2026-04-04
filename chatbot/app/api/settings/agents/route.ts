/**
 * GET    /api/settings/agents       — List all agent config entries
 * POST   /api/settings/agents       — Add a new agent
 * PATCH  /api/settings/agents       — Update an agent's definition (partial patch)
 * DELETE /api/settings/agents       — Remove an agent by name
 */

import { z } from "zod";
import {
  readAgentConfigEntries,
  readAgentFile,
  createAgentFile,
  patchAgentDefinition,
  deleteAgentDefinition,
} from "@@/lib/agents-config";
import { agentConfigEntrySchema } from "@@/lib/agents-config-schemas";
import { parseBody } from "@/lib/env-var-routes";

export async function GET() {
  const agents = await readAgentConfigEntries();
  return Response.json({ agents });
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, agentConfigEntrySchema);
  if (!parsed.ok) return parsed.response;

  if (await readAgentFile(parsed.data.name)) {
    return Response.json({ error: `Agent "${parsed.data.name}" already exists` }, { status: 409 });
  }

  await createAgentFile(parsed.data);
  return Response.json({ agents: await readAgentConfigEntries() }, { status: 201 });
}

const patchBodySchema = z.object({
  name: z.string(),
  patch: agentConfigEntrySchema.partial().omit({ name: true }),
});

export async function PATCH(request: Request) {
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  const { name, patch } = parsed.data;

  if (!(await readAgentFile(name))) {
    return Response.json({ error: `Agent "${name}" not found` }, { status: 404 });
  }

  await patchAgentDefinition(name, patch);
  return Response.json({ agents: await readAgentConfigEntries() });
}

const deleteBodySchema = z.object({ name: z.string() });

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, deleteBodySchema);
  if (!parsed.ok) return parsed.response;

  const { name } = parsed.data;

  const file = await readAgentFile(name);
  if (!file) {
    return Response.json({ error: `Agent "${name}" not found` }, { status: 404 });
  }
  if (file.locked) {
    return Response.json(
      { error: `Agent "${name}" is locked — unlock it before deleting` },
      { status: 403 },
    );
  }

  await deleteAgentDefinition(name);
  return Response.json({ agents: await readAgentConfigEntries() });
}
