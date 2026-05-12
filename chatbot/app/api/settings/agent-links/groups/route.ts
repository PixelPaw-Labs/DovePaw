/**
 * POST   /api/settings/agent-links/groups  — Create a new group
 * PATCH  /api/settings/agent-links/groups  — Rename a group (updates all links in it)
 * DELETE /api/settings/agent-links/groups  — Delete a group (links become ungrouped)
 */

import { z } from "zod";
import { readAgentLinksFile, writeAgentLinksFile } from "@@/lib/agent-links";
import { parseBody } from "@/lib/env-var-routes";

const postBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, postBodySchema);
  if (!parsed.ok) return parsed.response;

  const { name, description } = parsed.data;
  const file = await readAgentLinksFile();

  if (file.groups.some((g) => g.name === name)) {
    return Response.json({ error: `Group "${name}" already exists` }, { status: 409 });
  }

  await writeAgentLinksFile({
    ...file,
    groups: [...file.groups, { name, members: [], description: description ?? "" }],
  });
  return Response.json({ ok: true }, { status: 201 });
}

const patchBodySchema = z
  .object({
    name: z.string().min(1),
    newName: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((v) => v.newName !== undefined || v.description !== undefined, {
    message: "At least one of newName or description must be provided",
  });

export async function PATCH(request: Request) {
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  const { name, newName, description } = parsed.data;
  const file = await readAgentLinksFile();

  if (!file.groups.some((g) => g.name === name)) {
    return Response.json({ error: `Group "${name}" not found` }, { status: 404 });
  }
  if (newName !== undefined && name !== newName && file.groups.some((g) => g.name === newName)) {
    return Response.json({ error: `Group "${newName}" already exists` }, { status: 409 });
  }

  const resolvedName = newName ?? name;
  await writeAgentLinksFile({
    ...file,
    groups: file.groups.map((g) => {
      if (g.name !== name) return g;
      return {
        ...g,
        name: resolvedName,
        ...(description !== undefined && { description }),
      };
    }),
    links:
      newName !== undefined && newName !== name
        ? file.links.map((l) => (l.group === name ? Object.assign({}, l, { group: newName }) : l))
        : file.links,
  });
  return Response.json({ ok: true });
}

const deleteBodySchema = z.object({
  name: z.string().min(1),
});

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, deleteBodySchema);
  if (!parsed.ok) return parsed.response;

  const { name } = parsed.data;
  const file = await readAgentLinksFile();

  await writeAgentLinksFile({
    ...file,
    groups: file.groups.filter((g) => g.name !== name),
    links: file.links.map((l) => {
      if (l.group !== name) return l;
      const copy = Object.assign({}, l);
      delete copy.group;
      return copy;
    }),
  });
  return Response.json({ ok: true });
}
