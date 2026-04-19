/**
 * GET  /api/settings/group-repos?group=<groupName>
 *   Returns { enabledRepoIds: string[] }
 *
 * PUT  /api/settings/group-repos
 *   Body: { groupName: string; enabledRepoIds: string[] }
 *   Saves the per-group repo selection.
 */

import { z } from "zod";
import { readOrCreateGroupConfig, patchGroupConfig } from "@@/lib/group-config";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const groupName = url.searchParams.get("group");
  if (!groupName) {
    return Response.json({ error: "Missing group query param" }, { status: 400 });
  }
  const config = readOrCreateGroupConfig(groupName);
  return Response.json({ enabledRepoIds: config.repos });
}

const putBodySchema = z.object({
  groupName: z.string().min(1),
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

  const { groupName, enabledRepoIds } = parsed.data;
  patchGroupConfig(groupName, { repos: enabledRepoIds });
  return Response.json({ enabledRepoIds });
}
