/**
 * GET    /api/settings/agents       — List all agent config entries
 * POST   /api/settings/agents       — Add a new agent
 * PATCH  /api/settings/agents       — Update an agent by name
 * DELETE /api/settings/agents       — Remove an agent by name
 */

import { z } from "zod";
import { readAgentConfigEntries, writeAgentsConfig } from "@@/lib/agents-config";
import { agentConfigEntrySchema } from "@@/lib/agents-config-schemas";
import { parseBody } from "@/lib/env-var-routes";

export function GET() {
  const agents = readAgentConfigEntries();
  return Response.json({ agents });
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, agentConfigEntrySchema);
  if (!parsed.ok) return parsed.response;

  const entries = readAgentConfigEntries();

  if (entries.some((a) => a.name === parsed.data.name)) {
    return Response.json({ error: `Agent "${parsed.data.name}" already exists` }, { status: 409 });
  }

  const updated = [...entries, parsed.data];
  writeAgentsConfig(updated);
  return Response.json({ agents: updated }, { status: 201 });
}

const patchBodySchema = z.object({
  name: z.string(),
  patch: agentConfigEntrySchema.partial().omit({ name: true }),
});

export async function PATCH(request: Request) {
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  const { name, patch } = parsed.data;
  const entries = readAgentConfigEntries();
  const idx = entries.findIndex((a) => a.name === name);

  if (idx === -1) {
    return Response.json({ error: `Agent "${name}" not found` }, { status: 404 });
  }

  const updated = entries.map((a, i) => (i === idx ? Object.assign({}, a, patch) : a));
  writeAgentsConfig(updated);
  return Response.json({ agents: updated });
}

const deleteBodySchema = z.object({ name: z.string() });

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, deleteBodySchema);
  if (!parsed.ok) return parsed.response;

  const entries = readAgentConfigEntries();
  if (!entries.some((a) => a.name === parsed.data.name)) {
    return Response.json({ error: `Agent "${parsed.data.name}" not found` }, { status: 404 });
  }

  const updated = entries.filter((a) => a.name !== parsed.data.name);
  writeAgentsConfig(updated);
  return Response.json({ agents: updated });
}
