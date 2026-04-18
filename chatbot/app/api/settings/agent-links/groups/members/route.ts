/**
 * PUT /api/settings/agent-links/groups/members  — Replace a group's member list
 *
 * Members are independent of links: an agent can be a member without any links,
 * and links in the group are not forced to match membership.
 */

import { z } from "zod";
import { readAgentFile } from "@@/lib/agents-config";
import { readAgentLinksFile, writeAgentLinksFile } from "@@/lib/agent-links";
import { parseBody } from "@/lib/env-var-routes";

const bodySchema = z.object({
  name: z.string().min(1),
  members: z.array(z.string()),
});

export async function PUT(request: Request) {
  const parsed = await parseBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  const { name, members } = parsed.data;
  const unique = [...new Set(members)];

  const file = await readAgentLinksFile();
  const group = file.groups.find((g) => g.name === name);
  if (!group) {
    return Response.json({ error: `Group "${name}" not found` }, { status: 404 });
  }

  const missing: string[] = [];
  await Promise.all(
    unique.map(async (agentName) => {
      const agent = await readAgentFile(agentName);
      if (!agent) missing.push(agentName);
    }),
  );
  if (missing.length > 0) {
    return Response.json({ error: `Unknown agent(s): ${missing.join(", ")}` }, { status: 400 });
  }

  await writeAgentLinksFile({
    ...file,
    groups: file.groups.map((g) =>
      g.name === name ? Object.assign({}, g, { members: unique }) : g,
    ),
  });
  return Response.json({ ok: true });
}
