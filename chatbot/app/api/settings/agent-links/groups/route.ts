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
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, postBodySchema);
  if (!parsed.ok) return parsed.response;

  const { name } = parsed.data;
  const file = readAgentLinksFile();

  if (file.groups.includes(name)) {
    return Response.json({ error: `Group "${name}" already exists` }, { status: 409 });
  }

  writeAgentLinksFile({ ...file, groups: [...file.groups, name] });
  return Response.json({ ok: true }, { status: 201 });
}

const patchBodySchema = z.object({
  name: z.string().min(1),
  newName: z.string().min(1),
});

export async function PATCH(request: Request) {
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  const { name, newName } = parsed.data;
  const file = readAgentLinksFile();

  if (!file.groups.includes(name)) {
    return Response.json({ error: `Group "${name}" not found` }, { status: 404 });
  }
  if (name !== newName && file.groups.includes(newName)) {
    return Response.json({ error: `Group "${newName}" already exists` }, { status: 409 });
  }

  writeAgentLinksFile({
    ...file,
    groups: file.groups.map((g) => (g === name ? newName : g)),
    links: file.links.map((l) => (l.group === name ? Object.assign({}, l, { group: newName }) : l)),
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
  const file = readAgentLinksFile();

  writeAgentLinksFile({
    ...file,
    groups: file.groups.filter((g) => g !== name),
    // Ungroup all links that belonged to this group
    links: file.links.map((l) => {
      if (l.group !== name) return l;
      const copy = Object.assign({}, l);
      delete copy.group;
      return copy;
    }),
  });
  return Response.json({ ok: true });
}
